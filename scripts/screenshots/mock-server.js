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
    console.log('[MOCK] GET /api/investigations/' + id, '— has pipeline:', !!inv?.pipeline, 'stages:', inv?.pipeline?.stages?.length, 'currentStageIndex:', inv?.pipeline?.currentStageIndex);
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
    const id = Date.now().toString();
    const body = req.body || {};

    // Build pipeline stages: use what the frontend sent, or fall back to
    // the Standard pipeline from the settings fixture.
    let pipelineSource = body.pipeline;
    if (!pipelineSource || !pipelineSource.stages || pipelineSource.stages.length === 0) {
        pipelineSource = settingsData.pipeline || { stages: [] };
    }
    const pipelineStages = (pipelineSource.stages || []).map((s, i) => ({
        agentId: s.agent?.id || s.agentId || `stage-${i}`,
        agentName: s.agent?.name || s.agentName || `Stage ${i + 1}`,
        color: s.agent?.color || s.color || '#64748b',
        icon: s.agent?.icon || s.icon || '🔧',
        status: i === 0 ? 'running' : 'pending',
        retryCount: 0,
        startedAt: i === 0 ? Date.now() : undefined,
    }));

    // Store in overrideDetail so GET /api/investigations/:id returns it
    overrideDetail[id] = {
        id,
        status: 'running',
        title: body.query ? body.query.slice(0, 80) : 'New Investigation',
        query: body.query || '',
        target: body.target || '',
        timeRange: body.timeRange || '',
        category: body.category || '',
        correlationId: body.correlationId || '',
        model: body.model || 'claude-opus-4.6',
        thoughts: ['Investigation started — Planner agent is analyzing the query and building an execution plan...'],
        thoughtCount: 1,
        actions: [],
        logs: ['[Planner] Starting investigation...'],
        pipeline: {
            id: pipelineSource.id || 'preset-default',
            name: pipelineSource.name || 'Standard',
            currentStageIndex: 0,
            conversationLog: [],
            stages: pipelineStages,
        },
        createdAt: new Date().toISOString(),
        lastModified: Date.now(),
        source: 'manual',
        verdict: 'unknown',
    };
    console.log('[MOCK] POST /api/investigations — pipeline stages:', overrideDetail[id].pipeline.stages.length, 'currentStageIndex:', overrideDetail[id].pipeline.currentStageIndex);
    res.json({ id, status: 'running' });
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
        {
            id: 'builtin-planner',
            name: 'Planner',
            description: 'Creates a structured investigation plan before execution. Analyzes the query scope and produces a step-by-step approach.',
            source: 'builtin',
            builtinType: 'planner',
            color: '#0ea5e9',
            icon: '📋',
        },
        {
            id: 'builtin-triage',
            name: 'Triage',
            description: 'Fast initial severity assessment and routing. Classifies the issue type and recommends investigation priority.',
            source: 'builtin',
            builtinType: 'triage',
            color: '#f43f5e',
            icon: '🚦',
        },
        {
            id: 'builtin-correlator',
            name: 'Correlator',
            description: 'Cross-references findings across multiple data sources to identify patterns and relationships between events.',
            source: 'builtin',
            builtinType: 'correlator',
            color: '#06b6d4',
            icon: '🔗',
        },
        {
            id: 'builtin-devils-advocate',
            name: "Devil's Advocate",
            description: 'Challenges conclusions and probes for blind spots. Questions assumptions, checks for alternative explanations, and stress-tests the evidence.',
            source: 'builtin',
            builtinType: 'devils-advocate',
            color: '#ef4444',
            icon: '😈',
        },
        {
            id: 'builtin-summarizer',
            name: 'Summarizer',
            description: 'Distills investigation findings into a concise executive summary with key metrics, timeline, and actionable recommendations.',
            source: 'builtin',
            builtinType: 'summarizer',
            color: '#14b8a6',
            icon: '📊',
        },
        {
            id: 'builtin-remediation',
            name: 'Remediation Advisor',
            description: 'Proposes operational fixes and mitigation actions based on investigation findings. Focuses on practical remediation steps.',
            source: 'builtin',
            builtinType: 'remediation',
            color: '#f97316',
            icon: '🩹',
        },
        {
            id: 'builtin-timeline',
            name: 'Timeline Reconstructor',
            description: 'Builds a chronological sequence of events from investigation data. Creates a detailed timeline of what happened and when.',
            source: 'builtin',
            builtinType: 'timeline',
            color: '#a855f7',
            icon: '⏱️',
        },
        {
            id: 'builtin-enrichment',
            name: 'Data Enrichment',
            description: 'Gathers pre-investigation context by reading documentation, recent changes, and related incidents before the main investigation.',
            source: 'builtin',
            builtinType: 'enrichment',
            color: '#3b82f6',
            icon: '🔎',
        },
        {
            id: 'builtin-compliance',
            name: 'Compliance Auditor',
            description: 'Reviews investigation findings against security policies, compliance frameworks, and organizational standards.',
            source: 'builtin',
            builtinType: 'compliance',
            color: '#84cc16',
            icon: '📜',
        },
        {
            id: 'builtin-signal-grounding',
            name: 'Signal Grounding Auditor',
            description: 'Audits conclusions to ensure they are grounded in observed telemetry, not inferred from missing data. Rejects absence-based reasoning — missing telemetry says nothing.',
            source: 'builtin',
            builtinType: 'signal-grounding',
            color: '#d946ef',
            icon: '📡',
        },
    ]);
});

