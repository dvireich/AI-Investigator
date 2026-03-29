import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { AgentRunner, InvestigationState } from './agent/Runner';
import { LlmProviderRegistry } from './agent/llm/LlmProviderRegistry';
import { LlmProvider } from './agent/llm/LlmProvider';
import { IncidentProviderRegistry } from './agent/incidents/IncidentProviderRegistry';
import { IncidentProvider } from './agent/incidents/IncidentProvider';
import { McpServerConfig } from './agent/tools/McpToolBridge';
import { renderPdf } from './pdfRenderer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { appRoot, isPackaged, resolveFromRoot } from './utils/appRoot';
import { ScheduleStore, ScheduleDefinition } from './schedules/ScheduleStore';
import { Scheduler, SchedulerConfig, generateExecutiveReport, generateAIExecutiveReport } from './schedules/Scheduler';
import { QueryBankStore, SavedQuery } from './querybank/QueryBankStore';

const app = express();
const port = 3000;

/** Return a generic error message in production; include detail in dev mode. */
function sanitizedError(e: unknown, fallback = 'Internal server error'): string {
    if (process.env.NODE_ENV === 'production') return fallback;
    return (e instanceof Error ? e.message : String(e)) || fallback;
}

type StoredInvestigationState = InvestigationState & {
    _lastModified?: number;
    _storagePath?: string;
    _statePath?: string;
    _summaryOnly?: boolean;
    _thoughtCount?: number;
};

export function getThoughtSource(state: InvestigationState): any[] {
    if (Array.isArray(state.fullHistory) && state.fullHistory.length > 0) {
        return state.fullHistory;
    }
    return Array.isArray(state.thoughts) ? state.thoughts : [];
}

export function getThoughtPreview(lastThought: any): string | undefined {
    if (!lastThought) return undefined;
    if (typeof lastThought === 'string') return lastThought;
    return (lastThought as any).content || '';
}

export function summarizeRetrospect(retrospect?: InvestigationState['retrospect']): InvestigationState['retrospect'] | undefined {
    if (!retrospect) return undefined;
    return {
        messages: [],
        proposals: (retrospect.proposals || []).map((proposal: any) => ({ id: proposal.id, status: proposal.status })) as any,
        analysisComplete: retrospect.analysisComplete,
        analysisFailed: retrospect.analysisFailed,
        completed: retrospect.completed,
    };
}

/**
 * Infer target from legacy 'stamp' field or query text when target is missing.
 * Handles migration from older investigations that used 'stamp' instead of 'target'.
 */
export function inferTarget(state: Record<string, any>): string | undefined {
    if (state.target?.trim()) return undefined; // already has a valid target

    // Migrate legacy 'stamp' field
    if ((state as any).stamp?.trim()) return (state as any).stamp.trim();

    // Extract from query text: "Stamp: <value>" or "Target: <value>"
    if (state.query) {
        const match = state.query.match(/^(?:Stamp|Target):\s*(.+)$/m);
        if (match?.[1]?.trim()) return match[1].trim();
    }

    return undefined;
}

export function normalizeHistoricalState(state: InvestigationState, productId?: string): StoredInvestigationState {
    const normalized = { ...state } as StoredInvestigationState;
    normalized.thoughts = Array.isArray(normalized.thoughts) ? [...normalized.thoughts] : [];
    normalized.actions = Array.isArray(normalized.actions) ? normalized.actions : [];
    normalized.logs = Array.isArray(normalized.logs) ? normalized.logs : [];

    if (normalized.status === 'running') {
        normalized.status = 'paused';
        normalized.thoughts.push('System: Investigation automatically paused due to server restart.');
    }

    if (productId && !normalized.productId) {
        normalized.productId = productId;
    }

    // Migrate legacy 'stamp' field or extract target from query text
    const inferred = inferTarget(normalized);
    if (inferred) normalized.target = inferred;

    return normalized;
}

export function createSummaryState(
    state: InvestigationState,
    storagePath: string,
    statePath: string,
    lastModified: number,
): StoredInvestigationState {
    const thoughtSource = getThoughtSource(state);
    const thoughtPreview = getThoughtPreview(thoughtSource[thoughtSource.length - 1]);

    return {
        id: state.id,
        status: state.status,
        thoughts: thoughtPreview ? [thoughtPreview] : [],
        actions: [],
        logs: [],
        title: state.title,
        query: state.query,
        target: state.target,
        timeRange: state.timeRange,
        correlationId: state.correlationId,
        category: state.category,
        incidentId: state.incidentId,
        model: state.model,
        productId: state.productId,
        pausedAt: state.pausedAt,
        totalPausedTime: state.totalPausedTime,
        finalReport: state.finalReport,
        retrospect: summarizeRetrospect(state.retrospect),
        contestCount: state.contestCount,
        tags: state.tags || [],
        createdBy: state.createdBy,
        source: state.source,
        scheduleId: state.scheduleId,
        verdict: state.verdict,
        _summaryOnly: true,
        _thoughtCount: thoughtSource.length,
        _lastModified: lastModified,
        _storagePath: storagePath,
        _statePath: statePath,
    };
}

export function hydrateStoredState(stored: StoredInvestigationState): StoredInvestigationState | undefined {
    if (!stored._summaryOnly) return stored;
    if (!stored._statePath || !fs.existsSync(stored._statePath)) return stored;

    try {
        const content = fs.readFileSync(stored._statePath, 'utf-8');
        const parsed = JSON.parse(content) as InvestigationState;
        const normalized = normalizeHistoricalState(parsed, stored.productId);
        const stateStat = fs.statSync(stored._statePath);
        normalized._summaryOnly = false;
        normalized._lastModified = stateStat.mtimeMs;
        normalized._storagePath = stored._storagePath || getInvestigationStoragePath(normalized);
        normalized._statePath = stored._statePath;
        normalized._thoughtCount = undefined;
        // Strip fullHistory/fullActions from the cached record to reduce memory.
        // These are only needed transiently (detail/step endpoints, runner creation)
        // and can be re-read from disk on demand via state.json.
        delete (normalized as any).fullHistory;
        delete (normalized as any).fullActions;
        return normalized;
    } catch (error) {
        console.error(`Failed to hydrate investigation ${stored.id} from ${stored._statePath}:`, error);
        return stored;
    }
}

class InvestigationHistoryStore {
    private readonly records = new Map<string, StoredInvestigationState>();
    /** Tracks access order for LRU eviction — Map maintains insertion order; re-insert = move to end. */
    private readonly accessOrder = new Map<string, true>();
    static readonly MAX_IN_MEMORY = 1000;

    get size(): number {
        return this.records.size;
    }

    has(id: string): boolean {
        return this.records.has(id);
    }

    get(id: string): StoredInvestigationState | undefined {
        const stored = this.records.get(id);
        if (!stored) return undefined;

        // Move to most-recently-used
        this.touch(id);

        if (!stored._summaryOnly) return stored;

        const hydrated = hydrateStoredState(stored);
        if (hydrated && hydrated !== stored) {
            this.records.set(id, hydrated);
            if (hydrated._storagePath) {
                storagePathCache.set(id, hydrated._storagePath);
            }
        }
        return hydrated;
    }

    set(id: string, state: InvestigationState): this {
        const stored = state as StoredInvestigationState;
        const storagePath = stored._storagePath || getInvestigationStoragePath(stored);
        stored._storagePath = storagePath;
        stored._statePath = stored._statePath || path.join(storagePath, 'state.json');
        this.records.set(id, stored);
        storagePathCache.set(id, storagePath);
        this.touch(id);
        this.evictIfNeeded();
        return this;
    }

    values(): IterableIterator<StoredInvestigationState> {
        return this.records.values();
    }

    entries(): IterableIterator<[string, StoredInvestigationState]> {
        return this.records.entries();
    }

    delete(id: string): boolean {
        storagePathCache.delete(id);
        this.accessOrder.delete(id);
        return this.records.delete(id);
    }

    clear(): void {
        storagePathCache.clear();
        this.accessOrder.clear();
        this.records.clear();
    }

    /** Move id to most-recently-used position (O(1) via Map re-insert). */
    private touch(id: string): void {
        this.accessOrder.delete(id);
        this.accessOrder.set(id, true);
    }

    /** Evict least-recently-used entries to summary-only form when over limit. */
    private evictIfNeeded(): void {
        while (this.records.size > InvestigationHistoryStore.MAX_IN_MEMORY && this.accessOrder.size > 0) {
            const evictId = this.accessOrder.keys().next().value!;
            this.accessOrder.delete(evictId);
            const rec = this.records.get(evictId);
            if (rec && !rec._summaryOnly) {
                // Downgrade to summary-only (keeps metadata, drops heavy fields)
                rec._summaryOnly = true;
                delete (rec as any).thoughts;
                delete (rec as any).actions;
                delete (rec as any).logs;
                delete (rec as any).fullHistory;
                delete (rec as any).fullActions;
                delete (rec as any).retrospect;
            }
        }
    }
}

export function handleUncaughtException(err: unknown, logger: Pick<Console, 'error'> = console): void {
    logger.error('CRITICAL: Uncaught Exception:', err);
}

export function handleUnhandledRejection(reason: unknown, promise: unknown, logger: Pick<Console, 'error'> = console): void {
    logger.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
}

export function registerProcessErrorHandlers(processLike: Pick<NodeJS.Process, 'on'>, logger: Pick<Console, 'error'> = console): void {
    processLike.on('uncaughtException', (err) => {
        handleUncaughtException(err, logger);
    });

    processLike.on('unhandledRejection', (reason, promise) => {
        handleUnhandledRejection(reason, promise, logger);
    });
}

registerProcessErrorHandlers(process);
const llmRegistry = new LlmProviderRegistry();
const incidentRegistry = new IncidentProviderRegistry();
let activeLlmProvider: LlmProvider | null = null;
let activeIncidentProvider: IncidentProvider | null = null;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

