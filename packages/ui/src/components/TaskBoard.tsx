import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';
import { CharacterAvatarPreview } from './AgentStudio';

interface TaskItem {
    id: number | string;
    title: string;
    assigned_to: string;
    status: string;
    summary?: string;
}

interface AgentOption {
    id: string;
    name: string;
    role: string;
    avatar: string;
}

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const [agents, setAgents] = useState<AgentOption[]>([]);

    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                // Task update message handler
                room.onMessage('task-update', (data: any) => {
                    setTasks(prev => {
                        const taskTitle = data.task || data.title;
                        const existing = prev.find(t => t.title === taskTitle || (data.taskId && t.id === data.taskId));
                        if (existing) {
                            return prev.map(t =>
                                (t.title === taskTitle || (data.taskId && t.id === data.taskId))
                                    ? {
                                        ...t,
                                        status: data.status,
                                        assigned_to: data.agentId || data.agentName || t.assigned_to,
                                        summary: data.summary || t.summary
                                    }
                                    : t
                            );
                        }
                        return [
                            ...prev,
                            {
                                id: data.taskId || Date.now(),
                                title: taskTitle,
                                assigned_to: data.agentName || data.agentId || '',
                                status: data.status,
                                summary: data.summary
                            }
                        ];
                    });
                });

                // Tasks sync message handler
                room.onMessage('tasks-sync', (serverTasks: any[]) => {
                    if (Array.isArray(serverTasks)) {
                        setTasks(serverTasks.map(t => ({
                            id: t.id,
                            title: t.title,
                            assigned_to: t.assigned_to || '',
                            status: t.status,
                            summary: t.summary
                        })));
                    }
                });

                // Update active agents list dynamically
                const updateAgentsList = () => {
                    const list: AgentOption[] = [];
                    room.state.agents.forEach((ag, id) => {
                        list.push({
                            id,
                            name: ag.name,
                            role: ag.role,
                            avatar: ag.avatar || 'char_0'
                        });
                    });
                    setAgents(list);
                };

                updateAgentsList();
                room.state.agents.onAdd(updateAgentsList);
                room.state.agents.onRemove(updateAgentsList);

                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', {
                title: newTask.trim(),
                agentId: targetAgent === 'auto' ? undefined : targetAgent
            });
            setNewTask('');
        }
    };

    const handleCompleteTask = (task: TaskItem) => {
        const room = getColyseusRoom();
        if (room) {
            room.send('complete-task', {
                taskId: task.id,
                title: task.title,
                summary: 'Completed by user from Task Board'
            });
        }
        setTasks(prev => prev.map(t =>
            (t.id === task.id || t.title === task.title)
                ? { ...t, status: 'completed', summary: 'Completed by user from Task Board' }
                : t
        ));
    };

    const statusColor = (s: string) => {
        if (s === 'completed') return '#00b894';
        if (s === 'in_progress') return '#fdcb6e';
        return '#74b9ff';
    };

    const statusIcon = (s: string) => {
        if (s === 'completed') return '✅';
        if (s === 'in_progress') return '🔄';
        return '⏳';
    };

    const getAssignedAgentAvatar = (assignedNameOrId: string) => {
        const found = agents.find(a => a.id === assignedNameOrId || a.name === assignedNameOrId);
        return found?.avatar || 'char_0';
    };

    return (
        <FloatingPanel
            id="task-board"
            title="Task Board"
            width={310}
            defaultDock="left"
            defaultY={320}
            subtitle={`${tasks.filter(t => t.status !== 'completed').length} active`}
        >
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '52vh', fontSize: '12px' }}>
                {/* Task Assignment Form */}
                <form onSubmit={handleSubmit} style={{ marginBottom: 10 }}>
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="Assign work to team..."
                        style={{
                            width: '100%', padding: '7px 9px', borderRadius: 6,
                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                            color: 'white', fontSize: '11px', outline: 'none',
                            boxSizing: 'border-box', marginBottom: 6
                        }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <select
                            value={targetAgent}
                            onChange={(e) => setTargetAgent(e.target.value)}
                            style={{
                                flex: 1, padding: '6px', borderRadius: 6,
                                border: '1px solid #444', backgroundColor: '#1a1a3e',
                                color: '#ddd', fontSize: '11px'
                            }}
                        >
                            <option value="auto">🤖 Auto-assign (Least Busy)</option>
                            {agents.map(ag => (
                                <option key={ag.id} value={ag.id}>
                                    {ag.name} ({ag.role})
                                </option>
                            ))}
                        </select>
                        <button
                            type="submit"
                            style={{
                                padding: '6px 12px', borderRadius: 6, border: 'none',
                                backgroundColor: '#6c5ce7', color: 'white', fontSize: '11px',
                                cursor: 'pointer', fontWeight: 'bold'
                            }}
                        >
                            Assign
                        </button>
                    </div>
                </form>

                {/* Task List */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
                    {tasks.length === 0 && (
                        <p style={{ color: '#777', fontStyle: 'italic', margin: '14px 0', fontSize: '11px', textAlign: 'center' }}>
                            No tasks yet. Type above to assign work to agents!
                        </p>
                    )}
                    {tasks.map(task => (
                        <div
                            key={String(task.id) + task.title}
                            style={{
                                padding: '7px 9px', marginBottom: 6, borderRadius: 6,
                                backgroundColor: 'rgba(255,255,255,0.04)',
                                borderLeft: `3px solid ${statusColor(task.status)}`,
                                borderTop: '1px solid rgba(255,255,255,0.06)',
                                borderRight: '1px solid rgba(255,255,255,0.06)',
                                borderBottom: '1px solid rgba(255,255,255,0.06)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#f5f6fa', flex: 1 }}>
                                    {statusIcon(task.status)} {task.title}
                                </div>
                                {task.status !== 'completed' && (
                                    <button
                                        onClick={() => handleCompleteTask(task)}
                                        style={{
                                            padding: '2px 6px', borderRadius: 4, border: '1px solid #00b894',
                                            backgroundColor: 'rgba(0, 184, 148, 0.2)', color: '#55efc4',
                                            fontSize: '10px', cursor: 'pointer', fontWeight: 'bold'
                                        }}
                                        title="Mark task completed"
                                    >
                                        ✓ Complete
                                    </button>
                                )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                {task.assigned_to && (
                                    <CharacterAvatarPreview
                                        avatar={getAssignedAgentAvatar(task.assigned_to)}
                                        size="sm"
                                    />
                                )}
                                <span style={{ fontSize: '10px', color: '#aaa' }}>
                                    → {task.assigned_to || 'Unassigned'}
                                </span>
                                <span style={{
                                    fontSize: '9px', padding: '1px 4px', borderRadius: 3,
                                    backgroundColor: 'rgba(255,255,255,0.08)',
                                    color: statusColor(task.status), marginLeft: 'auto',
                                    textTransform: 'capitalize'
                                }}>
                                    {task.status.replace('_', ' ')}
                                </span>
                            </div>

                            {task.summary && (
                                <div style={{
                                    fontSize: '10px', color: '#55efc4', fontStyle: 'italic',
                                    marginTop: 4, padding: '2px 4px', backgroundColor: 'rgba(0, 184, 148, 0.1)',
                                    borderRadius: 4
                                }}>
                                    Deliverable: {task.summary}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: 8, fontSize: '10px', color: '#666', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Dynamic Multi-Agent</span>
                    <span>💾 SQLite Persistence</span>
                </div>
            </div>
        </FloatingPanel>
    );
}
