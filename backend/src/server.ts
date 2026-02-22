import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { AgentRunner, InvestigationState } from './agent/Runner';
import { CopilotClient } from './agent/CopilotClient';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const port = 3000;

// Global error handlers to prevent crashes and log failures
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});
const copilotClient = new CopilotClient();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active runners
const runners = new Map<string, AgentRunner>();
// Store past investigations
const history = new Map<string, InvestigationState>();

// function to ensure directory exists
function ensureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadHistory() {
    const dir = config.investigationsPath || path.join(process.cwd(), 'investigations');
    ensureDirectoryExists(dir);

    try {
        const files = fs.readdirSync(dir);
        console.log(`Scanning ${files.length} files in ${dir}`);

        // 1. Scan for directories (New Structure) and JSON files (Legacy)
        for (const file of files) {
            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    // Check for state.json inside
                    const statePath = path.join(fullPath, 'state.json');
                    if (fs.existsSync(statePath)) {
                        const content = fs.readFileSync(statePath, 'utf-8');
                        const state = JSON.parse(content) as InvestigationState;

                        // Force running investigations to pause on server restart
                        if (state.status === 'running') {
                            state.status = 'paused';
                            state.thoughts.push("System: Investigation automatically paused due to server restart.");
                        }

                        if (state.id) history.set(state.id, state);
                    }
                } else if (file.endsWith('.json')) {
                    // Legacy flat file support
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const state = JSON.parse(content) as InvestigationState;

                    if (state.status === 'running') {
                        state.status = 'paused';
                        state.thoughts.push("System: Investigation automatically paused due to server restart.");
                    }

                    if (state.id) history.set(state.id, state);
                }
            } catch (e) {
                console.error(`Failed to load ${file}:`, e);
            }
        }

        // 2. Load Markdown reports (legacy/completed) if no JSON exists for them
        const mdFiles = files.filter(f => f.endsWith('.md'));
        for (const file of mdFiles) {
            // Check if we already have a state for this file (matching ID or similar name)
            // Heuristic: MD filenames often don't match JSON IDs exactly in legacy, 
            // but for new ones they do. 
            // We'll create a synthetic ID from the filename.
            const id = file.replace('.md', '');

            // If we don't have this ID yet (from JSON), create a synthetic state
            if (!history.has(id)) {
                // Try to exist smarter: check if any existing JSON state *generated* this MD file?
                // Hard to know without metadata. We'll treat it as a separate entry if no JSON match.
                // Actually, let's just add them as "Archived" investigations.

                try {
                    const stats = fs.statSync(path.join(dir, file));
                    history.set(id, {
                        id: id,
                        status: 'completed', // Assume completed if report exists
                        thoughts: [`Legacy report loaded from ${file}`],
                        actions: [],
                        logs: [`Imported from ${file} on ${new Date().toISOString()}`],
                        // Use file creation time as timestamp roughly
                    });
                } catch (e) {
                    console.error(`Failed to load legacy MD ${file}:`, e);
                }
            }
        }
        console.log(`Loaded ${history.size} total investigations into history.`);
    } catch (e) {
        console.error("Failed to read investigations directory:", e);
    }
}



// WebSocket Client Management
const clients = new Map<string, Set<WebSocket>>();

const broadcast = (id: string, type: string, data: any) => {
    const clientSet = clients.get(id);
    console.log(`[WS Broadcast] id=${id} type=${type} clients=${clientSet ? clientSet.size : 0}`);
    if (clientSet) {
        clientSet.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type, data }));
                console.log(`[WS Broadcast] Sent ${type} to client`);
            } else {
                console.log(`[WS Broadcast] Client not OPEN, readyState=${ws.readyState}`);
            }
        });
    }
};

const attachRunnerListeners = (runner: AgentRunner, id: string) => {
    console.log(`[WS] Attaching listeners for runner id=${id}`);
    // Only attach if listeners aren't already flooding (simple check? no, new runner instance means clean slate)
    runner.on('thought', (data) => broadcast(id, 'thought', data));
    runner.on('action', (data) => broadcast(id, 'action', data));
    runner.on('log', (data) => broadcast(id, 'log', data));
    runner.on('status', (data) => broadcast(id, 'status', data));
    runner.on('retrospect', (data) => broadcast(id, 'retrospect', data));
    runner.on('retrospect-proposal', (data) => broadcast(id, 'retrospect-proposal', data));
    runner.on('retrospect-tool-activity', (data) => broadcast(id, 'retrospect-tool-activity', data));
};