app.get('/api/pipeline/presets', (_req, res) => {
    res.json([
        { id: 'default', name: 'Standard', description: 'Balanced pipeline: investigate, validate, propose changes, and improve knowledge base.', icon: '⚡', stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ]},
        { id: 'deep-investigation', name: 'Deep Investigation', description: 'Thorough pipeline with planning, adversarial review, grounding audit, and executive summary for complex issues.', icon: '🔬', stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ]},
        { id: 'incident-response', name: 'Incident Response', description: 'Fast triage, enrichment, timeline reconstruction, and remediation for active incidents.', icon: '🚨', stages: [
            { builtinType: 'triage' },
            { builtinType: 'enrichment' },
            { builtinType: 'investigator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'summarizer' },
        ]},
        { id: 'quick-health-check', name: 'Quick Health Check', description: 'Lightweight pipeline for scheduled health checks and routine monitoring.', icon: '💚', stages: [
            { builtinType: 'triage' },
            { builtinType: 'investigator' },
            { builtinType: 'validator' },
        ]},
        { id: 'compliance-review', name: 'Compliance Review', description: 'Investigation followed by grounding audit, compliance auditing, and change proposals.', icon: '📜', stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'compliance', canReject: true, onReject: 'flag' },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ]},
        { id: 'root-cause-analysis', name: 'Root Cause Analysis', description: 'Correlate with past incidents, reconstruct timeline, verify grounding, and generate remediation plan.', icon: '🔍', stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'correlator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'retrospect' },
        ]},
        { id: 'grounded-investigation', name: 'Grounded Investigation', description: 'Rigorous pipeline that ensures all conclusions are grounded in observed telemetry — rejects absence-based reasoning.', icon: '📡', stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ]},
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
    console.log('[MOCK] GET /api/investigations/' + id + '/pipeline', '— found inv:', !!inv, 'has pipeline:', !!inv?.pipeline, 'stages:', inv?.pipeline?.stages?.length);
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

app.patch('/api/investigations/:id/retrospect/proposals/:proposalId', (req, res) => {
    res.json({ success: true });
});

app.post('/api/investigations/:id/retrospect/apply', (req, res) => {
    res.json({ success: true, applied: 0, failed: 0 });
});

