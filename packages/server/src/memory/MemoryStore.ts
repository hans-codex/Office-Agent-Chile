import { MemoryEntry, SkillDefinition } from '@agent-office/core';
import fs from 'fs/promises';
import path from 'path';
import { PostgresClient } from '../pgClient';

export interface PersistedAgentProfile {
    id: string;
    name: string;
    role: string;
    avatar: string;
    x: number;
    y: number;
    provider: string;
    model: string;
    systemPrompt: string;
    communicationStyle: 'formal' | 'casual' | 'technical' | 'creative';
    skills: string[];
    allowedTools: string[];
}

interface JsonFallbackStore {
    memories: Array<{ agent_id: string; content: string; type: string; timestamp: string; importance: number; embedding?: string | null; session_id?: string | null }>;
    tasks: Array<{ id: number; title: string; assigned_to: string | null; status: string; created_at: string; completed_at?: string | null }>;
    layouts: Record<string, any>;
    agents: Record<string, PersistedAgentProfile>;
    skills: Record<string, SkillDefinition>;
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export class MemoryStore {
    private pgClient?: PostgresClient;
    private db?: any;
    private useJsonFallback = false;
    private jsonPath = './data/office-memory.json';
    private jsonData: JsonFallbackStore = {
        memories: [],
        tasks: [],
        layouts: {},
        agents: {},
        skills: {}
    };
    private ollamaUrl: string;

    constructor(ollamaUrl: string = 'http://localhost:11434') {
        this.ollamaUrl = ollamaUrl;
    }

    private async flushJson() {
        if (!this.useJsonFallback) return;
        await fs.mkdir(path.dirname(this.jsonPath), { recursive: true });
        await fs.writeFile(this.jsonPath, JSON.stringify(this.jsonData, null, 2), 'utf-8');
    }

    async initialize(dbPath?: string) {
        const targetConn = dbPath || process.env.DATABASE_URL || './data/office-memory.db';

        // 1. Check if PostgreSQL URL is configured (and not an explicit local file path passed by unit tests)
        if (/^postgres(ql)?:\/\//i.test(targetConn)) {
            try {
                const pg = new PostgresClient(targetConn);
                await pg.initialize();
                await pg.query(`
                    CREATE TABLE IF NOT EXISTS memories (
                        id SERIAL PRIMARY KEY,
                        agent_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        type TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
                        embedding TEXT,
                        session_id TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
                    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

                    CREATE TABLE IF NOT EXISTS tasks (
                        id SERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        assigned_to TEXT,
                        status TEXT DEFAULT 'pending',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        completed_at TIMESTAMPTZ
                    );

                    CREATE TABLE IF NOT EXISTS office_layout (
                        id SERIAL PRIMARY KEY,
                        layout_json TEXT NOT NULL,
                        name TEXT UNIQUE NOT NULL DEFAULT 'default',
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS custom_agents (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL,
                        avatar TEXT NOT NULL DEFAULT 'char_0',
                        x INTEGER NOT NULL DEFAULT 10,
                        y INTEGER NOT NULL DEFAULT 10,
                        provider TEXT NOT NULL DEFAULT 'gemini',
                        model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
                        system_prompt TEXT NOT NULL,
                        communication_style TEXT NOT NULL DEFAULT 'technical',
                        skills_json TEXT NOT NULL DEFAULT '[]',
                        tools_json TEXT NOT NULL DEFAULT '[]',
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS custom_skills (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        category TEXT NOT NULL DEFAULT 'Custom',
                        instructions TEXT NOT NULL,
                        recommended_tools_json TEXT NOT NULL DEFAULT '[]',
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );
                `);
                this.pgClient = pg;
                console.log('[MemoryStore] Connected to PostgreSQL (Supabase)');
                return;
            } catch (pgErr: any) {
                console.warn(`[MemoryStore] PostgreSQL connection warning (${pgErr?.message || pgErr}). Falling back to local store.`);
            }
        }

        const localFilePath = /^postgres(ql)?:\/\//i.test(targetConn)
            ? './data/office-memory.db'
            : targetConn;

        await fs.mkdir(path.dirname(localFilePath), { recursive: true });
        this.jsonPath = localFilePath.replace(/\.db$/i, '.json');

        try {
            const sqlite3Mod = await import('sqlite3');
            const sqlite3 = sqlite3Mod.default || sqlite3Mod;
            const { open } = await import('sqlite');

            this.db = await open({
                filename: localFilePath,
                driver: sqlite3.Database
            });

            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    importance REAL NOT NULL DEFAULT 0.5,
                    embedding TEXT,
                    session_id TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
                CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    assigned_to TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT DEFAULT (datetime('now')),
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS office_layout (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    layout_json TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT 'default',
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS custom_agents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    avatar TEXT NOT NULL DEFAULT 'char_0',
                    x INTEGER NOT NULL DEFAULT 10,
                    y INTEGER NOT NULL DEFAULT 10,
                    provider TEXT NOT NULL DEFAULT 'gemini',
                    model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
                    system_prompt TEXT NOT NULL,
                    communication_style TEXT NOT NULL DEFAULT 'technical',
                    skills_json TEXT NOT NULL DEFAULT '[]',
                    tools_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS custom_skills (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'Custom',
                    instructions TEXT NOT NULL,
                    recommended_tools_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT DEFAULT (datetime('now'))
                );
            `);

            try {
                await this.db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT');
            } catch {}

            console.log('[MemoryStore] SQLite initialized at', localFilePath);
        } catch {
            this.useJsonFallback = true;
            try {
                const raw = await fs.readFile(this.jsonPath, 'utf-8');
                const parsed = JSON.parse(raw);
                this.jsonData = {
                    memories: parsed.memories || [],
                    tasks: parsed.tasks || [],
                    layouts: parsed.layouts || {},
                    agents: parsed.agents || {},
                    skills: parsed.skills || {}
                };
            } catch {
                await this.flushJson();
            }
            console.log(`[MemoryStore] Using JSON persistence store at ${this.jsonPath}`);
        }
    }

    // --- Agent Profile Persistence ---

    async saveAgentProfile(profile: PersistedAgentProfile): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query(
                `INSERT INTO custom_agents (id, name, role, avatar, x, y, provider, model, system_prompt, communication_style, skills_json, tools_json, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                 ON CONFLICT(id) DO UPDATE SET
                    name = EXCLUDED.name,
                    role = EXCLUDED.role,
                    avatar = EXCLUDED.avatar,
                    x = EXCLUDED.x,
                    y = EXCLUDED.y,
                    provider = EXCLUDED.provider,
                    model = EXCLUDED.model,
                    system_prompt = EXCLUDED.system_prompt,
                    communication_style = EXCLUDED.communication_style,
                    skills_json = EXCLUDED.skills_json,
                    tools_json = EXCLUDED.tools_json,
                    updated_at = NOW()`,
                [
                    profile.id,
                    profile.name,
                    profile.role,
                    profile.avatar,
                    profile.x,
                    profile.y,
                    profile.provider,
                    profile.model,
                    profile.systemPrompt,
                    profile.communicationStyle,
                    JSON.stringify(profile.skills || []),
                    JSON.stringify(profile.allowedTools || [])
                ]
            );
            return;
        }
        if (this.useJsonFallback) {
            this.jsonData.agents[profile.id] = profile;
            await this.flushJson();
            return;
        }
        if (!this.db) return;
        await this.db.run(
            `INSERT INTO custom_agents (id, name, role, avatar, x, y, provider, model, system_prompt, communication_style, skills_json, tools_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                avatar = excluded.avatar,
                x = excluded.x,
                y = excluded.y,
                provider = excluded.provider,
                model = excluded.model,
                system_prompt = excluded.system_prompt,
                communication_style = excluded.communication_style,
                skills_json = excluded.skills_json,
                tools_json = excluded.tools_json,
                updated_at = datetime('now')`,
            [
                profile.id,
                profile.name,
                profile.role,
                profile.avatar,
                profile.x,
                profile.y,
                profile.provider,
                profile.model,
                profile.systemPrompt,
                profile.communicationStyle,
                JSON.stringify(profile.skills || []),
                JSON.stringify(profile.allowedTools || [])
            ]
        );
    }

    async loadAgentProfiles(): Promise<PersistedAgentProfile[]> {
        if (this.pgClient) {
            const res = await this.pgClient.query('SELECT * FROM custom_agents ORDER BY updated_at ASC');
            return res.rows.map((r: any) => ({
                id: r.id,
                name: r.name,
                role: r.role,
                avatar: r.avatar || 'char_0',
                x: Number(r.x ?? 10),
                y: Number(r.y ?? 10),
                provider: r.provider || 'gemini',
                model: r.model || 'gemini-3.1-flash-lite',
                systemPrompt: r.system_prompt || '',
                communicationStyle: (r.communication_style || 'casual') as any,
                skills: JSON.parse(r.skills_json || '[]'),
                allowedTools: JSON.parse(r.tools_json || '[]')
            }));
        }
        if (this.useJsonFallback) {
            return Object.values(this.jsonData.agents);
        }
        if (!this.db) return [];
        const rows = await this.db.all('SELECT * FROM custom_agents ORDER BY updated_at ASC');
        return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            role: r.role,
            avatar: r.avatar || 'char_0',
            x: Number(r.x ?? 10),
            y: Number(r.y ?? 10),
            provider: r.provider || 'gemini',
            model: r.model || 'gemini-3.1-flash-lite',
            systemPrompt: r.system_prompt || '',
            communicationStyle: r.communication_style || 'casual',
            skills: JSON.parse(r.skills_json || '[]'),
            allowedTools: JSON.parse(r.tools_json || '[]')
        }));
    }

    async deleteAgentProfile(id: string): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query('DELETE FROM custom_agents WHERE id = $1', [id]);
            return;
        }
        if (this.useJsonFallback) {
            delete this.jsonData.agents[id];
            await this.flushJson();
            return;
        }
        if (!this.db) return;
        await this.db.run('DELETE FROM custom_agents WHERE id = ?', [id]);
    }

    // --- Custom Skill Persistence ---

    async saveCustomSkill(skill: SkillDefinition): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query(
                `INSERT INTO custom_skills (id, name, description, category, instructions, recommended_tools_json, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT(id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    category = EXCLUDED.category,
                    instructions = EXCLUDED.instructions,
                    recommended_tools_json = EXCLUDED.recommended_tools_json,
                    updated_at = NOW()`,
                [
                    skill.id,
                    skill.name,
                    skill.description,
                    skill.category || 'Custom',
                    skill.instructions,
                    JSON.stringify(skill.recommendedTools || [])
                ]
            );
            return;
        }
        if (this.useJsonFallback) {
            this.jsonData.skills[skill.id] = skill;
            await this.flushJson();
            return;
        }
        if (!this.db) return;
        await this.db.run(
            `INSERT INTO custom_skills (id, name, description, category, instructions, recommended_tools_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                category = excluded.category,
                instructions = excluded.instructions,
                recommended_tools_json = excluded.recommended_tools_json,
                updated_at = datetime('now')`,
            [
                skill.id,
                skill.name,
                skill.description,
                skill.category || 'Custom',
                skill.instructions,
                JSON.stringify(skill.recommendedTools || [])
            ]
        );
    }

    async loadCustomSkills(): Promise<SkillDefinition[]> {
        if (this.pgClient) {
            const res = await this.pgClient.query('SELECT * FROM custom_skills ORDER BY updated_at ASC');
            return res.rows.map((r: any) => ({
                id: r.id,
                name: r.name,
                description: r.description,
                category: r.category || 'Custom',
                instructions: r.instructions,
                recommendedTools: JSON.parse(r.recommended_tools_json || '[]'),
                source: 'custom' as const
            }));
        }
        if (this.useJsonFallback) {
            return Object.values(this.jsonData.skills);
        }
        if (!this.db) return [];
        const rows = await this.db.all('SELECT * FROM custom_skills ORDER BY updated_at ASC');
        return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            category: r.category || 'Custom',
            instructions: r.instructions,
            recommendedTools: JSON.parse(r.recommended_tools_json || '[]'),
            source: 'custom' as const
        }));
    }

    // --- Embedding Generation ---

    private async generateEmbedding(text: string): Promise<number[] | null> {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'llama3.2:latest', prompt: text })
            });
            const data = await res.json();
            return data.embedding || null;
        } catch {
            return null;
        }
    }

    // --- Memory Operations ---

    async saveMemory(agentId: string, entry: MemoryEntry, sessionId?: string): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query(
                'INSERT INTO memories (agent_id, content, type, timestamp, importance, embedding, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [agentId, entry.content, entry.type, entry.timestamp, entry.importance, null, sessionId || null]
            );
            return;
        }
        if (this.useJsonFallback) {
            this.jsonData.memories.push({
                agent_id: agentId,
                content: entry.content,
                type: entry.type,
                timestamp: entry.timestamp,
                importance: entry.importance,
                session_id: sessionId || null
            });
            if (this.jsonData.memories.length > 500) {
                this.jsonData.memories = this.jsonData.memories.slice(-500);
            }
            await this.flushJson();
            return;
        }
        if (!this.db) return;
        let embeddingStr: string | null = null;
        if (entry.importance >= 0.5) {
            const embedding = await this.generateEmbedding(entry.content);
            if (embedding) embeddingStr = JSON.stringify(embedding);
        }
        await this.db.run(
            'INSERT INTO memories (agent_id, content, type, timestamp, importance, embedding, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [agentId, entry.content, entry.type, entry.timestamp, entry.importance, embeddingStr, sessionId || null]
        );
    }

    async saveMemories(agentId: string, entries: MemoryEntry[], sessionId?: string): Promise<void> {
        for (const entry of entries) {
            await this.saveMemory(agentId, entry, sessionId);
        }
    }

    async loadMemories(agentId: string, limit: number = 20): Promise<MemoryEntry[]> {
        if (this.pgClient) {
            const res = await this.pgClient.query(
                'SELECT content, type, timestamp, importance FROM memories WHERE agent_id = $1 ORDER BY importance DESC, created_at DESC LIMIT $2',
                [agentId, limit]
            );
            return res.rows.map((r: any) => ({
                content: r.content,
                type: r.type,
                timestamp: r.timestamp,
                importance: Number(r.importance ?? 0.5)
            }));
        }
        if (this.useJsonFallback) {
            return this.jsonData.memories
                .filter(m => m.agent_id === agentId)
                .sort((a, b) => b.importance - a.importance)
                .slice(0, limit)
                .map(r => ({
                    content: r.content,
                    type: r.type as any,
                    timestamp: r.timestamp,
                    importance: r.importance
                }));
        }
        if (!this.db) return [];
        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance FROM memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
            [agentId, limit]
        );
        return rows.map((r: any) => ({
            content: r.content,
            type: r.type,
            timestamp: r.timestamp,
            importance: r.importance
        }));
    }

    async semanticSearch(agentId: string, query: string, topK: number = 5): Promise<MemoryEntry[]> {
        if (this.pgClient || this.useJsonFallback || !this.db) return this.loadMemories(agentId, topK);
        const queryEmbedding = await this.generateEmbedding(query);
        if (!queryEmbedding) return this.loadMemories(agentId, topK);

        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance, embedding FROM memories WHERE agent_id = ? AND embedding IS NOT NULL',
            [agentId]
        );

        const scored = rows.map((r: any) => {
            const emb = JSON.parse(r.embedding);
            const score = cosineSimilarity(queryEmbedding, emb);
            return { content: r.content, type: r.type, timestamp: r.timestamp, importance: r.importance, score };
        }).sort((a: any, b: any) => b.score - a.score);

        return scored.slice(0, topK).map((s: any) => ({
            content: s.content,
            type: s.type,
            timestamp: s.timestamp,
            importance: s.importance
        }));
    }

    // --- Task Operations ---

    async createTask(title: string, assignedTo?: string): Promise<number> {
        if (this.pgClient) {
            const res = await this.pgClient.query(
                "INSERT INTO tasks (title, assigned_to, status) VALUES ($1, $2, 'in_progress') RETURNING id",
                [title, assignedTo || null]
            );
            return Number(res.rows[0]?.id || Date.now());
        }
        if (this.useJsonFallback) {
            const id = Date.now();
            this.jsonData.tasks.unshift({
                id,
                title,
                assigned_to: assignedTo || null,
                status: 'in_progress',
                created_at: new Date().toISOString()
            });
            await this.flushJson();
            return id;
        }
        if (!this.db) return -1;
        const result = await this.db.run(
            'INSERT INTO tasks (title, assigned_to) VALUES (?, ?)',
            [title, assignedTo || null]
        );
        return result.lastID || -1;
    }

    async getTasks(): Promise<any[]> {
        if (this.pgClient) {
            const res = await this.pgClient.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50');
            return res.rows.map((r: any) => ({
                ...r,
                id: Number(r.id)
            }));
        }
        if (this.useJsonFallback) {
            return this.jsonData.tasks.slice(0, 50);
        }
        if (!this.db) return [];
        return this.db.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50');
    }

    async assignTask(taskId: number, agentId: string): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query("UPDATE tasks SET assigned_to = $1, status = 'in_progress' WHERE id = $2", [agentId, taskId]);
            return;
        }
        if (this.useJsonFallback) {
            const task = this.jsonData.tasks.find(t => t.id === taskId);
            if (task) {
                task.assigned_to = agentId;
                task.status = 'in_progress';
                await this.flushJson();
            }
            return;
        }
        if (!this.db) return;
        await this.db.run('UPDATE tasks SET assigned_to = ?, status = ? WHERE id = ?', [agentId, 'in_progress', taskId]);
    }

    async completeTask(taskId: number): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query("UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1", [taskId]);
            return;
        }
        if (this.useJsonFallback) {
            const task = this.jsonData.tasks.find(t => t.id === taskId);
            if (task) {
                task.status = 'completed';
                task.completed_at = new Date().toISOString();
                await this.flushJson();
            }
            return;
        }
        if (!this.db) return;
        await this.db.run("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [taskId]);
    }

    async completeTaskByTitle(title: string): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query("UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE title = $1", [title]);
            return;
        }
        if (this.useJsonFallback) {
            const task = this.jsonData.tasks.find(t => t.title === title);
            if (task) {
                task.status = 'completed';
                task.completed_at = new Date().toISOString();
                await this.flushJson();
            }
            return;
        }
        if (!this.db) return;
        await this.db.run("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE title = ?", [title]);
    }

    // --- Layout Operations ---

    async saveLayout(name: string, layoutJson: string): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.query(
                `INSERT INTO office_layout (name, layout_json, updated_at) VALUES ($1, $2, NOW())
                 ON CONFLICT(name) DO UPDATE SET layout_json = EXCLUDED.layout_json, updated_at = NOW()`,
                [name, layoutJson]
            );
            return;
        }
        if (this.useJsonFallback) {
            this.jsonData.layouts[name] = JSON.parse(layoutJson);
            await this.flushJson();
            return;
        }
        if (!this.db) return;
        const existing = await this.db.get('SELECT id FROM office_layout WHERE name = ?', [name]);
        if (existing) {
            await this.db.run("UPDATE office_layout SET layout_json = ?, updated_at = datetime('now') WHERE name = ?", [layoutJson, name]);
        } else {
            await this.db.run('INSERT INTO office_layout (name, layout_json) VALUES (?, ?)', [name, layoutJson]);
        }
    }

    async loadLayout(name: string = 'default'): Promise<any | null> {
        if (this.pgClient) {
            const res = await this.pgClient.query('SELECT layout_json FROM office_layout WHERE name = $1', [name]);
            return res.rows[0] ? JSON.parse(res.rows[0].layout_json) : null;
        }
        if (this.useJsonFallback) {
            return this.jsonData.layouts[name] || null;
        }
        if (!this.db) return null;
        const row = await this.db.get('SELECT layout_json FROM office_layout WHERE name = ?', [name]);
        return row ? JSON.parse(row.layout_json) : null;
    }

    async close(): Promise<void> {
        if (this.pgClient) await this.pgClient.close();
        if (this.db) await this.db.close();
    }
}