export function jsonParseErrorHandler(err: any, req: express.Request, res: express.Response, next: express.NextFunction) {
    if (err.type === 'entity.parse.failed') {
        console.error(`JSON parse error on ${req.method} ${req.url}:`, err.message);
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    next(err);
}

// Handle JSON parse errors from body-parser gracefully
app.use(jsonParseErrorHandler);

// In production mode, serve the frontend build from dist/public/
const publicDir = path.join(__dirname, 'public');

export function applyStaticServing(targetApp: ReturnType<typeof express>, dir: string): void {
    if (fs.existsSync(dir)) {
        targetApp.use(express.static(dir));
    }
}

export function applySpaFallback(targetApp: ReturnType<typeof express>, dir: string): void {
    if (fs.existsSync(dir)) {
        targetApp.get('*', (req, res) => {
            res.sendFile(path.join(dir, 'index.html'));
        });
    }
}

applyStaticServing(app, publicDir);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Prevent ws from throwing server errors as uncaught exceptions.
// ws re-emits http server 'error' events on the WebSocketServer; without a
// listener, EventEmitter's default behaviour throws, which bypasses our
// server.on('error') handler (used for EADDRINUSE auto-recovery).
wss.on('error', () => { /* handled on server */ });

// Store active runners
const runners = new Map<string, AgentRunner>();
// Store past investigations
const history = new InvestigationHistoryStore();
// Cache storage paths per investigation ID to avoid recompute on every poll
const storagePathCache = new Map<string, string>();
// Cached list response. Keep invalidation explicit because the dashboard polls this route heavily.
let cachedListJson: string | null = null;
let cachedListEtag: string | null = null;
let cachedListCacheKey: string | null = null;  // tracks query params for cache invalidation
let listCacheDirtyAt = 0;  // timestamp of last mutation

function invalidateListCache() {
    cachedListJson = null;
    cachedListEtag = null;
    cachedListCacheKey = null;
    listCacheDirtyAt = Date.now();
    storagePathCache.clear();
}

/**
 * Centralized runner cleanup: removes listeners, disconnects MCP tool
 * connections, and deletes the runner from the active map.
 * Every code path that removes a runner should call this instead of
 * `runners.delete(id)` directly.
 */
export function cleanupRunner(id: string): void {
    const runner = runners.get(id);
    if (runner) {
        runner.removeAllListeners();
        // Disconnect MCP child processes / transports
        runner.dispose();
    }
    runners.delete(id);
}

/** How long a paused runner can sit idle before auto-eviction (default 30 min). */
const RUNNER_IDLE_TTL = 30 * 60 * 1000;

/**
 * Evict runners that have been idle (paused) longer than RUNNER_IDLE_TTL.
 * Running investigations are never evicted.
 */
export function evictIdleRunners(): void {
    const now = Date.now();
    for (const [id, runner] of runners.entries()) {
        const state = (runner as any).state as InvestigationState | undefined;
        if (!state) continue;
        // Never evict running or active runners
        if (state.status === 'running') continue;
        const lastActivity = (runner as any)._lastActivityAt as number | undefined;
        if (lastActivity && (now - lastActivity) > RUNNER_IDLE_TTL) {
            console.log(`[Evict] Evicting idle runner ${id} (status=${state.status}, idle=${Math.round((now - lastActivity) / 1000)}s)`);
            // Persist state before eviction
            history.set(id, state);
            cleanupRunner(id);
            invalidateListCache();
        }
    }
}

let evictionInterval: ReturnType<typeof setInterval> | null = null;

// function to ensure directory exists
function ensureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Resolve the global (non-product) investigations base directory.
 * Must match Runner.saveArtifacts() which uses:
 *   config.investigationsPath || path.join(this.getRepoRoot(), 'investigations')
 * Previously this fell back to process.cwd()/investigations which is the backend/
 * directory — NOT where the Runner saves files.
 */
export function getGlobalInvestigationsDir(): string {
    return config.investigationsPath || path.join(config.repoRoot || defaultRepoRoot, 'investigations');
}

export function shouldScanGlobalInvestigationsDir(): boolean {
    if (config.investigationsPath) {
        return true;
    }

    return !config.products || config.products.length === 0;
}

export function isPathWithinDirectory(candidatePath: string | undefined, directoryPath: string): boolean {
    if (!candidatePath) {
        return false;
    }

    const relative = path.relative(directoryPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function shouldIncludeInvestigationInList(state: Partial<InvestigationState> & { id: string }): boolean {
    const products = config.products || [];
    const activeProductId = config.activeProductId;

    if (products.length === 0 || !activeProductId) {
        return true;
    }

    const storagePath = storagePathCache.get(state.id)
        || (state as StoredInvestigationState)._storagePath
        || getInvestigationStoragePath(state as { id: string; target?: string; productId?: string });

    const activeProduct = products.find(p => p.id === activeProductId);
    if (activeProduct?.investigationsPath && isPathWithinDirectory(storagePath, activeProduct.investigationsPath)) {
        return true;
    }

    if (!shouldScanGlobalInvestigationsDir()) {
        return false;
    }

    return isPathWithinDirectory(storagePath, getGlobalInvestigationsDir());
}

export function hasPersistedInvestigationState(state: Partial<InvestigationState> & { id: string }): boolean {
    const stored = state as StoredInvestigationState;

    if (stored._statePath) {
        return fs.existsSync(stored._statePath);
    }

    const storagePath = storagePathCache.get(state.id)
        || stored._storagePath
        || getInvestigationStoragePath(state as { id: string; target?: string; productId?: string });

    return fs.existsSync(path.join(storagePath, 'state.json'));
}

/** Compute the on-disk storage path for a given investigation state. */
export function getInvestigationStoragePath(state: { id: string; target?: string; productId?: string }): string {
    let baseDir: string;
    if (state.productId && config.products?.length) {
        const product = config.products.find(p => p.id === state.productId);
        baseDir = product?.investigationsPath || getGlobalInvestigationsDir();
    } else {
        baseDir = getGlobalInvestigationsDir();
    }
    const startDate = !isNaN(Number(state.id)) ? new Date(Number(state.id)) : new Date();
    const timestamp = startDate.toISOString().split('T')[0];
    const safeTarget = (state.target || 'UnknownTarget').replace(/[^a-zA-Z0-9-]/g, '');
    const safeId = String(state.id).replace(/[^a-zA-Z0-9]/g, '');
    return path.join(baseDir, `${timestamp}_${safeTarget}_${safeId}`);
}

export function loadHistory() {
    history.clear();
    storagePathCache.clear();
    invalidateListCache();

    // Collect all investigation directories to scan
    const dirsToScan: { dir: string; productId?: string }[] = [];
    
    // Add global/default investigations path
    const globalDir = getGlobalInvestigationsDir();
    if (shouldScanGlobalInvestigationsDir()) {
        dirsToScan.push({ dir: globalDir });
    } else {
        console.log(`Skipping implicit global investigations directory for product-configured mode: ${globalDir}`);
    }
    
    // Add each product's investigations path
    if (config.products && config.products.length > 0) {
        for (const product of config.products) {
            if (product.investigationsPath && product.investigationsPath !== globalDir) {
                dirsToScan.push({ dir: product.investigationsPath, productId: product.id });
            }
        }
    }
    
    console.log(`Scanning ${dirsToScan.length} investigation directories...`);
    
    for (const { dir, productId } of dirsToScan) {
        ensureDirectoryExists(dir);
        
        try {
            const files = fs.readdirSync(dir);
            console.log(`Scanning ${files.length} files in ${dir}${productId ? ` (product: ${productId})` : ''}`);

            // 1. Scan for directories (New Structure) and JSON files (Legacy)
            for (const file of files) {
                const fullPath = path.join(dir, file);
                try {
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        // Check for state.json inside
                        const statePath = path.join(fullPath, 'state.json');
                        if (fs.existsSync(statePath)) {
                            const summaryPath = path.join(fullPath, 'summary.json');

                            if (fs.existsSync(summaryPath)) {
                                const content = fs.readFileSync(summaryPath, 'utf-8');
                                const summary = JSON.parse(content) as StoredInvestigationState;
                                if (summary.id) {
                                    const summaryStat = fs.statSync(summaryPath);
                                    if (summary.status === 'running') {
                                        summary.status = 'paused';
                                    }
                                    if (productId && !summary.productId) {
                                        summary.productId = productId;
                                    }
                                    // Migrate legacy 'stamp' field or extract target from query
                                    const inferred = inferTarget(summary);
                                    if (inferred) {
                                        summary.target = inferred;
                                        // Persist the fix so it doesn't need re-inference next load
                                        try {
                                            const tmpPath = summaryPath + '.tmp';
                                            const updated = JSON.parse(content);
                                            updated.target = inferred;
                                            fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2));
                                            fs.renameSync(tmpPath, summaryPath);
                                        } catch { /* best-effort */ }
                                    }
                                    summary._summaryOnly = true;
                                    summary._lastModified = summaryStat.mtimeMs;
                                    summary._storagePath = fullPath;
                                    summary._statePath = statePath;
                                    history.set(summary.id, summary);
                                }
                            } else {
                                const content = fs.readFileSync(statePath, 'utf-8');
                                const parsed = JSON.parse(content) as InvestigationState;
                                const normalized = normalizeHistoricalState(parsed, productId);
                                const stateFileStat = fs.statSync(statePath);

                                if (normalized.id) {
                                    const summary = createSummaryState(normalized, fullPath, statePath, stateFileStat.mtimeMs);
                                    history.set(normalized.id, summary);

                                    try {
                                        const tmpSummaryPath = summaryPath + '.tmp';
                                        fs.writeFileSync(tmpSummaryPath, JSON.stringify(summary, null, 2));
                                        fs.renameSync(tmpSummaryPath, summaryPath);
                                    } catch (summaryError) {
                                        console.error(`Failed to backfill summary for ${statePath}:`, summaryError);
                                    }
                                }
                            }
                        }
                    } else if (file.endsWith('.json')) {
                        // Legacy flat file support
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const parsed = JSON.parse(content) as InvestigationState;
                        const normalized = normalizeHistoricalState(parsed, productId);
                        if (normalized.id) {
                            const summary = createSummaryState(normalized, path.dirname(fullPath), fullPath, stat.mtimeMs);
                            history.set(normalized.id, summary);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to load ${file}:`, e);
                }
            }

            // 2. Load Markdown reports (legacy/completed) if no JSON exists for them
            const mdFiles = files.filter(f => f.endsWith('.md'));
            for (const file of mdFiles) {
                const id = file.replace('.md', '');

                // If we don't have this ID yet (from JSON), create a synthetic state
                if (!history.has(id)) {
                    try {
                        const stats = fs.statSync(path.join(dir, file));
                        history.set(id, {
                            id: id,
                            status: 'completed',
                            thoughts: [`Legacy report loaded from ${file}`],
                            actions: [],
                            logs: [`Imported from ${file} on ${new Date().toISOString()}`],
                            productId: productId, // Tag with product if from product directory
                        });
                    } catch (e) {
                        console.error(`Failed to load legacy MD ${file}:`, e);
                    }
                }
            }
        } catch (e) {
            console.error(`Failed to read investigations directory ${dir}:`, e);
        }
    }
    
    console.log(`Loaded ${history.size} total investigations into history.`);
}



// WebSocket Client Management
const clients = new Map<string, Set<WebSocket>>();

export function broadcastToClients(
    clientMap: Map<string, Set<WebSocket>>,
    id: string,
    type: string,
    data: any,
    logger: Pick<Console, 'log'> = console,
) {
    const clientSet = clientMap.get(id);
    if (process.env.DEBUG_WS) {
        console.log(`[WS Broadcast] id=${id} type=${type} clients=${clientSet ? clientSet.size : 0}`);
    }
    if (clientSet) {
        // Stringify once — avoid re-serializing per client (Fix 30)
        const message = JSON.stringify({ type, data });
        clientSet.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    if (process.env.DEBUG_WS) {
                        logger.log(`[WS Broadcast] Sent ${type} to client`);
                    }
                } catch (err) {
                    // One broken client must not prevent others from receiving the broadcast
                    console.error(`[WS Broadcast] Failed to send to client:`, (err as Error).message);
                }
            } else if (process.env.DEBUG_WS) {
                logger.log(`[WS Broadcast] Client not OPEN, readyState=${ws.readyState}`);
            }
        });
    }
}

const broadcast = (id: string, type: string, data: any) => {
    broadcastToClients(clients, id, type, data);
};

const attachRunnerListeners = (runner: AgentRunner, id: string) => {
    console.log(`[WS] Attaching listeners for runner id=${id}`);
    (runner as any)._lastActivityAt = Date.now();
    const touch = () => { (runner as any)._lastActivityAt = Date.now(); };
    runner.on('thought', (data) => { touch(); broadcast(id, 'thought', data); });
    runner.on('action', (data) => { touch(); broadcast(id, 'action', data); });
    runner.on('log', (data) => { touch(); broadcast(id, 'log', data); });
    runner.on('status', (data) => { touch(); broadcast(id, 'status', data); });
    runner.on('retrospect', (data) => { touch(); broadcast(id, 'retrospect', data); });
    runner.on('retrospect-proposal', (data) => { touch(); broadcast(id, 'retrospect-proposal', data); });
    runner.on('retrospect-tool-activity', (data) => { touch(); broadcast(id, 'retrospect-tool-activity', data); });
};

export function registerWebSocketClient(
    clientMap: Map<string, Set<WebSocket>>,
    ws: WebSocket,
    req: http.IncomingMessage,
    logger: Pick<Console, 'log'> = console,
) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const investigationId = url.searchParams.get('id');
    logger.log(`[WS] Client connected for investigation: ${investigationId}`);

    if (investigationId) {
        if (!clientMap.has(investigationId)) {
            clientMap.set(investigationId, new Set());
        }
        clientMap.get(investigationId)!.add(ws);
        logger.log(`[WS] Total clients for ${investigationId}: ${clientMap.get(investigationId)!.size}`);

        ws.on('close', () => {
            logger.log(`[WS] Client disconnected for investigation: ${investigationId}`);
            if (clientMap.has(investigationId)) {
                clientMap.get(investigationId)!.delete(ws);
                if (clientMap.get(investigationId)!.size === 0) {
                    clientMap.delete(investigationId);
                }
            }
        });

        ws.on('error', () => {
            ws.terminate();
        });
    }
}

// WebSocket for real-time updates
wss.on('connection', (ws, req) => {
    registerWebSocketClient(clients, ws, req);

    // Mark alive on connect and on pong response
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
});

// Heartbeat: ping every 30s, terminate unresponsive clients
function wsHeartbeatCheck() {
    wss.clients.forEach((ws) => {
        if ((ws as any).isAlive === false) {
            ws.terminate();
            return;
        }
        (ws as any).isAlive = false;
        ws.ping();
    });
}
const wsHeartbeatInterval = setInterval(wsHeartbeatCheck, 30_000);
wss.on('close', () => clearInterval(wsHeartbeatInterval));

/**
 * Build the effective AgentConfig for a given investigation state.
 * 
 * When an investigation was created under a specific product, the product's
 * investigationsPath, repoRoot, prompts, etc. must be used when the runner is
 * rehydrated (e.g. for retrospect, resume, compact, save).
 * Without this, the global config (which may have an empty investigationsPath)
 * would be used, causing artifacts to save to the wrong directory.
 */
export function getEffectiveConfig(state?: Partial<InvestigationState>): typeof config {
    const productId = state?.productId;
    if (productId) {
        const product = config.products.find(p => p.id === productId);
        if (product) {
            return {
                ...config,
                repoRoot: product.repoRoot || config.repoRoot,
                systemPromptPath: product.systemPromptPath || config.systemPromptPath,
                knowledgeBasePath: product.knowledgeBasePath || config.knowledgeBasePath,
                workingDirectory: product.workingDirectory || config.workingDirectory,
                investigationsPath: product.investigationsPath || config.investigationsPath,
            };
        }
    }
    return config;
}

// Config Persistence
// Support --config <path> CLI argument to load config from an external file.
// This allows teams to keep their config.json in their own repo.
// In exe mode, look next to the executable. In normal mode, look in repo root.
export function resolveConfigFilePath(argv: string[], currentDir: string, root: string): string {
    const configArgIndex = argv.indexOf('--config');
    if (configArgIndex !== -1 && argv[configArgIndex + 1]) {
        return path.resolve(argv[configArgIndex + 1]);
    }
    return path.join(root, 'config.json');
}

const configFile = resolveConfigFilePath(process.argv, __dirname, appRoot);

// The directory containing the config file — used to resolve relative paths in config values.
// When --config points to a product repo's investigator-config.json, relative paths
// like "docs/investigations" resolve relative to that repo root.
const configFileDir = path.dirname(configFile);

// The AI-Investigator installation root.
// Normal mode: two levels up from backend/dist/. Exe mode: directory of the executable.
const investigatorRoot = appRoot;

// Derive a sensible default repoRoot: in exe mode, use the exe dir.
// In normal mode, climb from backend/dist/ to the expected outer repo root.
export function getDefaultRepoRoot(pkgd: boolean = isPackaged): string {
    return pkgd ? appRoot : path.resolve(__dirname, '..', '..', '..', '..');
}
const defaultRepoRoot = getDefaultRepoRoot();

interface Product {
    id: string;
    name: string;
    repoRoot: string;
    systemPromptPath: string;
    knowledgeBasePath: string;
    workingDirectory: string;
    investigationsPath: string;
}

let config: {
    repoRoot: string;
    systemPromptPath: string;
    retrospectPromptPath: string; // Internal — resolved automatically, not user-configurable
    knowledgeBasePath: string;
    mcpServers: McpServerConfig[];
    maxSteps: number;
    retrospectTimeoutMinutes: number;
    model: string;
    defaultTimeRange: string;
    maxConcurrentInvestigations: number;
    autoRefreshInterval: number;
    workingDirectory: string;
    notifications: boolean;
    notifEnabled: boolean;
    notifSound: boolean;
    notifEvents: string[];
    investigationsPath: string;
    llmProvider: { type: string; [key: string]: any };
    incidentProvider: { type: string; [key: string]: any };
    products: Product[];
    activeProductId: string;
    // Scheduled investigation settings
    maxConcurrentScheduledInvestigations: number;
    scheduledInvestigationMaxSteps: number;
    scheduledInvestigationRetentionCount: number;
    scheduledReportModel: string;
    recommendationModel: string;
    // UI preferences
    defaultView: 'grid' | 'list';
    defaultSortOrder: 'newest' | 'oldest' | 'steps' | 'modified';
    defaultPageSize: number;
    // Analytics preferences
    analyticsWidgets: string[];
    analyticsVisible: boolean;
} = {
    repoRoot: defaultRepoRoot,
    systemPromptPath: '',
    retrospectPromptPath: resolveFromRoot('prompts', 'RetrospectPrompt.md'),
    knowledgeBasePath: '',
    mcpServers: [],
    maxSteps: 50,
    retrospectTimeoutMinutes: 10,
    model: 'gpt-4-turbo',
    defaultTimeRange: 'ago(1h)',
    maxConcurrentInvestigations: 3,
    autoRefreshInterval: 30,
    workingDirectory: process.cwd(),
    notifications: true,
    notifEnabled: true,
    notifSound: true,
    notifEvents: ['completed', 'failed'],
    investigationsPath: '',
    llmProvider: { type: 'copilot' },
    incidentProvider: { type: 'manual' },
    products: [],
    activeProductId: '',
    maxConcurrentScheduledInvestigations: 2,
    scheduledInvestigationMaxSteps: 20,
    scheduledInvestigationRetentionCount: 10,
    scheduledReportModel: 'gpt-4o-mini',
    recommendationModel: 'gpt-4o-mini',
    defaultView: 'grid',
    defaultSortOrder: 'newest',
    defaultPageSize: 12,
    analyticsWidgets: ['trend', 'targetActivity', 'successRate'],
    analyticsVisible: true,
};

// Track what's persisted on disk — prevents internal defaults from leaking into the config file.
// Keys like repoRoot, workingDirectory are machine-specific runtime defaults that shouldn't
// be saved unless the user's config file already contained them.
let persistedConfig: Record<string, any> = {};

// Keys that are internal/machine-specific defaults — don't auto-persist if not already in the file
const INTERNAL_DEFAULT_KEYS = new Set([
    'repoRoot', 'workingDirectory', 'systemPromptPath', 'knowledgeBasePath',
    'investigationsPath',
]);

// Whitelist of config keys accepted via POST /api/settings and POST /api/settings/import.
// Defined once and shared by both routes to prevent drift.
const SETTINGS_ALLOWED_KEYS = new Set([
    'repoRoot', 'systemPromptPath', 'knowledgeBasePath',
    'mcpServers', 'maxSteps', 'retrospectTimeoutMinutes', 'model', 'defaultTimeRange',
    'maxConcurrentInvestigations', 'maxConcurrentScheduledInvestigations',
    'scheduledInvestigationMaxSteps', 'scheduledInvestigationRetentionCount', 'scheduledReportModel', 'recommendationModel',
    'autoRefreshInterval', 'workingDirectory',
    'notifications', 'notifEnabled', 'notifSound', 'notifEvents',
    'investigationsPath', 'products', 'activeProductId',
    'llmProvider', 'incidentProvider',
    'defaultView', 'defaultSortOrder', 'defaultPageSize',
    'analyticsWidgets', 'analyticsVisible',
]);

function saveConfigToDisk() {
    const tmpFile = configFile + '.tmp';
    // Never persist auto-resolved internal fields
    const { retrospectPromptPath: _retro, ...saveable } = persistedConfig;
    fs.writeFileSync(tmpFile, JSON.stringify(saveable, null, 2));
    fs.renameSync(tmpFile, configFile);
    console.log("Configuration saved to disk.");
}

/**
 * Resolve a path that may be relative. Relative paths are resolved against the
 * given baseDir (typically configFileDir for top-level config, or the product's
 * repoRoot for product-level paths).
 *
 * Special prefix "$INVESTIGATOR_ROOT/" resolves relative to the AI-Investigator
 * installation directory, allowing configs to reference built-in resources
 * (like scripts/icm) portably.
 */
export function resolveConfigPath(p: string, baseDir: string): string {
    if (!p) return p;
    if (p.startsWith('$INVESTIGATOR_ROOT/') || p.startsWith('$INVESTIGATOR_ROOT\\')) {
        return path.resolve(investigatorRoot, p.substring('$INVESTIGATOR_ROOT/'.length));
    }
    if (path.isAbsolute(p)) return p;
    return path.resolve(baseDir, p);
}

/**
 * Resolve all relative paths in a loaded config object.
 * Product paths resolve relative to their own repoRoot.
 * Top-level paths resolve relative to the config file's directory.
 */
export function resolveConfigPaths(cfg: any, baseDir: string): void {
    // Top-level paths
    const topLevelPathKeys = ['repoRoot', 'systemPromptPath', 'knowledgeBasePath', 'workingDirectory', 'investigationsPath'];
    for (const key of topLevelPathKeys) {
        if (cfg[key] && typeof cfg[key] === 'string') {
            cfg[key] = resolveConfigPath(cfg[key], baseDir);
        }
    }

    // Incident provider scriptsPath
    if (cfg.incidentProvider?.scriptsPath) {
        cfg.incidentProvider.scriptsPath = resolveConfigPath(cfg.incidentProvider.scriptsPath, baseDir);
    }

    // MCP server cwd
    if (Array.isArray(cfg.mcpServers)) {
        for (const server of cfg.mcpServers) {
            if (server.cwd) {
                server.cwd = resolveConfigPath(server.cwd, baseDir);
            }
        }
    }

    // Product paths resolve relative to their own repoRoot
    if (Array.isArray(cfg.products)) {
        for (const product of cfg.products) {
            // First resolve repoRoot relative to config file
            if (product.repoRoot) {
                product.repoRoot = resolveConfigPath(product.repoRoot, baseDir);
            }
            const productBase = product.repoRoot || baseDir;
            const productPathKeys = ['systemPromptPath', 'knowledgeBasePath', 'workingDirectory', 'investigationsPath'];
            for (const key of productPathKeys) {
                if (product[key] && typeof product[key] === 'string') {
                    product[key] = resolveConfigPath(product[key], productBase);
                }
            }
        }
    }
}

export function loadConfigFromDisk(targetConfigFile: string, baseConfig: typeof config, baseDir: string): {
    config: typeof config;
    persistedConfig: Record<string, any>;
    loaded: boolean;
} {
    const nextConfig = { ...baseConfig };
    let nextPersistedConfig: Record<string, any> = {};

    if (!fs.existsSync(targetConfigFile)) {
        return { config: nextConfig, persistedConfig: nextPersistedConfig, loaded: false };
    }

    const savedConfig = JSON.parse(fs.readFileSync(targetConfigFile, 'utf-8'));
    nextPersistedConfig = { ...savedConfig };
    const resolvedRetrospectPromptPath = nextConfig.retrospectPromptPath;
    const mergedConfig = { ...nextConfig, ...savedConfig };
    mergedConfig.retrospectPromptPath = resolvedRetrospectPromptPath;
    resolveConfigPaths(mergedConfig, baseDir);

    if (mergedConfig.investigationsPath) {
        ensureDirectoryExists(mergedConfig.investigationsPath);
    }

    return { config: mergedConfig, persistedConfig: nextPersistedConfig, loaded: true };
}

// Load config from disk if exists
try {
    const loadedConfig = loadConfigFromDisk(configFile, config, configFileDir);
    config = loadedConfig.config;
    persistedConfig = loadedConfig.persistedConfig;
    if (loadedConfig.loaded) {
        console.log("Loaded configuration from disk.");
    }
} catch (e) {
    console.error("Failed to load config file:", e);
}

// Initialize LLM and incident providers from config
export function initializeProviders() {
    try {
        const llmConfig = config.llmProvider || { type: 'copilot' };
        activeLlmProvider = llmRegistry.getConfigured(llmConfig);
        console.log(`[LLM] Initialized provider: ${llmConfig.type}`);
    } catch (e: any) {
        console.error(`[LLM] Failed to initialize provider:`, e.message);
        // Fall back to copilot
        activeLlmProvider = llmRegistry.get('copilot');
    }
    try {
        const incidentConfig = config.incidentProvider || { type: 'manual' };
        activeIncidentProvider = incidentRegistry.getConfigured(incidentConfig);
        console.log(`[Incidents] Initialized provider: ${incidentConfig.type}`);
    } catch (e: any) {
        console.error(`[Incidents] Failed to initialize provider:`, e.message);
        activeIncidentProvider = incidentRegistry.get('manual');
    }
}
initializeProviders();

// Initial load of history (after config is loaded)
loadHistory();

// Version / update API
import { getVersionStatus, setUpdateManifestUrl } from './utils/updateChecker';

app.get('/api/version', async (req, res) => {
    const forceCheck = req.query.check === 'true';
    const status = await getVersionStatus(forceCheck);
    res.json(status);
});

// Settings API

// Onboarding status — checks if minimum config exists
app.get('/api/onboarding/status', (req, res) => {
    const hasLlm = !!(config.llmProvider && config.llmProvider.type && config.llmProvider.type !== 'none');
    const hasProduct = config.products && config.products.length > 0;
    const configExists = fs.existsSync(configFile);
    res.json({
        complete: hasLlm && configExists,
        hasLlmProvider: hasLlm,
        hasProduct: !!hasProduct,
        hasConfig: configExists,
    });
});

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
        const stringFields = ['repoRoot', 'model', 'workingDirectory', 'scheduledReportModel', 'recommendationModel'] as const;
        for (const field of stringFields) {
            if (field in newSettings && typeof newSettings[field] !== 'string') {
                return res.status(400).json({ error: `${field} must be a string` });
            }
        }

        // Whitelist allowed config keys to prevent arbitrary key injection
        const filtered = Object.fromEntries(
            Object.entries(newSettings).filter(([k]) => SETTINGS_ALLOWED_KEYS.has(k))
        );

        // Deep-sanitize to prevent prototype pollution via nested __proto__ payloads
        const sanitized = JSON.parse(JSON.stringify(filtered));

        config = { ...config, ...sanitized };

        // Only persist keys that were already in the file or are user-facing settings
        for (const [key, value] of Object.entries(sanitized)) {
            if (key in persistedConfig || !INTERNAL_DEFAULT_KEYS.has(key)) {
                persistedConfig[key] = value;
            }
        }
        saveConfigToDisk();

        // Re-initialize providers if their config changed
        if ('llmProvider' in filtered || 'incidentProvider' in filtered) {
            initializeProviders();
        }

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
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.get('/api/settings/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
    res.json(config);
});

app.post('/api/settings/import', (req, res) => {
    try {
        const imported = req.body;
        if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
            return res.status(400).json({ error: 'Request body must be a JSON object' });
        }
        // Whitelist the same keys as POST /api/settings
        const filtered = Object.fromEntries(
            Object.entries(imported).filter(([k]) => SETTINGS_ALLOWED_KEYS.has(k))
        );
        if (Object.keys(filtered).length === 0) {
            return res.status(400).json({ error: 'No valid settings keys found in import' });
        }
        // Deep-sanitize to prevent prototype pollution
        const sanitized = JSON.parse(JSON.stringify(filtered));
        config = { ...config, ...sanitized };
        for (const [key, value] of Object.entries(sanitized)) {
            if (key in persistedConfig || !INTERNAL_DEFAULT_KEYS.has(key)) {
                persistedConfig[key] = value;
            }
        }
        saveConfigToDisk();
        if ('llmProvider' in filtered || 'incidentProvider' in filtered) {
            initializeProviders();
        }
        res.json({ imported: Object.keys(filtered).length, config });
    } catch (e: any) {
        console.error("Failed to import settings:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

// Products API
app.get('/api/products', (req, res) => {
    const products: Product[] = config.products || [];
    res.json(products);
});

app.get('/api/products/active', (req, res) => {
    const products: Product[] = config.products || [];
    const activeProduct = products.find(p => p.id === config.activeProductId) || null;
    res.json(activeProduct);
});

app.put('/api/products/active', (req, res) => {
    try {
        const { productId } = req.body;
        if (!productId) {
            return res.status(400).json({ error: 'productId is required' });
        }
        const products: Product[] = config.products || [];
        const product = products.find(p => p.id === productId);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        config.activeProductId = productId;
        persistedConfig.activeProductId = productId;
        invalidateListCache();
        saveConfigToDisk();
        res.json({ success: true });
    } catch (e: any) {
        console.error("Failed to set active product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.post('/api/products', (req, res) => {
    try {
        const product: Omit<Product, 'id'> = req.body;
        if (!product.name) {
            return res.status(400).json({ error: 'name is required' });
        }
        // Generate a unique ID from the name
        const id = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!config.products) {
            config.products = [];
        }
        if (config.products.some((p: Product) => p.id === id)) {
            return res.status(409).json({ error: 'Product with this name already exists' });
        }
        const newProduct: Product = { id, ...product };
        config.products.push(newProduct);
        persistedConfig.products = [...config.products];
        saveConfigToDisk();
        // Reload history to include investigations from new product directory
        if (newProduct.investigationsPath) {
            console.log(`New product added with investigationsPath: ${newProduct.investigationsPath}. Reloading history...`);
            history.clear();
            loadHistory();
        }
        res.json(newProduct);
    } catch (e: any) {
        console.error("Failed to add product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.put('/api/products/:id', (req, res) => {
    try {
        const { id } = req.params;
        const updates: Partial<Product> = req.body;
        const products: Product[] = config.products || [];
        const index = products.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Product not found' });
        }
        // Prevent changing the ID
        delete updates.id;
        const oldInvestigationsPath = config.products[index].investigationsPath;
        config.products[index] = { ...config.products[index], ...updates };
        persistedConfig.products = [...config.products];
        saveConfigToDisk();
        // Reload history if investigationsPath changed
        if (updates.investigationsPath && updates.investigationsPath !== oldInvestigationsPath) {
            console.log(`Product investigationsPath changed to ${updates.investigationsPath}. Reloading history...`);
            history.clear();
            loadHistory();
        }
        res.json(config.products[index]);
    } catch (e: any) {
        console.error("Failed to update product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.delete('/api/products/:id', (req, res) => {
    try {
        const { id } = req.params;
        if (!config.products || config.products.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const index = config.products.findIndex((p: Product) => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Product not found' });
        }
        // Don't allow deleting the last product
        if (config.products.length === 1) {
            return res.status(400).json({ error: 'Cannot delete the last product' });
        }
        // If deleting the active product, switch to first available
        if (config.activeProductId === id) {
            const remaining = config.products.filter((p: Product) => p.id !== id);
            config.activeProductId = remaining[0]?.id || '';
        }
        config.products.splice(index, 1);
        persistedConfig.products = [...config.products];
        persistedConfig.activeProductId = config.activeProductId;
        saveConfigToDisk();
        res.json({ success: true });
    } catch (e: any) {
        console.error("Failed to delete product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

// --- Product Path Validation ---
interface PathValidationResult {
    field: string;
    label: string;
    value: string;
    isAbsolute: boolean;
    exists: boolean;
    error: string | null;
}
interface ProductValidation {
    valid: boolean;
    paths: PathValidationResult[];
}

export function validateProductPaths(product: Product): ProductValidation {
    const pathFields: { field: keyof Product; label: string; required: boolean }[] = [
        { field: 'repoRoot', label: 'Repository Root', required: true },
        { field: 'systemPromptPath', label: 'System Prompt', required: false },
        { field: 'knowledgeBasePath', label: 'Knowledge Base', required: false },
        { field: 'workingDirectory', label: 'Working Directory', required: false },
        { field: 'investigationsPath', label: 'Investigations Storage', required: false },
    ];

    const results: PathValidationResult[] = [];
    let allValid = true;

    for (const { field, label, required } of pathFields) {
        const value = product[field] || '';
        if (!value) {
            // Empty path - only an error if required
            if (required) {
                results.push({ field, label, value, isAbsolute: false, exists: false, error: 'Path is required' });
                allValid = false;
            }
            continue; // skip unconfigured optional paths
        }

        const isAbsolute = path.isAbsolute(value);
        let exists = false;
        let error: string | null = null;

        if (!isAbsolute) {
            error = 'Path must be absolute (full path, not relative)';
            allValid = false;
        } else {
            try {
                exists = fs.existsSync(value);
                if (!exists) {
                    error = 'Path does not exist on disk';
                    allValid = false;
                }
            } catch {
                error = 'Unable to check path on disk';
                allValid = false;
            }
        }

        results.push({ field, label, value, isAbsolute, exists, error });
    }

    return { valid: allValid, paths: results };
}

app.get('/api/products/:id/validate', (req, res) => {
    try {
        const { id } = req.params;
        const products: Product[] = config.products || [];
        const product = products.find(p => p.id === id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const validation = validateProductPaths(product);
        res.json(validation);
    } catch (e: any) {
        console.error("Failed to validate product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

// --- Product Discovery & Clone ---

interface InvestigatorManifest {
    name?: string;
    description?: string;
    systemPrompt?: string;
    systemPromptPath?: string;
    knowledgeBase?: string;
    knowledgeBasePath?: string;
    workingDirectory?: string;
    investigationsPath?: string;
}

interface DiscoverResult {
    source: 'manifest' | 'auto-discovered' | 'none';
    product: Partial<Product>;
    suggestions: string[];
}

const WORKING_DIRECTORY_DEFAULT_SUGGESTION = 'Working directory defaulted to repo root';

/**
 * Resolve a manifest's relative paths to absolute paths based on repoRoot.
 */
export function resolveManifest(repoRoot: string, manifest: InvestigatorManifest): Partial<Product> {
    const abs = (rel?: string) => rel ? path.resolve(repoRoot, rel) : '';
    return {
        name: manifest.name || path.basename(repoRoot),
        repoRoot,
        systemPromptPath: abs(manifest.systemPrompt || manifest.systemPromptPath),
        knowledgeBasePath: abs(manifest.knowledgeBase || manifest.knowledgeBasePath),
        workingDirectory: abs(manifest.workingDirectory),
        investigationsPath: abs(manifest.investigationsPath),
    };
}

/**
 * Auto-discover product configuration by scanning repo structure for known patterns.
 */
export function autoDiscoverProduct(repoRoot: string): { product: Partial<Product>; suggestions: string[] } {
    const product: Partial<Product> = { name: path.basename(repoRoot), repoRoot };
    const suggestions: string[] = [];

    // Look for agent prompts
    const agentsDir = path.join(repoRoot, '.github', 'agents');
    if (fs.existsSync(agentsDir)) {
        try {
            const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.agent.md'));
            if (agentFiles.length === 1) {
                product.systemPromptPath = path.join(agentsDir, agentFiles[0]);
                suggestions.push(`Found agent prompt: ${agentFiles[0]}`);
            } else if (agentFiles.length > 1) {
                suggestions.push(`Found ${agentFiles.length} agent prompts in .github/agents/ — pick one for System Prompt`);
            }
        } catch { /* ignore read errors */ }
    }

    // Look for knowledge base directories (ordered generic-first)
    const kbCandidates = ['docs/investigations', 'docs', 'knowledge', 'docs/telemetry-investigations'];
    for (const candidate of kbCandidates) {
        const full = path.join(repoRoot, candidate);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            product.knowledgeBasePath = full;
            suggestions.push(`Found knowledge base directory at ${candidate}`);
            break;
        }
    }

    // Look for investigations directory (ordered generic-first)
    const invCandidates = [
        'investigations',
        'docs/investigations/AgentInvestigations',
        'docs/telemetry-investigations/Investigations/AgentInvestigations',
    ];
    for (const candidate of invCandidates) {
        const full = path.join(repoRoot, candidate);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            product.investigationsPath = full;
            suggestions.push(`Found investigations directory at ${candidate}`);
            break;
        }
    }

    // Working directory — default to repo root
    product.workingDirectory = repoRoot;
    suggestions.push(WORKING_DIRECTORY_DEFAULT_SUGGESTION);

    return { product, suggestions };
}

app.get('/api/products/discover', (req, res) => {
    try {
        const repoRoot = req.query.repoRoot as string;
        if (!repoRoot) {
            return res.status(400).json({ error: 'repoRoot query parameter is required' });
        }
        const resolvedRoot = path.resolve(repoRoot);
        if (!fs.existsSync(resolvedRoot)) {
            return res.status(404).json({ error: 'Repository root does not exist on disk' });
        }

        // Step 1: Try .investigator.json manifest
        const manifestPath = path.join(resolvedRoot, '.investigator.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const raw = fs.readFileSync(manifestPath, 'utf-8');
                const manifest: InvestigatorManifest = JSON.parse(raw);
                const product = resolveManifest(resolvedRoot, manifest);
                const result: DiscoverResult = {
                    source: 'manifest',
                    product,
                    suggestions: ['Loaded from .investigator.json manifest'],
                };
                return res.json(result);
            } catch (parseErr: any) {
                // Manifest exists but is malformed — fall through to auto-discover
                console.warn(`Malformed .investigator.json at ${manifestPath}: ${parseErr.message}`);
            }
        }

        // Step 2: Auto-discover by pattern scanning
        const { product, suggestions } = autoDiscoverProduct(resolvedRoot);
        const hasDetectedStructure = suggestions.some(
            suggestion => suggestion !== WORKING_DIRECTORY_DEFAULT_SUGGESTION,
        );
        if (hasDetectedStructure) {
            const result: DiscoverResult = {
                source: 'auto-discovered',
                product,
                suggestions,
            };
            return res.json(result);
        }

        // Step 3: Nothing found
        const result: DiscoverResult = {
            source: 'none',
            product: { name: path.basename(resolvedRoot), repoRoot: resolvedRoot },
            suggestions: ['No .investigator.json or recognizable structure found — configure paths manually'],
        };
        res.json(result);
    } catch (e: any) {
        console.error("Failed to discover product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.post('/api/products/:id/clone', (req, res) => {
    try {
        const { id } = req.params;
        const products: Product[] = config.products || [];
        const source = products.find(p => p.id === id);
        if (!source) {
            return res.status(404).json({ error: 'Source product not found' });
        }

        // Generate a unique clone ID
        let baseId = source.id + '-copy';
        let cloneId = baseId;
        let counter = 2;
        while (products.some(p => p.id === cloneId)) {
            cloneId = `${baseId}-${counter++}`;
        }

        const clonedProduct: Product = {
            ...source,
            id: cloneId,
            name: `${source.name} (Copy)`,
        };

        config.products.push(clonedProduct);
        persistedConfig.products = [...config.products];
        saveConfigToDisk();

        res.json(clonedProduct);
    } catch (e: any) {
        console.error("Failed to clone product:", e);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.get('/api/models', async (req, res) => {
    try {
        if (!activeLlmProvider) {
            return res.json(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']);
        }
        const models = await activeLlmProvider.listModels();
        res.json(models);
    } catch (e) {
        console.error("Failed to list models:", e);
        res.json(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']);
    }
});

app.get('/api/files/list', async (req, res) => {
    try {
        const requestedPath = req.query.path as string || process.cwd();
        const targetPath = path.resolve(requestedPath);

        // Path traversal protection: use path.relative() to prevent sibling-directory bypass
        const allowedRoots = [path.resolve(config.repoRoot), path.resolve(config.investigationsPath || process.cwd())];
        const isAllowed = allowedRoots.some(root => {
            // Exact root is fine, or it must be strictly under root + sep
            if (targetPath === root) return true;
            const rel = path.relative(root, targetPath);
            // Must not start with '..' and must not be absolute (which means it's outside)
            return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
        });
        if (!isAllowed) {
            return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
        }

        const stats = await fs.promises.stat(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: "Path is not a directory" });
        }

        const dirents = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const entries = dirents.map(entry => ({
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
        if (e.code === 'ENOENT') {
            return res.status(404).json({ error: 'Path not found' });
        }
        console.error("Error listing files:", e);
        res.status(500).json({ error: 'Failed to list directory contents' });
    }
});

// --- Incident Provider Endpoints -----------------------------------------

app.get('/api/incidents/status', async (_req, res) => {
    if (!activeIncidentProvider) {
        return res.json({ available: false, message: 'No incident provider configured' });
    }
    const available = await activeIncidentProvider.isAvailable();
    res.json({ available, providerType: config.incidentProvider?.type || 'manual' });
});

app.get('/api/incidents/providers', (_req, res) => {
    res.json(incidentRegistry.listProviders());
});

app.post('/api/incidents/:incidentId/read', async (req, res) => {
    const { incidentId } = req.params;

    if (!activeIncidentProvider) {
        return res.status(400).json({ error: 'No incident provider configured' });
    }

    const available = await activeIncidentProvider.isAvailable();
    if (!available) {
        return res.status(400).json({ error: 'Incident provider is not available' });
    }

    // Stream progress events via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    try {
        const incident = await activeIncidentProvider.fetchIncident(incidentId, (event) => {
            if (!clientDisconnected) res.write(`data: ${JSON.stringify(event)}\n\n`);
        });

        // Send final result event
        const result = {
            type: 'result',
            incidentId: incident.id,
            title: incident.title,
            severity: incident.severity || 'Unknown',
            status: incident.status || '',
            target: incident.target || '',
            timeRange: incident.timeRange || '',
            summary: (incident.content || '').substring(0, 500).trim(),
            raw: incident.content || '',
        };
        if (!clientDisconnected) {
            res.write(`data: ${JSON.stringify(result)}\n\n`);
            res.end();
        }
    } catch (err: any) {
        console.error(`[Incidents] Failed to read incident ${incidentId}:`, err);
        if (!clientDisconnected) {
            const errorEvent = { type: 'error', message: err.message || 'Failed to read incident' };
            res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
            res.end();
        }
    }
});
// --- End Incident Provider Endpoints -------------------------------------

// ── Shared investigation creation logic ──────────────────────────────────
// Used by both POST /api/investigations and the Scheduler.

interface CreateInvestigationParams {
    query?: string;
    target?: string;
    timeRange?: string;
    correlationId?: string;
    category?: string;
    incidentId?: string;
    model?: string;
    productId?: string;
    maxSteps?: number;
    source?: 'manual' | 'scheduled';
    scheduleId?: string;
    title?: string;
    createdBy?: string;
}

export function createInvestigation(params: CreateInvestigationParams): { id: string; runner: AgentRunner } {
    const { query, target, timeRange, correlationId, category, incidentId, model, productId, maxSteps, source, scheduleId, title, createdBy } = params;

    // Determine which config to use (product-specific or global)
    let effectiveConfig: typeof config = config;
    if (productId && config.products && config.products.length > 0) {
        const product = config.products.find(p => p.id === productId);
        if (product) {
            const resolvedProductConfig = {
                ...product,
                repoRoot: product.repoRoot || config.repoRoot,
                systemPromptPath: product.systemPromptPath || config.systemPromptPath,
                knowledgeBasePath: product.knowledgeBasePath || config.knowledgeBasePath,
                workingDirectory: product.workingDirectory || config.workingDirectory,
                investigationsPath: product.investigationsPath || config.investigationsPath,
            };
            const validation = validateProductPaths(resolvedProductConfig);
            if (!validation.valid) {
                const issues = validation.paths
                    .filter(p => p.error)
                    .map(p => `${p.label}: ${p.error}`)
                    .join('; ');
                throw new Error(`Product "${product.name}" has path issues: ${issues}`);
            }
            effectiveConfig = {
                ...config,
                repoRoot: resolvedProductConfig.repoRoot,
                systemPromptPath: resolvedProductConfig.systemPromptPath,
                knowledgeBasePath: resolvedProductConfig.knowledgeBasePath,
                workingDirectory: resolvedProductConfig.workingDirectory,
                investigationsPath: resolvedProductConfig.investigationsPath
            };
        }
    }

    // Apply maxSteps override if provided
    if (maxSteps !== undefined) {
        effectiveConfig = { ...effectiveConfig, maxSteps };
    }

    // Construct the user query for the agent
    let fullQuery = '';
    if (incidentId) {
        fullQuery = `Incident ID: ${incidentId}`;
        if (target) fullQuery += `\nTarget: ${target}`;
        if (timeRange) fullQuery += `\nTime Range: ${timeRange}`;
    } else {
        fullQuery = `Target: ${target}\nTime Range: ${timeRange}`;
    }
    if (correlationId) fullQuery += `\nCorrelation ID: ${correlationId}`;
    if (category) fullQuery += `\nCategory: ${category}`;
    fullQuery += `\n\nUser Question/Context: ${query || (incidentId ? 'Investigate this incident. Extract context and route to the correct investigation guide.' : 'Start general investigation based on provided context.')}`;

    if (!activeLlmProvider) {
        throw new Error('No LLM provider configured. Update settings to configure an LLM provider.');
    }

    const runner = new AgentRunner(effectiveConfig, activeLlmProvider, {
        query: fullQuery,
        target,
        timeRange,
        correlationId,
        category,
        incidentId,
        model: model || effectiveConfig.model,
        productId,
        source: source || 'manual',
        scheduleId,
        title,
        createdBy: createdBy || (source === 'scheduled' ? 'scheduler' : undefined),
    });

    const id = (runner as any).state.id;
    runners.set(id, runner);
    attachRunnerListeners(runner, id);
    invalidateListCache();

    // Start asynchronously
    runner.start(fullQuery).then(() => {
        const finalState = (runner as any).state;
        history.set(id, finalState);
        invalidateListCache();

        if (finalState.status === 'completed' || finalState.status === 'failed' || finalState.status === 'aborted') {
            cleanupRunner(id);
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
        cleanupRunner(id);
        invalidateListCache();
    });

    return { id, runner };
}

app.post('/api/investigations', async (req, res) => {
    const { query, target, timeRange, correlationId, category, incidentId, model, productId, title, createdBy } = req.body;

    // Resolve createdBy: use provided value, fall back to OS username
    let resolvedCreatedBy = createdBy;
    if (!resolvedCreatedBy) {
        resolvedCreatedBy = os.userInfo().username;
    }

    // Validate required fields - target and timeRange are optional when incidentId is provided
    if (!incidentId) {
        if (!target || typeof target !== 'string') {
            return res.status(400).json({ error: 'target is required and must be a string (or provide incidentId)' });
        }
        if (!timeRange || typeof timeRange !== 'string') {
            return res.status(400).json({ error: 'timeRange is required and must be a string (or provide incidentId)' });
        }
    }

    // Enforce max concurrent investigations (only count manual/non-temporary); 0 = unlimited
    if (config.maxConcurrentInvestigations > 0) {
        const runningCount = Array.from(runners.values()).filter(r => !(r as any)._isTemporary && (r as any).state.status === 'running').length;
        if (runningCount >= config.maxConcurrentInvestigations) {
            return res.status(429).json({ error: `Maximum concurrent investigations (${config.maxConcurrentInvestigations}) reached. Wait for one to complete or pause an active investigation.` });
        }
    }

    try {
        const { id } = createInvestigation({ query, target, timeRange, correlationId, category, incidentId, model, productId, title, createdBy: resolvedCreatedBy });
        res.json({ id, status: 'running' });
    } catch (err: any) {
        return res.status(400).json({ error: err.message });
    }
});

app.get('/api/investigations', (req, res) => {
    try {
    // ── Parse pagination & filter query params ──────────────────────
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 12));
    const sortOrder = (['newest', 'oldest', 'steps', 'modified'] as const).includes(req.query.sortOrder as any)
        ? (req.query.sortOrder as 'newest' | 'oldest' | 'steps' | 'modified')
        : 'newest';
    const filterStatus = req.query.filter as string || 'all';
    const filterProduct = req.query.productFilter as string || 'all';
    const filterSource = req.query.sourceFilter as string || 'all';
    const filterTag = req.query.tagFilter as string || 'all';
    const filterCreatedBy = req.query.createdByFilter as string || 'all';
    const searchQuery = (req.query.search as string || '').toLowerCase();
    const pinnedIdsParam = req.query.pinnedIds as string || '';
    const pinnedIds = new Set(pinnedIdsParam ? pinnedIdsParam.split(',') : []);

    // ── Build cache key from all params ─────────────────────────────
    const cacheKey = `${page}:${pageSize}:${sortOrder}:${filterStatus}:${filterProduct}:${filterSource}:${filterTag}:${filterCreatedBy}:${searchQuery}:${pinnedIdsParam}`;

    // Check if any runners are active — if so, always rebuild (state changes constantly)
    const hasActiveRunners = Array.from(runners.values()).some(r => (r as any).state?.status === 'running');

    // If no active runners and cache is valid for this exact query, use cached response
    if (!hasActiveRunners && cachedListJson && cachedListEtag && cachedListCacheKey === cacheKey) {
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag === cachedListEtag) {
            return res.status(304).end();
        }
        res.setHeader('ETag', cachedListEtag);
        res.setHeader('Content-Type', 'application/json');
        return res.send(cachedListJson);
    }

    // Filter out runners with undefined/null state
    const active = Array.from(runners.values())
        .map(r => (r as any).state)
        .filter((s): s is InvestigationState => s != null)
        .filter(s => shouldIncludeInvestigationInList(s));
    const past = Array.from(history.values())
        .filter(p => !runners.has(p.id))
        .filter(p => hasPersistedInvestigationState(p))
        .filter(p => shouldIncludeInvestigationInList(p));
    const all = [...active, ...past];

    // Create a product name lookup map
    const productMap = new Map<string, string>();
    (config.products || []).forEach((p: Product) => productMap.set(p.id, p.name));

    // ── Collect filter metadata and stats from raw data (lightweight) ──
    const productsSet = new Map<string, string>();
    const tagsSet = new Set<string>();
    const creatorsSet = new Set<string>();
    const statusCounts: Record<string, number> = { running: 0, paused: 0, completed: 0, failed: 0, aborted: 0 };
    let resolvedCount = 0, completedKpi = 0, contestedCount = 0, contestableCount = 0;
    const durations: number[] = [];
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const dayOfWeek = todayStart.getDay();
    const weekStart = todayStart.getTime() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * dayMs;
    const lastWeekStart = weekStart - 7 * dayMs;
    let thisWeekCount = 0, lastWeekCount = 0;

    for (const s of all) {
        if (!s || !s.id) continue;
        const source = s.source || 'manual';
        if (source === 'scheduled') continue; // exclude scheduled from stats
        const pName = s.productId ? productMap.get(s.productId) || 'Unknown' : '';
        if (s.productId && pName) productsSet.set(s.productId, pName);
        for (const t of (s.tags || [])) tagsSet.add(t);
        if (s.createdBy) creatorsSet.add(s.createdBy);
        if (s.status in statusCounts) statusCounts[s.status]++;
        const isActive = runners.has(s.id);
        const lastMod = isActive ? now : ((s as any)._lastModified || Number(s.id) || now);
        if (s.status === 'completed' || s.status === 'failed' || s.status === 'aborted') {
            resolvedCount++;
            if (s.status === 'completed') completedKpi++;
        }
        if ((s.status === 'completed' || s.status === 'failed') && lastMod && !isNaN(Number(s.id))) {
            const d = lastMod - Number(s.id);
            if (d > 0 && d < dayMs) durations.push(d);
        }
        if (s.status === 'completed' || s.status === 'failed') {
            contestableCount++;
            if ((s.contestCount ?? 0) > 0) contestedCount++;
        }
        const ts = Number(s.id);
        if (!isNaN(ts)) {
            if (ts >= weekStart) thisWeekCount++;
            else if (ts >= lastWeekStart) lastWeekCount++;
        }
    }

    const filterMeta = {
        products: Array.from(productsSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        tags: Array.from(tagsSet).sort(),
        creators: Array.from(creatorsSet).sort(),
    };

    const stats = {
        total: all.filter(s => (s.source || 'manual') !== 'scheduled').length,
        ...statusCounts,
        successRate: resolvedCount > 0 ? Math.round((completedKpi / resolvedCount) * 100) : 0,
        resolvedCount,
        avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        durationSamples: durations.length,
        thisWeekCount,
        lastWeekCount,
        contestRate: contestableCount > 0 ? Math.round((contestedCount / contestableCount) * 100) : 0,
        contestableCount,
    };

    // ── Pre-filter raw data before building summaries ──
    let preFiltered: typeof all = all;
    if (filterSource === 'all') {
        preFiltered = preFiltered.filter(s => (s.source || 'manual') !== 'scheduled');
    } else {
        preFiltered = preFiltered.filter(s => (s.source || 'manual') === filterSource);
    }
    if (filterStatus !== 'all') preFiltered = preFiltered.filter(s => s.status === filterStatus);
    if (filterProduct !== 'all') preFiltered = preFiltered.filter(s => s.productId === filterProduct);
    if (filterTag !== 'all') preFiltered = preFiltered.filter(s => (s.tags || []).includes(filterTag));
    if (filterCreatedBy !== 'all') preFiltered = preFiltered.filter(s => (s.createdBy || '') === filterCreatedBy);

    // Build lightweight summaries only for items passing non-search filters
    const summaries: any[] = [];
    for (const s of preFiltered) {
        try {
        if (!s || !s.id) continue; // skip invalid entries
        // For active runners, lastModified is now; for history, use file mtime or fall back to creation time
        const isActive = runners.has(s.id);
        const lastModified = isActive ? Date.now() : ((s as any)._lastModified || Number(s.id) || Date.now());
        // Use cached storage path or compute and cache it
        let storagePath = storagePathCache.get(s.id) || (s as StoredInvestigationState)._storagePath;
        if (!storagePath) {
            storagePath = getInvestigationStoragePath(s);
            storagePathCache.set(s.id, storagePath);
        }
        // Extract last thought as a plain string preview (avoid serializing large objects)
        // Use fullHistory when available for accurate count and latest thought
        const stored = s as StoredInvestigationState;
        const allThoughts = stored._summaryOnly
            ? (Array.isArray(s.thoughts) ? s.thoughts : [])
            : getThoughtSource(s);
        const lastThought = allThoughts.length > 0 ? allThoughts[allThoughts.length - 1] : undefined;
        const thoughtPreview = getThoughtPreview(lastThought);
        const thoughtCount = stored._summaryOnly
            ? (stored._thoughtCount ?? allThoughts.length)
            : allThoughts.length;
        summaries.push({
        id: s.id,
        status: s.status,
        title: s.title || '',
        query: s.query || '',
        target: s.target || '',
        timeRange: s.timeRange,
        correlationId: s.correlationId,
        category: s.category || '',
        incidentId: s.incidentId || '',
        model: s.model,
        productId: s.productId,
        productName: s.productId ? productMap.get(s.productId) || 'Unknown' : '',
        storagePath,
        tags: s.tags || [],
        source: s.source || 'manual',
        scheduleId: s.scheduleId,
        verdict: s.verdict,
        contestCount: s.contestCount ?? 0,
        createdBy: s.createdBy || '',
        pausedAt: s.pausedAt,
        totalPausedTime: s.totalPausedTime,
        lastModified,
        thoughts: thoughtPreview ? [thoughtPreview] : [],
        thoughtCount, // Actual count for stale detection & step bar (includes pre-compaction entries)
        actions: [],
        logs: [],
        retrospect: s.retrospect ? {
            messages: [],
            proposals: (s.retrospect.proposals || []).map((p: any) => ({ id: p.id, status: p.status })),
            analysisComplete: s.retrospect.analysisComplete,
            analysisFailed: s.retrospect.analysisFailed,
            completed: s.retrospect.completed
        } : undefined
    });
        } catch (itemErr) {
            console.error(`Failed to build summary for investigation ${s?.id}:`, itemErr);
        }
    }

    // ── Apply search filter on summaries (other filters already pre-applied) ──
    let filtered = summaries;
    if (searchQuery) {
        filtered = filtered.filter(s => {
            return (
                s.title.toLowerCase().includes(searchQuery) ||
                s.query.toLowerCase().includes(searchQuery) ||
                s.target.toLowerCase().includes(searchQuery) ||
                s.category.toLowerCase().includes(searchQuery) ||
                s.incidentId.toLowerCase().includes(searchQuery) ||
                s.productName.toLowerCase().includes(searchQuery) ||
                s.tags.some((t: string) => t.toLowerCase().includes(searchQuery)) ||
                s.createdBy.toLowerCase().includes(searchQuery) ||
                s.id.toLowerCase().includes(searchQuery) ||
                s.thoughts.some((t: string) => typeof t === 'string' && t.toLowerCase().includes(searchQuery))
            );
        });
    }

    // ── Apply server-side sort ──────────────────────────────────────
    // Pinned first, then running/paused, then by sort order
    filtered.sort((a: any, b: any) => {
        const aPinned = pinnedIds.has(a.id);
        const bPinned = pinnedIds.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        const aActive = a.status === 'running' || a.status === 'paused';
        const bActive = b.status === 'running' || b.status === 'paused';
        if (aActive !== bActive) return aActive ? -1 : 1;
        if (sortOrder === 'oldest') return a.id.localeCompare(b.id);
        if (sortOrder === 'steps') return b.thoughtCount - a.thoughtCount;
        if (sortOrder === 'modified') return b.lastModified - a.lastModified;
        return b.id.localeCompare(a.id); // newest
    });

    // ── Paginate ────────────────────────────────────────────────────
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const startIdx = (clampedPage - 1) * pageSize;
    const items = filtered.slice(startIdx, startIdx + pageSize);

    const envelope = {
        items,
        totalCount,
        page: clampedPage,
        pageSize,
        totalPages,
        filterMeta,
        stats,
    };

    const json = JSON.stringify(envelope);

    // Cache the response when no runners are active
    if (!hasActiveRunners) {
        cachedListJson = json;
        cachedListEtag = `"${listCacheDirtyAt || Date.now()}"`;
        cachedListCacheKey = cacheKey;
        res.setHeader('ETag', cachedListEtag);
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(json);
    } catch (err: any) {
        console.error('GET /api/investigations failed:', err);
        res.status(500).json({ error: 'Failed to list investigations', details: sanitizedError(err) });
    }
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
    const lightweightState = { ...state, storagePath: getInvestigationStoragePath(state) };

    // Use fullHistory (uncompacted) for the UI when available, falling back to thoughts
    const sourceThoughts = (state.fullHistory && state.fullHistory.length > 0)
        ? state.fullHistory
        : state.thoughts;
    const sourceActions = (state.fullActions && state.fullActions.length > 0)
        ? state.fullActions
        : state.actions;

    // Truncate thoughts > 500 chars
    lightweightState.thoughts = sourceThoughts.map((t: any) => {
        if (typeof t === 'string') {
            if (t.length > 500) {
                return {
                    role: 'assistant',
                    content: t.substring(0, 500) + '...',
                    _truncated: true,
                    _original_type: 'string'
                };
            }
            return t;
        }
        // Object thought — truncate the .content field directly, preserving role and structure
        const textContent = typeof t.content === 'string' ? t.content : JSON.stringify(t, null, 2);
        if (textContent.length > 500) {
            return {
                ...t,
                content: textContent.substring(0, 500) + '...',
                _truncated: true,
                _original_type: 'object'
            };
        }
        return t;
    });

    // Truncate action results > 500 chars
    lightweightState.actions = sourceActions.map((a: any) => {
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

    // Don't send the raw fullHistory/fullActions to the client — they're already
    // surfaced via lights.thoughts/actions above, and sending both would double the payload.
    lightweightState.fullHistory = undefined;
    lightweightState.fullActions = undefined;

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

    // Use fullHistory for step details when available
    const thoughts = (state.fullHistory && state.fullHistory.length > 0)
        ? state.fullHistory
        : state.thoughts;
    const actions = (state.fullActions && state.fullActions.length > 0)
        ? state.fullActions
        : state.actions;

    if (isNaN(index) || index < 0 || index >= thoughts.length) {
        return res.status(400).json({ error: 'Invalid step index' });
    }

    const thought = thoughts[index];
    const action = actions[index];

    res.json({ thought, action });
});

app.post('/api/investigations/:id/action', async (req, res) => {
    invalidateListCache();
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
            runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            runners.set(id, runner);
            attachRunnerListeners(runner, id);

            runner.resume(); // Ensure status is updated to 'running'

            // Re-link to schedule if this is a scheduled investigation
            if (state.scheduleId && scheduleStore) {
                scheduleStore.update(state.scheduleId, { activeInvestigationId: id });
            }

            // Restart execution loop
            // Use stored query or default
            const query = state.query || "Resume investigation";
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
            }).catch(err => {
                console.error(`Runner ${id} failed:`, err);
            }).finally(() => {
                // Guaranteed: save state and cleanup
                history.set(id, (runner as any).state);
                cleanupRunner(id);
            });

            runner.log(`Resuming investigation ${id} from disk...`);
        } else if (action === 'pause') {
            // Runner already stopped, just update status in history
            state.status = 'paused';
            history.set(id, state);
            // Persist to disk
            const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            try {
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist pause for ${id}:`, e.message);
            } finally {
                tempRunner.dispose();
            }
            return res.json({ status: 'ok' });
        } else if (action === 'abort') {
            state.status = 'aborted';
            history.set(id, state);
            // Persist to disk
            const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            try {
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist abort for ${id}:`, e.message);
            } finally {
                tempRunner.dispose();
            }
            return res.json({ status: 'ok' });
        } else if (action === 'intervene' && message) {
            // Runner stopped, but we can append the intervention to history so it's seen on resume
            state.thoughts.push({ role: 'user', content: `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)` });
            history.set(id, state);
            // Persist to disk
            const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            try {
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist intervention for ${id}:`, e.message);
            } finally {
                tempRunner.dispose();
            }
            return res.json({ status: 'ok' });
        } else if (action === 'contest' && message) {
            if (state.status !== 'completed') {
                return res.status(400).json({ error: 'Can only contest a completed investigation.' });
            }
            // Guard against double-contest race condition
            if (runners.has(id)) {
                return res.json({ status: 'ok', message: 'Already contesting' });
            }
            runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            runners.set(id, runner);
            attachRunnerListeners(runner, id);

            runner.contestReport(message);

            // Restart execution loop with the original query
            const query = state.query || 'Resume investigation';
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
            }).catch(err => {
                console.error(`Runner ${id} failed after contest:`, err);
            }).finally(() => {
                history.set(id, (runner as any).state);
                cleanupRunner(id);
            });

            runner.log(`Investigation ${id} contested and resumed from disk...`);
            return res.json({ status: 'ok' });
        } else {
            return res.status(400).json({ error: 'Runner not active. Use resume to restart.' });
        }
    }

    if (!runner) return res.status(404).json({ error: 'Runner not found' });

    if (action === 'pause') runner.pause();
    if (action === 'resume') {
        runner.resume();
        // Re-link to schedule if this is a scheduled investigation
        const st = (runner as any).state as InvestigationState;
        if (st?.scheduleId && scheduleStore) {
            scheduleStore.update(st.scheduleId, { activeInvestigationId: id });
        }
    }
    if (action === 'abort') runner.abort();
    if (action === 'intervene' && message) {
        runner.intervene(message);
    }
    if (action === 'contest' && message) {
        try {
            runner.contestReport(message);

            // Restart the execution loop — the previous loop has already exited
            // after the 'finish' tool's break. Without this, the investigation
            // would be stuck in 'running' status with no active loop.
            const query = (runner as any).state.query || 'Resume investigation';
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
                const finalStatus = (runner as any).state.status;
                if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'aborted') {
                    cleanupRunner(id);
                }
            }).catch(err => {
                console.error(`Runner ${id} failed after contest:`, err);
                history.set(id, (runner as any).state);
                cleanupRunner(id);
            }).finally(() => {
                invalidateListCache();
            });

            runner.log(`Investigation ${id} contested and resumed...`);
        } catch (e: any) {
            return res.status(400).json({ error: e.message });
        }
    }

    res.json({ status: 'ok' });
});

