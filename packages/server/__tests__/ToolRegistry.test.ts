import { ToolRegistry } from '../src/tools/ToolRegistry';
import { ToolExecutor } from '../src/tools/ToolExecutor';
import path from 'path';
import fs from 'fs/promises';

describe('ToolRegistry Unit Tests', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    test('should initialize with all 10 built-in tools', () => {
        const tools = registry.getAll();
        expect(tools.length).toBe(10);

        const names = tools.map(t => t.name);
        expect(names).toContain('code_execute');
        expect(names).toContain('web_search');
        expect(names).toContain('http_request');
        expect(names).toContain('read_file');
        expect(names).toContain('write_file');
        expect(names).toContain('list_files');
        expect(names).toContain('write_note');
        expect(names).toContain('create_task');
        expect(names).toContain('complete_task');
        expect(names).toContain('hire_agent');
    });

    test('should retrieve individual tool with schema details', () => {
        const completeTool = registry.get('complete_task');
        expect(completeTool).toBeDefined();
        expect(completeTool?.name).toBe('complete_task');
        expect(completeTool?.category).toBe('office');
        expect(completeTool?.parameters.properties.summary).toBeDefined();
        expect(completeTool?.parameters.required).toContain('summary');
    });

    test('should retrieve multiple tools via getMany filtering missing ones', () => {
        const tools = registry.getMany(['code_execute', 'write_file', 'unknown_tool']);
        expect(tools.length).toBe(2);
        expect(tools.map(t => t.name)).toEqual(['code_execute', 'write_file']);
    });

    test('should allow registering custom tools', () => {
        registry.registerTool({
            name: 'send_webhook',
            description: 'Sends a webhook payload to external URL',
            category: 'web',
            parameters: {
                type: 'object',
                properties: {
                    endpoint: { type: 'string', description: 'Webhook URL' }
                },
                required: ['endpoint']
            }
        });

        const custom = registry.get('send_webhook');
        expect(custom).toBeDefined();
        expect(custom?.name).toBe('send_webhook');
        expect(registry.getAll().length).toBe(11);
    });
});

describe('ToolExecutor Resilience & Malformed Input Handling', () => {
    let executor: ToolExecutor;
    const testWorkspace = path.resolve(__dirname, 'fixtures', 'test-executor-workspace');

    beforeAll(async () => {
        await fs.mkdir(testWorkspace, { recursive: true });
        executor = new ToolExecutor(testWorkspace);
    });

    afterAll(async () => {
        await fs.rm(testWorkspace, { recursive: true, force: true }).catch(() => {});
    });

    test('calling execute complete_task with null params succeeds without throwing', async () => {
        const result = await executor.execute('complete_task', null);
        expect(result.success).toBe(true);
        expect(result.output).toContain('Task marked as completed');
    });

    test('calling execute complete_task with summary object or number', async () => {
        const result = await executor.execute('complete_task', { summary: 12345 });
        expect(result.success).toBe(true);
        expect(result.output).toBe('Task marked as completed: 12345');
    });

    test('calling execute code_execute with null params and malformed code types', async () => {
        const resNull = await executor.execute('code_execute', null);
        expect(resNull.success).toBe(false);
        expect(resNull.error).toBeDefined();

        const resNum = await executor.execute('code_execute', { code: 12345 });
        expect(resNum).toBeDefined();
        expect(typeof resNum.success).toBe('boolean');

        const resBool = await executor.execute('code_execute', { code: true });
        expect(resBool).toBeDefined();
        expect(typeof resBool.success).toBe('boolean');
    });

    test('calling execute web_search with null params and malformed query types', async () => {
        const resNull = await executor.execute('web_search', null);
        expect(resNull.success).toBe(false);
        expect(resNull.error).toBeDefined();

        const resNum = await executor.execute('web_search', { query: 99999 });
        expect(resNum).toBeDefined();
        expect(typeof resNum.success).toBe('boolean');
    });

    test('calling execute write_note with null params and malformed content types', async () => {
        const resNull = await executor.execute('write_note', null);
        expect(resNull.success).toBe(false);
        expect(resNull.error).toBeDefined();

        const resNum = await executor.execute('write_note', { content: 555 });
        expect(resNum.success).toBe(true);
        expect(resNum.output).toContain('Note saved');
    });

    test('calling execute read_file and write_file with null params returns failure without throwing', async () => {
        const resReadNull = await executor.execute('read_file', null);
        expect(resReadNull.success).toBe(false);
        expect(resReadNull.error).toBeDefined();

        const resWriteNull = await executor.execute('write_file', null);
        expect(resWriteNull.success).toBe(false);
        expect(resWriteNull.error).toBeDefined();
    });

    test('calling execute http_request, create_task, hire_agent, and list_files with null params', async () => {
        const resHttp = await executor.execute('http_request', null);
        expect(resHttp.success).toBe(false);
        expect(resHttp.error).toBeDefined();

        const resTask = await executor.execute('create_task', null);
        expect(resTask.success).toBe(true);

        const resHire = await executor.execute('hire_agent', null);
        expect(resHire.success).toBe(true);

        const resList = await executor.execute('list_files', null);
        expect(resList.success).toBe(true);
    });
});
