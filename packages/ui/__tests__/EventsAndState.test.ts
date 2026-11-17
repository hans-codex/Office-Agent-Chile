import { eventBus } from '../src/events';
import { AgentState, OfficeState } from '../src/game/schema';

describe('UI Events & Colyseus Schema Sync', () => {
    it('should dispatch and receive agent-focus events on eventBus', (done) => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            expect(detail).toEqual({ id: 'agent_alice', name: 'Alice' });
            eventBus.removeEventListener('agent-focus', handler);
            done();
        };

        eventBus.addEventListener('agent-focus', handler);
        eventBus.dispatchEvent(new CustomEvent('agent-focus', {
            detail: { id: 'agent_alice', name: 'Alice' }
        }));
    });

    it('should dispatch and receive focus-camera events on eventBus', (done) => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            expect(detail).toEqual({ id: 'agent_bob' });
            eventBus.removeEventListener('focus-camera', handler);
            done();
        };

        eventBus.addEventListener('focus-camera', handler);
        eventBus.dispatchEvent(new CustomEvent('focus-camera', {
            detail: { id: 'agent_bob' }
        }));
    });

    it('should correctly initialize AgentState schema properties', () => {
        const agent = new AgentState();
        agent.id = 'char_001';
        agent.name = 'Charlie';
        agent.role = 'DevOps';
        agent.avatar = 'char_4';
        agent.x = 12;
        agent.y = 18;
        agent.action = 'work';
        agent.currentTask = 'Deploy pipeline';
        agent.thought = 'Checking cluster health';
        agent.mood = 0.85;
        agent.momentum = 0.9;
        agent.reputation = 0.75;
        agent.riskLevel = 0.15;

        expect(agent.name).toBe('Charlie');
        expect(agent.avatar).toBe('char_4');
        expect(agent.action).toBe('work');
        expect(agent.mood).toBe(0.85);
        expect(agent.riskLevel).toBe(0.15);
    });

    it('should support adding agents into OfficeState MapSchema', () => {
        const state = new OfficeState();
        const agent1 = new AgentState();
        agent1.id = 'a1';
        agent1.name = 'Alice';
        agent1.avatar = 'char_0';

        const agent2 = new AgentState();
        agent2.id = 'a2';
        agent2.name = 'Bob';
        agent2.avatar = 'char_1';

        state.agents.set('a1', agent1);
        state.agents.set('a2', agent2);

        expect(state.agents.size).toBe(2);
        expect(state.agents.get('a1')?.name).toBe('Alice');
        expect(state.agents.get('a2')?.avatar).toBe('char_1');
    });
});