// Resume all paused investigations in one call
app.post('/api/investigations/resume-all', async (req, res) => {
    try {
    invalidateListCache();
    const paused: string[] = [];
    for (const [id, state] of history.entries()) {
        if (state.status === 'paused' && !runners.has(id)) {
            paused.push(id);
        }
    }

    if (paused.length === 0) {
        return res.json({ resumed: 0, skipped: 0, ids: [] });
    }

    // Respect maxConcurrentInvestigations — count currently running; 0 = unlimited
    const currentlyRunning = Array.from(runners.values()).filter(r => (r as any).state?.status === 'running').length;
    const slotsAvailable = config.maxConcurrentInvestigations === 0
        ? paused.length
        : Math.max(0, config.maxConcurrentInvestigations - currentlyRunning);

    const toResume = paused.slice(0, slotsAvailable);
    const skipped = paused.length - toResume.length;
    const resumed: string[] = [];

    for (const id of toResume) {
        try {
            const state = history.get(id)!;
            const runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
            runners.set(id, runner);
            attachRunnerListeners(runner, id);
            runner.resume();

            const query = state.query || 'Resume investigation';
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
            }).catch(err => {
                console.error(`Runner ${id} failed:`, err);
            }).finally(() => {
                history.set(id, (runner as any).state);
                cleanupRunner(id);
            });

            runner.log(`Resuming investigation ${id} (bulk resume-all)...`);
            resumed.push(id);
        } catch (e: any) {
            console.error(`Failed to resume ${id}:`, e.message);
        }
    }

    console.log(`Resume-all: ${resumed.length} resumed, ${skipped} skipped (max concurrent: ${config.maxConcurrentInvestigations})`);
    res.json({ resumed: resumed.length, skipped, ids: resumed });
    } catch (err: any) {
        console.error('POST /api/investigations/resume-all failed:', err);
        res.status(500).json({ error: 'Failed to resume investigations', details: sanitizedError(err) });
    }
});

