import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';
import { CharacterAvatarPreview, AgentProfile } from './AgentStudio';

interface AgentInspectorProps {
    agent?: {
        id?: string;
        name: string;
        role: string;
        status?: string;
        currentTask?: string;
    };
}

export function AgentInspector({ agent: staticPropAgent }: AgentInspectorProps) {
    const [selectedId, setSelectedId] = useState<string | null>(staticPropAgent?.id || null);
    const [availableAgents, setAvailableAgents] = useState<{ id: string; name: string }[]>([]);
    const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
    const [telemetry, setTelemetry] = useState({
        mood: 0.7,
        momentum: 0.5,
        riskLevel: 0.2,
        reputation: 0.8,
        action: 'idle'
    });
    const [agentLiveState, setAgentLiveState] = useState<{
        name: string;
        role: string;
        avatar: string;
        action: string;
        currentTask: string;
        thought: string;
    }>({
        name: staticPropAgent?.name || 'Alice',
        role: staticPropAgent?.role || 'Engineer',
        avatar: 'char_0',
        action: staticPropAgent?.status || 'idle',
        currentTask: staticPropAgent?.currentTask || '',
        thought: ''
    });

    const [showTaskInput, setShowTaskInput] = useState(false);
    const [taskTitle, setTaskTitle] = useState('');

    // Listen to agent-focus events from Game.ts
    useEffect(() => {
        const handleFocus = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.id) {
                setSelectedId(detail.id);
            }
        };
        eventBus.addEventListener('agent-focus', handleFocus);
        return () => eventBus.removeEventListener('agent-focus', handleFocus);
    }, []);

    // Listen to agent-telemetry events from Game.ts
    useEffect(() => {
        const handleTelemetry = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail && (!selectedId || detail.id === selectedId)) {
                setTelemetry({
                    mood: typeof detail.mood === 'number' ? detail.mood : 0.5,
                    momentum: typeof detail.momentum === 'number' ? detail.momentum : 0.5,
                    riskLevel: typeof detail.riskLevel === 'number' ? detail.riskLevel : 0.2,
                    reputation: typeof detail.reputation === 'number' ? detail.reputation : 0.5,
                    action: detail.action || 'idle'
                });
            }
        };
        eventBus.addEventListener('agent-telemetry', handleTelemetry);
        return () => eventBus.removeEventListener('agent-telemetry', handleTelemetry);
    }, [selectedId]);

    // Register agent-profiles-sync listener cleanly once room is available
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                unsubscribe = room.onMessage('agent-profiles-sync', (list: AgentProfile[]) => {
                    if (Array.isArray(list)) {
                        const map: Record<string, AgentProfile> = {};
                        list.forEach(p => { map[p.id] = p; });
                        setProfiles(map);
                    }
                });
                clearInterval(checkRoom);
            }
        }, 500);

        // Initial REST fallback for immediate profile lookup
        fetch('/api/agents')
            .then(r => r.ok ? r.json() : [])
            .then((list: AgentProfile[]) => {
                if (Array.isArray(list) && list.length > 0) {
                    const map: Record<string, AgentProfile> = {};
                    list.forEach(p => { map[p.id] = p; });
                    setProfiles(prev => ({ ...map, ...prev }));
                }
            })
            .catch(() => {});

        return () => {
            clearInterval(checkRoom);
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    // Poll room state for active agents & telemetry
    useEffect(() => {
        const poll = setInterval(() => {
            const room = getColyseusRoom();
            if (!room) return;

            // Gather active agents
            const activeList: { id: string; name: string }[] = [];
            room.state.agents.forEach((ag, id) => {
                activeList.push({ id, name: ag.name });
            });
            setAvailableAgents(activeList);

            // If nothing selected yet, pick the first active agent
            const targetId = selectedId || (activeList.length > 0 ? activeList[0].id : null);
            if (targetId && !selectedId && activeList.length > 0) {
                setSelectedId(targetId);
            }

            if (targetId) {
                const ag = room.state.agents.get(targetId);
                if (ag) {
                    setAgentLiveState({
                        name: ag.name,
                        role: ag.role,
                        avatar: ag.avatar || 'char_0',
                        action: ag.action || 'idle',
                        currentTask: ag.currentTask || '',
                        thought: ag.thought || ''
                    });
                    setTelemetry(prev => ({
                        ...prev,
                        mood: Number(ag.mood || 0),
                        reputation: Number(ag.reputation || 0),
                        riskLevel: Number(ag.riskLevel || 0),
                        momentum: Number(ag.momentum || 0),
                        action: ag.action || 'idle'
                    }));
                }
            }
        }, 300);

        return () => clearInterval(poll);
    }, [selectedId]);

    const activeProfile = selectedId ? profiles[selectedId] : null;

    const handleFocusCamera = () => {
        if (!selectedId) return;
        eventBus.dispatchEvent(new CustomEvent('focus-camera', { detail: { id: selectedId } }));
    };

    const handleOpenStudio = () => {
        if (!selectedId) return;
        eventBus.dispatchEvent(new CustomEvent('open-studio-agent', { detail: { agentId: selectedId } }));
    };

    const handleAssignTask = (e: React.FormEvent) => {
        e.preventDefault();
        if (!taskTitle.trim() || !selectedId) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', { title: taskTitle.trim(), agentId: selectedId });
            setTaskTitle('');
            setShowTaskInput(false);
        }
    };

    const formatPercent = (val: number) => `${Math.round(Math.max(0, Math.min(1, val)) * 100)}%`;

    const getActionBadgeColor = (act: string) => {
        switch (act) {
            case 'work': return '#00b894';
            case 'talk': return '#0984e3';
            case 'use_tool': return '#e17055';
            case 'think': return '#fdcb6e';
            default: return '#636e72';
        }
    };

    return (
        <FloatingPanel
            id="agent-inspector"
            title="Agent Inspector"
            width={320}
            defaultDock="right"
            defaultY={20}
            subtitle={agentLiveState.name}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '12px' }}>
                {/* Agent Selector Dropdown (Quick switch between office agents) */}
                {availableAgents.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '10px', color: '#888' }}>Target:</span>
                        <select
                            value={selectedId || ''}
                            onChange={(e) => setSelectedId(e.target.value)}
                            style={{
                                flex: 1, padding: '4px 6px', borderRadius: 4,
                                border: '1px solid #444', backgroundColor: '#1a1a3e',
                                color: 'white', fontSize: '11px'
                            }}
                        >
                            {availableAgents.map(ag => (
                                <option key={ag.id} value={ag.id}>{ag.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Profile Header Card */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <CharacterAvatarPreview avatar={agentLiveState.avatar} size="lg" />
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#f5f6fa' }}>
                                {agentLiveState.name}
                            </span>
                            <span style={{
                                fontSize: '10px', padding: '2px 6px', borderRadius: 4,
                                backgroundColor: getActionBadgeColor(agentLiveState.action),
                                color: 'white', fontWeight: 'bold', textTransform: 'uppercase'
                            }}>
                                {agentLiveState.action}
                            </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#a29bfe', marginTop: 2 }}>
                            {agentLiveState.role}
                        </div>
                        {activeProfile?.provider && (
                            <div style={{ fontSize: '10px', color: '#888', marginTop: 2 }}>
                                Model: {activeProfile.provider} / {activeProfile.model || 'default'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Thought Bubble */}
                {agentLiveState.thought && (
                    <div style={{
                        padding: '8px 10px', borderRadius: 6,
                        backgroundColor: 'rgba(108, 92, 231, 0.15)',
                        borderLeft: '3px solid #6c5ce7',
                        fontStyle: 'italic', fontSize: '11px', color: '#dfe6e9'
                    }}>
                        💭 "{agentLiveState.thought}"
                    </div>
                )}

                {/* Current Task */}
                <div style={{
                    padding: '6px 8px', borderRadius: 6,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)'
                }}>
                    <div style={{ fontSize: '10px', color: '#888', marginBottom: 2 }}>Current Task</div>
                    <div style={{ fontWeight: 'bold', color: agentLiveState.currentTask ? '#55efc4' : '#777' }}>
                        {agentLiveState.currentTask ? `📋 ${agentLiveState.currentTask}` : 'No active task (Idle)'}
                    </div>
                </div>

                {/* Telemetry Metrics */}
                <div style={{
                    padding: '8px 10px', borderRadius: 6,
                    backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)'
                }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#a29bfe', marginBottom: 6 }}>
                        📊 Telemetry & State
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* Mood */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#bbb', marginBottom: 2 }}>
                                <span>Mood</span>
                                <span>{formatPercent(telemetry.mood)}</span>
                            </div>
                            <div style={{ width: '100%', height: 6, backgroundColor: '#2d3436', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    width: formatPercent(telemetry.mood),
                                    height: '100%',
                                    backgroundColor: telemetry.mood > 0.6 ? '#00b894' : telemetry.mood > 0.3 ? '#fdcb6e' : '#d63031',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        </div>

                        {/* Momentum */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#bbb', marginBottom: 2 }}>
                                <span>Momentum</span>
                                <span>{formatPercent(telemetry.momentum)}</span>
                            </div>
                            <div style={{ width: '100%', height: 6, backgroundColor: '#2d3436', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    width: formatPercent(telemetry.momentum),
                                    height: '100%',
                                    backgroundColor: '#0984e3',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        </div>

                        {/* Risk Level */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#bbb', marginBottom: 2 }}>
                                <span>Risk Level</span>
                                <span>{formatPercent(telemetry.riskLevel)}</span>
                            </div>
                            <div style={{ width: '100%', height: 6, backgroundColor: '#2d3436', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    width: formatPercent(telemetry.riskLevel),
                                    height: '100%',
                                    backgroundColor: telemetry.riskLevel > 0.6 ? '#d63031' : '#e17055',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        </div>

                        {/* Reputation */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#bbb', marginBottom: 2 }}>
                                <span>Reputation</span>
                                <span>{formatPercent(telemetry.reputation)}</span>
                            </div>
                            <div style={{ width: '100%', height: 6, backgroundColor: '#2d3436', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    width: formatPercent(telemetry.reputation),
                                    height: '100%',
                                    backgroundColor: '#a29bfe',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Skills & Tools */}
                {(activeProfile?.skills?.length || activeProfile?.allowedTools?.length) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {activeProfile?.skills && activeProfile.skills.length > 0 && (
                            <div>
                                <div style={{ fontSize: '10px', color: '#888', marginBottom: 3 }}>Assigned Skills</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {activeProfile.skills.map(s => (
                                        <span key={s} style={{
                                            fontSize: '10px', padding: '2px 6px', borderRadius: 4,
                                            backgroundColor: 'rgba(0, 184, 148, 0.25)', color: '#55efc4',
                                            border: '1px solid rgba(0, 184, 148, 0.4)'
                                        }}>
                                            ⚡ {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeProfile?.allowedTools && activeProfile.allowedTools.length > 0 && (
                            <div>
                                <div style={{ fontSize: '10px', color: '#888', marginBottom: 3 }}>Allowed Tools</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {activeProfile.allowedTools.map(t => (
                                        <span key={t} style={{
                                            fontSize: '9px', padding: '1px 5px', borderRadius: 3,
                                            backgroundColor: 'rgba(255,255,255,0.06)', color: '#aaa',
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}>
                                            🔧 {t}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}

                {/* Task Assignment Form (Inline toggle) */}
                {showTaskInput && (
                    <form onSubmit={handleAssignTask} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input
                            type="text"
                            value={taskTitle}
                            onChange={(e) => setTaskTitle(e.target.value)}
                            placeholder={`Assign task to ${agentLiveState.name}...`}
                            autoFocus
                            style={{
                                flex: 1, padding: '6px 8px', borderRadius: 6,
                                border: '1px solid #6c5ce7', backgroundColor: '#1a1a3e',
                                color: 'white', fontSize: '11px', outline: 'none'
                            }}
                        />
                        <button
                            type="submit"
                            style={{
                                padding: '6px 10px', borderRadius: 6, border: 'none',
                                backgroundColor: '#6c5ce7', color: 'white', fontSize: '11px',
                                cursor: 'pointer', fontWeight: 'bold'
                            }}
                        >
                            Send
                        </button>
                    </form>
                )}

                {/* Action Buttons Toolbar */}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                        onClick={handleFocusCamera}
                        style={{
                            flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
                            backgroundColor: 'rgba(255,255,255,0.06)', color: '#f5f6fa', fontSize: '11px',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
                        }}
                        title="Center camera on this agent"
                    >
                        🎯 Focus
                    </button>
                    <button
                        onClick={() => setShowTaskInput(prev => !prev)}
                        style={{
                            flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #6c5ce7',
                            backgroundColor: showTaskInput ? '#6c5ce7' : 'rgba(108, 92, 231, 0.2)',
                            color: 'white', fontSize: '11px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
                        }}
                    >
                        📝 Task
                    </button>
                    <button
                        onClick={handleOpenStudio}
                        style={{
                            flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #00b894',
                            backgroundColor: 'rgba(0, 184, 148, 0.2)', color: '#55efc4', fontSize: '11px',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
                        }}
                        title="Open agent in Studio to edit configuration"
                    >
                        🎨 Studio
                    </button>
                </div>
            </div>
        </FloatingPanel>
    );
}
