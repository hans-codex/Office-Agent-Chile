import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';

export interface AgentProfile {
    id: string;
    name: string;
    role: string;
    avatar: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    communicationStyle?: string;
    skills?: string[];
    allowedTools?: string[];
    x?: number;
    y?: number;
}

export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    category?: string;
    instructions: string;
    recommendedTools?: string[];
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters?: any;
}

const AVATAR_OPTIONS = ['char_0', 'char_1', 'char_2', 'char_3', 'char_4', 'char_5'] as const;
const PROVIDER_OPTIONS = ['gemini', 'openai', 'openrouter', 'ollama'] as const;
const STYLE_OPTIONS = ['technical', 'creative', 'casual', 'formal'] as const;

const DEFAULT_MODELS: Record<string, string> = {
    gemini: 'gemini-3.8-flash',
    openai: 'gpt-4o-mini',
    openrouter: 'deepseek/deepseek-chat',
    ollama: 'llama3.2:latest'
};

export function CharacterAvatarPreview({
    avatar,
    size = 'md',
    selected = false,
    onClick
}: {
    avatar: string;
    size?: 'sm' | 'md' | 'lg';
    selected?: boolean;
    onClick?: () => void;
}) {
    const scale = size === 'sm' ? 1 : size === 'md' ? 1.4 : 2;
    const width = 16 * scale;
    const height = 32 * scale;
    const bgWidth = 112 * scale;
    const bgHeight = 96 * scale;
    const charName = avatar || 'char_0';

    return (
        <div
            onClick={onClick}
            style={{
                width: width + 8,
                height: height + 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                border: selected ? '2px solid #a29bfe' : '1px solid rgba(255,255,255,0.15)',
                backgroundColor: selected ? 'rgba(108, 92, 231, 0.4)' : 'rgba(255,255,255,0.06)',
                cursor: onClick ? 'pointer' : 'default',
                boxShadow: selected ? '0 0 10px rgba(108, 92, 231, 0.6)' : 'none',
                transition: 'all 0.15s ease'
            }}
            title={charName}
        >
            <div
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    backgroundImage: `url(/assets/characters/${charName}.png)`,
                    backgroundPosition: '0 0',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${bgWidth}px ${bgHeight}px`,
                    imageRendering: 'pixelated'
                }}
            />
        </div>
    );
}

export function AgentStudio() {
    const [tab, setTab] = useState<'agents' | 'editor' | 'catalog' | 'new-skill'>('agents');
    const [agents, setAgents] = useState<AgentProfile[]>([]);
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [tools, setTools] = useState<ToolDefinition[]>([]);
    const [catalogView, setCatalogView] = useState<'skills' | 'tools'>('skills');

    // Editing agent state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formName, setFormName] = useState('');
    const [formRole, setFormRole] = useState('');
    const [formAvatar, setFormAvatar] = useState('char_0');
    const [formProvider, setFormProvider] = useState<string>('gemini');
    const [formModel, setFormModel] = useState('gemini-2.5-flash');
    const [formPrompt, setFormPrompt] = useState('');
    const [formStyle, setFormStyle] = useState('technical');
    const [formSkills, setFormSkills] = useState<string[]>([]);
    const [formTools, setFormTools] = useState<string[]>(['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task']);

    // New skill form state
    const [skillName, setSkillName] = useState('');
    const [skillCategory, setSkillCategory] = useState('Engineering');
    const [skillDesc, setSkillDesc] = useState('');
    const [skillInstructions, setSkillInstructions] = useState('');
    const [skillRecTools, setSkillRecTools] = useState<string[]>(['code_execute', 'read_file']);
    const [saveStatus, setSaveStatus] = useState<string | null>(null);

    // Initial load via REST & real-time sync via Colyseus
    useEffect(() => {
        const fetchRestData = async () => {
            try {
                const [skillsRes, toolsRes, agentsRes] = await Promise.all([
                    fetch('/api/skills').then(r => r.ok ? r.json() : []).catch(() => []),
                    fetch('/api/tools').then(r => r.ok ? r.json() : []).catch(() => []),
                    fetch('/api/agents').then(r => r.ok ? r.json() : []).catch(() => [])
                ]);
                if (Array.isArray(skillsRes) && skillsRes.length > 0) setSkills(skillsRes);
                if (Array.isArray(toolsRes) && toolsRes.length > 0) setTools(toolsRes);
                if (Array.isArray(agentsRes) && agentsRes.length > 0) setAgents(agentsRes);
            } catch (err) {
                console.warn('[AgentStudio] REST fetch fallback error:', err);
            }
        };

        fetchRestData();

        const pollRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.onMessage('skills-sync', (data: SkillDefinition[]) => {
                    if (Array.isArray(data)) setSkills(data);
                });
                room.onMessage('tools-sync', (data: ToolDefinition[]) => {
                    if (Array.isArray(data)) setTools(data);
                });
                room.onMessage('agent-profiles-sync', (data: AgentProfile[]) => {
                    if (Array.isArray(data)) setAgents(data);
                });
                clearInterval(pollRoom);
            }
        }, 500);

        return () => clearInterval(pollRoom);
    }, []);

    // Listen for requests from AgentInspector to open an agent in Studio
    useEffect(() => {
        const handleOpenStudio = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.agentId) {
                const target = agents.find(a => a.id === detail.agentId);
                if (target) {
                    startEdit(target);
                }
            }
        };
        eventBus.addEventListener('open-studio-agent', handleOpenStudio);
        return () => eventBus.removeEventListener('open-studio-agent', handleOpenStudio);
    }, [agents]);

    const startEdit = (agent: AgentProfile) => {
        setEditingId(agent.id);
        setFormName(agent.name);
        setFormRole(agent.role);
        setFormAvatar(agent.avatar || 'char_0');
        setFormProvider(agent.provider || 'gemini');
        setFormModel(agent.model || DEFAULT_MODELS[agent.provider || 'gemini'] || 'gemini-2.5-flash');
        setFormPrompt(agent.systemPrompt || '');
        setFormStyle(agent.communicationStyle || 'technical');
        setFormSkills(agent.skills ? [...agent.skills] : []);
        setFormTools(agent.allowedTools ? [...agent.allowedTools] : ['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task']);
        setTab('editor');
    };

    const resetForm = () => {
        setEditingId(null);
        setFormName('');
        setFormRole('');
        setFormAvatar('char_0');
        setFormProvider('gemini');
        setFormModel(DEFAULT_MODELS['gemini']);
        setFormPrompt('');
        setFormStyle('technical');
        setFormSkills([]);
        setFormTools(['code_execute', 'read_file', 'write_file', 'list_files', 'complete_task']);
    };

    const handleProviderChange = (newProvider: string) => {
        setFormProvider(newProvider);
        setFormModel(DEFAULT_MODELS[newProvider] || '');
    };

    const handleSaveAgent = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formName.trim()) {
            alert('Agent name is required');
            return;
        }

        const room = getColyseusRoom();
        const payload = {
            id: editingId || undefined,
            name: formName.trim(),
            role: formRole.trim() || 'Specialist',
            avatar: formAvatar,
            provider: formProvider,
            model: formModel.trim() || DEFAULT_MODELS[formProvider],
            systemPrompt: formPrompt.trim() || undefined,
            communicationStyle: formStyle,
            skills: formSkills,
            allowedTools: formTools
        };

        if (room) {
            if (editingId) {
                room.send('update-agent', payload);
            } else {
                room.send('create-agent', payload);
            }
        }

        // Optimistic local state update
        if (editingId) {
            const currentId = editingId;
            setAgents(prev => prev.map(a => a.id === currentId ? { ...a, ...payload, id: currentId } : a));
        }

        setSaveStatus(`Agent ${formName} saved!`);
        setTimeout(() => setSaveStatus(null), 3000);
        resetForm();
        setTab('agents');
    };

    const handleDeleteAgent = (id: string, name: string) => {
        if (!confirm(`Are you sure you want to remove agent "${name}" from the office?`)) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('delete-agent', { id });
        }
        setAgents(prev => prev.filter(a => a.id !== id));
    };

    const handleSaveSkill = (e: React.FormEvent) => {
        e.preventDefault();
        if (!skillName.trim()) {
            alert('Skill name is required');
            return;
        }

        const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const newSkill: SkillDefinition = {
            id: slug,
            name: skillName.trim(),
            category: skillCategory,
            description: skillDesc.trim(),
            instructions: skillInstructions.trim() || `# ${skillName}\n\nOperate effectively in this role.`,
            recommendedTools: skillRecTools
        };

        const room = getColyseusRoom();
        if (room) {
            room.send('save-skill', newSkill);
        }

        setSkills(prev => {
            const filtered = prev.filter(s => s.id !== slug);
            return [...filtered, newSkill];
        });

        setSaveStatus(`Skill "${newSkill.name}" registered!`);
        setTimeout(() => setSaveStatus(null), 3000);

        setSkillName('');
        setSkillDesc('');
        setSkillInstructions('');
        setTab('catalog');
        setCatalogView('skills');
    };

    const toggleSkillSelection = (skillId: string) => {
        setFormSkills(prev =>
            prev.includes(skillId) ? prev.filter(s => s !== skillId) : [...prev, skillId]
        );
    };

    const toggleToolSelection = (toolName: string) => {
        setFormTools(prev =>
            prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName]
        );
    };

    const toggleRecToolSelection = (toolName: string) => {
        setSkillRecTools(prev =>
            prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName]
        );
    };

    return (
        <FloatingPanel
            id="agent-studio"
            title="Agent & Skill Studio"
            width={420}
            defaultDock="left"
            defaultY={20}
            subtitle="Configure agents, skills & tools"
        >
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '72vh', fontSize: '12px' }}>
                {/* Tab Navigation */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
                    <button
                        onClick={() => setTab('agents')}
                        style={{
                            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
                            backgroundColor: tab === 'agents' ? '#6c5ce7' : 'rgba(255,255,255,0.08)',
                            color: 'white', fontWeight: tab === 'agents' ? 'bold' : 'normal',
                            cursor: 'pointer', fontSize: '11px'
                        }}
                    >
                        👥 Agents ({agents.length})
                    </button>
                    <button
                        onClick={() => { resetForm(); setTab('editor'); }}
                        style={{
                            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
                            backgroundColor: tab === 'editor' ? '#6c5ce7' : 'rgba(255,255,255,0.08)',
                            color: 'white', fontWeight: tab === 'editor' ? 'bold' : 'normal',
                            cursor: 'pointer', fontSize: '11px'
                        }}
                    >
                        {editingId ? '✏️ Edit' : '➕ Create'}
                    </button>
                    <button
                        onClick={() => setTab('catalog')}
                        style={{
                            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
                            backgroundColor: tab === 'catalog' ? '#6c5ce7' : 'rgba(255,255,255,0.08)',
                            color: 'white', fontWeight: tab === 'catalog' ? 'bold' : 'normal',
                            cursor: 'pointer', fontSize: '11px'
                        }}
                    >
                        📚 Catalog
                    </button>
                    <button
                        onClick={() => setTab('new-skill')}
                        style={{
                            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
                            backgroundColor: tab === 'new-skill' ? '#6c5ce7' : 'rgba(255,255,255,0.08)',
                            color: 'white', fontWeight: tab === 'new-skill' ? 'bold' : 'normal',
                            cursor: 'pointer', fontSize: '11px'
                        }}
                    >
                        ⚡ New Skill
                    </button>
                </div>

                {/* Save Feedback Banner */}
                {saveStatus && (
                    <div style={{
                        padding: '6px 10px', marginBottom: 10, borderRadius: 6,
                        backgroundColor: 'rgba(0, 184, 148, 0.25)', border: '1px solid #00b894',
                        color: '#55efc4', fontSize: '11px', textAlign: 'center'
                    }}>
                        ✓ {saveStatus}
                    </div>
                )}

                {/* Content Area */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                    {/* TAB 1: ACTIVE AGENTS LIST */}
                    {tab === 'agents' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontWeight: 'bold', color: '#a29bfe' }}>Active Office Agents</span>
                                <button
                                    onClick={() => { resetForm(); setTab('editor'); }}
                                    style={{
                                        padding: '4px 8px', borderRadius: 4, border: 'none',
                                        backgroundColor: '#00b894', color: 'white', fontSize: '11px',
                                        cursor: 'pointer', fontWeight: 'bold'
                                    }}
                                >
                                    + Add Agent
                                </button>
                            </div>

                            {agents.length === 0 && (
                                <p style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', margin: '20px 0' }}>
                                    No agents found. Click "+ Add Agent" to spawn one!
                                </p>
                            )}

                            {agents.map(agent => (
                                <div
                                    key={agent.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                                        backgroundColor: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.08)'
                                    }}
                                >
                                    <CharacterAvatarPreview avatar={agent.avatar} size="sm" />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#f5f6fa' }}>
                                                {agent.name}
                                            </span>
                                            <span style={{
                                                fontSize: '10px', padding: '1px 5px', borderRadius: 4,
                                                backgroundColor: 'rgba(108, 92, 231, 0.3)', color: '#a29bfe'
                                            }}>
                                                {agent.role}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: 2 }}>
                                            ⚡ {agent.provider || 'ollama'} • {agent.model || 'default'}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#888', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                            {agent.skills?.map(s => (
                                                <span key={s} style={{ background: 'rgba(0, 184, 148, 0.2)', color: '#55efc4', padding: '1px 4px', borderRadius: 3 }}>
                                                    {s}
                                                </span>
                                            ))}
                                            <span style={{ color: '#666' }}>({agent.allowedTools?.length || 0} tools)</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <button
                                            onClick={() => startEdit(agent)}
                                            style={{
                                                padding: '4px 8px', borderRadius: 4, border: '1px solid #6c5ce7',
                                                backgroundColor: 'rgba(108, 92, 231, 0.2)', color: '#dcdde1',
                                                fontSize: '10px', cursor: 'pointer'
                                            }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDeleteAgent(agent.id, agent.name)}
                                            style={{
                                                padding: '4px 8px', borderRadius: 4, border: '1px solid #d63031',
                                                backgroundColor: 'rgba(214, 48, 49, 0.2)', color: '#ff7675',
                                                fontSize: '10px', cursor: 'pointer'
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* TAB 2: CREATE / EDIT AGENT FORM */}
                    {tab === 'editor' && (
                        <form onSubmit={handleSaveAgent} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ fontWeight: 'bold', color: '#a29bfe', marginBottom: 2 }}>
                                {editingId ? `Edit Agent: ${formName}` : 'Create New Agent'}
                            </div>

                            {/* Name & Role */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Name *</label>
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={e => setFormName(e.target.value)}
                                        placeholder="e.g. Maya"
                                        required
                                        style={{
                                            width: '100%', padding: '6px 8px', borderRadius: 6,
                                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                                            color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Role</label>
                                    <input
                                        type="text"
                                        value={formRole}
                                        onChange={e => setFormRole(e.target.value)}
                                        placeholder="e.g. Lead Architect"
                                        style={{
                                            width: '100%', padding: '6px 8px', borderRadius: 6,
                                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                                            color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Visual Avatar Picker */}
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 4 }}>
                                    Avatar Sprite (char_0 to char_5)
                                </label>
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '6px 4px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                                    {AVATAR_OPTIONS.map(av => (
                                        <div key={av} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                            <CharacterAvatarPreview
                                                avatar={av}
                                                size="md"
                                                selected={formAvatar === av}
                                                onClick={() => setFormAvatar(av)}
                                            />
                                            <span style={{ fontSize: '9px', color: formAvatar === av ? '#a29bfe' : '#777' }}>
                                                {av}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* LLM Provider & Model */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>LLM Provider</label>
                                    <select
                                        value={formProvider}
                                        onChange={e => handleProviderChange(e.target.value)}
                                        style={{
                                            width: '100%', padding: '6px 8px', borderRadius: 6,
                                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                                            color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                        }}
                                    >
                                        {PROVIDER_OPTIONS.map(p => (
                                            <option key={p} value={p}>{p.toUpperCase()}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Model</label>
                                    <input
                                        type="text"
                                        value={formModel}
                                        onChange={e => setFormModel(e.target.value)}
                                        placeholder={DEFAULT_MODELS[formProvider] || 'model'}
                                        style={{
                                            width: '100%', padding: '6px 8px', borderRadius: 6,
                                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                                            color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Communication Style */}
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Communication Style</label>
                                <select
                                    value={formStyle}
                                    onChange={e => setFormStyle(e.target.value)}
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                    }}
                                >
                                    {STYLE_OPTIONS.map(s => (
                                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* System Prompt */}
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>System Prompt</label>
                                <textarea
                                    value={formPrompt}
                                    onChange={e => setFormPrompt(e.target.value)}
                                    placeholder="Define agent personality, domain rules, and constraints..."
                                    rows={3}
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            {/* Assigned Skills */}
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 4 }}>
                                    Assigned Skills ({formSkills.length} selected)
                                </label>
                                <div style={{
                                    maxHeight: 110, overflowY: 'auto', padding: '6px 8px',
                                    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, border: '1px solid #333'
                                }}>
                                    {skills.length === 0 && (
                                        <span style={{ color: '#777', fontStyle: 'italic' }}>No skills in catalog.</span>
                                    )}
                                    {skills.map(s => (
                                        <label key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formSkills.includes(s.id)}
                                                onChange={() => toggleSkillSelection(s.id)}
                                                style={{ marginTop: 2 }}
                                            />
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: formSkills.includes(s.id) ? '#a29bfe' : '#ddd' }}>
                                                    {s.name} <span style={{ fontSize: '9px', opacity: 0.6 }}>({s.category || 'Skill'})</span>
                                                </div>
                                                <div style={{ fontSize: '10px', color: '#888' }}>
                                                    {s.description}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Allowed Tools */}
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 4 }}>
                                    Allowed Tools ({formTools.length} selected)
                                </label>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
                                    maxHeight: 110, overflowY: 'auto', padding: '6px 8px',
                                    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, border: '1px solid #333'
                                }}>
                                    {tools.length === 0 && (
                                        <span style={{ color: '#777', fontStyle: 'italic' }}>Loading tools...</span>
                                    )}
                                    {tools.map(t => (
                                        <label key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '10px' }}>
                                            <input
                                                type="checkbox"
                                                checked={formTools.includes(t.name)}
                                                onChange={() => toggleToolSelection(t.name)}
                                            />
                                            <span style={{ color: formTools.includes(t.name) ? '#55efc4' : '#aaa' }}>
                                                {t.name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                <button
                                    type="submit"
                                    style={{
                                        flex: 2, padding: '8px 12px', borderRadius: 6, border: 'none',
                                        backgroundColor: '#6c5ce7', color: 'white', fontWeight: 'bold',
                                        cursor: 'pointer', fontSize: '11px'
                                    }}
                                >
                                    💾 {editingId ? 'Update Agent' : 'Create Agent'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { resetForm(); setTab('agents'); }}
                                    style={{
                                        flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #444',
                                        backgroundColor: 'transparent', color: '#aaa',
                                        cursor: 'pointer', fontSize: '11px'
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}

                    {/* TAB 3: SKILLS & TOOLS CATALOG */}
                    {tab === 'catalog' && (
                        <div>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                                <button
                                    onClick={() => setCatalogView('skills')}
                                    style={{
                                        flex: 1, padding: '4px', borderRadius: 4, border: 'none',
                                        backgroundColor: catalogView === 'skills' ? 'rgba(108, 92, 231, 0.4)' : 'rgba(255,255,255,0.06)',
                                        color: catalogView === 'skills' ? '#a29bfe' : '#aaa',
                                        fontWeight: 'bold', fontSize: '10px', cursor: 'pointer'
                                    }}
                                >
                                    Skills Catalog ({skills.length})
                                </button>
                                <button
                                    onClick={() => setCatalogView('tools')}
                                    style={{
                                        flex: 1, padding: '4px', borderRadius: 4, border: 'none',
                                        backgroundColor: catalogView === 'tools' ? 'rgba(0, 184, 148, 0.4)' : 'rgba(255,255,255,0.06)',
                                        color: catalogView === 'tools' ? '#55efc4' : '#aaa',
                                        fontWeight: 'bold', fontSize: '10px', cursor: 'pointer'
                                    }}
                                >
                                    Tools Catalog ({tools.length})
                                </button>
                            </div>

                            {catalogView === 'skills' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {skills.map(s => (
                                        <div
                                            key={s.id}
                                            style={{
                                                padding: '8px 10px', borderRadius: 6,
                                                backgroundColor: 'rgba(255,255,255,0.04)',
                                                border: '1px solid rgba(255,255,255,0.08)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontWeight: 'bold', color: '#a29bfe' }}>{s.name}</span>
                                                <span style={{ fontSize: '9px', backgroundColor: 'rgba(108,92,231,0.2)', padding: '1px 5px', borderRadius: 4 }}>
                                                    {s.category || 'General'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#ccc', margin: '4px 0' }}>
                                                {s.description}
                                            </div>
                                            {s.recommendedTools && s.recommendedTools.length > 0 && (
                                                <div style={{ fontSize: '10px', color: '#888', marginTop: 4 }}>
                                                    Recommended: {s.recommendedTools.join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {catalogView === 'tools' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {tools.map(t => (
                                        <div
                                            key={t.name}
                                            style={{
                                                padding: '8px 10px', borderRadius: 6,
                                                backgroundColor: 'rgba(255,255,255,0.04)',
                                                border: '1px solid rgba(255,255,255,0.08)'
                                            }}
                                        >
                                            <div style={{ fontWeight: 'bold', color: '#55efc4' }}>🔧 {t.name}</div>
                                            <div style={{ fontSize: '11px', color: '#ccc', margin: '4px 0' }}>
                                                {t.description}
                                            </div>
                                            {t.parameters && (
                                                <div style={{ fontSize: '10px', color: '#777', fontFamily: 'monospace', marginTop: 2 }}>
                                                    Params: {Object.keys(t.parameters.properties || {}).join(', ') || 'none'}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 4: CUSTOM SKILL CREATOR */}
                    {tab === 'new-skill' && (
                        <form onSubmit={handleSaveSkill} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ fontWeight: 'bold', color: '#a29bfe', marginBottom: 2 }}>
                                Define New Skill
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Skill Name *</label>
                                <input
                                    type="text"
                                    value={skillName}
                                    onChange={e => setSkillName(e.target.value)}
                                    placeholder="e.g. Security Auditor"
                                    required
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Category</label>
                                <select
                                    value={skillCategory}
                                    onChange={e => setSkillCategory(e.target.value)}
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                    }}
                                >
                                    <option value="Engineering">Engineering</option>
                                    <option value="Product">Product</option>
                                    <option value="Security">Security</option>
                                    <option value="Operations">Operations</option>
                                    <option value="Research">Research</option>
                                    <option value="Design">Design</option>
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Short Description</label>
                                <input
                                    type="text"
                                    value={skillDesc}
                                    onChange={e => setSkillDesc(e.target.value)}
                                    placeholder="Brief summary of capability..."
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 3 }}>Instructions / Methodology (Markdown)</label>
                                <textarea
                                    value={skillInstructions}
                                    onChange={e => setSkillInstructions(e.target.value)}
                                    placeholder="# Methodology&#10;&#10;1. Analyze input...&#10;2. Apply verification rules..."
                                    rows={4}
                                    style={{
                                        width: '100%', padding: '6px 8px', borderRadius: 6,
                                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                                        color: 'white', fontSize: '11px', boxSizing: 'border-box',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: 4 }}>
                                    Recommended Tools
                                </label>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
                                    maxHeight: 100, overflowY: 'auto', padding: '6px 8px',
                                    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, border: '1px solid #333'
                                }}>
                                    {tools.map(t => (
                                        <label key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '10px' }}>
                                            <input
                                                type="checkbox"
                                                checked={skillRecTools.includes(t.name)}
                                                onChange={() => toggleRecToolSelection(t.name)}
                                            />
                                            <span style={{ color: skillRecTools.includes(t.name) ? '#a29bfe' : '#aaa' }}>
                                                {t.name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                style={{
                                    padding: '8px 12px', borderRadius: 6, border: 'none',
                                    backgroundColor: '#00b894', color: 'white', fontWeight: 'bold',
                                    cursor: 'pointer', fontSize: '11px', marginTop: 4
                                }}
                            >
                                ⚡ Register Skill
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </FloatingPanel>
    );
}
