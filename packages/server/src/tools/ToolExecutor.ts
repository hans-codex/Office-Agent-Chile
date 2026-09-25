import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { tavily, type TavilyClient, type TavilySearchResponse } from '@tavily/core';

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

export class ToolExecutor {
    private tavilyClient: TavilyClient | null = null;
    private workspaceDir: string;

    constructor(workspaceDir?: string) {
        this.workspaceDir = workspaceDir || path.resolve(process.cwd(), 'workspace');
    }

    private async ensureWorkspace(): Promise<string> {
        await fs.mkdir(this.workspaceDir, { recursive: true });
        return this.workspaceDir;
    }

    private resolveSafeWorkspacePath(relativePath: string): string | null {
        const clean = String(relativePath || '').replace(/^[/\\]+/, '');
        if (!clean || clean.includes('..')) return null;
        const resolved = path.resolve(this.workspaceDir, clean);
        if (!resolved.startsWith(path.resolve(this.workspaceDir))) return null;
        return resolved;
    }

    private getTavilyClient(): TavilyClient | null {
        if (this.tavilyClient) return this.tavilyClient;
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
            this.tavilyClient = tavily({ apiKey });
            return this.tavilyClient;
        }
        return null;
    }

    async execute(toolName: string, params: any = {}): Promise<ToolResult> {
        switch (toolName) {
            case 'code_execute':
                return this.executeCode(params.code || '', params.language || 'javascript');
            case 'web_search':
                return this.webSearch(params.query || '');
            case 'http_request':
                return this.httpRequest(params.url || '', params.method || 'GET', params.body);
            case 'write_note':
                return this.writeNote(params.content || '');
            case 'read_file':
                return this.readFile(params.path || '');
            case 'write_file':
                return this.writeFile(params.path || '', params.content || '');
            case 'list_files':
                return this.listFiles();
            default:
                return {
                    success: false,
                    output: '',
                    error: `Unknown tool "${toolName}". Check your <available_tools> list and use an exact tool name.`
                };
        }
    }

    private executeCode(code: string, language: string): Promise<ToolResult> {
        return new Promise((resolve) => {
            if (!code.trim()) {
                resolve({ success: false, output: '', error: 'Parameter "code" is required for code_execute.' });
                return;
            }
            if (language !== 'javascript' && language !== 'js') {
                resolve({ success: false, output: '', error: 'Only JavaScript ("javascript") is supported for sandboxed execution.' });
                return;
            }

            const encoded = Buffer.from(code, 'utf-8').toString('base64');
            const runner = `
                const __timeout = setTimeout(() => { console.error('Execution timed out (5s)'); process.exit(1); }, 5000);
                (async () => {
                    try {
                        const fn = new Function(Buffer.from('${encoded}', 'base64').toString('utf-8'));
                        const result = await fn();
                        if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result));
                        clearTimeout(__timeout);
                    } catch (e) {
                        console.error(e && e.message ? e.message : String(e));
                        clearTimeout(__timeout);
                        process.exit(1);
                    }
                })();
            `.replace(/\s+/g, ' ').trim();

            exec(`node -e "${runner.replace(/"/g, '\\"')}"`, { timeout: 6000 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, output: stderr || error.message, error: (stderr || error.message).trim() });
                } else {
                    resolve({ success: true, output: (stdout || 'Executed successfully (no output).').trim().slice(0, 800) });
                }
            });
        });
    }

    private async webSearch(query: string): Promise<ToolResult> {
        if (!query.trim()) {
            return { success: false, output: '', error: 'Parameter "query" is required for web_search.' };
        }
        const client = this.getTavilyClient();
        if (client) {
            return this.webSearchTavily(query, client);
        }
        return this.webSearchDuckDuckGo(query);
    }

    private async webSearchTavily(query: string, client: TavilyClient): Promise<ToolResult> {
        try {
            const response = await client.search(query, { maxResults: 5 });
            const results = (response.results || [])
                .map((r: TavilySearchResponse['results'][number]) => `${r.title}: ${r.content}`)
                .join('\n\n');

            const output = results ? `Results:\n${results}` : `No results for "${query}".`;
            return { success: true, output: output.slice(0, 1000) };
        } catch (e: any) {
            return { success: false, output: '', error: `Tavily search failed: ${e.message}` };
        }
    }

    private async webSearchDuckDuckGo(query: string): Promise<ToolResult> {
        try {
            const encoded = encodeURIComponent(query);
            const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
            const data = await res.json();

            const abstract = data.Abstract || data.AbstractText || '';
            const relatedTopics = (data.RelatedTopics || []).slice(0, 3).map((t: any) => t.Text || '').join('; ');

            const output = abstract
                ? `Result: ${abstract}`
                : relatedTopics
                    ? `Related: ${relatedTopics}`
                    : `Search executed for "${query}" (no instant summary available).`;

            return { success: true, output: output.slice(0, 1000) };
        } catch (e: any) {
            return { success: false, output: '', error: `Search failed: ${e.message}` };
        }
    }

    private async httpRequest(url: string, method: string = 'GET', body?: any): Promise<ToolResult> {
        if (!url || !/^https?:\/\//i.test(url)) {
            return { success: false, output: '', error: 'Valid http/https "url" parameter is required.' };
        }
        try {
            const res = await fetch(url, {
                method: method.toUpperCase(),
                headers: { 'User-Agent': 'AgentOffice-ToolExecutor/1.0', 'Accept': 'application/json, text/plain, */*' },
                body: body && method.toUpperCase() !== 'GET' ? JSON.stringify(body) : undefined
            });
            const text = await res.text();
            return {
                success: res.ok,
                output: text.slice(0, 1000),
                error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`
            };
        } catch (e: any) {
            return { success: false, output: '', error: `HTTP request failed: ${e.message}` };
        }
    }

    private async writeNote(content: string): Promise<ToolResult> {
        if (!content.trim()) {
            return { success: false, output: '', error: 'Parameter "content" cannot be empty.' };
        }
        await this.ensureWorkspace();
        const notesPath = path.join(this.workspaceDir, 'office-notes.md');
        const entry = `\n- **[${new Date().toISOString()}]** ${content.trim()}`;
        await fs.appendFile(notesPath, entry, 'utf-8');
        return { success: true, output: `Note saved to workspace/office-notes.md: "${content.slice(0, 80)}"` };
    }

    private async readFile(relativePath: string): Promise<ToolResult> {
        await this.ensureWorkspace();
        const safePath = this.resolveSafeWorkspacePath(relativePath);
        if (!safePath) {
            return { success: false, output: '', error: 'Invalid file path. Must be a relative path inside the workspace without "..".' };
        }
        try {
            const content = await fs.readFile(safePath, 'utf-8');
            return { success: true, output: content.slice(0, 1200) };
        } catch (e: any) {
            return { success: false, output: '', error: `File not found or unreadable: ${relativePath}. Use list_files to see existing files.` };
        }
    }

    private async writeFile(relativePath: string, content: string): Promise<ToolResult> {
        await this.ensureWorkspace();
        const safePath = this.resolveSafeWorkspacePath(relativePath);
        if (!safePath) {
            return { success: false, output: '', error: 'Invalid file path. Must be a relative path inside the workspace without "..".' };
        }
        try {
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            await fs.writeFile(safePath, content, 'utf-8');
            return { success: true, output: `Wrote ${content.length} bytes to workspace/${relativePath}` };
        } catch (e: any) {
            return { success: false, output: '', error: `Failed to write file: ${e.message}` };
        }
    }

    private async listFiles(): Promise<ToolResult> {
        await this.ensureWorkspace();
        try {
            const walk = async (dir: string, prefix = ''): Promise<string[]> => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const results: string[] = [];
                for (const entry of entries) {
                    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        results.push(...await walk(path.join(dir, entry.name), rel));
                    } else {
                        results.push(rel);
                    }
                }
                return results;
            };
            const files = await walk(this.workspaceDir);
            return {
                success: true,
                output: files.length > 0 ? `Workspace files:\n${files.map(f => `- ${f}`).join('\n')}` : 'Workspace is currently empty.'
            };
        } catch (e: any) {
            return { success: false, output: '', error: e.message };
        }
    }
}
