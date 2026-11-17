import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { OfficeRoom } from '../src/rooms/OfficeRoom';
import { app, colyseusServer } from '../src/index';
import { ToolExecutor } from '../src/tools/ToolExecutor';

/**
 * Dispatch an in-memory HTTP request directly through the Express app pipeline.
 * This exercises all middlewares (CORS, body parsing, route handlers) without requiring raw TCP sockets.
 */
function dispatchExpressRequest(appInstance: any, options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
}): Promise<{
    statusCode: number;
    headers: Record<string, any>;
    body: string;
    json: () => any;
}> {
    return new Promise((resolve) => {
        const req: any = new Readable();
        req._read = () => {};
        req.method = options.method.toUpperCase();
        req.url = options.url;
        req.headers = options.headers || {};
        if (options.headers?.Origin) {
            req.headers.origin = options.headers.Origin;
        }

        let statusCode = 200;
        const headers: Record<string, any> = {};
        let responseBody = '';

        const res: any = {
            statusCode: 200,
            status(code: number) {
                statusCode = code;
                this.statusCode = code;
                return this;
            },
            sendStatus(code: number) {
                statusCode = code;
                this.statusCode = code;
                this.end();
                return this;
            },
            header(name: string, val: any) {
                headers[name.toLowerCase()] = val;
                return this;
            },
            setHeader(name: string, val: any) {
                headers[name.toLowerCase()] = val;
                return this;
            },
            getHeader(name: string) {
                return headers[name.toLowerCase()];
            },
            json(data: any) {
                headers['content-type'] = 'application/json';
                responseBody = JSON.stringify(data);
                this.end();
            },
            send(data: any) {
                responseBody = typeof data === 'string' ? data : JSON.stringify(data);
                this.end();
            },
            end(chunk?: any) {
                if (chunk) responseBody += chunk;
                resolve({
                    statusCode,
                    headers,
                    body: responseBody,
                    json: () => {
                        try {
                            return JSON.parse(responseBody);
                        } catch {
                            return null;
                        }
                    }
                });
            }
        };

        if (options.body) {
            req.push(JSON.stringify(options.body));
        }
        req.push(null);

        appInstance(req, res);
    });
}