// Graceful server restart — in-process reload of config, providers, and state
app.post('/api/server/restart', (req, res) => {
    try {
    console.log('Server restart requested via API. Performing in-process restart...');
    invalidateListCache();

    // 1. Pause all running investigations, save state, and dispose resources
    for (const [id, runner] of runners.entries()) {
        try {
            runner.pause();
            history.set(id, (runner as any).state);
            console.log(`  Paused runner ${id} before restart.`);
        } catch (e: any) {
            console.error(`  Failed to pause runner ${id}:`, e.message);
        }
    }
    for (const id of [...runners.keys()]) {
        cleanupRunner(id);
    }
    storagePathCache.clear();

    // 2. Reload config from disk
    try {
        const loaded = loadConfigFromDisk(configFile, config, configFileDir);
        config = loaded.config;
        persistedConfig = loaded.persistedConfig;
        console.log('  Config reloaded from disk.');
    } catch (e: any) {
        console.error('  Failed to reload config:', e.message);
    }

    // 3. Reinitialize providers
    initializeProviders();

    // 4. Reload investigation history
    loadHistory();

    // 5. Reinitialize scheduler
    if (scheduler) {
        try { scheduler.stop(); } catch { /* ignore */ }
    }
    initScheduler();

    console.log('In-process restart complete.');
    res.json({ status: 'restarted' });
    } catch (err: any) {
        console.error('Server restart failed:', err);
        res.status(500).json({ error: 'Restart failed', details: sanitizedError(err) });
    }
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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
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
            cleanupRunner(id); // Clean up
            invalidateListCache();
        }
        res.json({ success: true });
    } catch (e: any) {
        if (isTemporary) cleanupRunner(id); // Clean up on error too
        res.status(500).json({ error: sanitizedError(e) });
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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
        attachRunnerListeners(runner, id);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    // If reset flag is set, clear analysisComplete so it re-runs
    if (reset) {
        runner.resetRetrospectiveAnalysis();
    }

    // Return 202 immediately — analysis runs in the background.
    // Progress is streamed via WebSocket 'retrospect' events; the HTTP response
    // staying open for 10–30 min would be killed by the browser (ERR_CONNECTION_RESET).
    res.status(202).json({ success: true, message: 'Analysis started' });

    // Fire-and-forget: run asynchronously and clean up temp runner when done
    runner.runRetrospectiveAnalysis().then(async () => {
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
        }
        invalidateListCache();
    }).catch((e: any) => {
        console.error(`[retrospect/analyze] Unhandled error for ${id}:`, e.message);
    }).finally(() => {
        if (isTemporary) cleanupRunner(id);
    });
});

