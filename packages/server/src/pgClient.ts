import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

export interface PgQueryResult {
    rows: any[];
    rowCount: number;
}

/**
 * Normalizes a PostgreSQL connection URL, stripping optional bracket wrappers
 * around the password like postgresql://postgres:[password]@host:5432/postgres
 */
export function normalizePostgresUrl(rawUrl: string): string {
    return rawUrl.trim().replace(/:(\[([^\]]+)\])@/, ':$2@');
}

function escapeSqlValue(val: any): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `'${str.replace(/'/g, "''")}'`;
}

export function interpolateSqlParams(sql: string, params: any[] = []): string {
    if (!params || params.length === 0) return sql;
    return sql.replace(/\$(\d+)/g, (_, idxStr) => {
        const idx = Number(idxStr) - 1;
        return idx >= 0 && idx < params.length ? escapeSqlValue(params[idx]) : 'NULL';
    });
}

/**
 * Lightweight zero-dependency PostgreSQL v3 Wire Protocol client over TLS
 * (with automatic usage of `pg` Pool if installed in node_modules).
 */
export class PostgresClient {
    private connectionUrl: string;
    private pgPool: any = null;

    constructor(connectionUrl: string) {
        this.connectionUrl = normalizePostgresUrl(connectionUrl);
    }

    async initialize(): Promise<void> {
        try {
            const pgMod = await import('pg' as string);
            const Pool = pgMod.Pool || pgMod.default?.Pool;
            if (Pool) {
                this.pgPool = new Pool({
                    connectionString: this.connectionUrl,
                    ssl: { rejectUnauthorized: false }
                });
                await this.pgPool.query('SELECT 1');
                return;
            }
        } catch {
            // Fallback to native TLS wire protocol client
        }

        const res = await this.rawWireQuery('SELECT 1 AS ok');
        if (!res || !Array.isArray(res.rows)) {
            throw new Error('Failed to verify PostgreSQL wire connection');
        }
    }

    async query(sql: string, params: any[] = []): Promise<PgQueryResult> {
        if (this.pgPool) {
            const res = await this.pgPool.query(sql, params);
            return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        }
        const finalSql = interpolateSqlParams(sql, params);
        return this.rawWireQuery(finalSql);
    }

    async close(): Promise<void> {
        if (this.pgPool) {
            await this.pgPool.end().catch(() => {});
            this.pgPool = null;
        }
    }

