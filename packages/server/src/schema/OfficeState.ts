import { Schema, MapSchema, type } from '@colyseus/schema';

export class AgentState extends Schema {
    @type('string') id: string;
    @type('string') name: string;
    @type('string') role: string;
    @type('string') avatar: string;
    @type('number') x: number;
    @type('number') y: number;
    @type('string') direction: 'up' | 'down' | 'left' | 'right';
    @type('string') action: string;
    @type('string') currentTask: string;
    @type('string') thought: string;
    @type('number') mood: number;
    @type('number') reputation: number;
    @type('number') riskLevel: number;
    @type('number') momentum: number;

    constructor(id: string, name: string, role: string = 'Specialist', avatar: string = 'char_0') {
        super();
        this.id = id;
        this.name = name;
        this.role = role;
        this.avatar = avatar;
        this.x = 0;
        this.y = 0;
        this.direction = 'down';
        this.action = 'idle';
        this.currentTask = '';
        this.thought = '';
        this.mood = 0.6;
        this.reputation = 0.5;
        this.riskLevel = 0.2;
        this.momentum = 0.4;
    }
}

export class OfficeState extends Schema {
    @type({ map: AgentState }) agents = new MapSchema<AgentState>();
    @type('string') officeTime: string = new Date().toISOString();
    @type('number') timeScale: number = 1;

    createAgent(id: string, name: string, role: string = 'Specialist', avatar: string = 'char_0') {
        this.agents.set(id, new AgentState(id, name, role, avatar));
    }

    removeAgent(id: string) {
        this.agents.delete(id);
    }
}
