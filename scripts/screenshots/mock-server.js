/**
 * Mock API server for screenshot generation.
 *
 * Serves canned fixture data so the frontend can be captured in every state
 * without a real backend, KQL connection, or Azure auth.
 *
 * Usage:
 *   node mock-server.js                  → listens on port 3099
 *   node mock-server.js --port 4000      → listens on custom port
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------
function loadJSON(name) {
    return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

const investigationsIndex = loadJSON('investigations.json');
const invRunning      = loadJSON('investigation-running.json');
const invPaused       = loadJSON('investigation-paused.json');
const invLiveSession  = loadJSON('investigation-live-session.json');
const invCompleted    = loadJSON('investigation-completed.json');
const invContested    = loadJSON('investigation-contested.json');
const invFailed       = loadJSON('investigation-failed.json');
const invRetrospect   = loadJSON('investigation-retrospect.json');
const invRetroChat    = loadJSON('investigation-retrospect-chat.json');
const settingsData    = loadJSON('settings.json');

// Lookup map: id → detailed fixture (use detailed when available)
const detailedInvestigations = {};
for (const inv of [invRunning, invPaused, invLiveSession, invCompleted, invContested, invFailed, invRetrospect, invRetroChat]) {
    detailedInvestigations[inv.id] = inv;
}

// ---------------------------------------------------------------------------
// State — mutable so capture.js can swap fixtures at runtime
// ---------------------------------------------------------------------------
let currentInvestigations = investigationsIndex.investigations;
let overrideDetail = {};    // id → fixture override for GET /api/investigations/:id
let authStatus = { authenticated: true, username: 'user@microsoft.com' };

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- Investigations ----

app.get('/api/investigations', (_req, res) => {
    // Mimic the list endpoint which returns a trimmed version (last thought only)
    const list = currentInvestigations.map(inv => ({
        ...inv,
        thoughts: inv.thoughts?.length ? [inv.thoughts[inv.thoughts.length - 1]] : [],
        actions: [],          // list endpoint doesn't return full actions
    }));
    res.json(list);
});

app.get('/api/investigations/:id', (req, res) => {
    const { id } = req.params;
    // Priority: runtime override → detailed fixture → index entry
    const inv = overrideDetail[id]
        || detailedInvestigations[id]
        || currentInvestigations.find(i => i.id === id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
});

app.get('/api/investigations/:id/step/:index', (req, res) => {
    const { id, index } = req.params;
    const inv = overrideDetail[id] || detailedInvestigations[id] || currentInvestigations.find(i => i.id === id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(index, 10);
    res.json({
        thought: inv.thoughts?.[idx] || '',
        action: inv.actions?.[idx] || null,
    });
});

app.post('/api/investigations', (req, res) => {
    res.json({ id: Date.now().toString(), status: 'running' });
});

app.post('/api/investigations/:id/action', (req, res) => {
    res.json({ success: true });
});

app.delete('/api/investigations/:id', (req, res) => {
    res.json({ success: true });
});

app.patch('/api/investigations/:id/title', (req, res) => {
    res.json({ success: true });
});

// ---- Auth ----

app.get('/api/auth/status', (_req, res) => {
    res.json(authStatus);
});

app.get('/api/auth/azure-status', (_req, res) => {
    res.json({ authenticated: true });
});

app.post('/api/auth/azure-login', (_req, res) => {
    res.json({ success: true });
});

// ---- Settings ----

app.get('/api/settings', (_req, res) => {
    res.json(settingsData.settings);
});

app.post('/api/settings', (req, res) => {
    res.json({ success: true });
});

// ---- Models ----

app.get('/api/models', (_req, res) => {
    res.json(settingsData.models);
});

// ---- Products ----

app.get('/api/products', (_req, res) => {
    res.json(settingsData.products);
});

app.get('/api/products/active', (_req, res) => {
    res.json({ productId: settingsData.activeProductId });
});

app.post('/api/products/active', (req, res) => {
    res.json({ success: true });
});

app.post('/api/products', (req, res) => {
    res.json({ id: 'new-product', ...req.body });
});

app.put('/api/products/:id', (req, res) => {
    res.json({ success: true });
});

app.delete('/api/products/:id', (req, res) => {
    res.json({ success: true });
});

app.get('/api/products/:id/validate', (req, res) => {
    const validation = settingsData.productValidations?.[req.params.id];
    res.json(validation || { valid: true, paths: [] });
});

app.post('/api/products/discover', (req, res) => {
    res.json({ source: 'none', product: {}, suggestions: [] });
});

app.post('/api/products/clone', (req, res) => {
    res.json({ id: 'cloned-product', ...req.body });
});

// ---- Retrospect ----

app.post('/api/investigations/:id/retrospect/start', (req, res) => {
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/message', (req, res) => {
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/proposals/:proposalId/status', (req, res) => {
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/apply', (req, res) => {
    res.json({ success: true, applied: 0, failed: 0 });
});

// ---- ICM ----

app.get('/api/icm/status', (_req, res) => {
    res.json({ available: true, scriptPath: 'scripts/icm' });
});

// ---- Files ----

app.get('/api/files/list', (req, res) => {
    res.json([
        { name: 'investigations', type: 'directory' },
        { name: 'docs', type: 'directory' },
        { name: 'src', type: 'directory' },
    ]);
});

// ---- MCP ----

app.get('/api/mcp/status', (_req, res) => {
    res.json({ server: 'kusto-cli', connected: true });
});

// ---------------------------------------------------------------------------
// Control API — used by capture.js to swap state between screenshots
// ---------------------------------------------------------------------------

app.post('/__control/set-investigations', (req, res) => {
    currentInvestigations = req.body.investigations || [];
    res.json({ ok: true });
});

app.post('/__control/set-detail-override', (req, res) => {
    const { id, investigation } = req.body;
    if (investigation) {
        overrideDetail[id] = investigation;
    } else {
        delete overrideDetail[id];
    }
    res.json({ ok: true });
});

app.post('/__control/set-auth', (req, res) => {
    authStatus = req.body;
    res.json({ ok: true });
});

app.post('/__control/reset', (_req, res) => {
    currentInvestigations = investigationsIndex.investigations;
    overrideDetail = {};
    authStatus = { authenticated: true, username: 'user@microsoft.com' };
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
    // No-op — the frontend connects but we don't push messages for screenshots
    ws.on('message', () => {});
});

export function startServer(port = 3099) {
    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log(`Mock server listening on http://localhost:${port}`);
            resolve(server);
        });
    });
}

export function stopServer() {
    return new Promise((resolve) => {
        wss.close();
        server.close(resolve);
    });
}

// CLI mode
if (process.argv[1] && process.argv[1].includes('mock-server')) {
    const portArg = process.argv.indexOf('--port');
    const port = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 3099;
    startServer(port);
}
