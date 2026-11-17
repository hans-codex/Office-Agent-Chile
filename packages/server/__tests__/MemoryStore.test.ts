import { MemoryStore, PersistedAgentProfile } from '../src/memory/MemoryStore';
import fs from 'fs/promises';
import path from 'path';

describe('MemoryStore Unit Tests', () => {
    let memoryStore: MemoryStore;
    const testDbPath = path.resolve(process.cwd(), 'data', 'unit-test-memory.db');
    const testJsonPath = path.resolve(process.cwd(), 'data', 'unit-test-memory.json');

    beforeAll(async () => {
        // Clean up previous test artifacts if any
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}

        memoryStore = new MemoryStore();
        await memoryStore.initialize(testDbPath);
    });

    afterAll(async () => {
        await memoryStore.close();
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}
    });

    test('should save and load agent profiles', async () => {
        const profile: PersistedAgentProfile = {
            id: 'test_agent_1',
            name: 'Test Engineer',
            role: 'Tester',
            avatar: 'char_3',
            x: 12,
            y: 18,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            systemPrompt: 'You are a test agent.',
            communicationStyle: 'technical',
            skills: ['fullstack-engineer'],
            allowedTools: ['code_execute', 'complete_task']
        };

        await memoryStore.saveAgentProfile(profile);

        const loaded = await memoryStore.loadAgentProfiles();
        const found = loaded.find(p => p.id === 'test_agent_1');
        expect(found).toBeDefined();
        expect(found?.name).toBe('Test Engineer');
        expect(found?.provider).toBe('gemini');
        expect(found?.avatar).toBe('char_3');
        expect(found?.skills).toContain('fullstack-engineer');
    });

    test('should delete an agent profile', async () => {
        await memoryStore.deleteAgentProfile('test_agent_1');
        const loaded = await memoryStore.loadAgentProfiles();
        const found = loaded.find(p => p.id === 'test_agent_1');
        expect(found).toBeUndefined();
    });

    test('should save and load custom skills', async () => {
        const customSkill = {
            id: 'security-analyst',
            name: 'Security Analyst',
            description: 'Audits vulnerabilities and validates tokens',
            category: 'Security',
            recommendedTools: ['code_execute', 'read_file'],
            instructions: 'Analyze code for OWASP vulnerabilities.',
            source: 'custom' as const
        };

        await memoryStore.saveCustomSkill(customSkill);

        const skills = await memoryStore.loadCustomSkills();
        const found = skills.find(s => s.id === 'security-analyst');
        expect(found).toBeDefined();
        expect(found?.name).toBe('Security Analyst');
        expect(found?.category).toBe('Security');
    });

    test('should create, assign, and complete tasks (by id and title)', async () => {
        const taskId = await memoryStore.createTask('Test Auth Flow', 'test_agent_1');
        expect(taskId).toBeDefined();

        const tasks = await memoryStore.getTasks();
        const task = tasks.find(t => t.title === 'Test Auth Flow');
        expect(task).toBeDefined();
        expect(task?.assigned_to).toBe('test_agent_1');

        // Complete by title
        await memoryStore.completeTaskByTitle('Test Auth Flow');
        const updatedTasks = await memoryStore.getTasks();
        const completedTask = updatedTasks.find(t => t.title === 'Test Auth Flow');
        expect(completedTask?.status).toBe('completed');
    });
});
