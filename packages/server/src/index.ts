import express from 'express';
import { Server } from 'colyseus';
import { createServer } from 'http';
import { OfficeRoom } from './rooms/OfficeRoom';
import { SkillRegistry } from './skills/SkillRegistry';
import { ToolRegistry } from './tools/ToolRegistry';
import { MemoryStore } from './memory/MemoryStore';

// Setup Express
const app = express();

// Express CORS middleware for frontend clients (e.g. http://localhost:5173)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});

app.use(express.json());

// Fallback registry instances if room is not yet active
const fallbackSkillRegistry = new SkillRegistry();
fallbackSkillRegistry.loadFromDisk();
const fallbackToolRegistry = new ToolRegistry();
const fallbackMemoryStore = new MemoryStore();
fallbackMemoryStore.initialize().catch(err => {
    console.warn('[Server] Fallback memory store init warning:', err?.message || err);
});

// Basic REST API for Office Management
app.get('/api/offices', (req, res) => {
    res.json({ status: 'ok', offices: [] });
});

// REST Endpoints for Catalog & Active Agents
app.get('/api/skills', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (room) {
        res.json(room.getSkills());
    } else {
        res.json(fallbackSkillRegistry.getAll());
    }
});

app.get('/api/tools', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (room) {
        res.json(room.getTools());
    } else {
        res.json(fallbackToolRegistry.getAll());
    }
});

app.get('/api/agents', async (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (room) {
        res.json(room.getAgentProfiles());
    } else {
        const profiles = await fallbackMemoryStore.loadAgentProfiles();
        res.json(profiles);
    }
});

app.post('/api/vote-chaos', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    const { event, voterId } = req.body || {};
    const result = room.registerAudienceVote(event || 'server_outage', voterId);
    res.json({ ok: true, ...result });
});

app.get('/api/episode-recap', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    res.json({ ok: true, recap: room.getEpisodeRecap() });
});

// Create HTTP and Colyseus server
const httpServer = createServer(app);
const colyseusServer = new Server({
    server: httpServer,
});

// Define Rooms
colyseusServer.define('office', OfficeRoom);

// Start listening (skipped in test environment to allow ephemeral test servers)
const PORT = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV !== 'test') {
    colyseusServer.listen(PORT).then(() => {
        console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);
    });
}

export { app, httpServer, colyseusServer };
