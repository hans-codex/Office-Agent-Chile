import { Room, Client } from 'colyseus';
import { OfficeState } from '../schema/OfficeState';
import { Agent, Office, OfficeConfig, ConversationMessage, ToolDefinition, SkillDefinition, LLMProviderType } from '@agent-office/core';
import { AdapterFactory, DEFAULT_MODELS, OllamaAdapter } from '@agent-office/adapters';
import { ToolExecutor, ToolResult } from '../tools/ToolExecutor';
import { MemoryStore, PersistedAgentProfile } from '../memory/MemoryStore';
import { SkillRegistry } from '../skills/SkillRegistry';
import { ToolRegistry } from '../tools/ToolRegistry';

interface HighlightEvent {
    type: string;
    title: string;
    body: string;
    agentId?: string | null;
    scenario: string;
    time: string;
}

interface RelationshipEdge {
    a: string;
    b: string;
    score: number;
    status: 'alliance' | 'neutral' | 'rivalry';
    updatedAt: string;
}

export class OfficeRoom extends Room<OfficeState> {
    private static activeRoom: OfficeRoom | null = null;

    maxClients = 100;
    private office!: Office;
    private demoTickCount = 0;
    private coreAgents: Map<string, Agent> = new Map();
    private thinkingLocks: Map<string, boolean> = new Map();
    private ollamaAdapter = new OllamaAdapter('http://localhost:11434');
    private hireCount = 0; // Counter for generating unique IDs
    private toolExecutor = new ToolExecutor();
    private memoryStore = new MemoryStore();
    private skillRegistry = new SkillRegistry();
    private toolRegistry = new ToolRegistry();
    private agentProfiles: Map<string, PersistedAgentProfile> = new Map();
    private sessionId = `session_${Date.now()}`;
    private currentScenario = 'Free Play';
    private highlights: HighlightEvent[] = [];
    private chaosHistory: Array<{ event: string; label: string; time: string }> = [];
    private relationships: Map<string, RelationshipEdge> = new Map();
    private audienceVotes: Record<string, number> = {};
    private currentLayout: any[] = [];

    // Furniture interaction points: named locations agents can walk to
    private furnitureTargets: Record<string, { x: number; y: number; type: string }> = {
        'alice-desk': { x: 5, y: 18, type: 'desk' },
        'bob-desk': { x: 5, y: 23, type: 'desk' },
        'meeting-table': { x: 10, y: 5, type: 'table' },
        'coffee-machine': { x: 25, y: 25, type: 'appliance' },
        'whiteboard': { x: 17, y: 3, type: 'board' },
        'water-cooler': { x: 28, y: 27, type: 'appliance' },
        'bookshelf': { x: 32, y: 12, type: 'furniture' },
        'beanbag': { x: 28, y: 6, type: 'seating' },
        // Extra desks for dynamically hired agents
        'hire_0-desk': { x: 15, y: 18, type: 'desk' },
        'hire_1-desk': { x: 15, y: 23, type: 'desk' },
        'hire_2-desk': { x: 25, y: 18, type: 'desk' },
        'hire_3-desk': { x: 25, y: 8, type: 'desk' },
        'hire_4-desk': { x: 32, y: 18, type: 'desk' },
    };

    static getActiveRoom(): OfficeRoom | null {
        return OfficeRoom.activeRoom;
    }

    public getSkills(): SkillDefinition[] {
        return this.skillRegistry.getAll();
    }

    public getTools(): ToolDefinition[] {
        return this.toolRegistry.getAll();
    }

    public getAgentProfiles(): PersistedAgentProfile[] {
        return Array.from(this.agentProfiles.values());
    }

    private async spawnAgentFromProfile(profile: PersistedAgentProfile) {
        this.state.createAgent(profile.id, profile.name, profile.role, profile.avatar || 'char_0');
        const state = this.state.agents.get(profile.id);
        if (state) {
            state.x = profile.x;
            state.y = profile.y;
        }

        const allowedTools = Array.isArray(profile.allowedTools) && profile.allowedTools.length > 0
            ? profile.allowedTools
            : ['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task'];
        const skills = Array.isArray(profile.skills) ? profile.skills : [];
        const allowedToolDefs = this.toolRegistry.getMany(allowedTools);
        const skillDefs = this.skillRegistry.getMany(skills);

        const provider = (profile.provider || 'gemini') as LLMProviderType;
        const model = profile.model || (DEFAULT_MODELS[profile.provider] || 'gemini-2.5-flash');

        const coreAgent = new Agent({
            id: profile.id,
            name: profile.name,
            role: profile.role,
            avatar: profile.avatar || 'char_0',
            inference: {
                provider,
                model,
                systemPrompt: profile.systemPrompt || `You are ${profile.name}, a ${profile.role} in a virtual office. Be social, do your work, and collaborate with colleagues. Keep thoughts SHORT.`,
                tools: allowedToolDefs
            },
            personality: {
                traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.1 },
                communicationStyle: profile.communicationStyle || (profile.role === 'Engineer' ? 'technical' : 'casual'),
                workHours: { start: '09:00', end: '17:00' },
                breakFrequency: 120
            },
            capabilities: allowedToolDefs.map(t => ({ name: t.name, description: t.description })),
            skills: skillDefs,
            allowedTools,
            memory: { shortTermLimit: 50 }
        });