// --- Update investigation title ---
app.patch('/api/investigations/:id/title', async (req, res) => {
    invalidateListCache();
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
        const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
        await (tempRunner as any).saveArtifacts();
    } catch (e: any) {
        console.error(`Failed to persist title for ${id}:`, e.message);
    }
    return res.json({ ok: true, title });
});

// --- Update investigation tags ---
app.patch('/api/investigations/:id/tags', async (req, res) => {
    invalidateListCache();
    const { id } = req.params;
    const { tags } = req.body;

    if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string')) {
        return res.status(400).json({ error: 'Tags must be an array of strings' });
    }

    // Deduplicate, trim, and remove empty tags
    const cleanTags = [...new Set(tags.map((t: string) => t.trim()).filter(Boolean))];

    const runner = runners.get(id);
    if (runner) {
        (runner as any).state.tags = cleanTags;
        await (runner as any).saveArtifacts();
        history.set(id, (runner as any).state);
        return res.json({ ok: true, tags: cleanTags });
    }

    const state = history.get(id);
    if (!state) return res.status(404).json({ error: 'Investigation not found' });

    state.tags = cleanTags;
    history.set(id, state);
    try {
        const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
        await (tempRunner as any).saveArtifacts();
    } catch (e: any) {
        console.error(`Failed to persist tags for ${id}:`, e.message);
    }
    return res.json({ ok: true, tags: cleanTags });
});

