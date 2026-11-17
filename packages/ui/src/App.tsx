import React, { useState, useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { TaskBoard } from './components/TaskBoard';
import { AgentInspector } from './components/AgentInspector';
import { AgentStudio } from './components/AgentStudio';
import { LayoutEditor } from './components/LayoutEditor';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { eventBus } from './events';

export function App() {
    const [showStudio, setShowStudio] = useState(true);
    const [showInspector, setShowInspector] = useState(true);
    const [showTaskBoard, setShowTaskBoard] = useState(true);
    const [showChat, setShowChat] = useState(false);
    const [showLayout, setShowLayout] = useState(false);
    const [showSystemLog, setShowSystemLog] = useState(false);
    const [showViral, setShowViral] = useState(false);
    const [showGraph, setShowGraph] = useState(false);
    const [showHighlights, setShowHighlights] = useState(false);
    const [showPulse, setShowPulse] = useState(false);
    const [showRecap, setShowRecap] = useState(false);

    // Auto-open Studio when requested from AgentInspector or other components
    useEffect(() => {
        const handleOpenStudio = () => {
            setShowStudio(true);
        };
        const handleAgentFocus = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.id) {
                setShowInspector(true);
            }
        };

        eventBus.addEventListener('open-studio-agent', handleOpenStudio);
        eventBus.addEventListener('agent-focus', handleAgentFocus);

        return () => {
            eventBus.removeEventListener('open-studio-agent', handleOpenStudio);
            eventBus.removeEventListener('agent-focus', handleAgentFocus);
        };
    }, []);

    const toolbarButton = (
        label: string,
        active: boolean,
        onClick: () => void,
        activeColor = '#6c5ce7'
    ) => (
        <button
            onClick={onClick}
            style={{
                padding: '4px 9px',
                borderRadius: 14,
                border: active ? `1px solid ${activeColor}` : '1px solid rgba(255,255,255,0.12)',
                backgroundColor: active ? `${activeColor}33` : 'rgba(255,255,255,0.06)',
                color: active ? '#ffffff' : '#b2bec3',
                fontSize: '11px',
                fontWeight: active ? 'bold' : 'normal',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease'
            }}
        >
            {label}
        </button>
    );

    return (
        <>
            {/* Top Toolbar */}
            <div
                style={{
                    position: 'absolute',
                    top: 12,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 100,
                    backgroundColor: 'rgba(10, 10, 30, 0.88)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(108, 92, 231, 0.35)',
                    borderRadius: 24,
                    padding: '5px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                }}
            >
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#a29bfe', marginRight: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    🏢 Office
                </span>
                {toolbarButton('🎨 Studio', showStudio, () => setShowStudio(v => !v))}
                {toolbarButton('🔍 Inspector', showInspector, () => setShowInspector(v => !v))}
                {toolbarButton('📋 Tasks', showTaskBoard, () => setShowTaskBoard(v => !v))}
                {toolbarButton('💬 Chat', showChat, () => setShowChat(v => !v))}
                {toolbarButton('📊 Pulse', showPulse, () => setShowPulse(v => !v))}
                {toolbarButton('🕸️ Graph', showGraph, () => setShowGraph(v => !v))}
                {toolbarButton('📐 Layout', showLayout, () => setShowLayout(v => !v))}
                {toolbarButton('⚡ Chaos', showViral, () => setShowViral(v => !v))}
                {toolbarButton('📜 Logs', showSystemLog, () => setShowSystemLog(v => !v))}
                {toolbarButton('✨ Feed', showHighlights, () => setShowHighlights(v => !v))}
                {toolbarButton('🎬 Recap', showRecap, () => setShowRecap(v => !v))}
            </div>

            {/* Bottom-Left Branding Card */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 20,
                    left: 20,
                    color: 'white',
                    backgroundColor: 'rgba(10,10,30,0.85)',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    zIndex: 10,
                    border: '1px solid rgba(108,92,231,0.3)',
                    pointerEvents: 'none'
                }}
            >
                <h1 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🏢 AgentOffice
                </h1>
                <p style={{ margin: '2px 0 0', opacity: 0.6, fontSize: '10px' }}>
                    Modular Multi-Agent Simulation • M2 Studio & Sprites
                </p>
            </div>

            {/* Floating Panels */}
            {showStudio && <AgentStudio />}
            {showInspector && <AgentInspector />}
            {showTaskBoard && <TaskBoard />}
            {showChat && <ChatPanel />}
            {showLayout && <LayoutEditor />}
            {showSystemLog && <SystemLog />}
            {showViral && <ViralControlPanel />}
            {showGraph && <RelationshipGraph />}
            {showHighlights && <HighlightsFeed />}
            {showPulse && <AgentPulseBoard />}
            {showRecap && <EpisodeRecapPanel />}
        </>
    );
}