        const adapter = AdapterFactory.createForAgent(coreAgent.config.inference);
        coreAgent.setInferenceAdapter(adapter);
        await coreAgent.initialize();

        // Load persistent memories from previous sessions
        const previousMemories = await this.memoryStore.loadMemories(profile.id, 20);
        if (previousMemories.length > 0) {
            coreAgent.loadMemories(previousMemories);
            console.log(`[${profile.name}] Loaded ${previousMemories.length} memories from previous sessions`);
        }

        this.coreAgents.set(profile.id, coreAgent);
        this.thinkingLocks.set(profile.id, false);
        this.agentProfiles.set(profile.id, profile);

        if (!this.furnitureTargets[`${profile.id}-desk`]) {
            this.furnitureTargets[`${profile.id}-desk`] = { x: profile.x, y: profile.y, type: 'desk' };
        }
    }

    async onCreate(options: any) {
        OfficeRoom.activeRoom = this;
        this.setState(new OfficeState());

        // Initialize memory store
        await this.memoryStore.initialize(options?.dbPath);

        // Initialize skills and tools catalogs
        this.skillRegistry.loadFromDisk();
        const customSkills = await this.memoryStore.loadCustomSkills();
        for (const s of customSkills) {
            this.skillRegistry.registerSkill(s, false);
        }

        const config: OfficeConfig = {
            name: options.name || 'Startup HQ',
            grid: { width: 40, height: 40, tileSize: 16 },
            rooms: [],
            furniture: [],
            spawnPoints: [{ x: 10, y: 10 }],
            zones: []
        };
        this.office = new Office(config);

        // Restore persisted agent profiles or seed default Alice & Bob
        const persistedProfiles = await this.memoryStore.loadAgentProfiles();
        if (persistedProfiles && persistedProfiles.length > 0) {
            console.log(`[OfficeRoom] Restoring ${persistedProfiles.length} persisted agent profiles...`);
            for (const profile of persistedProfiles) {
                await this.spawnAgentFromProfile(profile);
            }
        } else {
            console.log('[OfficeRoom] No persisted profiles found. Seeding default agents Alice & Bob...');
            const defaultAlice: PersistedAgentProfile = {
                id: 'alice',
                name: 'Alice',
                role: 'Engineer',
                avatar: 'char_0',
                x: 10,
                y: 10,
                provider: 'ollama',
                model: 'llama3.2:latest',
                systemPrompt: 'You are Alice, an Engineer in a virtual office. Be social, do your work, and collaborate with colleagues. Keep thoughts SHORT.',
                communicationStyle: 'technical',
                skills: ['fullstack-engineer'],
                allowedTools: ['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task']
            };
            const defaultBob: PersistedAgentProfile = {
                id: 'bob',
                name: 'Bob',
                role: 'Product Manager',
                avatar: 'char_1',
                x: 20,
                y: 15,
                provider: 'ollama',
                model: 'llama3.2:latest',
                systemPrompt: 'You are Bob, a Product Manager in a virtual office. Be social, coordinate tasks, and collaborate with colleagues. Keep thoughts SHORT.',
                communicationStyle: 'casual',
                skills: ['product-manager'],
                allowedTools: ['web_search', 'write_note', 'create_task', 'complete_task', 'read_file']
            };
            await this.spawnAgentFromProfile(defaultAlice);
            await this.memoryStore.saveAgentProfile(defaultAlice);

            await this.spawnAgentFromProfile(defaultBob);
            await this.memoryStore.saveAgentProfile(defaultBob);
        }

        this.rebuildRelationshipGraph();
        const savedLayout = await this.memoryStore.loadLayout('default');
        this.currentLayout = Array.isArray(savedLayout) ? savedLayout : [];

        // ─── MESSAGE HANDLERS ───

        this.onMessage('command', (client, message) => {
            console.log(`Command from ${client.sessionId}:`, message);
        });

        this.onMessage('chat', (client, message) => {
            console.log(`Chat from ${client.sessionId}: ${message.text}`);
            this.broadcast('chat', { sender: 'User', text: message.text });
        });

        this.onMessage('start-scenario', (client, message) => {
            const scenarioName = String(message?.scenario || 'Free Play');
            this.currentScenario = scenarioName;
            this.applyScenarioKickoff(scenarioName);
        });

        this.onMessage('trigger-chaos', (client, message) => {
            const eventName = String(message?.event || 'minor_outage');
            this.applyChaosEvent(eventName);
        });

        // UI-driven task assignment
        this.onMessage('assign-task', (client, message) => {
            const { title, agentId } = message;
            console.log(`[TaskBoard] Assigning "${title}" to ${agentId || 'auto'}`);

            // Pick agent: explicit or auto-assign to least busy
            const targetId = agentId || this.autoAssignAgent();
            const agent = this.coreAgents.get(targetId);
            const agentState = this.state.agents.get(targetId);

            if (agent && agentState) {
                agent.currentTask = title;
                agentState.currentTask = title;
                agentState.action = 'work';

                // Persist task
                this.memoryStore.createTask(title, targetId);

                this.broadcast('chat', {
                    sender: 'System',
                    text: `📋 Task "${title}" assigned to ${agentState.name}`
                });

                this.broadcast('task-update', {
                    agentId: targetId,
                    agentName: agentState.name,
                    task: title,
                    status: 'in_progress'
                });
            }
        });

        // Save office layout from editor
        this.onMessage('save-layout', async (client, message) => {
            const layoutName = message.name || 'default';
            const layout = Array.isArray(message.layout) ? message.layout : [];
            await this.memoryStore.saveLayout(layoutName, JSON.stringify(layout));
            this.currentLayout = layout;
            this.broadcast('layout-sync', { name: layoutName, layout: this.currentLayout });
            this.broadcast('chat', { sender: 'System', text: '✅ Office layout saved!' });
        });

        // Create dynamic agent
        this.onMessage('create-agent', async (client, message) => {
            const id = message.id || (`agent_${(message.name || 'agent').toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`);
            if (this.coreAgents.has(id)) {
                client.send('error', { message: `Agent with id ${id} already exists` });
                return;
            }

            const x = typeof message.x === 'number' ? message.x : (10 + (this.coreAgents.size * 5) % 25);
            const y = typeof message.y === 'number' ? message.y : (10 + (this.coreAgents.size * 4) % 20);
            const provider = message.provider || 'gemini';
            const model = message.model || (DEFAULT_MODELS[provider] || 'gemini-2.5-flash');
            const skills = Array.isArray(message.skills) ? message.skills : [];
            const allowedTools = Array.isArray(message.allowedTools) && message.allowedTools.length > 0
                ? message.allowedTools
                : ['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task'];

            const profile: PersistedAgentProfile = {
                id,
                name: message.name || 'New Agent',
                role: message.role || 'Specialist',
                avatar: message.avatar || 'char_0',
                x,
                y,
                provider,
                model,
                systemPrompt: message.systemPrompt || `You are ${message.name || 'New Agent'}, a ${message.role || 'Specialist'} in a virtual office. Collaborate with colleagues and achieve your goals. Keep thoughts SHORT.`,
                communicationStyle: message.communicationStyle || 'casual',
                skills,
                allowedTools
            };

            await this.spawnAgentFromProfile(profile);
            await this.memoryStore.saveAgentProfile(profile);
            this.rebuildRelationshipGraph();

            this.broadcast('agent-profiles-sync', Array.from(this.agentProfiles.values()));
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `🎉 Welcome ${profile.name} (${profile.role}) to the team!`
            });
            this.emitHighlight(
                'hiring',
                `${profile.name} joined the office`,
                `${profile.name} was added as ${profile.role}.`,
                profile.id
            );
        });

        // Update existing agent configuration
        this.onMessage('update-agent', async (client, message) => {
            const id = message.id;
            if (!id || !this.agentProfiles.has(id)) {
                client.send('error', { message: `Agent ${id} not found.` });
                return;
            }

            const profile = this.agentProfiles.get(id)!;
            if (message.name) profile.name = message.name;
            if (message.role) profile.role = message.role;
            if (message.avatar) profile.avatar = message.avatar;
            if (message.provider) profile.provider = message.provider;
            if (message.model) profile.model = message.model;
            if (message.systemPrompt) profile.systemPrompt = message.systemPrompt;
            if (message.communicationStyle) profile.communicationStyle = message.communicationStyle;
            if (Array.isArray(message.skills)) profile.skills = message.skills;
            if (Array.isArray(message.allowedTools)) profile.allowedTools = message.allowedTools;

            const state = this.state.agents.get(id);
            if (state) {
                if (message.name) state.name = message.name;
                if (message.role) state.role = message.role;
                if (message.avatar) state.avatar = message.avatar;
            }

            const coreAgent = this.coreAgents.get(id);
            if (coreAgent) {
                if (message.name) coreAgent.config.name = message.name;
                if (message.role) coreAgent.config.role = message.role;
                if (message.avatar) coreAgent.config.avatar = message.avatar;
                if (message.communicationStyle) coreAgent.config.personality.communicationStyle = message.communicationStyle;

                if (Array.isArray(message.skills)) {
                    const skillDefs = this.skillRegistry.getMany(message.skills);
                    coreAgent.updateSkills(skillDefs);
                }

                if (Array.isArray(message.allowedTools)) {
                    const toolDefs = this.toolRegistry.getMany(message.allowedTools);
                    coreAgent.updateTools(message.allowedTools, toolDefs);
                }

                if (message.provider || message.model || message.systemPrompt) {
                    coreAgent.config.inference.provider = profile.provider as LLMProviderType;
                    coreAgent.config.inference.model = profile.model;
                    coreAgent.config.inference.systemPrompt = profile.systemPrompt;
                    coreAgent.setInferenceAdapter(AdapterFactory.createForAgent(coreAgent.config.inference));
                }
            }

            await this.memoryStore.saveAgentProfile(profile);
            this.broadcast('agent-profiles-sync', Array.from(this.agentProfiles.values()));
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `✏️ Agent ${profile.name} updated.`
            });
        });

        // Delete agent
        this.onMessage('delete-agent', async (client, message) => {
            const id = message.id;
            if (!id) return;

            this.state.removeAgent(id);
            this.coreAgents.delete(id);
            this.agentProfiles.delete(id);
            this.thinkingLocks.delete(id);
            await this.memoryStore.deleteAgentProfile(id);
            this.rebuildRelationshipGraph();

            this.broadcast('agent-profiles-sync', Array.from(this.agentProfiles.values()));
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `🗑️ Agent ${id} removed from office.`
            });
        });

        // Save custom skill
        this.onMessage('save-skill', async (client, message) => {
            if (!message || !message.name) return;
            const skillDef = this.skillRegistry.registerSkill(message, true);
            await this.memoryStore.saveCustomSkill(skillDef);

            this.broadcast('skills-sync', this.skillRegistry.getAll());
            this.broadcast('chat', {
                sender: '⚡ Skill System',
                text: `Registered skill: "${skillDef.name}"`
            });
        });

        // Complete task manually or via UI
        this.onMessage('complete-task', async (client, message) => {
            const { taskId, title, summary } = message || {};
            if (taskId) {
                await this.memoryStore.completeTask(Number(taskId));
            } else if (title) {
                await this.memoryStore.completeTaskByTitle(String(title));
            }

            for (const [agentId, agent] of this.coreAgents) {
                if ((title && agent.currentTask === title) || (!title && !taskId)) {
                    agent.currentTask = '';
                    const st = this.state.agents.get(agentId);
                    if (st) {
                        st.currentTask = '';
                        st.action = 'idle';
                    }
                }
            }

            this.broadcast('task-update', {
                taskId,
                task: title || 'Task',
                status: 'completed',
                summary: summary || 'Completed by user'
            });
            this.broadcast('chat', {
                sender: 'System',
                text: `✅ Task "${title || taskId || 'Task'}" marked as completed.`
            });
        });

        // Start Simulation Loop
        this.setSimulationInterval((delta) => this.update(delta), 100);
    }

    private autoAssignAgent(): string {
        // Pick the agent with no current task, or the first one
        for (const [id, agent] of this.coreAgents) {
            if (!agent.currentTask) return id;
        }
        return 'alice'; // fallback
    }

    async update(delta: number) {
        if (Math.random() < 0.02) {
            console.log(`[Server] Agents: ${this.state.agents.size} | Session: ${this.sessionId}`);
        }

        this.state.officeTime = new Date().toISOString();

        // ─── AGENT THINK CYCLE ───
        this.coreAgents.forEach((coreAgent, id) => {
            if (!this.thinkingLocks.get(id)) {
                this.thinkingLocks.set(id, true);

                const agentState = this.state.agents.get(id);
                if (!agentState) return;

                // Build nearby agents list
                const nearbyAgents: { name: string; role: string; distance: number }[] = [];
                this.coreAgents.forEach((other, otherId) => {
                    if (otherId === id) return;
                    const otherState = this.state.agents.get(otherId);
                    if (otherState) {
                        const dist = Math.abs(agentState.x - otherState.x) + Math.abs(agentState.y - otherState.y);
                        nearbyAgents.push({ name: other.config.name, role: other.config.role, distance: dist });
                    }
                });

                coreAgent.think({
                    time: this.state.officeTime,
                    location: `${agentState.x},${agentState.y}`,
                    nearbyAgents,
                    currentTask: coreAgent.currentTask || null,
                    recentMessages: coreAgent.getUnreadMessages(),
                    memories: coreAgent.getRecentMemories(5)
                }).then(async (decision) => {
                    agentState.action = decision.action;

                    if (decision.thought) {
                        agentState.thought = decision.thought;
                    }

                    // ─── HANDLE TALK ACTION (Agent-to-Agent) ───
                    if (decision.action === 'talk' && decision.message) {
                        const targetName = decision.target || '';
                        let targetId = '';
                        this.coreAgents.forEach((a, aId) => {
                            if (a.config.name.toLowerCase() === targetName.toLowerCase()) targetId = aId;
                        });

                        const targetAgent = this.coreAgents.get(targetId);
                        if (targetAgent) {
                            const msg: ConversationMessage = {
                                from: coreAgent.config.name,
                                to: targetAgent.config.name,
                                content: decision.message,
                                timestamp: this.state.officeTime
                            };
                            targetAgent.receiveMessage(msg);

                            // Broadcast to UI chat
                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💬 (to ${targetAgent.config.name}): ${decision.message}`
                            });
                            this.emitHighlight(
                                'conversation',
                                `${coreAgent.config.name} pinged ${targetAgent.config.name}`,
                                decision.message.slice(0, 120),
                                id
                            );
                            this.updateRelationship(id, targetId, 0.08);

                            // Save conversation memory
                            await this.memoryStore.saveMemory(id, {
                                content: `Said to ${targetAgent.config.name}: "${decision.message}"`,
                                type: 'conversation',
                                timestamp: this.state.officeTime,
                                importance: 0.7
                            }, this.sessionId);
                        }

                        coreAgent.clearInbox(); // Clear after processing
                    }

                    // ─── HANDLE TOOL EXECUTION ───
                    if (decision.action === 'use_tool' && decision.toolCall) {
                        // Special case: agent-created tasks
                        if (decision.toolCall.name === 'create_task') {
                            const { title, assignee } = decision.toolCall.params;
                            const targetId = assignee?.toLowerCase() || this.autoAssignAgent();
                            const targetAgent = this.coreAgents.get(targetId);
                            const targetState = this.state.agents.get(targetId);

                            if (targetAgent && targetState) {
                                targetAgent.currentTask = title;
                                targetState.currentTask = title;
                                await this.memoryStore.createTask(title, targetId);

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Created task "${title}" for ${targetAgent.config.name}`
                                });
                                this.broadcast('task-update', {
                                    agentId: targetId,
                                    agentName: targetAgent.config.name,
                                    task: title,
                                    status: 'in_progress'
                                });
                                this.emitHighlight(
                                    'task',
                                    `${coreAgent.config.name} assigned work`,
                                    `"${title}" is now owned by ${targetAgent.config.name}.`,
                                    targetId
                                );
                            }
                        } else if (decision.toolCall.name === 'complete_task') {
                            const { summary } = decision.toolCall.params || {};
                            const completedTaskTitle = coreAgent.currentTask || 'Task';
                            coreAgent.currentTask = '';
                            agentState.currentTask = '';
                            agentState.action = 'idle';

                            if (completedTaskTitle) {
                                await this.memoryStore.completeTaskByTitle(completedTaskTitle);
                            }

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `✅ Completed task "${completedTaskTitle}": ${summary || 'Deliverable ready'}`
                            });
                            this.broadcast('task-update', {
                                agentId: id,
                                agentName: coreAgent.config.name,
                                task: completedTaskTitle,
                                status: 'completed',
                                summary: summary || ''
                            });
                            this.emitHighlight(
                                'task',
                                `${coreAgent.config.name} completed work`,
                                `"${completedTaskTitle}": ${summary || 'Deliverable ready'}`,
                                id
                            );

                            coreAgent.addMemory({
                                content: `Completed task "${completedTaskTitle}". Summary: ${summary || 'Done'}`,
                                type: 'achievement',
                                timestamp: this.state.officeTime,
                                importance: 0.9
                            });
                        } else if (decision.toolCall.name === 'hire_agent') {
                            // ─── DYNAMIC AGENT HIRING ───
                            const hireParams = decision.toolCall.params;
                            const hireName = hireParams.name || ['Charlie', 'Diana', 'Eve', 'Frank', 'Grace'][this.hireCount % 5];
                            const hireRole = hireParams.role || 'Intern';
                            const hireId = `hire_${this.hireCount}`;

                            if (this.hireCount < 5 && !this.coreAgents.has(hireId)) {
                                // Spawn at office door (top-center), then walk to their desk
                                const spawnX = 20;
                                const spawnY = 2;

                                const hireTools = ['code_execute', 'web_search', 'write_note', 'create_task', 'complete_task'];
                                const parsedSkills = hireParams.skills ? hireParams.skills.split(',').map((s: string) => s.trim()) : [];

                                const hireProfile: PersistedAgentProfile = {
                                    id: hireId,
                                    name: hireName,
                                    role: hireRole,
                                    avatar: `char_${(this.hireCount + 2) % 6}`,
                                    x: spawnX,
                                    y: spawnY,
                                    provider: 'ollama',
                                    model: 'llama3.2:latest',
                                    systemPrompt: `You are ${hireName}, a ${hireRole} who just joined the team at a virtual office. You were hired by ${coreAgent.config.name}. Be enthusiastic, helpful, and eager to learn. Introduce yourself to your colleagues. Keep thoughts SHORT.`,
                                    communicationStyle: hireRole.includes('Design') ? 'creative' : 'casual',
                                    skills: parsedSkills,
                                    allowedTools: hireTools
                                };

                                await this.spawnAgentFromProfile(hireProfile);
                                await this.memoryStore.saveAgentProfile(hireProfile);

                                const hireAgent = this.coreAgents.get(hireId);
                                if (hireAgent) {
                                    hireAgent.addMemory({
                                        content: `I was hired by ${coreAgent.config.name} as a ${hireRole}.`,
                                        type: 'achievement',
                                        timestamp: this.state.officeTime,
                                        importance: 0.9
                                    });
                                }

                                this.hireCount++;
                                this.rebuildRelationshipGraph();

                                this.broadcast('agent-profiles-sync', Array.from(this.agentProfiles.values()));
                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `🎉 ${coreAgent.config.name} hired ${hireName} as ${hireRole}! Welcome to the team!`
                                });
                                this.emitHighlight(
                                    'hiring',
                                    `${hireName} joined the team`,
                                    `${coreAgent.config.name} hired ${hireName} (${hireRole}).`,
                                    hireId
                                );

                                // Give the hiring agent a memory of the hire
                                coreAgent.addMemory({
                                    content: `I hired ${hireName} as a ${hireRole}. They just joined the team.`,
                                    type: 'achievement',
                                    timestamp: this.state.officeTime,
                                    importance: 0.9
                                });
                            } else if (this.hireCount >= 5) {
                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `⚠️ ${coreAgent.config.name} tried to hire but the office is full! (Max 7 agents)`
                                });
                            }
                        } else {
                            let result: ToolResult;
                            try {
                                result = await this.toolExecutor.execute(
                                    decision.toolCall.name,
                                    decision.toolCall.params
                                );
                            } catch (err: any) {
                                result = { success: false, output: '', error: err?.message || 'Tool execution error' };
                            }

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `🔧 Used tool [${decision.toolCall.name}]: ${result.success ? result.output.slice(0, 100) : result.error}`
                            });
                            this.emitHighlight(
                                'tool',
                                `${coreAgent.config.name} used ${decision.toolCall.name}`,
                                (result.success ? result.output : result.error || 'Tool failed').slice(0, 120),
                                id
                            );

                            coreAgent.addMemory({
                                content: `Tool ${decision.toolCall.name} result: ${result.output.slice(0, 200)}`,
                                type: 'task_result',
                                timestamp: this.state.officeTime,
                                importance: 0.8
                            });
                        }
                    }

                    // ─── PERSIST MEMORIES PERIODICALLY ───
                    if (Math.random() < 0.3) {
                        const recentMemories = coreAgent.memories.slice(-3);
                        await this.memoryStore.saveMemories(id, recentMemories, this.sessionId);
                    }

                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);

                }).catch(err => {
                    console.error(`Agent ${id} think error:`, err);
                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);
                });
            }
        });

        // ─── FURNITURE INTERACTION PATHFINDING ───
        // Office grid boundaries (agents must stay inside)
        const BOUNDS = { minX: 2, maxX: 36, minY: 2, maxY: 36 };
        const clamp = (agent: any) => {
            agent.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, agent.x));
            agent.y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, agent.y));
        };

        this.demoTickCount++;
        if (this.demoTickCount >= 5) {
            this.demoTickCount = 0;
            this.state.agents.forEach((agent, key) => {
                // Default targets: agent's own desk chair
                const deskKey = `${key}-desk`;
                const target = this.furnitureTargets[deskKey] || { x: 5, y: 18 };

                // If agent action is 'talk', move towards the other agent instead
                if (agent.action === 'talk') {
                    let closest: { x: number; y: number } | null = null;
                    let minDist = Infinity;
                    this.state.agents.forEach((other, otherKey) => {
                        if (otherKey === key) return;
                        const dist = Math.abs(agent.x - other.x) + Math.abs(agent.y - other.y);
                        if (dist < minDist) { minDist = dist; closest = { x: other.x, y: other.y + 2 }; }
                    });
                    if (closest && minDist > 2) {
                        const c = closest as { x: number; y: number };
                        if (agent.x < c.x) agent.x += 1;
                        else if (agent.x > c.x) agent.x -= 1;
                        else if (agent.y < c.y) agent.y += 1;
                        else if (agent.y > c.y) agent.y -= 1;
                        clamp(agent);
                        return;
                    }
                }

                // Walk to desk/furniture target
                if (agent.x < target.x) agent.x += 1;
                else if (agent.x > target.x) agent.x -= 1;
                else if (agent.y < target.y) agent.y += 1;
                else if (agent.y > target.y) agent.y -= 1;
                clamp(agent);

                // Keep viral telemetry alive for UI overlays and highlights.
                this.updateAgentViralMetrics(key, agent.action);
            });
        }
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private emitHighlight(type: string, title: string, body: string, agentId?: string) {
        const payload: HighlightEvent = {
            type,
            title,
            body,
            agentId: agentId || null,
            scenario: this.currentScenario,
            time: this.state.officeTime
        };
        this.highlights = [payload, ...this.highlights].slice(0, 200);
        this.broadcast('highlight-event', payload);
    }

    private updateAgentViralMetrics(agentId: string, action: string) {
        const state = this.state.agents.get(agentId);
        if (!state) return;
        const jitter = (Math.random() - 0.5) * 0.03;
        const actionBoost =
            action === 'work' ? 0.015 :
                action === 'talk' ? 0.02 :
                    action === 'use_tool' ? 0.03 :
                        -0.005;

        state.momentum = this.clamp01(state.momentum + actionBoost + jitter);
        state.riskLevel = this.clamp01(state.riskLevel + (action === 'use_tool' ? 0.02 : -0.004) + jitter);
        state.mood = this.clamp01(state.mood + (action === 'talk' ? 0.02 : -0.002) + jitter);
        state.reputation = this.clamp01(state.reputation + (action === 'work' ? 0.015 : 0.001) + jitter / 2);
    }

    private applyScenarioKickoff(scenarioName: string) {
        this.broadcast('scenario-event', {
            type: 'scenario-started',
            scenario: scenarioName,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '🎬 Producer',
            text: `Scenario loaded: ${scenarioName}. Let the office drama begin.`
        });

        this.emitHighlight(
            'scenario',
            `Scenario: ${scenarioName}`,
            `The office switched into ${scenarioName} mode.`,
        );

        this.state.agents.forEach((agent, id) => {
            agent.momentum = this.clamp01(agent.momentum + 0.15);
            agent.riskLevel = this.clamp01(agent.riskLevel + 0.1);
            if (Math.random() < 0.4) {
                this.emitHighlight(
                    'character_arc',
                    `${agent.name} steps up`,
                    `${agent.name} is pushing hard as ${scenarioName} starts.`,
                    id
                );
            }
        });
    }

    private applyChaosEvent(eventName: string) {
        const chaosMap: Record<string, { label: string; moodDelta: number; riskDelta: number; momentumDelta: number }> = {
            server_outage: { label: 'Server Outage', moodDelta: -0.25, riskDelta: 0.35, momentumDelta: 0.1 },
            funding_cut: { label: 'Funding Cut', moodDelta: -0.2, riskDelta: 0.28, momentumDelta: -0.05 },
            surprise_launch: { label: 'Surprise Launch', moodDelta: 0.12, riskDelta: 0.22, momentumDelta: 0.25 },
            client_escalation: { label: 'Client Escalation', moodDelta: -0.1, riskDelta: 0.3, momentumDelta: 0.08 },
            viral_tweet: { label: 'Viral Tweet', moodDelta: 0.25, riskDelta: 0.12, momentumDelta: 0.3 }
        };

        const selected = chaosMap[eventName] || chaosMap.server_outage;
        this.chaosHistory = [
            { event: eventName, label: selected.label, time: this.state.officeTime },
            ...this.chaosHistory
        ].slice(0, 100);
        this.broadcast('scenario-event', {
            type: 'chaos-triggered',
            event: eventName,
            label: selected.label,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '⚠️ Chaos Engine',
            text: `${selected.label} hit the office. Everyone reacts in real-time.`
        });

        this.emitHighlight(
            'chaos',
            selected.label,
            `Chaos event "${selected.label}" changed team mood and risk levels.`
        );

        this.state.agents.forEach((agent, id) => {
            agent.mood = this.clamp01(agent.mood + selected.moodDelta + (Math.random() - 0.5) * 0.08);
            agent.riskLevel = this.clamp01(agent.riskLevel + selected.riskDelta + Math.random() * 0.08);
            agent.momentum = this.clamp01(agent.momentum + selected.momentumDelta + (Math.random() - 0.5) * 0.05);
            if (agent.riskLevel > 0.75) {
                this.emitHighlight(
                    'high_risk',
                    `${agent.name} is under pressure`,
                    `${agent.name}'s risk level spiked after ${selected.label}.`,
                    id
                );
            }
        });

        // Chaos can create alliances or rivalries.
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const delta = (Math.random() - 0.5) * 0.35;
                this.updateRelationship(ids[i], ids[j], delta);
            }
        }
    }

    private relationshipKey(a: string, b: string): string {
        return [a, b].sort().join('::');
    }

    private statusFromScore(score: number): RelationshipEdge['status'] {
        if (score > 0.35) return 'alliance';
        if (score < -0.35) return 'rivalry';
        return 'neutral';
    }

    private rebuildRelationshipGraph() {
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const key = this.relationshipKey(ids[i], ids[j]);
                if (!this.relationships.has(key)) {
                    this.relationships.set(key, {
                        a: ids[i],
                        b: ids[j],
                        score: 0,
                        status: 'neutral',
                        updatedAt: this.state.officeTime
                    });
                }
            }
        }
        this.emitRelationshipGraph();
    }

    private updateRelationship(a: string, b: string, delta: number) {
        const key = this.relationshipKey(a, b);
        const existing = this.relationships.get(key) || {
            a: [a, b].sort()[0],
            b: [a, b].sort()[1],
            score: 0,
            status: 'neutral' as const,
            updatedAt: this.state.officeTime
        };
        const score = Math.max(-1, Math.min(1, existing.score + delta));
        const updated: RelationshipEdge = {
            ...existing,
            score,
            status: this.statusFromScore(score),
            updatedAt: this.state.officeTime
        };
        this.relationships.set(key, updated);
        this.emitRelationshipGraph();
    }

    private emitRelationshipGraph() {
        this.broadcast('relationship-update', this.buildRelationshipPayload());
    }

    private buildRelationshipPayload() {
        const idToName: Record<string, string> = {};
        this.state.agents.forEach((agent, id) => {
            idToName[id] = agent.name;
        });
        return {
            edges: Array.from(this.relationships.values()).map((edge) => ({
                ...edge,
                aName: idToName[edge.a] || edge.a,
                bName: idToName[edge.b] || edge.b
            })),
            time: this.state.officeTime
        };
    }

    public registerAudienceVote(eventName: string, voterId?: string) {
        const normalized = String(eventName || 'server_outage');
        this.audienceVotes[normalized] = (this.audienceVotes[normalized] || 0) + 1;
        const totalVotes = Object.values(this.audienceVotes).reduce((sum, value) => sum + value, 0);
        const shouldTrigger = this.audienceVotes[normalized] >= 3 || totalVotes % 5 === 0;

        if (shouldTrigger) {
            this.applyChaosEvent(normalized);
            this.emitHighlight(
                'audience_vote',
                `Audience triggered ${normalized}`,
                `Viewers forced a ${normalized} chaos event.`
            );
            this.audienceVotes[normalized] = 0;
        }

        return {
            accepted: true,
            event: normalized,
            voterId: voterId || null,
            tally: this.audienceVotes[normalized] || 0,
            triggered: shouldTrigger
        };
    }

    public getEpisodeRecap() {
        const topHighlights = [...this.highlights].slice(0, 10);
        const leaderboard = Array.from(this.state.agents.entries()).map(([id, agent]) => {
            const impact = (
                agent.momentum * 0.35 +
                agent.reputation * 0.3 +
                agent.mood * 0.2 +
                (1 - agent.riskLevel) * 0.15
            );
            return {
                id,
                name: agent.name,
                action: agent.action,
                mood: agent.mood,
                reputation: agent.reputation,
                riskLevel: agent.riskLevel,
                momentum: agent.momentum,
                impact: Number(impact.toFixed(3))
            };
        }).sort((a, b) => b.impact - a.impact);

        const avgMomentum = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.momentum, 0) / leaderboard.length
            : 0;
        const avgRisk = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.riskLevel, 0) / leaderboard.length
            : 0;
        const outcome = avgMomentum > 0.65 && avgRisk < 0.5
            ? 'Launch trajectory: team executed under pressure and came out stronger.'
            : avgRisk > 0.65
                ? 'High volatility: chaos dominated this episode.'
                : 'Mixed outcome: strong moments with unresolved tensions.';

        return {
            generatedAt: this.state.officeTime,
            scenario: this.currentScenario,
            topHighlights,
            leaderboard: leaderboard.slice(0, 10),
            outcomeCard: {
                title: `${this.currentScenario} Outcome`,
                summary: outcome,
                chaosEvents: this.chaosHistory.slice(0, 10),
                activeRelationships: Array.from(this.relationships.values()).filter((edge) => edge.status !== 'neutral').length
            }
        };
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined the office room!");
        // Send existing tasks to newly joined client
        this.memoryStore.getTasks().then(tasks => {
            client.send('tasks-sync', tasks);
        });
        client.send('relationship-update', this.buildRelationshipPayload());
        client.send('layout-sync', { name: 'default', layout: this.currentLayout });
        client.send('skills-sync', this.skillRegistry.getAll());
        client.send('tools-sync', this.toolRegistry.getAll());
        client.send('agent-profiles-sync', Array.from(this.agentProfiles.values()));
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left the office room!");
    }

    async onDispose() {
        console.log("room", this.roomId, "disposing... saving memories");
        OfficeRoom.activeRoom = null;
        if ((this as any)._simulationInterval) {
            clearInterval((this as any)._simulationInterval);
        }
        if (this.clock) {
            this.clock.clear();
        }
        // Persist all agent memories on shutdown
        for (const [id, agent] of this.coreAgents) {
            await this.memoryStore.saveMemories(id, agent.memories, this.sessionId);
        }
        await this.memoryStore.close();
    }
}