// WebSocket for real-time updates
wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const investigationId = url.searchParams.get('id');
    console.log(`[WS] Client connected for investigation: ${investigationId}`);

    if (investigationId) {
        if (!clients.has(investigationId)) {
            clients.set(investigationId, new Set());
        }
        clients.get(investigationId)!.add(ws);
        console.log(`[WS] Total clients for ${investigationId}: ${clients.get(investigationId)!.size}`);

        ws.on('close', () => {
            console.log(`[WS] Client disconnected for investigation: ${investigationId}`);
            if (clients.has(investigationId)) {
                clients.get(investigationId)!.delete(ws);
                if (clients.get(investigationId)!.size === 0) {
                    clients.delete(investigationId);
                }
            }
        });
    }
});

// Config Persistence
// Derive configFile from __dirname (compiled: dist/server.js -> backend/config.json)
// or from process.cwd() as fallback
const configFile = path.join(__dirname, '..', 'config.json');

// Derive a sensible default repoRoot: climb from backend/src/ (dev) or backend/dist/ (prod) to repo root
// Expected layout: <repoRoot>/tools/InvestigationDashboard/backend/src/server.ts (4 levels up)
const defaultRepoRoot = path.resolve(__dirname, '..', '..', '..', '..');

let config = {
    repoRoot: defaultRepoRoot,
    systemPromptPath: '',
    retrospectPromptPath: '',
    knowledgeBasePath: '',
    mcpServers: [] as string[],
    maxSteps: 50,
    retrospectTimeoutMinutes: 10,
    model: 'gpt-4-turbo',
    defaultTimeRange: 'ago(1h)',
    maxConcurrentInvestigations: 3,
    autoRefreshInterval: 30,
    workingDirectory: process.cwd(),
    notifications: true,
    investigationsPath: ''
};

// Load config from disk if exists
try {
    if (fs.existsSync(configFile)) {
        const savedConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        config = { ...config, ...savedConfig };
        console.log("Loaded configuration from disk.");
        // Ensure path exists after loading config (skip empty strings)
        if (config.investigationsPath) {
            ensureDirectoryExists(config.investigationsPath);
        }
    }
} catch (e) {
    console.error("Failed to load config file:", e);
}

// Initial load of history (after config is loaded)
loadHistory();

// Settings API
app.get('/api/settings', (req, res) => {
    res.json(config);
});

