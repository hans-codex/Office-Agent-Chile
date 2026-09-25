import { ToolDefinition } from '@agent-office/core';

export const BUILTIN_TOOLS: ToolDefinition[] = [
    {
        name: 'code_execute',
        description: 'Execute sandboxed JavaScript code to compute values, test algorithms, or transform data.',
        category: 'code',
        parameters: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Valid JavaScript code body to execute (can return a value or use console.log).' },
                language: { type: 'string', description: 'Language identifier (must be "javascript").', enum: ['javascript'] }
            },
            required: ['code']
        },
        example: { code: 'return [1, 2, 3].map(n => n * 2);', language: 'javascript' }
    },
    {
        name: 'web_search',
        description: 'Search the web for technical documentation, market facts, or general information.',
        category: 'web',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Concise search query keywords.' }
            },
            required: ['query']
        },
        example: { query: 'TypeScript 5.4 new features summary' }
    },
    {
        name: 'http_request',
        description: 'Fetch JSON or text from a public HTTP/REST API endpoint.',
        category: 'web',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full HTTPS URL to request.' },
                method: { type: 'string', description: 'HTTP method (GET or POST).', enum: ['GET', 'POST'] }
            },
            required: ['url']
        },
        example: { url: 'https://api.github.com/repos/harishkotra/agent-office', method: 'GET' }
    },
    {
        name: 'read_file',
        description: 'Read the contents of a file inside the shared office workspace folder.',
        category: 'files',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Relative file path inside workspace (e.g., "prd.md" or "architecture.json").' }
            },
            required: ['path']
        },
        example: { path: 'notes.md' }
    },
    {
        name: 'write_file',
        description: 'Create or overwrite a file (Markdown, JSON, JS, TS, HTML) in the shared office workspace folder.',
        category: 'files',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Relative file path inside workspace (e.g., "specs/prd.md").' },
                content: { type: 'string', description: 'Full text content to write to the file.' }
            },
            required: ['path', 'content']
        },
        example: { path: 'specs/mvp.md', content: '# MVP Spec\n- Feature 1\n- Feature 2' }
    },
    {
        name: 'list_files',
        description: 'List all files currently stored in the shared office workspace folder.',
        category: 'files',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        example: {}
    },
    {
        name: 'write_note',
        description: 'Save a quick internal memo or observation to the office knowledge log.',
        category: 'office',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The memo or note text.' }
            },
            required: ['content']
        },
        example: { content: 'API latency spikes when payload exceeds 2MB.' }
    },
    {
        name: 'create_task',
        description: 'Create a new task on the Office TaskBoard and assign it to yourself or a teammate.',
        category: 'office',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Clear, actionable task title.' },
                assignee: { type: 'string', description: 'Agent ID or name to assign the task to (e.g., "alice", "bob").' }
            },
            required: ['title']
        },
        example: { title: 'Write unit tests for authentication module', assignee: 'alice' }
    },
    {
        name: 'complete_task',
        description: 'Mark your current task as completed and broadcast the deliverable summary to the team.',
        category: 'office',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Brief summary of what was accomplished.' }
            },
            required: ['summary']
        },
        example: { summary: 'Implemented and verified the auth module in workspace/auth.js' }
    },
    {
        name: 'hire_agent',
        description: 'Hire a new specialized AI agent to join the office team with specific skills and tools.',
        category: 'office',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the new teammate (e.g., "Diana", "Carlos").' },
                role: { type: 'string', description: 'Role title (e.g., "QA Security Engineer", "Research Analyst").' },
                skills: { type: 'string', description: 'Comma-separated skill IDs (e.g., "qa-security-auditor,fullstack-engineer").' }
            },
            required: ['name', 'role']
        },
        example: { name: 'Diana', role: 'QA Security Auditor', skills: 'qa-security-auditor' }
    }
];

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    constructor() {
        for (const tool of BUILTIN_TOOLS) {
            this.tools.set(tool.name, tool);
        }
    }

    public registerTool(tool: ToolDefinition) {
        this.tools.set(tool.name, tool);
    }

    public get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    public getMany(names: string[]): ToolDefinition[] {
        return names.map(n => this.tools.get(n)).filter(Boolean) as ToolDefinition[];
    }

    public getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }
}
