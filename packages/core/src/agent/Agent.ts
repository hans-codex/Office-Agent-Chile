import { AgentConfig, SkillDefinition, ToolDefinition } from './AgentConfig';
import { InferenceAdapter } from './InferenceAdapter';

export type AgentStateStatus = 'IDLE' | 'PERCEIVING' | 'THINKING' | 'ACTING' | 'COMMUNICATING';

export interface Perception {
    time: string;
    location: string;
    nearbyAgents: { name: string; role: string; distance: number }[];
    currentTask: any | null;
    recentMessages: ConversationMessage[];
    memories: string[];
}

export interface Decision {
    thought: string;
    action: 'move' | 'talk' | 'work' | 'use_tool' | 'idle';
    target?: string;
    message?: string;
    toolCall?: { name: string; params: any };
}

export interface ActionResult {
    success: boolean;
    result?: any;
    error?: string;
}

export interface Event {
    type: string;
    data: any;
    timestamp: Date;
}

export interface Message {
    from: string;
    content: string;
}

export interface ConversationMessage {
    from: string;
    to: string;
    content: string;
    timestamp: string;
}

export interface MemoryEntry {
    content: string;
    type: 'thought' | 'conversation' | 'task_result' | 'observation' | 'achievement' | 'relationship';
    timestamp: string;
    importance: number; // 0-1
}

export class Agent {
    public config: AgentConfig;
    private status: AgentStateStatus = 'IDLE';
    private adapter?: InferenceAdapter;

    // Conversation inbox
    public inbox: ConversationMessage[] = [];

    // Short-term memory buffer
    public memories: MemoryEntry[] = [];

    // Current assigned task
    public currentTask: string = '';

    // Loop detection state (AI Agents Architect guardrail)
    private lastToolSignature: string = '';
    private repeatedToolCount: number = 0;

    constructor(config: AgentConfig) {
        this.config = {
            ...config,
            skills: config.skills || [],
            allowedTools: config.allowedTools || config.capabilities.map(c => c.name)
        };
    }

    setInferenceAdapter(adapter: InferenceAdapter) {
        this.adapter = adapter;
    }

    getInferenceAdapter(): InferenceAdapter | undefined {
        return this.adapter;
    }

    async initialize(): Promise<void> {
        this.status = 'IDLE';
    }

    // --- Live Customization (Skills, Tools, Role, LLM) ---

    updateSkills(skills: SkillDefinition[]) {
        this.config.skills = skills;
    }

    updateTools(allowedTools: string[], toolDefinitions: ToolDefinition[]) {
        this.config.allowedTools = allowedTools;
        this.config.inference.tools = toolDefinitions;
        this.config.capabilities = toolDefinitions.map(t => ({
            name: t.name,
            description: t.description
        }));
    }

    isToolAllowed(toolName: string): boolean {
        const allowed = this.config.allowedTools || this.config.capabilities.map(c => c.name);
        return allowed.includes(toolName);
    }

    // --- Conversation System ---

    receiveMessage(msg: ConversationMessage) {
        this.inbox.push(msg);
        if (this.inbox.length > 20) this.inbox.shift();
    }

    getUnreadMessages(): ConversationMessage[] {
        return [...this.inbox];
    }

    clearInbox() {
        this.inbox = [];
    }

    // --- Memory System ---

    addMemory(entry: MemoryEntry) {
        this.memories.push(entry);
        const limit = this.config.memory.shortTermLimit || 50;
        if (this.memories.length > limit) {
            this.memories.sort((a, b) => b.importance - a.importance);
            this.memories = this.memories.slice(0, limit);
        }
    }

    getRecentMemories(count: number = 10): string[] {
        return this.memories.slice(-count).map(m => `[${m.type}] ${m.content}`);
    }

    loadMemories(entries: MemoryEntry[]) {
        this.memories = entries;
    }

    // --- Prompt Construction (RTCCO Framework) ---

    public buildSystemInstruction(): string {
        const skills = this.config.skills || [];
        const skillsBlock = skills.length > 0
            ? skills.map(s => `### Skill: ${s.name} (${s.id})\n${s.description}\nInstructions:\n${s.instructions}`).join('\n\n')
            : 'General office collaboration and problem solving.';

        const toolDefs = this.config.inference.tools || [];
        const toolsBlock = toolDefs.length > 0
            ? toolDefs.map(t => {
                const required = t.parameters?.required?.length ? ` (required: ${t.parameters.required.join(', ')})` : '';
                const props = t.parameters?.properties
                    ? Object.entries(t.parameters.properties)
                        .map(([k, v]: [string, any]) => `    - ${k} (${v.type}): ${v.description}`)
                        .join('\n')
                    : '';
                const exampleStr = t.example ? `\n    Example params: ${JSON.stringify(t.example)}` : '';
                return `- **${t.name}**: ${t.description}${required}\n${props}${exampleStr}`;
            }).join('\n')
            : this.config.capabilities.map(c => `- **${c.name}**: ${c.description}`).join('\n') || 'None';

        return `<role>
You are ${this.config.name}, a ${this.config.role} in an autonomous multi-agent virtual office.
Communication style: ${this.config.personality.communicationStyle}.
Personality traits: ${JSON.stringify(this.config.personality.traits)}.
${this.config.inference.systemPrompt}
</role>

<skills>
${skillsBlock}
</skills>

<available_tools>
You may ONLY invoke tools from this exact list when action is "use_tool":
${toolsBlock}
</available_tools>

<constraints>
1. Never invent or call a tool that is not listed in <available_tools>.
2. If a colleague sent you a message in <recent_messages>, prioritize replying with action "talk" and set "target" to their exact name.
3. If you have an assigned task in <current_task>, make concrete progress using your <skills> and <available_tools>, or coordinate with teammates.
4. Keep "thought" concise (maximum 30 words) reflecting your active skills and reasoning.
5. Output ONLY a valid JSON object matching the <output_format> schema. Do not wrap in markdown prose.
</constraints>

<output_format>
{
  "thought": "brief inner monologue (max 30 words)",
  "action": "work" | "talk" | "idle" | "use_tool",
  "target": "colleague name if action is talk, or tool name if action is use_tool",
  "message": "message to colleague if action is talk",
  "toolCall": { "name": "exact_tool_name", "params": { "key": "value" } }
}
</output_format>`;
    }