app.post('/api/settings', (req, res) => {
    try {
        const newSettings = req.body;
        const oldPath = config.investigationsPath;

        // Validate known numeric fields
        const numericFields = ['maxSteps', 'maxConcurrentInvestigations', 'autoRefreshInterval', 'retrospectTimeoutMinutes'] as const;
        for (const field of numericFields) {
            if (field in newSettings && (typeof newSettings[field] !== 'number' || !Number.isFinite(newSettings[field]) || newSettings[field] < 0)) {
                return res.status(400).json({ error: `${field} must be a non-negative number` });
            }
        }
        // Validate string fields exist if specified
        const stringFields = ['repoRoot', 'model', 'workingDirectory'] as const;
        for (const field of stringFields) {
            if (field in newSettings && typeof newSettings[field] !== 'string') {
                return res.status(400).json({ error: `${field} must be a string` });
            }
        }

        // Whitelist allowed config keys to prevent arbitrary key injection
        const ALLOWED_KEYS = new Set([
            'repoRoot', 'systemPromptPath', 'retrospectPromptPath', 'knowledgeBasePath',
            'mcpServers', 'maxSteps', 'retrospectTimeoutMinutes', 'model', 'defaultTimeRange',
            'maxConcurrentInvestigations', 'autoRefreshInterval', 'workingDirectory',
            'notifications', 'investigationsPath'
        ]);
        const filtered = Object.fromEntries(
            Object.entries(newSettings).filter(([k]) => ALLOWED_KEYS.has(k))
        );

        config = { ...config, ...filtered };

        const tmpConfigFile = configFile + '.tmp';
        fs.writeFileSync(tmpConfigFile, JSON.stringify(config, null, 2));
        fs.renameSync(tmpConfigFile, configFile);
        console.log("Configuration saved to disk.");

        // If investigations path changed, reload history
        if (newSettings.investigationsPath && newSettings.investigationsPath !== oldPath) {
            console.log(`Investigations path changed to ${newSettings.investigationsPath}. Reloading history...`);
            // Clear existing history? Or just add to it? 
            // Usually we want to switch context, so clear history.
            history.clear();
            // Also need to stop running investigations? 
            // For now, let's just reload. Running investigations in memory might be unaffected but saving them might go to old path if Runner has copy of config.
            // Runner takes `config` by reference or value? 
            // access via `this.config`. If we mutate `config`, does Runner see it?
            // Runner stores `private config: AgentConfig`. It might be a reference if we passed the object.
            // Let's check Runner instantiation.

            loadHistory();
        }

        res.json(config);
    } catch (e: any) {
        console.error("Failed to save settings:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/models', async (req, res) => {
    try {
        const models = await copilotClient.listModels();
        res.json(models);
    } catch (e) {
        console.error("Failed to list models:", e);
        res.json(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini']);
    }
});

app.get('/api/files/list', (req, res) => {
    try {
        const requestedPath = req.query.path as string || process.cwd();
        const targetPath = path.resolve(requestedPath);

        // Path traversal protection: only allow paths under repoRoot or investigationsPath
        const allowedRoots = [path.resolve(config.repoRoot), path.resolve(config.investigationsPath || process.cwd())];
        if (!allowedRoots.some(root => targetPath.startsWith(root))) {
            return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
        }

        if (!fs.existsSync(targetPath)) {
            return res.status(404).json({ error: "Path not found" });
        }

        const stats = fs.statSync(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: "Path is not a directory" });
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true }).map(entry => ({
            name: entry.name,
            isDirectory: entry.isDirectory()
        }));

        // Sort: Directories first, then files
        entries.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
        });

        res.json({
            path: targetPath,
            entries
        });
    } catch (e: any) {
        console.error("Error listing files:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/investigations', async (req, res) => {
    const { query, stamp, timeRange, trackingId, issueType, model } = req.body;

    // Validate required fields
    if (!stamp || typeof stamp !== 'string') {
        return res.status(400).json({ error: 'stamp is required and must be a string' });
    }
    if (!timeRange || typeof timeRange !== 'string') {
        return res.status(400).json({ error: 'timeRange is required and must be a string' });
    }

    // Enforce max concurrent investigations
    const runningCount = Array.from(runners.values()).filter(r => !(r as any)._isTemporary && (r as any).state.status === 'running').length;
    if (runningCount >= config.maxConcurrentInvestigations) {
        return res.status(429).json({ error: `Maximum concurrent investigations (${config.maxConcurrentInvestigations}) reached. Wait for one to complete or pause an active investigation.` });
    }

    // Construct the user query for the agent
    let fullQuery = `Stamp: ${stamp}\nTime Range: ${timeRange}`;
    if (trackingId) fullQuery += `\nTrackingId: ${trackingId}`;
    if (issueType) fullQuery += `\nIssue Type: ${issueType}`;
    fullQuery += `\n\nUser Question/Context: ${query || 'Start general investigation based on provided tracking ID or issue.'}`;

    const runner = new AgentRunner(config, {
        query: fullQuery, // Store the full constructed query for resumption
        stamp,
        timeRange,
        trackingId,
        issueType,
        model
    });

    // Typescript workaround for private state
    const id = (runner as any).state.id;
    runners.set(id, runner);

    // Attach event listeners for broadcasting
    attachRunnerListeners(runner, id);

    // Start asynchronously
    runner.start(fullQuery).then(() => {
        // Only remove if it actually finished (completed/failed/aborted)
        // If it's just paused, keep it in runners map so we can resume/compact it
        const finalState = (runner as any).state;
        history.set(id, finalState);

        if (finalState.status === 'completed' || finalState.status === 'failed' || finalState.status === 'aborted') {
            runners.delete(id);
            console.log(`[Runner] Investigation ${id} finished (${finalState.status}). Removed from active runners.`);
        } else {
            console.log(`[Runner] Investigation ${id} paused/suspended. Keeping in active runners.`);
        }
    }).catch(err => {
        console.error(`[Runner] Investigation ${id} crashed:`, err);
        const finalState = (runner as any).state;
        if (finalState) {
            finalState.status = 'failed';
            history.set(id, finalState);
        }
        runners.delete(id);
    });

    res.json({ id, status: 'running' });
});

