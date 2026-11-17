import { OfficeRoom } from '../src/rooms/OfficeRoom';
import fs from 'fs/promises';
import path from 'path';

describe('OfficeRoom Unit Tests', () => {
    let room: OfficeRoom;
    const testDbPath = path.resolve(process.cwd(), 'data', 'office-room-test.db');
    const testJsonPath = path.resolve(process.cwd(), 'data', 'office-room-test.json');

    beforeAll(async () => {
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}
    });

    afterAll(async () => {
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}
        try { await fs.rm(path.resolve(process.cwd(), '../../skills', 'site-reliability'), { recursive: true, force: true }); } catch {}
        try { await fs.rm(path.resolve(process.cwd(), 'skills', 'site-reliability'), { recursive: true, force: true }); } catch {}
    });

    beforeEach(async () => {
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}

        room = new OfficeRoom();
        await room.onCreate({ name: 'Test HQ', dbPath: testDbPath });
        if ((room as any)._simulationInterval) {
            clearInterval((room as any)._simulationInterval);
        }
    });

    afterEach(async () => {
        await room.onDispose();
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testJsonPath); } catch {}
    });

    test('should initialize registries and seed default agents Alice & Bob', () => {
        const skills = room.getSkills();
        expect(skills.length).toBeGreaterThanOrEqual(5);

        const tools = room.getTools();
        expect(tools.length).toBe(10);

        const profiles = room.getAgentProfiles();
        expect(profiles.length).toBe(2);

        const ids = profiles.map(p => p.id);
        expect(ids).toContain('alice');
        expect(ids).toContain('bob');

        const alice = profiles.find(p => p.id === 'alice');
        expect(alice?.skills).toContain('fullstack-engineer');
        expect(alice?.allowedTools).toContain('complete_task');
    });

    test('should handle create-agent message', async () => {
        const mockClient: any = { sessionId: 'test-client', send: jest.fn() };
        const newAgentMsg = {
            id: 'carol',
            name: 'Carol',
            role: 'Security Auditor',
            avatar: 'char_2',
            provider: 'openai',
            model: 'gpt-4o-mini',
            skills: ['qa-security-auditor'],
            allowedTools: ['code_execute', 'read_file', 'complete_task']
        };

        // Invoke create-agent handler
        const handler = (room as any).onMessageHandlers['create-agent'];
        expect(handler).toBeDefined();

        await handler(mockClient, newAgentMsg);

        const profiles = room.getAgentProfiles();
        expect(profiles.length).toBe(3);

        const carol = profiles.find(p => p.id === 'carol');
        expect(carol).toBeDefined();
        expect(carol?.role).toBe('Security Auditor');
        expect(carol?.provider).toBe('openai');
        expect(carol?.skills).toContain('qa-security-auditor');
    });

    test('should handle update-agent message', async () => {
        const mockClient: any = { sessionId: 'test-client', send: jest.fn() };
        const updateMsg = {
            id: 'alice',
            role: 'Lead Architect',
            provider: 'openrouter',
            model: 'google/gemini-2.5-flash',
            skills: ['fullstack-engineer', 'qa-security-auditor']
        };

        const handler = (room as any).onMessageHandlers['update-agent'];
        expect(handler).toBeDefined();

        await handler(mockClient, updateMsg);

        const alice = room.getAgentProfiles().find(p => p.id === 'alice');
        expect(alice).toBeDefined();
        expect(alice?.role).toBe('Lead Architect');
        expect(alice?.provider).toBe('openrouter');
        expect(alice?.skills).toContain('qa-security-auditor');
    });

    test('should handle delete-agent message', async () => {
        const mockClient: any = { sessionId: 'test-client', send: jest.fn() };
        const handler = (room as any).onMessageHandlers['delete-agent'];
        expect(handler).toBeDefined();

        await handler(mockClient, { id: 'bob' });

        const profiles = room.getAgentProfiles();
        expect(profiles.find(p => p.id === 'bob')).toBeUndefined();
    });

    test('should handle save-skill message', async () => {
        const mockClient: any = { sessionId: 'test-client', send: jest.fn() };
        const handler = (room as any).onMessageHandlers['save-skill'];
        expect(handler).toBeDefined();

        await handler(mockClient, {
            id: 'site-reliability',
            name: 'Site Reliability',
            description: 'Monitors service health and uptime',
            category: 'Operations',
            recommendedTools: ['http_request'],
            instructions: 'Monitor endpoints and report status codes.'
        });

        const skill = room.getSkills().find(s => s.id === 'site-reliability');
        expect(skill).toBeDefined();
        expect(skill?.name).toBe('Site Reliability');
    });

    test('should handle complete-task message', async () => {
        const mockClient: any = { sessionId: 'test-client', send: jest.fn() };
        const handler = (room as any).onMessageHandlers['complete-task'];
        expect(handler).toBeDefined();

        await handler(mockClient, {
            title: 'Audit System Logs',
            summary: 'All logs checked with zero warnings.'
        });

        // Verify task completion runs without errors
        expect(true).toBe(true);
    });

    test('should send catalog synchronization on onJoin', () => {
        const sentMessages: Record<string, any> = {};
        const mockClient: any = {
            sessionId: 'client-1',
            send: jest.fn((type, data) => {
                sentMessages[type] = data;
            })
        };

        room.onJoin(mockClient, {});

        expect(mockClient.send).toHaveBeenCalledWith('skills-sync', expect.any(Array));
        expect(mockClient.send).toHaveBeenCalledWith('tools-sync', expect.any(Array));
        expect(mockClient.send).toHaveBeenCalledWith('agent-profiles-sync', expect.any(Array));

        expect(sentMessages['skills-sync'].length).toBeGreaterThanOrEqual(5);
        expect(sentMessages['tools-sync'].length).toBe(10);
        expect(sentMessages['agent-profiles-sync'].length).toBeGreaterThanOrEqual(2);
    });
});