    // --- Core Think Cycle ---

    async think(perception: Perception): Promise<Decision> {
        this.status = 'THINKING';

        if (!this.adapter) {
            console.warn(`[Agent ${this.config.name}] No InferenceAdapter set, mocking thought...`);
            return { thought: 'Waiting for LLM adapter configuration...', action: 'idle' };
        }

        try {
            const nearbyStr = perception.nearbyAgents.length > 0
                ? perception.nearbyAgents.map(a => `${a.name} (${a.role}, dist=${a.distance})`).join(', ')
                : 'Alone at your workstation.';

            const messageStr = perception.recentMessages.length > 0
                ? perception.recentMessages.map(m => `${m.from}: "${m.content}"`).join('\n')
                : 'No unread messages.';

            const memoryStr = perception.memories.length > 0
                ? perception.memories.slice(-6).join('\n')
                : 'No recent memories.';

            const taskStr = perception.currentTask
                ? JSON.stringify(perception.currentTask)
                : 'No active task assigned.';

            const loopWarning = this.repeatedToolCount >= 2
                ? `\n<system_warning>You have called the same tool (${this.lastToolSignature}) ${this.repeatedToolCount} times in a row. Choose a different action, talk to a teammate, or complete the task.</system_warning>`
                : '';

            const userContext = `<office_context>
Time: ${perception.time}
Location: (${perception.location})
Nearby Colleagues: ${nearbyStr}
</office_context>

<current_task>
${taskStr}
</current_task>

<recent_messages>
${messageStr}
</recent_messages>

<recent_memories>
${memoryStr}
</recent_memories>${loopWarning}

Decide your next step and respond with the JSON object.`;

            const res = await this.adapter.complete({
                model: this.config.inference.model,
                messages: [
                    { role: 'system', content: this.buildSystemInstruction() },
                    { role: 'user', content: userContext }
                ],
                temperature: this.config.inference.temperature ?? 0.7
            });

            // Support native toolCalls if the provider returned them directly
            if (res.toolCalls && res.toolCalls.length > 0 && !res.content.includes('"action"')) {
                const tc = res.toolCalls[0];
                const decision: Decision = {
                    thought: `Executing tool ${tc.name} for current task.`,
                    action: 'use_tool',
                    target: tc.name,
                    toolCall: { name: tc.name, params: tc.params || {} }
                };
                this.trackLoopGuardrail(decision);
                return decision;
            }

            const match = res.content.match(/\{[\s\S]*\}/);
            const decisionStr = match ? match[0] : null;

            if (decisionStr) {
                const parsed = JSON.parse(decisionStr);
                const decision: Decision = {
                    thought: (parsed.thought || 'Thinking...').slice(0, 140),
                    action: parsed.action || 'idle',
                    target: parsed.target,
                    message: parsed.message,
                    toolCall: parsed.toolCall
                };

                this.trackLoopGuardrail(decision);

                // Auto-remember this thought
                this.addMemory({
                    content: decision.thought,
                    type: 'thought',
                    timestamp: perception.time,
                    importance: 0.3
                });

                return decision;
            }
        } catch (e) {
            console.error(`[Agent ${this.config.name}] Inference failed:`, e);
        }

        return { thought: 'Analyzing office state...', action: 'idle' };
    }

    private trackLoopGuardrail(decision: Decision) {
        if (decision.action === 'use_tool' && decision.toolCall) {
            const sig = `${decision.toolCall.name}:${JSON.stringify(decision.toolCall.params || {})}`;
            if (sig === this.lastToolSignature) {
                this.repeatedToolCount++;
            } else {
                this.lastToolSignature = sig;
                this.repeatedToolCount = 1;
            }
        } else {
            this.lastToolSignature = '';
            this.repeatedToolCount = 0;
        }
    }

    async act(decision: Decision): Promise<ActionResult> {
        this.status = 'ACTING';
        return { success: true };
    }

    async remember(event: Event): Promise<void> {
        this.addMemory({
            content: `${event.type}: ${JSON.stringify(event.data)}`,
            type: 'observation',
            timestamp: event.timestamp.toISOString(),
            importance: 0.5
        });
    }

    async communicate(message: Message): Promise<void> {
        this.status = 'COMMUNICATING';
        this.addMemory({
            content: `${message.from} said: "${message.content}"`,
            type: 'conversation',
            timestamp: new Date().toISOString(),
            importance: 0.7
        });
    }
}