    private rawWireQuery(sql: string): Promise<PgQueryResult> {
        const parsed = new URL(this.connectionUrl);
        const host = parsed.hostname;
        const port = Number(parsed.port || 5432);
        const user = decodeURIComponent(parsed.username || 'postgres');
        const password = decodeURIComponent(parsed.password || '');
        const database = decodeURIComponent((parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`PostgreSQL connection timeout to ${host}:${port}`));
            }, 10000);

            let rawSocket: net.Socket | null = null;
            let tlsSocket: tls.TLSSocket | null = null;
            let cleaned = false;

            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                clearTimeout(timeout);
                try { tlsSocket?.destroy(); } catch {}
                try { rawSocket?.destroy(); } catch {}
            };

            rawSocket = net.connect(port, host, () => {
                // Send SSLRequest (length=8, code=80877103)
                const sslReq = Buffer.alloc(8);
                sslReq.writeInt32BE(8, 0);
                sslReq.writeInt32BE(80877103, 4);
                rawSocket!.write(sslReq);
            });

            rawSocket.on('error', (err) => {
                cleanup();
                reject(err);
            });

            rawSocket.once('data', (chunk) => {
                if (chunk[0] !== 0x53) { // 'S'
                    cleanup();
                    reject(new Error('PostgreSQL server does not support SSL'));
                    return;
                }

                tlsSocket = tls.connect({
                    socket: rawSocket!,
                    servername: host,
                    rejectUnauthorized: false
                }, () => {
                    this.runWireSession(tlsSocket!, user, password, database, sql)
                        .then((result) => {
                            cleanup();
                            resolve(result);
                        })
                        .catch((err) => {
                            cleanup();
                            reject(err);
                        });
                });

                tlsSocket.on('error', (err) => {
                    cleanup();
                    reject(err);
                });
            });
        });
    }

    private runWireSession(
        socket: tls.TLSSocket,
        user: string,
        password: string,
        database: string,
        sql: string
    ): Promise<PgQueryResult> {
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            let clientNonce = '';
            let clientFirstBare = '';
            let querySent = false;
            let columns: string[] = [];
            const rows: any[] = [];
            let rowCount = 0;
            let queryError: string | null = null;

            // Send StartupMessage (v3.0 = 196608)
            const paramsStr = `user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`;
            const paramsBuf = Buffer.from(paramsStr, 'utf8');
            const startupBuf = Buffer.alloc(8 + paramsBuf.length);
            startupBuf.writeInt32BE(8 + paramsBuf.length, 0);
            startupBuf.writeInt32BE(196608, 4);
            paramsBuf.copy(startupBuf, 8);
            socket.write(startupBuf);

            const sendPacket = (typeChar: string, payload: Buffer) => {
                const pkt = Buffer.alloc(5 + payload.length);
                pkt.write(typeChar, 0, 1, 'ascii');
                pkt.writeInt32BE(4 + payload.length, 1);
                payload.copy(pkt, 5);
                socket.write(pkt);
            };

            socket.on('data', (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= 5) {
                    const msgType = String.fromCharCode(buffer[0]);
                    const msgLen = buffer.readInt32BE(1);
                    if (buffer.length < 1 + msgLen) break;

                    const body = buffer.subarray(5, 1 + msgLen);
                    buffer = buffer.subarray(1 + msgLen);

                    if (msgType === 'R') {
                        const authType = body.readInt32BE(0);
                        if (authType === 0) {
                            // AuthenticationOk
                        } else if (authType === 3) {
                            // CleartextPassword
                            sendPacket('p', Buffer.from(`${password}\0`, 'utf8'));
                        } else if (authType === 10) {
                            // SASL (SCRAM-SHA-256)
                            clientNonce = crypto.randomBytes(18).toString('base64');
                            clientFirstBare = `n=,r=${clientNonce}`;
                            const clientFirstMsg = `n,,${clientFirstBare}`;
                            const mechBuf = Buffer.from('SCRAM-SHA-256\0', 'utf8');
                            const msgBuf = Buffer.from(clientFirstMsg, 'utf8');
                            const saslInit = Buffer.alloc(mechBuf.length + 4 + msgBuf.length);
                            mechBuf.copy(saslInit, 0);
                            saslInit.writeInt32BE(msgBuf.length, mechBuf.length);
                            msgBuf.copy(saslInit, mechBuf.length + 4);
                            sendPacket('p', saslInit);
                        } else if (authType === 11) {
                            // AuthenticationSASLContinue
                            const serverFirst = body.subarray(4).toString('utf8');
                            const parts: Record<string, string> = {};
                            for (const item of serverFirst.split(',')) {
                                const eq = item.indexOf('=');
                                if (eq > 0) parts[item.slice(0, eq)] = item.slice(eq + 1);
                            }
                            const serverNonce = parts.r || '';
                            const salt = Buffer.from(parts.s || '', 'base64');
                            const iterations = parseInt(parts.i || '4096', 10);

                            const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
                            const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
                            const storedKey = crypto.createHash('sha256').update(clientKey).digest();
                            const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
                            const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
                            const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
                            const clientProof = Buffer.alloc(clientKey.length);
                            for (let i = 0; i < clientKey.length; i++) {
                                clientProof[i] = clientKey[i] ^ clientSignature[i];
                            }
                            const clientFinal = `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`;
                            sendPacket('p', Buffer.from(clientFinal, 'utf8'));
                        } else if (authType === 12) {
                            // AuthenticationSASLFinal
                        }
                    } else if (msgType === 'Z') {
                        // ReadyForQuery
                        if (!querySent) {
                            querySent = true;
                            sendPacket('Q', Buffer.from(`${sql}\0`, 'utf8'));
                        } else {
                            sendPacket('X', Buffer.alloc(0));
                            if (queryError) {
                                reject(new Error(queryError));
                            } else {
                                resolve({ rows, rowCount });
                            }
                            return;
                        }
                    } else if (msgType === 'T') {
                        // RowDescription
                        const numFields = body.readInt16BE(0);
                        let offset = 2;
                        columns = [];
                        for (let i = 0; i < numFields; i++) {
                            const nullIdx = body.indexOf(0, offset);
                            const colName = body.subarray(offset, nullIdx).toString('utf8');
                            columns.push(colName);
                            offset = nullIdx + 1 + 18;
                        }
                    } else if (msgType === 'D') {
                        // DataRow
                        const numCols = body.readInt16BE(0);
                        let offset = 2;
                        const rowObj: Record<string, any> = {};
                        for (let i = 0; i < numCols; i++) {
                            const colLen = body.readInt32BE(offset);
                            offset += 4;
                            const colName = columns[i] || `col_${i}`;
                            if (colLen === -1) {
                                rowObj[colName] = null;
                            } else {
                                const valStr = body.subarray(offset, offset + colLen).toString('utf8');
                                offset += colLen;
                                rowObj[colName] = valStr;
                            }
                        }
                        rows.push(rowObj);
                    } else if (msgType === 'C') {
                        // CommandComplete
                        const tag = body.subarray(0, body.indexOf(0)).toString('utf8');
                        const match = tag.match(/(\d+)$/);
                        if (match) rowCount = Number(match[1]);
                    } else if (msgType === 'E') {
                        // ErrorResponse
                        let offset = 0;
                        let errMsg = 'PostgreSQL error';
                        while (offset < body.length && body[offset] !== 0) {
                            const code = String.fromCharCode(body[offset]);
                            offset++;
                            const end = body.indexOf(0, offset);
                            const str = body.subarray(offset, end).toString('utf8');
                            if (code === 'M') errMsg = str;
                            offset = end + 1;
                        }
                        if (!querySent) {
                            reject(new Error(errMsg));
                            return;
                        }
                        queryError = errMsg;
                    }
                }
            });
        });
    }
}