app.get('/api/investigations', (req, res) => {
    const active = Array.from(runners.values()).map(r => (r as any).state);
    const past = Array.from(history.values()).filter(p => !runners.has(p.id));
    const all = [...active, ...past];

    // Return lightweight summaries for list view, not full thoughts/actions
    const summaries = all.map(s => ({
        id: s.id,
        status: s.status,
        title: s.title,
        query: s.query,
        stamp: s.stamp,
        timeRange: s.timeRange,
        trackingId: s.trackingId,
        issueType: s.issueType,
        model: s.model,
        pausedAt: s.pausedAt,
        totalPausedTime: s.totalPausedTime,
        thoughts: s.thoughts.slice(-1), // Only last thought for preview
        actions: [],
        logs: [],
        retrospect: s.retrospect ? {
            messages: [],
            proposals: (s.retrospect.proposals || []).map((p: any) => ({ id: p.id, status: p.status })),
            analysisComplete: s.retrospect.analysisComplete,
            completed: s.retrospect.completed
        } : undefined
    }));
    res.json(summaries);
});

app.get('/api/investigations/:id', (req, res) => {
    const id = req.params.id;
    let state: InvestigationState | undefined;

    if (runners.has(id)) {
        state = (runners.get(id) as any).state;
    } else if (history.has(id)) {
        state = history.get(id);
    }

    if (!state) return res.status(404).send('Not found');

    // Create a lightweight copy for initial load performance
    const lightweightState = { ...state };

    // Truncate thoughts > 500 chars
    lightweightState.thoughts = state.thoughts.map(t => {
        const content = typeof t === 'string' ? t : JSON.stringify(t, null, 2);
        if (content.length > 500) {
            // Return special object marking truncation
            return {
                role: 'assistant', // preserve role if implicit
                content: content.substring(0, 500) + '...',
                _truncated: true,
                _original_type: typeof t === 'string' ? 'string' : 'object'
            };
        }
        return t;
    });

    // Truncate action results > 500 chars
    lightweightState.actions = state.actions.map(a => {
        if (!a) return a;
        const result = a.result;
        if (result) {
            const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            if (content.length > 500) {
                return { ...a, result: content.substring(0, 500) + '...', _truncated_result: true };
            }
        }
        return a;
    });

    res.json(lightweightState);
});

// Endpoint for lazy loading specific step details
app.get('/api/investigations/:id/steps/:index', (req, res) => {
    const id = req.params.id;
    const index = parseInt(req.params.index);
    let state: InvestigationState | undefined;

    if (runners.has(id)) {
        state = (runners.get(id) as any).state;
    } else if (history.has(id)) {
        state = history.get(id);
    }

    if (!state) return res.status(404).send('Not found');

    if (isNaN(index) || index < 0 || index >= state.thoughts.length) {
        return res.status(400).json({ error: 'Invalid step index' });
    }

    const thought = state.thoughts[index];
    const action = state.actions[index];

    res.json({ thought, action });
});