// --- Delete investigation ---
app.delete('/api/investigations/:id', async (req, res) => {
    invalidateListCache();
    const id = req.params.id;

    // If the investigation is running, abort it first
    const runner = runners.get(id);
    if (runner) {
        const state = (runner as any).state;
        if (state.status === 'running') {
            try {
                (runner as any).abort();
                state.status = 'aborted';
                broadcast(id, 'status', { status: 'aborted' });
            } catch (e: any) {
                console.error(`[Delete] Failed to abort running investigation ${id}:`, e.message);
            }
        }
        cleanupRunner(id);
    }

    const investigation = history.get(id);
    if (!investigation) {
        return res.status(404).json({ error: 'Investigation not found' });
    }

    // Determine the correct investigations directory based on productId
    let investigationsDir = getGlobalInvestigationsDir();
    if (investigation.productId) {
        const product = (config.products || []).find((p: Product) => p.id === investigation.productId);
        if (product && product.investigationsPath) {
            investigationsDir = product.investigationsPath;
        }
    }

    history.delete(id);

    // Remove from disk - folder is named ${timestamp}_${safeTarget}_${safeId}
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
        console.log(`[Delete] Investigation ${id} deleted from disk at ${investigationsDir}.`);
    } catch (e: any) {
        console.error(`[Delete] Failed to delete files for ${id}:`, e.message);
        // Still return success since it's removed from memory
    }

    broadcast(id, 'status', { status: 'deleted' });
    res.json({ ok: true });
});

// --- Export investigation (full state JSON for sharing) ---
app.get('/api/investigations/:id/export', async (req, res) => {
    const id = req.params.id;

    // Try to read the full state from disk (not truncated)
    const investigation = history.get(id) || (runners.has(id) ? (runners.get(id) as any).state as InvestigationState : undefined);
    if (!investigation) {
        return res.status(404).json({ error: 'Investigation not found' });
    }

    // Resolve the investigations directory
    let investigationsDir = getGlobalInvestigationsDir();
    if (investigation.productId) {
        const product = (config.products || []).find((p: Product) => p.id === investigation.productId);
        if (product && product.investigationsPath) {
            investigationsDir = product.investigationsPath;
        }
    }

    // Try to read full state from disk (not truncated like the GET /:id endpoint)
    const safeId = id.replace(/[^a-zA-Z0-9]/g, '');
    let fullState: InvestigationState | null = null;
    try {
        const entries = fs.readdirSync(investigationsDir);
        const match = entries.find(e => e.endsWith(`_${safeId}`));
        if (match) {
            const statePath = path.join(investigationsDir, match, 'state.json');
            if (fs.existsSync(statePath)) {
                fullState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            }
        }
    } catch (e) {
        // Fall back to in-memory state
    }

    const state = fullState || investigation;

    // Build a safe filename from target and date
    const startDate = !isNaN(Number(id)) ? new Date(Number(id)) : new Date();
    const dateStr = startDate.toISOString().split('T')[0];
    const safeTarget = (state.target || 'investigation').replace(/[^a-zA-Z0-9-]/g, '');
    const filename = `${dateStr}_${safeTarget}_${safeId}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(state, null, 2));
});

// --- Import investigation (from shared JSON) ---
app.post('/api/investigations/import', async (req, res) => {
    invalidateListCache();
    const importedState = req.body;

    if (!importedState || typeof importedState !== 'object') {
        return res.status(400).json({ error: 'Request body must be a valid investigation state object' });
    }

    // Validate required fields
    if (!importedState.id && !importedState.status) {
        return res.status(400).json({ error: 'Invalid investigation format: missing required fields (id, status)' });
    }

    // Generate a new ID to avoid collisions
    const originalId = importedState.id;
    const newId = Date.now().toString();

    // Resolve createdBy: preserve from export, fall back to OS username
    let importCreatedBy = importedState.createdBy;
    if (!importCreatedBy) {
        importCreatedBy = os.userInfo().username;
    }

    // Re-map productId to the active product — the source system's productId is meaningless here
    const localProductId = config.activeProductId || importedState.productId;

    const state: InvestigationState = {
        ...importedState,
        id: newId,
        // Force terminal status — imported investigations should never be 'running'
        status: ['completed', 'failed', 'aborted'].includes(importedState.status) ? importedState.status : 'completed',
        createdBy: importCreatedBy,
        productId: localProductId,
    };

    // Add an import note to thoughts
    if (!Array.isArray(state.thoughts)) state.thoughts = [];
    state.thoughts.push(`System: Imported from shared investigation (original ID: ${originalId}) on ${new Date().toISOString()}`);

    // Ensure arrays exist
    if (!Array.isArray(state.actions)) state.actions = [];
    if (!Array.isArray(state.logs)) state.logs = [];

    // Determine investigations directory
    let investigationsDir = getGlobalInvestigationsDir();
    if (localProductId) {
        const product = (config.products || []).find((p: Product) => p.id === localProductId);
        if (product && product.investigationsPath) {
            investigationsDir = product.investigationsPath;
        }
    }

    // Save to disk using the same folder naming pattern as AgentRunner.saveArtifacts()
    let investigationDir: string | undefined;
    try {
        const startDate = new Date(Number(newId));
        const timestamp = startDate.toISOString().split('T')[0];
        const safeTarget = (state.target || 'UnknownTarget').replace(/[^a-zA-Z0-9-]/g, '');
        const safeId = newId.replace(/[^a-zA-Z0-9]/g, '');
        const folderName = `${timestamp}_${safeTarget}_${safeId}`;
        investigationDir = path.join(investigationsDir, folderName);

        ensureDirectoryExists(investigationDir);

        // Save state.json
        const jsonPath = path.join(investigationDir, 'state.json');
        const tmpPath = jsonPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
        fs.renameSync(tmpPath, jsonPath);

        // Save report.md if finalReport exists
        if (state.finalReport) {
            const report = `# Investigation Report: ${newId}\n\n` +
                `**Status**: ${state.status}\n` +
                `**Target**: ${state.target || 'N/A'}\n` +
                `**Model**: ${state.model || 'N/A'}\n` +
                `**Imported**: ${new Date().toLocaleString()}\n` +
                `**Original ID**: ${originalId}\n\n` +
                `## Report\n\n` +
                state.finalReport;
            fs.writeFileSync(path.join(investigationDir, 'report.md'), report);
        }

        console.log(`[Import] Investigation imported as ${newId} (original: ${originalId}) to ${investigationDir}`);
    } catch (e: any) {
        console.error(`[Import] Failed to save to disk:`, e.message);
        // Continue — we'll still add to memory
    }

    // Add to history with storage metadata so the list endpoint can find it
    const storedState = state as StoredInvestigationState;
    if (investigationDir) {
        storedState._storagePath = investigationDir;
        storedState._statePath = path.join(investigationDir, 'state.json');
        storagePathCache.set(newId, investigationDir);
    }
    history.set(newId, storedState);

    // Broadcast so dashboard auto-updates
    broadcast(newId, 'status', { status: state.status });

    res.json({ ok: true, id: newId });
});