app.post('/api/investigations/:id/retrospect/complete', (req, res) => {
    res.json({ success: true });
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
        stamp: 'oi-tds-prd-neup-01',
        query: 'Check for error spikes and queue overflow events.',
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
        { timestamp: new Date(Date.now() - 86400000).toISOString(), verdict: 'critical', investigationId: '1710000000003', summary: 'Queue overflow detected — 15K messages dropped.' },
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
        name: 'NEU Queue Audit',
        stamp: 'oi-tds-prd-neup-01',
        query: 'Audit pipeline queue health and identify permanent failure patterns.',
        issueType: 'Error / Failure Rate',
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

// ---- Saved Workflows & Custom Agents ----

let mockSavedWorkflows = [
    {
        id: 'sw-1',
        name: 'Security Deep Dive',
        description: 'Extended security investigation with compliance checks and remediation steps',
        icon: '🔒',
        pipeline: {
            id: 'sw-pipe-1',
            name: 'Security Deep Dive',
            stages: [
                { agent: { id: 'builtin-triage', name: 'Triage', source: 'builtin', builtinType: 'triage', color: '#f43f5e', icon: '🚦' }, inputMode: 'conversation' },
                { agent: { id: 'builtin-investigator', name: 'Investigator', source: 'builtin', builtinType: 'investigator', color: '#10b981', icon: '🤖' }, inputMode: 'conversation' },
                { agent: { id: 'builtin-compliance', name: 'Compliance Auditor', source: 'builtin', builtinType: 'compliance', color: '#84cc16', icon: '📜' }, inputMode: 'report-only' },
                { agent: { id: 'builtin-remediation', name: 'Remediation Advisor', source: 'builtin', builtinType: 'remediation', color: '#f97316', icon: '🩹' }, inputMode: 'report-only' },
                { agent: { id: 'builtin-summarizer', name: 'Summarizer', source: 'builtin', builtinType: 'summarizer', color: '#14b8a6', icon: '📊' }, inputMode: 'conversation' },
            ],
        },
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    {
        id: 'sw-2',
        name: 'Quick Triage & Validate',
        description: 'Fast assessment pipeline for P1 incidents',
        icon: '⚡',
        pipeline: {
            id: 'sw-pipe-2',
            name: 'Quick Triage & Validate',
            stages: [
                { agent: { id: 'builtin-triage', name: 'Triage', source: 'builtin', builtinType: 'triage', color: '#f43f5e', icon: '🚦' }, inputMode: 'conversation' },
                { agent: { id: 'builtin-investigator', name: 'Investigator', source: 'builtin', builtinType: 'investigator', color: '#10b981', icon: '🤖' }, inputMode: 'conversation' },
                { agent: { id: 'builtin-validator', name: 'Validator', source: 'builtin', builtinType: 'validator', color: '#f59e0b', icon: '🛡️' }, inputMode: 'conversation' },
            ],
        },
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    },
];

// New backend uses /api/workflows; keep /api/saved-workflows as alias for older builds.
for (const path of ['/api/workflows', '/api/saved-workflows']) {
    app.get(path, (_req, res) => {
        res.json(mockSavedWorkflows);
    });
    app.post(path, (req, res) => {
        const wf = { id: 'sw-new-' + Date.now(), ...req.body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        mockSavedWorkflows.push(wf);
        res.json(wf);
    });
    app.put(`${path}/:id`, (req, res) => {
        const idx = mockSavedWorkflows.findIndex(w => w.id === req.params.id);
        if (idx >= 0) mockSavedWorkflows[idx] = { ...mockSavedWorkflows[idx], ...req.body, updatedAt: new Date().toISOString() };
        res.json(mockSavedWorkflows[idx] || { success: true });
    });
    app.delete(`${path}/:id`, (req, res) => {
        mockSavedWorkflows = mockSavedWorkflows.filter(w => w.id !== req.params.id);
        res.json({ success: true });
    });
}

let mockCustomAgents = [
    {
        id: 'ca-cert-auditor',
        agent: {
            id: 'ca-cert-auditor',
            name: 'Certificate Auditor',
            description: 'Audits certificate expiry dates across all stamps and flags rotations needed within 30 days.',
            source: 'inline',
            kind: 'investigator',
            color: '#22d3ee',
            icon: '\ud83d\udd10',
            systemPrompt: 'You are a certificate auditor. Enumerate all certificates and identify those expiring within 30 days. Cross-reference with rotation schedules and flag risks.',
            tools: { mode: 'whitelist', list: ['kusto_query', 'azure_keyvault_list', 'read_file'] },
        },
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    },
    {
        id: 'ca-cost-analyzer',
        agent: {
            id: 'ca-cost-analyzer',
            name: 'Cost Analyzer',
            description: 'Reviews Azure resource utilization and identifies cost-optimization opportunities for the investigated stamp.',
            source: 'inline',
            kind: 'investigator',
            color: '#84cc16',
            icon: '\ud83d\udcb0',
            systemPrompt: 'You analyze Azure resource costs. Identify under-utilized SKUs, oversized clusters, and idle resources. Recommend right-sized alternatives.',
            tools: { mode: 'all' },
        },
        createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    },
];

app.get('/api/custom-agents', (_req, res) => {
    res.json(mockCustomAgents);
});

app.get('/api/custom-agents/:id', (req, res) => {
    const a = mockCustomAgents.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json(a);
});

app.post('/api/custom-agents', (req, res) => {
    const wrapped = { id: 'ca-new-' + Date.now(), ...req.body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    mockCustomAgents.push(wrapped);
    res.json(wrapped);
});

app.put('/api/custom-agents/:id', (req, res) => {
    const idx = mockCustomAgents.findIndex(x => x.id === req.params.id);
    if (idx >= 0) mockCustomAgents[idx] = { ...mockCustomAgents[idx], ...req.body, updatedAt: new Date().toISOString() };
    res.json(mockCustomAgents[idx] || { success: true });
});

app.delete('/api/custom-agents/:id', (req, res) => {
    mockCustomAgents = mockCustomAgents.filter(x => x.id !== req.params.id);
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

app.post('/__control/broadcast', (req, res) => {
    broadcastWs(req.body);
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
    ws.on('message', () => {});
});

/** Broadcast a JSON message to all connected WebSocket clients. */
export function broadcastWs(data) {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
        if (client.readyState === 1) client.send(msg);
    }
}

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