app.post('/api/investigations/:id/action', async (req, res) => {
    const id = req.params.id;
    const { action, message } = req.body; // action: pause, resume, abort, intervene

    let runner = runners.get(id);

    // Rehydration Logic: If runner inactive but in history, handle it
    if (!runner && history.has(id)) {
        const state = history.get(id)!;
        if (action === 'resume') {
            // Guard against double-resume race condition
            if (runners.has(id)) {
                return res.json({ status: 'ok', message: 'Already resuming' });
            }
            runner = new AgentRunner(config, state);
            runners.set(id, runner);
            attachRunnerListeners(runner, id);

            runner.resume(); // Ensure status is updated to 'running'

            // Restart execution loop
            // Use stored query or default
            const query = state.query || "Resume investigation";
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
                runners.delete(id);
            }).catch(err => {
                console.error(`Runner ${id} failed:`, err);
                // Ensure we save state even on crash
                history.set(id, (runner as any).state);
                runners.delete(id);
            });

            runner.log(`Resuming investigation ${id} from disk...`);
        } else if (action === 'pause') {
            // Runner already stopped, just update status in history
            state.status = 'paused';
            history.set(id, state);
            // Persist to disk
            try {
                const tempRunner = new AgentRunner(config, state);
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist pause for ${id}:`, e.message);
            }
            return res.json({ status: 'ok' });
        } else if (action === 'abort') {
            state.status = 'aborted';
            history.set(id, state);
            // Persist to disk
            try {
                const tempRunner = new AgentRunner(config, state);
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist abort for ${id}:`, e.message);
            }
            return res.json({ status: 'ok' });
        } else if (action === 'intervene' && message) {
            // Runner stopped, but we can append the intervention to history so it's seen on resume
            state.thoughts.push({ role: 'user', content: `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)` });
            history.set(id, state);
            // Persist to disk
            try {
                const tempRunner = new AgentRunner(config, state);
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist intervention for ${id}:`, e.message);
            }
            return res.json({ status: 'ok' });
        } else {
            return res.status(400).json({ error: 'Runner not active. Use resume to restart.' });
        }
    }

    if (!runner) return res.status(404).json({ error: 'Runner not found' });

    if (action === 'pause') runner.pause();
    if (action === 'resume') runner.resume();
    if (action === 'abort') runner.abort();
    if (action === 'intervene' && message) {
        runner.intervene(message);
    }

    res.json({ status: 'ok' });
});

app.post('/api/investigations/:id/model', async (req, res) => {
    const id = req.params.id;
    const { model } = req.body;

    if (!model) return res.status(400).json({ error: 'Model is required' });

    let runner = runners.get(id);

    // If runner is not active (paused/stopped), we update the history state directly
    if (!runner && history.has(id)) {
        const state = history.get(id)!;
        state.model = model;
        state.thoughts.push(`System: Model switched to ${model} by user (while inactive).`);
        history.set(id, state);
        console.log(`[Model Switch] Updated inactive investigation ${id} to model ${model}`);
        return res.json({ status: 'ok', model });
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    console.log(`[Model Switch] Updating active investigation ${id} to model ${model}`);
    runner.setModel(model);

    // Broadcast status update if needed, but setModel adds a thought which triggers broadcast
    res.json({ status: 'ok', model });
});

app.post('/api/investigations/:id/retrospect', async (req, res) => {
    const id = req.params.id;
    const { message } = req.body;
    let runner = runners.get(id);
    let isTemporary = false;

    // If runner inactive but in history, rehydrate a temporary runner
    if (!runner && history.has(id)) {
        // Prevent concurrent temp runner creation race
        if (runners.has(id)) {
            return res.status(409).json({ error: 'Investigation is currently being processed by another request. Try again shortly.' });
        }
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        // Attach listeners so retrospect events are broadcast via WS
        attachRunnerListeners(runner, id);

        // Add to runners map so GET requests can serve the live state updates!
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    try {
        await runner.runRetrospective(message);

        // If it was a temp runner, save state back to history and remove from active map
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            runners.delete(id); // Clean up
        }
        res.json({ success: true });
    } catch (e: any) {
        if (isTemporary) runners.delete(id); // Clean up on error too
        res.status(500).json({ error: e.message });
    }
});

// --- Retrospective Analysis (auto-triggered on first tab open) ---
app.post('/api/investigations/:id/retrospect/analyze', async (req, res) => {
    const id = req.params.id;
    const { reset } = req.body || {};
    let runner = runners.get(id);
    let isTemporary = false;

    if (!runner && history.has(id)) {
        // Prevent concurrent temp runner creation race
        if (runners.has(id)) {
            return res.status(409).json({ error: 'Investigation is currently being processed by another request. Try again shortly.' });
        }
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        attachRunnerListeners(runner, id);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    try {
        // If reset flag is set, clear analysisComplete so it re-runs
        if (reset) {
            runner.resetRetrospectiveAnalysis();
        }
        await runner.runRetrospectiveAnalysis();
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            runners.delete(id);
        }
        res.json({ success: true });
    } catch (e: any) {
        if (isTemporary) runners.delete(id);
        res.status(500).json({ error: e.message });
    }
});

// --- Update investigation title ---
app.patch('/api/investigations/:id/title', async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;

    if (typeof title !== 'string') {
        return res.status(400).json({ error: 'Title must be a string' });
    }

    const runner = runners.get(id);
    if (runner) {
        // Active runner — update state directly and persist
        (runner as any).state.title = title;
        await (runner as any).saveArtifacts();
        history.set(id, (runner as any).state);
        return res.json({ ok: true, title });
    }

    const state = history.get(id);
    if (!state) return res.status(404).json({ error: 'Investigation not found' });

    // No active runner — update in-memory state and persist via temporary runner
    state.title = title;
    history.set(id, state);
    try {
        const tempRunner = new AgentRunner(config, state);
        await (tempRunner as any).saveArtifacts();
    } catch (e: any) {
        console.error(`Failed to persist title for ${id}:`, e.message);
    }
    return res.json({ ok: true, title });
});

// --- Delete investigation ---
app.delete('/api/investigations/:id', async (req, res) => {
    const id = req.params.id;

    // Don't allow deleting running investigations
    const runner = runners.get(id);
    if (runner) {
        const state = (runner as any).state;
        if (state.status === 'running') {
            return res.status(400).json({ error: 'Cannot delete a running investigation. Abort it first.' });
        }
        runners.delete(id);
    }

    if (!history.has(id)) {
        return res.status(404).json({ error: 'Investigation not found' });
    }

    history.delete(id);

    // Remove from disk — folder is named ${timestamp}_${safeStamp}_${safeId}
    const investigationsDir = config.investigationsPath || path.join(process.cwd(), 'investigations');
    const safeId = id.replace(/[^a-zA-Z0-9]/g, '');
    let dirPath: string | null = null;

    try {
        const entries = fs.readdirSync(investigationsDir);
        const match = entries.find(e => e.endsWith(`_${safeId}`));
        if (match) {
            dirPath = path.join(investigationsDir, match);
        }
    } catch (e) {
        // Directory may not exist
    }

    const jsonPath = path.join(investigationsDir, `${id}.json`);

    try {
        if (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
        if (fs.existsSync(jsonPath)) {
            fs.unlinkSync(jsonPath);
        }
        console.log(`[Delete] Investigation ${id} deleted from disk.`);
    } catch (e: any) {
        console.error(`[Delete] Failed to delete files for ${id}:`, e.message);
        // Still return success since it's removed from memory
    }

    broadcast(id, 'status', { status: 'deleted' });
    res.json({ ok: true });
});

// --- Update proposal status (approve/reject) ---
app.patch('/api/investigations/:id/retrospect/proposals/:proposalId', async (req, res) => {
    const { id, proposalId } = req.params;
    const { status } = req.body; // 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Status must be approved or rejected' });
    }

    let runner = runners.get(id);
    let isTemporary = false;

    if (!runner && history.has(id)) {
        if (runners.has(id)) return res.status(409).json({ error: 'Concurrent operation in progress' });
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    const updated = runner.updateProposalStatus(proposalId, status);
    if (!updated) {
        if (isTemporary) runners.delete(id);
        return res.status(404).json({ error: 'Proposal not found' });
    }

    if (isTemporary) {
        history.set(id, (runner as any).state);
        await (runner as any).saveArtifacts();
        runners.delete(id);
    } else {
        await (runner as any).saveArtifacts();
    }

    res.json({ success: true, proposal: updated });
});

// --- Mark retrospective as complete/reopen ---
app.post('/api/investigations/:id/retrospect/complete', async (req, res) => {
    const id = req.params.id;
    const { completed } = req.body; // boolean: true = complete, false = reopen

    let runner = runners.get(id);
    let isTemporary = false;

    if (!runner && history.has(id)) {
        if (runners.has(id)) return res.status(409).json({ error: 'Concurrent operation in progress' });
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    try {
        const retro = runner.setRetrospectCompleted(completed !== false);
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            runners.delete(id);
        } else {
            await (runner as any).saveArtifacts();
        }
        broadcast(id, 'retrospect', retro);
        res.json({ success: true, retrospect: retro });
    } catch (e: any) {
        if (isTemporary) runners.delete(id);
        res.status(500).json({ error: e.message });
    }
});

// --- Abort retrospective analysis ---
app.post('/api/investigations/:id/retrospect/abort', async (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);
    if (!runner) return res.status(404).json({ error: 'Investigation not found or not active' });

    try {
        runner.abortRetrospective();
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Apply all approved proposals ---
app.post('/api/investigations/:id/retrospect/apply', async (req, res) => {
    const id = req.params.id;
    let runner = runners.get(id);
    let isTemporary = false;

    if (!runner && history.has(id)) {
        if (runners.has(id)) return res.status(409).json({ error: 'Concurrent operation in progress' });
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    try {
        const result = await runner.applyApprovedProposals();
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            runners.delete(id);
        }
        res.json(result);
    } catch (e: any) {
        if (isTemporary) runners.delete(id);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/investigations/:id/compact', async (req, res) => {
    const id = req.params.id;
    let runner = runners.get(id);
    let isTemporary = false;

    // Guard against concurrent compact/retrospect operations
    if (!runner && runners.has(id)) {
        return res.status(409).json({ error: 'Investigation is busy' });
    }

    // If runner inactive but in history, rehydrate a temporary runner to summarize
    if (!runner && history.has(id)) {
        const state = history.get(id)!;
        runner = new AgentRunner(config, state);
        // Attach listeners so the frontend gets the "Starting..." and "Finished" thoughts via WS
        attachRunnerListeners(runner, id);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found or not active' });

    try {
        await runner.summarize();
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            runners.delete(id);
        }
        res.json({ success: true });
    } catch (e: any) {
        if (isTemporary) runners.delete(id);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Auth Routes

app.get('/api/auth/status', async (req, res) => {
    res.json({ authenticated: await copilotClient.isAuthenticated() });
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const data = await copilotClient.startAuth();
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/poll', async (req, res) => {
    const { device_code } = req.body;
    try {
        const result = await copilotClient.checkToken(device_code);
        if (result.pending) {
            return res.json({ pending: true });
        }
        res.json({ success: true, result: result.result });
    } catch (e: any) {
        res.status(401).json({ error: e.message });
    }
});

// Note: /api/models is already defined above (line ~261). This duplicate was removed.

app.get('/api/me', (req, res) => {
    const username = process.env.USERNAME || process.env.USER || 'Unknown User';
    res.json({ username });
});

// MCP Control Routes
// MCP Control Routes
app.get('/api/investigations/:id/mcp/status', (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);

    if (runner) {
        // @ts-ignore - Accessing private toolManager
        const isConnected = (runner as any).toolManager.isConnected();
        const kqlBackend = (runner as any).toolManager.getKqlBackend();
        res.json({ connected: isConnected, kqlBackend });
    } else if (history.has(id)) {
        // If in history but not running, it's not connected
        res.json({ connected: false });
    } else {
        res.status(404).json({ error: 'Investigation not found' });
    }
});

app.post('/api/investigations/:id/mcp/restart', async (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);

    // Can only restart MCP on active runners
    if (!runner) {
        if (history.has(id)) {
            return res.status(400).json({ error: 'Cannot restart MCP for a finished/inactive investigation. Resume it first.' });
        }
        return res.status(404).json({ error: 'Runner not found' });
    }

    try {
        runner['log']("User requested MCP server restart...");
        // @ts-ignore
        await (runner as any).toolManager.restart((msg: string) => runner['log'](msg));
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