// --- Export investigation as PDF ---
app.get('/api/investigations/:id/pdf', async (req, res) => {
    const id = req.params.id;
    let state: InvestigationState | undefined;

    if (runners.has(id)) {
        state = (runners.get(id) as any).state;
    } else if (history.has(id)) {
        state = history.get(id);
    }

    if (!state) {
        return res.status(404).json({ error: 'Investigation not found' });
    }

    if (!state.finalReport) {
        return res.status(400).json({ error: 'No final report available for this investigation. The investigation must be completed first.' });
    }

    // Resolve product name for metadata
    let productName: string | undefined;
    if (state.productId) {
        const product = (config.products || []).find((p: Product) => p.id === state!.productId);
        if (product) productName = product.name;
    }

    try {
        const pdfBuffer = await renderPdf(state.finalReport, {
            id: state.id,
            status: state.status,
            target: state.target,
            timeRange: state.timeRange,
            category: state.category,
            model: state.model,
            correlationId: state.correlationId,
            incidentId: state.incidentId,
            productName,
            contestCount: state.contestCount,
        });

        const startDate = !isNaN(Number(id)) ? new Date(Number(id)) : new Date();
        const dateStr = startDate.toISOString().split('T')[0];
        const safeTarget = (state.target || 'investigation').replace(/[^a-zA-Z0-9-]/g, '');
        const safeId = id.replace(/[^a-zA-Z0-9]/g, '');
        const filename = `${dateStr}_${safeTarget}_${safeId}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
    } catch (e: any) {
        console.error(`[PDF] Failed to generate PDF for ${id}:`, e.message);
        res.status(500).json({ error: sanitizedError(e, 'PDF generation failed') });
    }
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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    const updated = runner.updateProposalStatus(proposalId, status);
    if (!updated) {
        if (isTemporary) cleanupRunner(id);
        return res.status(404).json({ error: 'Proposal not found' });
    }

    if (isTemporary) {
        history.set(id, (runner as any).state);
        await (runner as any).saveArtifacts();
        cleanupRunner(id);
    } else {
        await (runner as any).saveArtifacts();
    }
    invalidateListCache();

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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
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
            cleanupRunner(id);
        } else {
            await (runner as any).saveArtifacts();
        }
        invalidateListCache();
        broadcast(id, 'retrospect', retro);
        res.json({ success: true, retrospect: retro });
    } catch (e: any) {
        if (isTemporary) cleanupRunner(id);
        res.status(500).json({ error: sanitizedError(e) });
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
        res.status(500).json({ error: sanitizedError(e) });
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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
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
            cleanupRunner(id);
        }
        invalidateListCache();
        res.json(result);
    } catch (e: any) {
        if (isTemporary) cleanupRunner(id);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

// --- Get recommendations (cached from investigation completion, or parse on demand) ---
app.get('/api/investigations/:id/recommendations', async (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);
    const state = runner ? (runner as any).state : history.get(id);

    if (!state) return res.status(404).json({ error: 'Investigation not found' });

    // Return cached recommendations if available
    if (state.recommendations && state.recommendations.length > 0) {
        return res.json(state.recommendations);
    }

    const finalReport = state.finalReport;
    if (!finalReport) return res.json([]);

    // Use LLM to extract and classify recommendations in one pass
    const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
    try {
        const recommendations = await tempRunner.extractRecommendations(finalReport);
        // Cache in state for next load
        state.recommendations = recommendations;
        res.json(recommendations);
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to extract recommendations' });
    } finally {
        tempRunner.dispose();
    }
});

// --- Force re-extract and re-classify recommendations ---
app.post('/api/investigations/:id/recommendations/reclassify', async (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);
    const state = runner ? (runner as any).state : history.get(id);

    if (!state) return res.status(404).json({ error: 'Investigation not found' });
    if (!state.finalReport) return res.json([]);

    // Re-extract from scratch (ignores cache)
    const tempRunner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
    try {
        const recommendations = await tempRunner.extractRecommendations(state.finalReport);
        state.recommendations = recommendations;
        res.json(recommendations);
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to extract recommendations' });
    } finally {
        tempRunner.dispose();
    }
});

// --- Run implementation agent for selected recommendations ---
app.post('/api/investigations/:id/implement', async (req, res) => {
    const id = req.params.id;
    const { recommendations } = req.body;

    if (!recommendations || !Array.isArray(recommendations) || recommendations.length === 0) {
        return res.status(400).json({ error: 'At least one recommendation ID is required' });
    }

    let runner = runners.get(id);
    let isTemporary = false;

    if (!runner && history.has(id)) {
        if (runners.has(id)) return res.status(409).json({ error: 'Concurrent operation in progress' });
        const state = history.get(id)!;
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
        runners.set(id, runner);
        (runner as any)._isTemporary = true;
        isTemporary = true;

        // Wire up SSE events for real-time updates
        runner.on('retrospect', (retro: any) => {
            broadcast(id, 'retrospect', retro);
        });
        runner.on('retrospect-proposal', (proposal: any) => {
            broadcast(id, 'retrospect-proposal', proposal);
        });
        runner.on('retrospect-tool-activity', (activity: any) => {
            broadcast(id, 'retrospect-tool-activity', activity);
        });
    }

    if (!runner) return res.status(404).json({ error: 'Investigation not found' });

    // Return immediately — the agent runs asynchronously
    res.json({ started: true, recommendations: recommendations.length });

    try {
        await runner.runImplementationAnalysis(recommendations);
    } catch (e: any) {
        console.error(`[implement] Error for ${id}:`, e.message);
    } finally {
        if (isTemporary) {
            history.set(id, (runner as any).state);
            await (runner as any).saveArtifacts();
            cleanupRunner(id);
        }
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
        runner = new AgentRunner(getEffectiveConfig(state), activeLlmProvider!, state);
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
            cleanupRunner(id);
        }
        res.json({ success: true });
    } catch (e: any) {
        if (isTemporary) cleanupRunner(id);
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.get('/api/health', async (req, res) => {
    const hasLlm = !!(config.llmProvider && config.llmProvider.type && config.llmProvider.type !== 'none');
    let storageAccessible = false;
    try { await fs.promises.access(config.investigationsPath || '.', fs.constants.W_OK); storageAccessible = true; } catch { /* not accessible */ }
    const mcpConfigured = Array.isArray(config.mcpServers) && config.mcpServers.length > 0;
    res.json({
        status: 'ok',
        components: {
            llmProvider: { configured: hasLlm, type: config.llmProvider?.type || 'none' },
            storage: { accessible: storageAccessible },
            mcpServers: { configured: mcpConfigured, count: config.mcpServers?.length || 0 },
        },
        uptime: process.uptime(),
    });
});

// Auth Routes

app.get('/api/auth/status', async (req, res) => {
    if (!activeLlmProvider) {
        return res.json({ authenticated: false, providerType: 'none' });
    }
    const authStatus = await activeLlmProvider.getAuthStatus();
    res.json({
        providerType: config.llmProvider?.type || 'copilot',
        authRequirement: activeLlmProvider.getAuthRequirement(),
        ...authStatus,
    });
});

app.get('/api/auth/providers', (_req, res) => {
    const providers = llmRegistry.listProviders().map((p) => ({
        type: p.type,
        authRequirement: p.authRequirement,
    }));
    res.json(providers);
});

app.post('/api/auth/login', async (req, res) => {
    if (!activeLlmProvider || !activeLlmProvider.startAuthFlow) {
        return res.status(400).json({ error: 'Current LLM provider does not support interactive auth flow' });
    }
    try {
        const data = await activeLlmProvider.startAuthFlow();
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: sanitizedError(e) });
    }
});

app.post('/api/auth/poll', async (req, res) => {
    const { device_code } = req.body;
    if (!activeLlmProvider || !activeLlmProvider.pollAuthFlow) {
        return res.status(400).json({ error: 'Current LLM provider does not support auth polling' });
    }
    try {
        const result = await activeLlmProvider.pollAuthFlow(device_code);
        if (result.pending) {
            return res.json({ pending: true });
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(401).json({ error: e.message });
    }
});

app.post('/api/auth/configure', async (req, res) => {
    const { type, ...providerConfig } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'Provider type is required' });
    }
    try {
        config.llmProvider = { type, ...providerConfig };
        persistedConfig.llmProvider = config.llmProvider;
        saveConfigToDisk();
        initializeProviders();
        res.json({ success: true, providerType: type });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

// Note: /api/models is already defined above (line ~261). This duplicate was removed.

app.get('/api/me', (req, res) => {
    const username = process.env.USERNAME || process.env.USER || 'Unknown User';
    res.json({ username });
});

// MCP Control Routes
app.get('/api/investigations/:id/mcp/status', (req, res) => {
    const id = req.params.id;
    const runner = runners.get(id);

    if (runner) {
        const isConnected = (runner as any).toolManager.isConnected();
        res.json({ connected: isConnected });
    } else if (history.has(id)) {
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
        res.status(500).json({ error: sanitizedError(e) });
    }
});

// ── Scheduled Investigations ─────────────────────────────────────────────

// Determine the base investigations path (global or first product with one)
export function getScheduleInvestigationsPath(): string {
    if (config.investigationsPath) return config.investigationsPath;
    if (config.products?.length > 0) {
        const first = config.products.find(p => p.investigationsPath);
        if (first) return first.investigationsPath;
    }
    return getGlobalInvestigationsDir();
}

let scheduleStore: ScheduleStore | null = null;
let scheduler: Scheduler | null = null;
let queryBankStore: QueryBankStore | null = null;

/** Extracted so v8 coverage tracks branch-level data reliably across worker merges. */
async function deleteInvestigationFromDisk(investigationId: string): Promise<void> {
    invalidateListCache();
    const runner = runners.get(investigationId);
    if (runner) {
        cleanupRunner(investigationId);
    }
    const investigation = history.get(investigationId);
    if (!investigation) return;

    let investigationsDir = getGlobalInvestigationsDir();
    if (investigation.productId) {
        const product = (config.products || []).find((p: Product) => p.id === investigation.productId);
        if (product && product.investigationsPath) {
            investigationsDir = product.investigationsPath;
        }
    }

    history.delete(investigationId);

    const safeId = investigationId.replace(/[^a-zA-Z0-9]/g, '');
    let dirPath: string | null = null;
    try {
        const entries = fs.readdirSync(investigationsDir);
        const match = entries.find(e => e.endsWith(`_${safeId}`));
        if (match) {
            dirPath = path.join(investigationsDir, match);
        }
    } catch (_e) { /* directory may not exist */ }

    const jsonPath = path.join(investigationsDir, `${investigationId}.json`);
    try {
        if (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
        if (fs.existsSync(jsonPath)) {
            fs.unlinkSync(jsonPath);
        }
    } catch (_e) { /* best-effort cleanup */ }

    broadcast(investigationId, 'status', { status: 'deleted' });
}

export function initScheduler(): void {
    const invPath = getScheduleInvestigationsPath();
    ensureDirectoryExists(invPath);

    scheduleStore = new ScheduleStore(invPath);
    queryBankStore = new QueryBankStore(invPath);
    scheduler = new Scheduler(
        scheduleStore,
        // createInvestigation adapter for Scheduler
        async (params) => {
            const result = createInvestigation(params);
            return { id: result.id };
        },
        // getInvestigationResult adapter for Scheduler
        (investigationId: string) => {
            let state: InvestigationState | undefined;
            if (runners.has(investigationId)) {
                state = (runners.get(investigationId) as any).state;
            } else if (history.has(investigationId)) {
                state = history.get(investigationId);
            }
            if (!state) return undefined;
            return {
                status: state.status,
                verdict: state.verdict,
                finalReport: state.finalReport,
            };
        },
        // deleteInvestigation adapter for Scheduler pruning
        deleteInvestigationFromDisk,
        // listScheduleInvestigations: return IDs for a given scheduleId, newest first
        (scheduleId: string) => {
            const ids: string[] = [];
            for (const [id, state] of history.entries()) {
                if (state.scheduleId === scheduleId) {
                    ids.push(id);
                }
            }
            // IDs are Date.now() timestamps — sort descending (newest first)
            ids.sort((a, b) => Number(b) - Number(a));
            return ids;
        },
        {
            maxConcurrentScheduledInvestigations: config.maxConcurrentScheduledInvestigations,
            scheduledInvestigationMaxSteps: config.scheduledInvestigationMaxSteps,
            scheduledInvestigationRetentionCount: config.scheduledInvestigationRetentionCount,
            globalMaxSteps: config.maxSteps,
            defaultTimeRange: config.defaultTimeRange,
            scheduledReportModel: config.scheduledReportModel,
        },
    );

    // Broadcast schedule updates via WebSocket to all connected clients
    scheduler.on('schedule-update', (data) => {
        // Broadcast to a special 'schedules' channel
        const clientSet = clients.get('schedules');
        if (clientSet) {
            clientSet.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'schedule-update', data }));
                }
            });
        }
    });

    // Wire LLM provider for AI-enhanced executive reports
    if (activeLlmProvider) {
        scheduler.setLlmProvider(activeLlmProvider);
    }

    // Auto-start if any schedules are enabled
    const enabledCount = scheduleStore.getAll().filter(s => s.enabled).length;
    if (enabledCount > 0) {
        scheduler.start();
        console.log(`[Scheduler] Auto-started with ${enabledCount} enabled schedule(s).`);
    }
}

// Schedule CRUD endpoints
app.get('/api/schedules', (req, res) => {
    if (!scheduleStore) return res.json({ items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 1 });

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 12));

    // Auto-settle any schedules with stale activeInvestigationId
    const schedules = scheduleStore.getAll();
    for (const sched of schedules) {
        // ── Fix already-settled verdicts that became stale ──
        // e.g. 'error' → 'paused' (legacy), or 'paused' → 'completed' (investigation resumed)
        if (!sched.activeInvestigationId && sched.lastInvestigationId) {
            const inv = history.get(sched.lastInvestigationId);
            if (inv && ['paused', 'completed', 'failed', 'aborted'].includes(inv.status)) {
                const actualVerdict = inv.verdict || (inv.status === 'paused' ? 'paused' : inv.status === 'completed' ? 'completed' : 'error');
                if (actualVerdict !== sched.lastVerdict) {
                    scheduleStore.update(sched.id, { lastVerdict: actualVerdict });
                }
            }
            continue;
        }

        if (!sched.activeInvestigationId) continue;

        // Check the actual investigation status
        let state: InvestigationState | undefined;
        if (runners.has(sched.activeInvestigationId)) {
            state = (runners.get(sched.activeInvestigationId) as any).state;
        } else if (history.has(sched.activeInvestigationId)) {
            state = history.get(sched.activeInvestigationId);
        }

        if (!state) {
            // Investigation not found at all — clean up the stale reference
            scheduleStore.update(sched.id, {
                activeInvestigationId: undefined,
                lastVerdict: sched.lastVerdict || 'error',
            });
        } else if (['paused', 'completed', 'failed', 'aborted'].includes(state.status)) {
            // Investigation is in a terminal state — settle it now
            const verdict = state.status === 'paused'
                ? (state.verdict || 'paused')   // hit max steps — not an error
                : (state.verdict || 'error');

            // Also write history entry if the Scheduler missed settlement
            const existingHistory = scheduleStore.getHistory(sched.id);
            if (!existingHistory.some(e => e.investigationId === sched.activeInvestigationId)) {
                scheduleStore.appendHistory(sched.id, {
                    timestamp: new Date().toISOString(),
                    verdict,
                    investigationId: sched.activeInvestigationId,
                    summary: state.finalReport?.substring(0, 2000),
                });
            }

            scheduleStore.update(sched.id, {
                activeInvestigationId: undefined,
                lastVerdict: verdict,
            });
        }
    }

    const allSchedules = scheduleStore.getAll();
    const totalCount = allSchedules.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const startIdx = (clampedPage - 1) * pageSize;
    const items = allSchedules.slice(startIdx, startIdx + pageSize).map(s => ({
        ...s,
        historyCount: scheduleStore!.getHistoryCount(s.id),
    }));

    res.json({ items, totalCount, page: clampedPage, pageSize, totalPages });
});

app.post('/api/schedules', async (req, res) => {
    if (!scheduleStore || !scheduler) {
        // Attempt lazy initialization if not yet ready
        try { initScheduler(); } catch (err) { /* ignore */ }
        if (!scheduleStore || !scheduler) {
            return res.status(500).json({ error: 'Scheduler not initialized' });
        }
    }
    const { name, target, query, intervalMinutes, productId, model, maxSteps, timeRange, category, autoEscalate, escalationQuery, enabled } = req.body;
    if (!name || !target || !query) {
        return res.status(400).json({ error: 'name, target, and query are required' });
    }

    // Resolve schedule creator: OS username
    const scheduleCreatedBy = os.userInfo().username;

    const schedule = scheduleStore.create({
        name,
        enabled: enabled !== false,
        target,
        query,
        intervalMinutes: intervalMinutes || 15,
        productId,
        model,
        maxSteps,
        timeRange,
        category,
        autoEscalate: autoEscalate !== false,
        escalationQuery,
        createdBy: scheduleCreatedBy,
    });
    // Start scheduler if not already running and schedule is enabled
    if (schedule.enabled && !scheduler.isRunning()) {
        scheduler.start();
    }
    res.json(schedule);
});

app.put('/api/schedules/:id', (req, res) => {
    if (!scheduleStore) return res.status(500).json({ error: 'Scheduler not initialized' });
    const updated = scheduleStore.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Schedule not found' });
    res.json(updated);
});

app.delete('/api/schedules/:id', (req, res) => {
    if (!scheduleStore) return res.status(500).json({ error: 'Scheduler not initialized' });

    const scheduleId = req.params.id;
    const schedule = scheduleStore.get(scheduleId);

    // Collect ALL investigation IDs belonging to this schedule from both history AND runners
    const investigationIds = new Set<string>();

    // Scan history
    for (const [id, state] of history.entries()) {
        if (state.scheduleId === scheduleId) {
            investigationIds.add(id);
        }
    }

    // Scan runners (may have active investigations not yet in history)
    for (const [id, runner] of runners.entries()) {
        const st = (runner as any).state as InvestigationState | undefined;
        if (st?.scheduleId === scheduleId) {
            investigationIds.add(id);
        }
    }

    // Also include the schedule's activeInvestigationId (safety net)
    if (schedule?.activeInvestigationId) {
        investigationIds.add(schedule.activeInvestigationId);
    }

    for (const invId of investigationIds) {
        // Abort if still running
        const runner = runners.get(invId);
        if (runner) {
            try {
                (runner as any).abort();
                const st = (runner as any).state;
                if (st) st.status = 'aborted';
            } catch (e: any) {
                console.error(`[Delete Schedule] Failed to abort investigation ${invId}:`, e.message);
            }
            cleanupRunner(invId);
        }

        // Determine disk path from history or runner state
        const inv = history.get(invId) || (runner ? (runner as any).state : undefined);
        if (inv) {
            // Delete from disk
            let investigationsDir = getGlobalInvestigationsDir();
            if (inv.productId) {
                const product = (config.products || []).find((p: Product) => p.id === inv.productId);
                if (product && product.investigationsPath) {
                    investigationsDir = product.investigationsPath;
                }
            }
            const safeId = invId.replace(/[^a-zA-Z0-9]/g, '');
            try {
                const entries = fs.readdirSync(investigationsDir);
                const match = entries.find(e => e.endsWith(`_${safeId}`));
                if (match) {
                    fs.rmSync(path.join(investigationsDir, match), { recursive: true, force: true });
                    console.log(`[Delete Schedule] Deleted investigation directory: ${match}`);
                } else {
                    console.warn(`[Delete Schedule] No directory found ending with _${safeId} in ${investigationsDir}`);
                }
            } catch (e: any) {
                console.error(`[Delete Schedule] Failed to delete investigation directory for ${invId}:`, e.message);
            }

            const jsonPath = path.join(investigationsDir, `${invId}.json`);
            if (fs.existsSync(jsonPath)) {
                try { fs.unlinkSync(jsonPath); } catch { /* best effort */ }
            }
        }

        history.delete(invId);
        broadcast(invId, 'status', { status: 'deleted' });
    }

    const deletedCount = investigationIds.size;
    console.log(`[Delete Schedule] Deleted ${deletedCount} related investigation(s) for schedule ${scheduleId}.`);

    const deleted = scheduleStore.delete(scheduleId);
    if (!deleted) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ success: true, deletedInvestigations: deletedCount });
});

app.post('/api/schedules/:id/run-now', async (req, res) => {
    if (!scheduler) return res.status(500).json({ error: 'Scheduler not initialized' });
    try {
        await scheduler.runNow(req.params.id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/schedules/:id/enable', (req, res) => {
    if (!scheduleStore || !scheduler) return res.status(500).json({ error: 'Scheduler not initialized' });
    const updated = scheduleStore.update(req.params.id, { enabled: true });
    if (!updated) return res.status(404).json({ error: 'Schedule not found' });
    if (!scheduler.isRunning()) scheduler.start();
    res.json(updated);
});

app.post('/api/schedules/:id/disable', (req, res) => {
    if (!scheduleStore || !scheduler) return res.status(500).json({ error: 'Scheduler not initialized' });
    const updated = scheduleStore.update(req.params.id, { enabled: false });
    if (!updated) return res.status(404).json({ error: 'Schedule not found' });
    res.json(updated);
});

app.get('/api/schedules/:id/history', (req, res) => {
    if (!scheduleStore) return res.status(500).json({ error: 'Scheduler not initialized' });
    const maxEntries = req.query.maxEntries ? parseInt(req.query.maxEntries as string, 10) : undefined;
    const entries = scheduleStore.getHistory(req.params.id, maxEntries);

    // Correct stale verdicts by checking actual investigation state
    // e.g. 'error' → 'paused' (legacy), or 'paused' → 'completed' (investigation resumed)
    for (const entry of entries) {
        if (entry.investigationId) {
            const inv = history.get(entry.investigationId);
            if (inv && ['paused', 'completed', 'failed', 'aborted'].includes(inv.status)) {
                const actualVerdict = inv.verdict || (inv.status === 'paused' ? 'paused' : inv.status === 'completed' ? 'completed' : 'error');
                if (actualVerdict !== entry.verdict) {
                    entry.verdict = actualVerdict;
                }
            }
            // Backfill missing summary from actual investigation state
            if (!entry.summary && inv?.finalReport) {
                entry.summary = inv.finalReport.substring(0, 2000);
            }
        }
    }

    res.json(entries);
});

app.get('/api/schedules/:id/report', async (req, res) => {
    if (!scheduleStore) return res.status(500).json({ error: 'Scheduler not initialized' });
    const sched = scheduleStore.getAll().find((s: any) => s.id === req.params.id);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });

    const entries = scheduleStore.getHistory(req.params.id);
    if (entries.length === 0) {
        return res.json({
            scheduleId: req.params.id,
            scheduleName: sched.name,
            totalRuns: 0,
            verdictBreakdown: {},
            successRate: 0,
            trend: 'stable' as const,
            recentSummaries: [],
        });
    }

    // Correct verdicts & backfill summaries (same logic as history endpoint)
    for (const entry of entries) {
        if (entry.investigationId) {
            const inv = history.get(entry.investigationId);
            if (inv && ['paused', 'completed', 'failed', 'aborted'].includes(inv.status)) {
                const actualVerdict = inv.verdict || (inv.status === 'paused' ? 'paused' : inv.status === 'completed' ? 'completed' : 'error');
                if (actualVerdict !== entry.verdict) entry.verdict = actualVerdict;
            }
            if (!entry.summary && inv?.finalReport) {
                entry.summary = inv.finalReport.substring(0, 2000);
            }
        }
    }

    // Verdict breakdown
    const verdictBreakdown: Record<string, number> = {};
    for (const e of entries) {
        verdictBreakdown[e.verdict] = (verdictBreakdown[e.verdict] || 0) + 1;
    }

    // Success rate: healthy + completed = success
    const successCount = (verdictBreakdown['healthy'] || 0) + (verdictBreakdown['completed'] || 0);
    const successRate = Math.round((successCount / entries.length) * 1000) / 10;

    // Trend: compare last 5 vs previous 5 using severity score
    const severityScore = (v: string) => {
        if (v === 'critical') return 4;
        if (v === 'error') return 3;
        if (v === 'warning') return 2;
        if (v === 'paused') return 1;
        return 0; // healthy, completed, unknown
    };
    const sorted = [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let trend: 'improving' | 'degrading' | 'stable' = 'stable';
    if (sorted.length >= 4) {
        const mid = Math.floor(sorted.length / 2);
        const olderHalf = sorted.slice(0, mid);
        const newerHalf = sorted.slice(mid);
        const avgOlder = olderHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / olderHalf.length;
        const avgNewer = newerHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / newerHalf.length;
        if (avgNewer < avgOlder - 0.3) trend = 'improving';
        else if (avgNewer > avgOlder + 0.3) trend = 'degrading';
    }

    // Recent summaries (last 10, newest first)
    const recentSummaries = sorted.slice(-10).reverse().map(e => ({
        timestamp: e.timestamp,
        verdict: e.verdict,
        investigationId: e.investigationId,
        summary: e.summary || undefined,
    }));

    // Time range
    const firstRunAt = sorted[0].timestamp;
    const lastRunAt = sorted[sorted.length - 1].timestamp;

    // Executive summary: read from file, or generate (AI or template) on-demand
    const refresh = req.query.refresh === 'true';
    let executiveSummary = refresh ? null : scheduleStore.getExecutiveReport(req.params.id);

    if (!executiveSummary) {
        // Try AI-enhanced generation first
        if (activeLlmProvider) {
            try {
                executiveSummary = await generateAIExecutiveReport(sched, entries, activeLlmProvider, sched.model || config.scheduledReportModel);
                try { scheduleStore.writeExecutiveReport(req.params.id, executiveSummary); } catch { /* best-effort */ }
            } catch (err: any) {
                console.log(`[Report] AI generation failed for ${sched.name}: ${err.message}, falling back to template`);
            }
        }
        // Template fallback
        if (!executiveSummary) {
            executiveSummary = generateExecutiveReport(sched, entries);
            try { scheduleStore.writeExecutiveReport(req.params.id, executiveSummary); } catch { /* best-effort */ }
        }
    }

    res.json({
        scheduleId: req.params.id,
        scheduleName: sched.name,
        totalRuns: entries.length,
        verdictBreakdown,
        successRate,
        trend,
        firstRunAt,
        lastRunAt,
        recentSummaries,
        executiveSummary,
    });
});

app.post('/api/scheduler/start', (_req, res) => {
    if (!scheduler) return res.status(500).json({ error: 'Scheduler not initialized' });
    scheduler.start();
    res.json({ running: true });
});

app.post('/api/scheduler/stop', (_req, res) => {
    if (!scheduler) return res.status(500).json({ error: 'Scheduler not initialized' });
    scheduler.stop();
    res.json({ running: false });
});

app.get('/api/scheduler/status', (_req, res) => {
    res.json({ running: scheduler?.isRunning() || false });
});

// ── Query Bank ───────────────────────────────────────────────────────────────

app.get('/api/query-bank', (_req, res) => {
    if (!queryBankStore) return res.json([]);
    res.json(queryBankStore.getAll());
});

app.post('/api/query-bank', (req, res) => {
    if (!queryBankStore) return res.status(500).json({ error: 'Query bank not initialized' });
    const { name, target, query, category, correlationId, timeRange, timeMode, model, productId, intervalMinutes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const saved = queryBankStore.create({ name, target, query, category, correlationId, timeRange, timeMode, model, productId, intervalMinutes });
    res.json(saved);
});

app.put('/api/query-bank/:id', (req, res) => {
    if (!queryBankStore) return res.status(500).json({ error: 'Query bank not initialized' });
    const updated = queryBankStore.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Saved query not found' });
    res.json(updated);
});

app.delete('/api/query-bank/:id', (req, res) => {
    if (!queryBankStore) return res.status(500).json({ error: 'Query bank not initialized' });
    const deleted = queryBankStore.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Saved query not found' });
    res.json({ success: true });
});

// Global error handler — catches unhandled errors in route handlers
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`Unhandled error on ${req.method} ${req.url}:`, err);
    if (!res.headersSent) {
        const status = err.status || err.statusCode || 500;
        res.status(status).json({ error: sanitizedError(err) });
    }
});

// SPA fallback: serve index.html for any non-API route (must come after all API routes)
applySpaFallback(app, publicDir);

let serverStarted = false;

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFn = (cmd: string, cb: ExecCallback) => void;

function killProcessOnPort(
    targetPort: number,
    execFn: ExecFn = require('child_process').exec,
    platform: string = process.platform,
    currentPid: number = process.pid,
): Promise<boolean> {
    return new Promise((resolve) => {
        if (platform !== 'win32') {
            resolve(false);
            return;
        }
        execFn(`netstat -ano | findstr :${targetPort} | findstr LISTENING`, (err: Error | null, stdout: string) => {
            if (err || !stdout.trim()) {
                resolve(false);
                return;
            }
            const lines = stdout.trim().split('\n');
            const pids = new Set<string>();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0' && pid !== String(currentPid)) pids.add(pid);
            }
            if (pids.size === 0) {
                resolve(false);
                return;
            }
            console.log('');
            console.log('='.repeat(50));
            console.log('  Previous AI Investigator instance detected');
            console.log('  Shutting it down to start a fresh session...');
            console.log('='.repeat(50));
            console.log('');
            let killed = 0;
            for (const pid of pids) {
                execFn(`taskkill /PID ${pid} /F`, () => {
                    killed++;
                    if (killed === pids.size) resolve(true);
                });
            }
        });
    });
}

const internal = {
    killProcessOnPort,
    openBrowser(targetPort: number, platform: string = process.platform) {
        const url = `http://localhost:${targetPort}`;
        const { exec } = require('child_process');
        // Use --app= mode for a frameless desktop-app window (no address bar, no tabs)
        const cmd = platform === 'win32' ? `start msedge --app=${url}`
            : platform === 'darwin' ? `open -a "Google Chrome" --args --app=${url}`
            : `xdg-open "${url}"`;
        exec(cmd, () => { /* ignore errors */ });
    },
    printKeepOpenMessage(packaged: boolean = isPackaged) {
        if (!packaged) return;
        console.log('');
        console.log('  Press Ctrl+C to shut down.');
        console.log('');
    },
};

export function startServer() {
    if (serverStarted) {
        return server;
    }

    serverStarted = true;

    // Start idle runner eviction timer
    if (!evictionInterval) {
        evictionInterval = setInterval(evictIdleRunners, 60_000);
    }

    server.on('error', async (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            const killed = await internal.killProcessOnPort(port);
            if (killed) {
                console.log('Restarting...\n');
                setTimeout(() => {
                    server.listen(port);
                }, 1000);
            } else {
                console.error(`\nPort ${port} is already in use by another application.`);
                console.error('Please close it and try again.\n');
                process.exit(1);
            }
        } else {
            console.error('Server error:', err);
            process.exit(1);
        }
    });

    server.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        internal.printKeepOpenMessage();
        handleServerStarted();

        // Check for updates on startup (exe mode only)
        if (isPackaged || process.env.NODE_ENV === 'production') {
            getVersionStatus(true).then((status) => {
                if (status.updateAvailable && status.latest) {
                    console.log('');
                    console.log('='.repeat(50));
                    console.log(`  Update available: v${status.current} -> v${status.latest}`);
                    console.log(`  Download: ${status.downloadUrl}`);
                    console.log('='.repeat(50));
                    console.log('');
                }
            }).catch(() => { /* ignore update check failures */ });
        }

        // Auto-open browser in production/exe mode (unless --no-open flag)
        if (!process.argv.includes('--no-open') && (isPackaged || process.env.NODE_ENV === 'production')) {
            internal.openBrowser(port);
        }
    });

    return server;
}

