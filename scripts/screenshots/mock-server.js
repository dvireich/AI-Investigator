/**
 * Mock API server for screenshot generation.
 *
 * Serves canned fixture data so the frontend can be captured in every state
 * without a real backend or data source connection.
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
const investigationsAllPaused = loadJSON('investigations-all-paused.json');
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
let overrideSettings = null; // runtime override for GET /api/settings
let authStatus = { authenticated: true, username: 'user@microsoft.com' };
let onboardingComplete = true;

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
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
    res.json({
        items: list,
        totalCount: list.length,
        page: 1,
        pageSize: Math.max(list.length, 12),
        totalPages: 1,
        filterMeta: { products: [{ id: 'sample-product', name: 'Sample Product' }, { id: 'platform-api', name: 'Platform API' }, { id: 'infrastructure', name: 'Infrastructure' }], tags: ['p95-spike', 'on-call', 'sev2'], creators: ['dvreich', 'scheduler'] },
        stats: { total: list.length, running: list.filter(i => i.status === 'running').length, completed: list.filter(i => i.status === 'completed').length, failed: list.filter(i => i.status === 'failed').length, paused: list.filter(i => i.status === 'paused').length, aborted: 0, successRate: 75, resolvedCount: 6, avgDurationMs: 1843200000, durationSamples: 8, thisWeekCount: 7, lastWeekCount: 5, contestRate: 12.5, contestableCount: 1 },
    });
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

app.post('/api/investigations/resume-all', (req, res) => {
    const paused = currentInvestigations.filter(i => i.status === 'paused');
    res.json({ resumed: paused.length, skipped: 0, ids: paused.map(i => i.id) });
});

app.post('/api/server/restart', (req, res) => {
    res.json({ status: 'restarting' });
});

app.delete('/api/investigations/:id', (req, res) => {
    res.json({ success: true });
});

app.patch('/api/investigations/:id/title', (req, res) => {
    res.json({ success: true });
});

// ---- Tags & Notes ----

app.patch('/api/investigations/:id/tags', (req, res) => {
    res.json({ ok: true, tags: req.body.tags || [] });
});

app.patch('/api/investigations/:id/notes', (req, res) => {
    res.json({ ok: true, notes: req.body.notes || '' });
});

app.post('/api/investigations/:id/notes/rephrase', (req, res) => {
    // Return a polished version of the input text
    const text = req.body.text || '';
    res.json({ rephrased: text.replace(/\n/g, '\n').trim() + ' (rephrased)' });
});

// ---- Export / Import / PDF ----

app.get('/api/investigations/:id/export', (req, res) => {
    const { id } = req.params;
    const inv = overrideDetail[id]
        || detailedInvestigations[id]
        || currentInvestigations.find(i => i.id === id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
});

app.post('/api/investigations/import', (req, res) => {
    res.json({ success: true, id: Date.now().toString() });
});

app.get('/api/investigations/:id/pdf', (req, res) => {
    // Return a minimal PDF-like buffer for mock purposes
    const pdfHeader = '%PDF-1.4 mock';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
    res.send(Buffer.from(pdfHeader));
});

// ---- Onboarding ----

app.get('/api/onboarding/status', (_req, res) => {
    res.json({ complete: onboardingComplete });
});

app.get('/api/auth/providers', (_req, res) => {
    res.json([
        { type: 'copilot', displayName: 'GitHub Copilot', authRequirement: { type: 'oauth' } },
        { type: 'openai', displayName: 'OpenAI', authRequirement: { type: 'api_key' } },
        { type: 'anthropic', displayName: 'Anthropic', authRequirement: { type: 'api_key' } },
        { type: 'azure', displayName: 'Azure OpenAI', authRequirement: { type: 'msal' } },
        { type: 'ollama', displayName: 'Ollama (Local)', authRequirement: { type: 'none' } },
    ]);
});

// ---- Version ----

app.get('/api/version', (_req, res) => {
    res.json({
        current: '1.4.0',
        commit: 'd7b5dd2e',
        buildDate: '2026-03-22T12:00:00Z',
        latest: null,
        updateAvailable: false,
        downloadUrl: null,
        releaseNotesUrl: null,
    });
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

app.post('/api/auth/login', (_req, res) => {
    res.json({
        deviceCode: 'FAKEDEVICECODE',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
    });
});

// ---- Settings ----

app.get('/api/settings', (_req, res) => {
    if (overrideSettings) {
        res.json(overrideSettings);
    } else {
        // Include pipeline at top level so the frontend sees settings.pipeline
        const resp = { ...settingsData.settings };
        if (settingsData.pipeline) resp.pipeline = settingsData.pipeline;
        res.json(resp);
    }
});

app.post('/api/settings', (req, res) => {
    res.json({ success: true });
});

app.get('/api/settings/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
    res.json(settingsData.settings);
});

app.post('/api/settings/import', (req, res) => {
    res.json({ imported: Object.keys(req.body || {}).length, config: settingsData.settings });
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

// ---- Pipeline ----

app.get('/api/pipeline/builtins', (_req, res) => {
    res.json([
        {
            id: 'builtin-investigator',
            name: 'Investigator',
            description: 'Runs the main investigation loop with full tool access. Queries data sources, analyzes results, and produces a findings report.',
            source: 'builtin',
            builtinType: 'investigator',
            color: '#10b981',
            icon: '🤖',
        },
        {
            id: 'builtin-validator',
            name: 'Validator',
            description: 'Reviews investigation findings for accuracy, completeness, and evidence. Can approve, reject, or flag results.',
            source: 'builtin',
            builtinType: 'validator',
            color: '#f59e0b',
            icon: '🛡️',
        },
        {
            id: 'builtin-retrospect',
            name: 'Retrospect',
            description: 'Analyzes the completed investigation against the knowledge base and proposes file changes to improve future investigations.',
            source: 'builtin',
            builtinType: 'retrospect',
            color: '#8b5cf6',
            icon: '✨',
        },
        {
            id: 'builtin-proposer',
            name: 'Proposer',
            description: 'Reads investigation findings and proposes code changes for recommendations. Does not apply changes — only creates proposals for review.',
            source: 'builtin',
            builtinType: 'implementation',
            color: '#6366f1',
            icon: '🔧',
        },
    ]);
});

app.post('/api/pipeline/validate', (req, res) => {
    res.json({ valid: true, errors: [] });
});

app.get('/api/investigations/:id/pipeline', (req, res) => {
    const { id } = req.params;
    const inv = overrideDetail[id]
        || detailedInvestigations[id]
        || currentInvestigations.find(i => i.id === id);
    if (inv && inv.pipeline) return res.json(inv.pipeline);
    res.json(null);
});

// ---- Retrospect ----

app.get('/api/investigations/:id/recommendations', (req, res) => {
    res.json([
        { id: 'rec_P0_0', priority: 'P0', title: 'Add cluster capacity pre-check before bulk ingestion', description: 'The investigation shows ingestion failures occurred because the cluster ran out of capacity. Add a pre-check step that queries cluster capacity before starting bulk operations.', category: 'code' },
        { id: 'rec_P0_1', priority: 'P0', title: 'Add IngestionCapacityExceeded to retry-exclude list', description: 'This error type is non-transient and should not trigger retries. Add it to the permanent exception list.', category: 'code' },
        { id: 'rec_P0_2', priority: 'P0', title: 'Engage Kusto SRE team for capacity planning', description: 'The cluster consistently hits capacity limits during peak hours. Coordinate with the SRE team to evaluate scaling options.', category: 'operational' },
        { id: 'rec_P1_3', priority: 'P1', title: 'Add structured logging for ingestion batch sizes', description: 'Current logging lacks batch-level metrics. Add structured telemetry for batch size, duration, and error rates.', category: 'code' },
        { id: 'rec_P1_4', priority: 'P1', title: 'Create runbook for bulk operation coordination', description: 'Document the coordination process for scheduling bulk operations across stamps to avoid capacity contention.', category: 'operational' },
        { id: 'rec_P2_5', priority: 'P2', title: 'Add circuit breaker for repeated capacity errors', description: 'Implement a circuit breaker pattern that pauses ingestion after N consecutive capacity errors to prevent cascading failures.', category: 'code' },
    ]);
});

app.post('/api/investigations/:id/recommendations/reclassify', (req, res) => {
    res.json([]);
});

app.post('/api/investigations/:id/implement', (req, res) => {
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/start', (req, res) => {
    res.json({ success: true });
});

let analyzeHang = false;

app.post('/api/investigations/:id/retrospect/analyze', (req, res) => {
    if (analyzeHang) {
        // Never respond — keeps the frontend fetch pending so isAnalyzing stays true
        return;
    }
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/abort', (req, res) => {
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
    res.json({ servers: [{ name: 'query-tool', connected: true }] });
});

// ---- Schedules ----

let mockSchedules = [
    {
        id: 'sched-1',
        name: 'EUS2P Health Check',
        enabled: true,
        stamp: 'app-prd-eus2p-01',
        query: 'Check pipeline latency and queue health for the past hour.',
        intervalMinutes: 60,
        productId: 'sample-product',
        model: 'claude-opus-4.6',
        maxSteps: 20,
        timeRange: 'ago(1h)',
        issueType: 'Latency / Performance',
        autoEscalate: false,
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        lastRunAt: new Date(Date.now() - 3600000).toISOString(),
        nextRunAt: new Date(Date.now() + 900000).toISOString(),
        lastVerdict: 'healthy',
        lastInvestigationId: '1710000000001',
        consecutiveCriticalCount: 0,
    },
    {
        id: 'sched-2',
        name: 'WUS2 Latency Monitor',
        enabled: true,
        stamp: 'app-prd-wus2p-01',
        query: 'Monitor P95 latency and error rates across all processing services.',
        intervalMinutes: 30,
        productId: 'sample-product',
        model: 'gpt-4o',
        maxSteps: 15,
        timeRange: 'ago(30m)',
        issueType: 'Latency / Performance',
        autoEscalate: false,
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        lastRunAt: new Date(Date.now() - 1200000).toISOString(),
        nextRunAt: new Date(Date.now() + 600000).toISOString(),
        lastVerdict: 'warning',
        lastInvestigationId: '1710000000002',
        consecutiveCriticalCount: 0,
    },
    {
        id: 'sched-3',
        name: 'NEU Error Patrol',
        enabled: false,
        stamp: 'app-prd-neup-01',
        query: 'Check for error spikes and dead letter queue growth.',
        intervalMinutes: 240,
        productId: 'sample-product',
        model: 'claude-opus-4.6',
        maxSteps: 25,
        timeRange: 'ago(4h)',
        issueType: 'Error / Failure Rate',
        autoEscalate: false,
        createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        lastRunAt: new Date(Date.now() - 86400000).toISOString(),
        lastVerdict: 'critical',
        lastInvestigationId: '1710000000003',
        consecutiveCriticalCount: 2,
    },
];

let mockSchedulerRunning = true;

const mockScheduleHistory = {
    'sched-1': [
        { timestamp: new Date(Date.now() - 3600000).toISOString(), verdict: 'healthy', investigationId: '1710000000001', summary: 'P95 latency 2s. All queues healthy.' },
        { timestamp: new Date(Date.now() - 7200000).toISOString(), verdict: 'healthy', investigationId: '1710000000010', summary: 'No issues detected.' },
        { timestamp: new Date(Date.now() - 10800000).toISOString(), verdict: 'warning', investigationId: '1710000000011', summary: 'Slight latency increase on ProcessingService.' },
    ],
    'sched-2': [
        { timestamp: new Date(Date.now() - 1200000).toISOString(), verdict: 'warning', investigationId: '1710000000002', summary: 'P95 elevated at 8s (threshold 5s).' },
        { timestamp: new Date(Date.now() - 3000000).toISOString(), verdict: 'healthy', investigationId: '1710000000020', summary: 'All metrics within SLO.' },
    ],
    'sched-3': [
        { timestamp: new Date(Date.now() - 86400000).toISOString(), verdict: 'critical', investigationId: '1710000000003', summary: 'DLQ overflow detected — 15K messages.' },
        { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), verdict: 'critical', investigationId: '1710000000030', summary: 'Processing failures persisting.' },
    ],
};

app.get('/api/schedules', (_req, res) => {
    res.json({ items: mockSchedules, totalCount: mockSchedules.length, page: 1, pageSize: 12, totalPages: 1 });
});

app.post('/api/schedules', (req, res) => {
    res.json({ id: 'sched-new', ...req.body });
});

app.put('/api/schedules/:id', (req, res) => {
    res.json({ success: true });
});

app.delete('/api/schedules/:id', (req, res) => {
    res.json({ success: true });
});

app.post('/api/schedules/:id/run-now', (req, res) => {
    res.json({ success: true, investigationId: Date.now().toString() });
});

app.post('/api/schedules/:id/enable', (req, res) => {
    res.json({ success: true });
});

app.post('/api/schedules/:id/disable', (req, res) => {
    res.json({ success: true });
});

app.get('/api/schedules/:id/history', (req, res) => {
    res.json(mockScheduleHistory[req.params.id] || []);
});

app.get('/api/schedules/:id/report', (req, res) => {
    const sched = mockSchedules.find(s => s.id === req.params.id);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });
    const history = mockScheduleHistory[req.params.id] || [];
    const verdictBreakdown = {};
    for (const e of history) {
        verdictBreakdown[e.verdict] = (verdictBreakdown[e.verdict] || 0) + 1;
    }
    res.json({
        scheduleId: req.params.id,
        scheduleName: sched.name,
        totalRuns: history.length,
        verdictBreakdown,
        successRate: 66.7,
        trend: 'improving',
        firstRunAt: history.length ? history[history.length - 1].timestamp : null,
        lastRunAt: history.length ? history[0].timestamp : null,
        recentSummaries: history.slice(0, 5).map(e => ({ timestamp: e.timestamp, verdict: e.verdict, investigationId: e.investigationId, summary: e.summary })),
        executiveSummary: '## Executive Summary\n\nThe **EUS2P Health Check** schedule has completed 3 runs over the past 7 days. Overall health is **good** with an improving trend.\n\n### Verdict Breakdown\n- Healthy: 2 runs (67%)\n- Warning: 1 run (33%)\n\n### Trend Analysis\nThe most recent runs show improvement — the warning on the ProcessingService latency has resolved after the scaling event on Tuesday.\n\n### Recommendations\n- Continue monitoring P95 latency post-scaling\n- Consider reducing the check interval to 30m during peak hours',
    });
});

app.post('/api/scheduler/start', (_req, res) => {
    mockSchedulerRunning = true;
    res.json({ success: true });
});

app.post('/api/scheduler/stop', (_req, res) => {
    mockSchedulerRunning = false;
    res.json({ success: true });
});

app.get('/api/scheduler/status', (_req, res) => {
    res.json({ running: mockSchedulerRunning });
});

// ---- Query Bank ----

const mockQueryBank = [
    {
        id: 'qb-1',
        name: 'EUS2P Latency Check',
        stamp: 'app-prd-eus2p-01',
        query: 'Check pipeline latency and queue health.',
        issueType: 'Latency / Performance',
        timeRange: 'ago(1h)',
        model: 'claude-opus-4.6',
        productId: 'sample-product',
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
        id: 'qb-2',
        name: 'WUS2 Error Discovery',
        stamp: 'app-prd-wus2p-01',
        query: 'Discover and classify errors across processing services in the past 6 hours.',
        issueType: 'Error / Failure Rate',
        timeRange: 'ago(6h)',
        model: 'gpt-4o',
        productId: 'sample-product',
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    {
        id: 'qb-3',
        name: 'NEU DLQ Audit',
        stamp: 'app-prd-neup-01',
        query: 'Audit dead letter queue growth and identify permanent failure patterns.',
        issueType: 'Data Loss / Inconsistency',
        timeRange: 'ago(4h)',
        model: 'claude-opus-4.6',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
];

app.get('/api/query-bank', (_req, res) => {
    res.json(mockQueryBank);
});

app.post('/api/query-bank', (req, res) => {
    res.json({ id: 'qb-new', ...req.body });
});

app.put('/api/query-bank/:id', (req, res) => {
    res.json({ success: true });
});

app.delete('/api/query-bank/:id', (req, res) => {
    res.json({ success: true });
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

app.post('/__control/set-investigations-all-paused', (_req, res) => {
    currentInvestigations = investigationsAllPaused.investigations;
    res.json({ ok: true });
});

app.post('/__control/set-onboarding', (req, res) => {
    onboardingComplete = req.body.complete ?? true;
    res.json({ ok: true });
});

app.post('/__control/set-settings-override', (req, res) => {
    overrideSettings = req.body.settings || null;
    res.json({ ok: true });
});

app.post('/__control/reset', (_req, res) => {
    currentInvestigations = investigationsIndex.investigations;
    overrideDetail = {};
    overrideSettings = null;
    authStatus = { authenticated: true, username: 'user@microsoft.com' };
    onboardingComplete = true;
    analyzeHang = false;
    res.json({ ok: true });
});

app.post('/__control/set-analyze-hang', (req, res) => {
    analyzeHang = req.body.hang ?? false;
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