describe('Comprehensive E2E System Integration Test Suite', () => {
    let room: OfficeRoom;
    const testDbPath = path.resolve(process.cwd(), 'data', 'e2e-integration-test.db');
    const testJsonPath = path.resolve(process.cwd(), 'data', 'e2e-integration-test.json');
    const mockClient: any = {
        sessionId: 'client-e2e-tester',
        send: jest.fn()
    };
    const capturedBroadcasts: Array<{ type: string; payload: any }> = [];

    beforeAll(async () => {
        try { await fsp.unlink(testDbPath); } catch {}
        try { await fsp.unlink(testJsonPath); } catch {}
    });

    afterAll(async () => {
        try { await fsp.unlink(testDbPath); } catch {}
        try { await fsp.unlink(testJsonPath); } catch {}
        // Cleanup any custom skill test folder if created
        const customSkillPath = path.resolve(process.cwd(), '../../skills', 'cloud-infrastructure');
        const customSkillLocal = path.resolve(process.cwd(), 'skills', 'cloud-infrastructure');
        try { await fsp.rm(customSkillPath, { recursive: true, force: true }); } catch {}
        try { await fsp.rm(customSkillLocal, { recursive: true, force: true }); } catch {}
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 1: Full Monorepo Build and Startup verification
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 1: Full Monorepo Build and Startup verification', async () => {
        const repoRoot = path.resolve(process.cwd(), '../..');

        // Verify build outputs exist across all monorepo packages
        const coreDist = path.resolve(repoRoot, 'packages/core/dist/index.js');
        const adaptersDist = path.resolve(repoRoot, 'packages/adapters/dist/index.js');
        const serverDist = path.resolve(repoRoot, 'packages/server/dist/index.js');
        const uiDistHtml = path.resolve(repoRoot, 'packages/ui/dist/index.html');

        expect(fs.existsSync(coreDist)).toBe(true);
        expect(fs.existsSync(adaptersDist)).toBe(true);
        expect(fs.existsSync(serverDist)).toBe(true);
        expect(fs.existsSync(uiDistHtml)).toBe(true);

        // Verify server startup abstractions
        expect(app).toBeDefined();
        expect(typeof app.use).toBe('function');
        expect(colyseusServer).toBeDefined();

        // Verify root Markdown skills exist and contain instructions
        const skillsDir = path.resolve(repoRoot, 'skills');
        expect(fs.existsSync(skillsDir)).toBe(true);
        const requiredSkills = [
            'fullstack-engineer',
            'product-manager',
            'qa-security-auditor',
            'research-analyst',
            'team-lead-recruiter'
        ];
        for (const skillId of requiredSkills) {
            const skillFile = path.resolve(skillsDir, skillId, 'SKILL.md');
            expect(fs.existsSync(skillFile)).toBe(true);
            const content = fs.readFileSync(skillFile, 'utf-8');
            expect(content.length).toBeGreaterThan(50);
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 2: Dynamic Agent Lifecycle roundtrip
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 2: Dynamic Agent Lifecycle roundtrip', async () => {
        room = new OfficeRoom();
        await room.onCreate({ name: 'Integration HQ', dbPath: testDbPath });
        if ((room as any)._simulationInterval) {
            clearInterval((room as any)._simulationInterval);
        }

        // Spy on room broadcasts and record events
        const origBroadcast = room.broadcast.bind(room);
        room.broadcast = jest.fn((type: string, payload: any) => {
            capturedBroadcasts.push({ type, payload });
            return origBroadcast(type, payload);
        }) as any;

        // Create new dynamic agent: avatar char_2, skills: fullstack-engineer, research-analyst,
        // tools: code_execute, read_file, write_file, complete_task
        const newAgentPayload = {
            id: 'diana',
            name: 'Diana',
            role: 'Senior System Architect',
            avatar: 'char_2',
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            skills: ['fullstack-engineer', 'research-analyst'],
            allowedTools: ['code_execute', 'read_file', 'write_file', 'complete_task'],
            systemPrompt: 'You are Diana, Senior System Architect.',
            communicationStyle: 'technical'
        };

        const createHandler = (room as any).onMessageHandlers['create-agent'];
        expect(createHandler).toBeDefined();
        await createHandler(mockClient, newAgentPayload);

        // Verify core agent instance
        const coreAgent = (room as any).coreAgents.get('diana');
        expect(coreAgent).toBeDefined();
        expect(coreAgent.config.name).toBe('Diana');
        expect(coreAgent.config.role).toBe('Senior System Architect');
        expect(coreAgent.config.avatar).toBe('char_2');
        expect(coreAgent.config.inference.provider).toBe('gemini');
        expect(coreAgent.config.allowedTools).toEqual(expect.arrayContaining([
            'code_execute', 'read_file', 'write_file', 'complete_task'
        ]));

        // Verify profiles registry
        const profiles = room.getAgentProfiles();
        const dianaProfile = profiles.find(p => p.id === 'diana');
        expect(dianaProfile).toBeDefined();
        expect(dianaProfile?.avatar).toBe('char_2');
        expect(dianaProfile?.skills).toEqual(['fullstack-engineer', 'research-analyst']);
        expect(dianaProfile?.allowedTools).toEqual(['code_execute', 'read_file', 'write_file', 'complete_task']);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 3: Colyseus State synchronization
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 3: Colyseus State synchronization', async () => {
        // Verify agent exists in state.agents MapSchema
        const agentState = room.state.agents.get('diana');
        expect(agentState).toBeDefined();
        expect(agentState?.name).toBe('Diana');
        expect(agentState?.role).toBe('Senior System Architect');
        expect(agentState?.avatar).toBe('char_2');
        expect(agentState?.action).toBe('idle');

        // Verify agent-profiles-sync was broadcast upon creation
        const profilesSyncEvent = capturedBroadcasts.find(e => e.type === 'agent-profiles-sync');
        expect(profilesSyncEvent).toBeDefined();
        expect(Array.isArray(profilesSyncEvent?.payload)).toBe(true);
        const syncedDiana = profilesSyncEvent?.payload.find((p: any) => p.id === 'diana');
        expect(syncedDiana).toBeDefined();
        expect(syncedDiana.avatar).toBe('char_2');
        expect(syncedDiana.skills).toContain('fullstack-engineer');
        expect(syncedDiana.skills).toContain('research-analyst');

        // Verify onJoin synchronizes catalogs to newly joined client
        const newClient: any = { sessionId: 'client-join-2', send: jest.fn() };
        room.onJoin(newClient, {});

        expect(newClient.send).toHaveBeenCalledWith('skills-sync', expect.any(Array));
        expect(newClient.send).toHaveBeenCalledWith('tools-sync', expect.any(Array));
        expect(newClient.send).toHaveBeenCalledWith('agent-profiles-sync', expect.arrayContaining([
            expect.objectContaining({ id: 'diana', avatar: 'char_2' })
        ]));
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 4: Task lifecycle integration
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 4: Task lifecycle integration', async () => {
        const taskTitle = 'Implement Distributed Event Streaming';

        // 1. Assign task via assign-task message
        const assignHandler = (room as any).onMessageHandlers['assign-task'];
        expect(assignHandler).toBeDefined();
        assignHandler(mockClient, { title: taskTitle, agentId: 'diana' });

        const coreAgent = (room as any).coreAgents.get('diana');
        const agentState = room.state.agents.get('diana');

        expect(coreAgent.currentTask).toBe(taskTitle);
        expect(agentState.currentTask).toBe(taskTitle);
        expect(agentState.action).toBe('work');

        // Verify task stored in MemoryStore with in_progress status
        const tasks = await (room as any).memoryStore.getTasks();
        const storedTask = tasks.find((t: any) => t.title === taskTitle);
        expect(storedTask).toBeDefined();
        expect(storedTask.assigned_to).toBe('diana');
        expect(storedTask.status).toBe('in_progress');

        // 2. Execute complete_task via ToolExecutor
        const toolExecutor = new ToolExecutor();
        const execResult = await toolExecutor.execute('complete_task', {
            summary: 'Event streaming cluster deployed with 10k eps capacity.'
        });
        expect(execResult.success).toBe(true);
        expect(execResult.output).toContain('Task marked as completed');

        // 3. Dispatch complete-task room message to transition state
        const completeHandler = (room as any).onMessageHandlers['complete-task'];
        expect(completeHandler).toBeDefined();
        await completeHandler(mockClient, {
            title: taskTitle,
            summary: 'Event streaming cluster deployed with 10k eps capacity.'
        });

        // Verify task completed in MemoryStore
        const updatedTasks = await (room as any).memoryStore.getTasks();
        const completedTask = updatedTasks.find((t: any) => t.title === taskTitle);
        expect(completedTask.status).toBe('completed');

        // Verify agent state transitions to idle
        expect(coreAgent.currentTask).toBe('');
        expect(agentState.currentTask).toBe('');
        expect(agentState.action).toBe('idle');

        // Verify memory persistence in MemoryStore
        await (room as any).memoryStore.saveMemory('diana', {
            content: `Completed task "${taskTitle}": Event streaming cluster deployed.`,
            type: 'achievement',
            timestamp: new Date().toISOString(),
            importance: 0.9
        });
        const memories = await (room as any).memoryStore.loadMemories('diana');
        const achievementMem = memories.find((m: any) => m.content && m.content.includes(taskTitle));
        expect(achievementMem).toBeDefined();
        expect(achievementMem?.type).toBe('achievement');
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 5: Dynamic agent live update
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 5: Dynamic agent live update', async () => {
        const updateHandler = (room as any).onMessageHandlers['update-agent'];
        expect(updateHandler).toBeDefined();

        // Update avatar to char_4, role, skills and tools
        await updateHandler(mockClient, {
            id: 'diana',
            avatar: 'char_4',
            role: 'Principal Cloud Architect',
            skills: ['fullstack-engineer', 'research-analyst', 'qa-security-auditor'],
            allowedTools: ['code_execute', 'read_file', 'write_file', 'complete_task', 'web_search']
        });

        // Verify Colyseus state update
        const agentState = room.state.agents.get('diana');
        expect(agentState.avatar).toBe('char_4');
        expect(agentState.role).toBe('Principal Cloud Architect');

        // Verify Core agent update
        const coreAgent = (room as any).coreAgents.get('diana');
        expect(coreAgent.config.avatar).toBe('char_4');
        expect(coreAgent.config.role).toBe('Principal Cloud Architect');
        expect(coreAgent.config.allowedTools).toContain('web_search');
        expect(coreAgent.config.skills.map((s: any) => s.id)).toContain('qa-security-auditor');

        // Verify profile in registry
        const dianaProfile = room.getAgentProfiles().find(p => p.id === 'diana');
        expect(dianaProfile?.avatar).toBe('char_4');
        expect(dianaProfile?.role).toBe('Principal Cloud Architect');
        expect(dianaProfile?.skills).toContain('qa-security-auditor');
        expect(dianaProfile?.allowedTools).toContain('web_search');
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 6: Persistence roundtrip across room restart
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 6: Persistence roundtrip across room restart', async () => {
        // Register a custom skill in room 1
        const saveSkillHandler = (room as any).onMessageHandlers['save-skill'];
        await saveSkillHandler(mockClient, {
            id: 'cloud-infrastructure',
            name: 'Cloud Infrastructure & DevOps',
            description: 'Manages cloud deployments and CI/CD pipelines',
            category: 'DevOps',
            recommendedTools: ['code_execute', 'http_request'],
            instructions: 'Deploy, monitor and scale distributed infrastructure.'
        });

        // Dispose room 1
        await room.onDispose();

        // Instantiate brand-new room 2 pointing to the same persistent store
        const room2 = new OfficeRoom();
        await room2.onCreate({ name: 'Restarted Integration HQ', dbPath: testDbPath });
        if ((room2 as any)._simulationInterval) {
            clearInterval((room2 as any)._simulationInterval);
        }

        try {
            // Verify persisted dynamic agent was restored
            const restoredProfiles = room2.getAgentProfiles();
            const restoredDiana = restoredProfiles.find(p => p.id === 'diana');
            expect(restoredDiana).toBeDefined();
            expect(restoredDiana?.avatar).toBe('char_4');
            expect(restoredDiana?.role).toBe('Principal Cloud Architect');
            expect(restoredDiana?.skills).toContain('qa-security-auditor');

            // Verify Colyseus state in new room
            const dianaState = room2.state.agents.get('diana');
            expect(dianaState).toBeDefined();
            expect(dianaState?.name).toBe('Diana');
            expect(dianaState?.avatar).toBe('char_4');

            // Verify custom skill was restored from persistence
            const restoredSkills = room2.getSkills();
            const customSkill = restoredSkills.find(s => s.id === 'cloud-infrastructure');
            expect(customSkill).toBeDefined();
            expect(customSkill?.name).toBe('Cloud Infrastructure & DevOps');
            expect(customSkill?.category).toBe('DevOps');
        } finally {
            await room2.onDispose();
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 7: REST API endpoints and CORS preflight verification
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 7: REST API endpoints and CORS preflight verification', async () => {
        // Create an active room for the REST endpoints
        room = new OfficeRoom();
        await room.onCreate({ name: 'REST HQ', dbPath: testDbPath });
        if ((room as any)._simulationInterval) {
            clearInterval((room as any)._simulationInterval);
        }

        try {
            // 1. GET /api/skills
            const skillsRes = await dispatchExpressRequest(app, {
                method: 'GET',
                url: '/api/skills'
            });
            expect(skillsRes.statusCode).toBe(200);
            const skills = skillsRes.json();
            expect(Array.isArray(skills)).toBe(true);
            expect(skills.length).toBeGreaterThanOrEqual(5);
            expect(skills.map((s: any) => s.id)).toContain('fullstack-engineer');

            // 2. GET /api/tools
            const toolsRes = await dispatchExpressRequest(app, {
                method: 'GET',
                url: '/api/tools'
            });
            expect(toolsRes.statusCode).toBe(200);
            const tools = toolsRes.json();
            expect(Array.isArray(tools)).toBe(true);
            expect(tools.length).toBe(10);
            const toolNames = tools.map((t: any) => t.name);
            expect(toolNames).toContain('code_execute');
            expect(toolNames).toContain('read_file');
            expect(toolNames).toContain('write_file');
            expect(toolNames).toContain('complete_task');

            // 3. GET /api/agents
            const agentsRes = await dispatchExpressRequest(app, {
                method: 'GET',
                url: '/api/agents'
            });
            expect(agentsRes.statusCode).toBe(200);
            const agents = agentsRes.json();
            expect(Array.isArray(agents)).toBe(true);
            expect(agents.some((a: any) => a.id === 'diana' || a.id === 'alice')).toBe(true);

            // 4. CORS Preflight OPTIONS verification
            const corsRes = await dispatchExpressRequest(app, {
                method: 'OPTIONS',
                url: '/api/skills',
                headers: {
                    'Origin': 'http://localhost:5173',
                    'Access-Control-Request-Method': 'GET'
                }
            });
            expect(corsRes.statusCode).toBe(200);
            expect(corsRes.headers['access-control-allow-origin']).toBe('*');
            expect(corsRes.headers['access-control-allow-methods']).toContain('GET');
            expect(corsRes.headers['access-control-allow-methods']).toContain('OPTIONS');
            expect(corsRes.headers['access-control-allow-headers']).toContain('Origin');
        } finally {
            await room.onDispose();
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 8: Sprite asset verification
    // ─────────────────────────────────────────────────────────────────────────────
    test('Test 8: Sprite asset verification (char_0.png through char_5.png)', async () => {
        const repoRoot = path.resolve(process.cwd(), '../..');
        const charactersDir = path.resolve(repoRoot, 'packages/ui/public/assets/characters');

        expect(fs.existsSync(charactersDir)).toBe(true);

        const expectedSprites = [
            'char_0.png',
            'char_1.png',
            'char_2.png',
            'char_3.png',
            'char_4.png',
            'char_5.png'
        ];

        // Standard PNG Magic Number Header: 89 50 4E 47 0D 0A 1A 0A
        const pngMagicHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        for (const spriteName of expectedSprites) {
            const filePath = path.resolve(charactersDir, spriteName);
            expect(fs.existsSync(filePath)).toBe(true);

            const stats = await fsp.stat(filePath);
            // Must be accessible, non-empty, and realistic spritesheet size (> 1KB)
            expect(stats.size).toBeGreaterThan(1024);

            const fileBuffer = await fsp.readFile(filePath);
            const header = fileBuffer.subarray(0, 8);
            expect(header.equals(pngMagicHeader)).toBe(true);
        }
    });
});