export function handleServerStarted(
    schedulerInitializer: () => void = initScheduler,
    logger: Pick<typeof console, 'error'> = console,
) {
    try {
        schedulerInitializer();
    } catch (err) {
        logger.error('[Scheduler] Failed to initialize:', err);
    }
}

export async function stopServer() {
    if (!serverStarted) {
        return;
    }

    serverStarted = false;
    if (evictionInterval) {
        clearInterval(evictionInterval);
        evictionInterval = null;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

export const __testUtils = {
    app,
    server,
    wss,
    clients,
    broadcastToClients,
    registerWebSocketClient,
    handleUncaughtException,
    handleUnhandledRejection,
    registerProcessErrorHandlers,
    jsonParseErrorHandler,
    resolveConfigFilePath,
    loadConfigFromDisk,
    killProcessOnPort,
    wsHeartbeatCheck,
    internal,
    llmRegistry,
    incidentRegistry,
    SETTINGS_ALLOWED_KEYS,
    evictIdleRunners,
    sanitizedError,
    cleanupRunner,
    getConfig: () => config,
    setConfig: (nextConfig: Partial<typeof config>) => {
        config = { ...config, ...nextConfig };
    },
    getPersistedConfig: () => persistedConfig,
    setPersistedConfig: (nextPersisted: Record<string, any>) => {
        persistedConfig = nextPersisted;
    },
    setActiveLlmProvider: (provider: LlmProvider | null) => {
        activeLlmProvider = provider;
    },
    setActiveIncidentProvider: (provider: IncidentProvider | null) => {
        activeIncidentProvider = provider;
    },
    setScheduleStore: (store: ScheduleStore | null) => {
        scheduleStore = store;
    },
    setScheduler: (value: Scheduler | null) => {
        scheduler = value;
    },
    setQueryBankStore: (store: QueryBankStore | null) => {
        queryBankStore = store;
    },
    getScheduleStore: () => scheduleStore,
    getScheduler: () => scheduler,
    getQueryBankStore: () => queryBankStore,
    getHistory: () => history,
    getRunners: () => runners,
    setListCacheDirtyAt: (value: number) => {
        listCacheDirtyAt = value;
    },
    resetRuntimeState: () => {
        for (const id of [...runners.keys()]) {
            cleanupRunner(id);
        }
        history.clear();
        clients.clear();
        scheduleStore = null;
        scheduler = null;
        queryBankStore = null;
        activeLlmProvider = null;
        activeIncidentProvider = null;
        invalidateListCache();
    },
};

export function shouldAutoStartServer(env: NodeJS.ProcessEnv): boolean {
    return env.VITEST !== 'true';
}

export function autoStartServerIfNeeded(
    env: NodeJS.ProcessEnv,
    starter: () => unknown = startServer,
) {
    if (shouldAutoStartServer(env)) {
        return starter();
    }

    return undefined;
}

autoStartServerIfNeeded(process.env);
