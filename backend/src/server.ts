import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { AgentRunner, InvestigationState } from './agent/Runner';
import { CopilotClient } from './agent/CopilotClient';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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

// Handle JSON parse errors from body-parser gracefully
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === 'entity.parse.failed') {
        console.error(`JSON parse error on ${req.method} ${req.url}:`, err.message);
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    next(err);
});

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
    // Collect all investigation directories to scan
    const dirsToScan: { dir: string; productId?: string }[] = [];
    
    // Add global/default investigations path
    const globalDir = config.investigationsPath || path.join(process.cwd(), 'investigations');
    dirsToScan.push({ dir: globalDir });
    
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
                            const content = fs.readFileSync(statePath, 'utf-8');
                            const state = JSON.parse(content) as InvestigationState;

                            // Force running investigations to pause on server restart
                            if (state.status === 'running') {
                                state.status = 'paused';
                                state.thoughts.push("System: Investigation automatically paused due to server restart.");
                            }

                            // Tag with productId if loaded from a product directory and not already tagged
                            if (productId && !state.productId) {
                                state.productId = productId;
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

                        // Tag with productId if loaded from a product directory and not already tagged
                        if (productId && !state.productId) {
                            state.productId = productId;
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

/**
 * Build the effective AgentConfig for a given investigation state.
 * 
 * When an investigation was created under a specific product, the product's
 * investigationsPath, repoRoot, prompts, etc. must be used when the runner is
 * rehydrated (e.g. for retrospect, resume, compact, save).
 * Without this, the global config (which may have an empty investigationsPath)
 * would be used, causing artifacts to save to the wrong directory.
 */
function getEffectiveConfig(state?: Partial<InvestigationState>): typeof config {
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
// Derive configFile from __dirname (compiled: dist/server.js -> backend/config.json)
// or from process.cwd() as fallback
const configFile = path.join(__dirname, '..', 'config.json');

// Derive a sensible default repoRoot: climb from backend/src/ (dev) or backend/dist/ (prod) to repo root
// Expected layout: <repoRoot>/tools/InvestigationDashboard/backend/src/server.ts (4 levels up)
const defaultRepoRoot = path.resolve(__dirname, '..', '..', '..', '..');

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
    mcpServers: string[];
    maxSteps: number;
    retrospectTimeoutMinutes: number;
    model: string;
    defaultTimeRange: string;
    maxConcurrentInvestigations: number;
    autoRefreshInterval: number;
    workingDirectory: string;
    notifications: boolean;
    investigationsPath: string;
    icmScriptsPath: string; // Internal — resolved automatically, not user-configurable
    products: Product[];
    activeProductId: string;
} = {
    repoRoot: defaultRepoRoot,
    systemPromptPath: '',
    retrospectPromptPath: path.resolve(__dirname, '..', '..', 'prompts', 'RetrospectPrompt.md'),
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
    investigationsPath: '',
    icmScriptsPath: path.resolve(__dirname, '..', '..', 'scripts', 'icm'),
    products: [],
    activeProductId: ''
};

// Load config from disk if exists
try {
    if (fs.existsSync(configFile)) {
        const savedConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        // Internal paths are auto-resolved, not user-configurable — never let saved config override them
        const resolvedIcmScriptsPath = config.icmScriptsPath;
        const resolvedRetrospectPromptPath = config.retrospectPromptPath;
        config = { ...config, ...savedConfig };
        config.icmScriptsPath = resolvedIcmScriptsPath;
        config.retrospectPromptPath = resolvedRetrospectPromptPath;
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
            'repoRoot', 'systemPromptPath', 'knowledgeBasePath',
            'mcpServers', 'maxSteps', 'retrospectTimeoutMinutes', 'model', 'defaultTimeRange',
            'maxConcurrentInvestigations', 'autoRefreshInterval', 'workingDirectory',
            'notifications', 'investigationsPath', 'products', 'activeProductId',
            'theme'
        ]);
        const filtered = Object.fromEntries(
            Object.entries(newSettings).filter(([k]) => ALLOWED_KEYS.has(k))
        );

        config = { ...config, ...filtered };

        const tmpConfigFile = configFile + '.tmp';
        // Exclude internal fields that are auto-resolved and not user-configurable
        const { icmScriptsPath: _icm, retrospectPromptPath: _retro, ...persistableConfig } = config;
        fs.writeFileSync(tmpConfigFile, JSON.stringify(persistableConfig, null, 2));
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
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (e: any) {
        console.error("Failed to set active product:", e);
        res.status(500).json({ error: e.message });
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
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        // Reload history to include investigations from new product directory
        if (newProduct.investigationsPath) {
            console.log(`New product added with investigationsPath: ${newProduct.investigationsPath}. Reloading history...`);
            history.clear();
            loadHistory();
        }
        res.json(newProduct);
    } catch (e: any) {
        console.error("Failed to add product:", e);
        res.status(500).json({ error: e.message });
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
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        // Reload history if investigationsPath changed
        if (updates.investigationsPath && updates.investigationsPath !== oldInvestigationsPath) {
            console.log(`Product investigationsPath changed to ${updates.investigationsPath}. Reloading history...`);
            history.clear();
            loadHistory();
        }
        res.json(config.products[index]);
    } catch (e: any) {
        console.error("Failed to update product:", e);
        res.status(500).json({ error: e.message });
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
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (e: any) {
        console.error("Failed to delete product:", e);
        res.status(500).json({ error: e.message });
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

function validateProductPaths(product: Product): ProductValidation {
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
        res.status(500).json({ error: e.message });
    }
});

// --- Product Discovery & Clone ---

interface InvestigatorManifest {
    name?: string;
    description?: string;
    systemPrompt?: string;
    knowledgeBase?: string;
    workingDirectory?: string;
    investigationsPath?: string;
}

interface DiscoverResult {
    source: 'manifest' | 'auto-discovered' | 'none';
    product: Partial<Product>;
    suggestions: string[];
}

/**
 * Resolve a manifest's relative paths to absolute paths based on repoRoot.
 */
function resolveManifest(repoRoot: string, manifest: InvestigatorManifest): Partial<Product> {
    const abs = (rel?: string) => rel ? path.resolve(repoRoot, rel) : '';
    return {
        name: manifest.name || path.basename(repoRoot),
        repoRoot,
        systemPromptPath: abs(manifest.systemPrompt),
        knowledgeBasePath: abs(manifest.knowledgeBase),
        workingDirectory: abs(manifest.workingDirectory),
        investigationsPath: abs(manifest.investigationsPath),
    };
}

/**
 * Auto-discover product configuration by scanning repo structure for known patterns.
 */
function autoDiscoverProduct(repoRoot: string): { product: Partial<Product>; suggestions: string[] } {
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

    // Look for knowledge base directories
    const kbCandidates = ['docs/telemetry-investigations', 'docs/investigations', 'docs', 'knowledge'];
    for (const candidate of kbCandidates) {
        const full = path.join(repoRoot, candidate);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
            product.knowledgeBasePath = full;
            suggestions.push(`Found knowledge base directory at ${candidate}`);
            break;
        }
    }

    // Look for investigations directory
    const invCandidates = [
        'docs/telemetry-investigations/Investigations/AgentInvestigations',
        'docs/investigations/AgentInvestigations',
        'investigations',
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
    suggestions.push('Working directory defaulted to repo root');

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
        if (suggestions.length > 0) {
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
        res.status(500).json({ error: e.message });
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
        const tmpConfigFile = configFile + '.tmp';
        fs.writeFileSync(tmpConfigFile, JSON.stringify(config, null, 2));
        fs.renameSync(tmpConfigFile, configFile);

        res.json(clonedProduct);
    } catch (e: any) {
        console.error("Failed to clone product:", e);
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

// --- ICM Endpoints -------------------------------------------------------
// ICM scripts are bundled with the dashboard at scripts/icm/
function getIcmScriptsPath(): string {
    return config.icmScriptsPath;
}

app.get('/api/icm/status', (_req, res) => {
    // Check if ICM scripts path is configured and the main script exists
    const scriptsPath = getIcmScriptsPath();
    const scriptFile = path.join(scriptsPath, 'icm-full-read.js');
    if (!fs.existsSync(scriptFile)) {
        return res.json({ available: false, message: `Script not found: ${scriptFile}` });
    }
    res.json({ available: true });
});

app.post('/api/icm/:incidentId/read', async (req, res) => {
    const { incidentId } = req.params;
    const scriptsPath = getIcmScriptsPath();

    const scriptFile = path.join(scriptsPath, 'icm-full-read.js');
    if (!fs.existsSync(scriptFile)) {
        return res.status(400).json({ error: `ICM script not found: ${scriptFile}` });
    }

    // Stream progress events via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        let metadata: any = {};
        let content = '';
        let sections: any = {};

        await new Promise<void>((resolve, reject) => {
            let stderr = '';
            const proc = spawn('node', [scriptFile, incidentId], {
                cwd: scriptsPath,
                timeout: 120000,
                env: { ...process.env }
            });

            proc.stdout.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // Parse structured progress events
                    if (trimmed.startsWith('[PROGRESS] ')) {
                        try {
                            const event = JSON.parse(trimmed.substring(11));
                            res.write(`data: ${JSON.stringify(event)}\n\n`);
                        } catch { /* skip malformed */ }
                        continue;
                    }

                    // Parse structured data events
                    if (trimmed.startsWith('[DATA] ')) {
                        try {
                            const event = JSON.parse(trimmed.substring(7));
                            if (event.key === 'metadata') metadata = event.value;
                            if (event.key === 'content') content = event.value;
                            if (event.key === 'sections') sections = event.value;
                        } catch { /* skip malformed */ }
                        continue;
                    }
                }
            });

            proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ICM script exited with code ${code}: ${stderr}`));
                }
            });
            proc.on('error', (err) => reject(err));
        });

        // Extract time range from metadata
        let timeRange = '';
        const timeSource = metadata.impactingFrom || metadata.created;
        if (timeSource) {
            const parsedDate = new Date(timeSource);
            if (!isNaN(parsedDate.getTime())) {
                const startISO = parsedDate.toISOString();
                const endISO = new Date().toISOString();
                timeRange = `between(datetime(${startISO}) .. datetime(${endISO}))`;
            }
        }

        // Also try to find stamp in content if not in metadata
        const stamp = metadata.stamp || '';
        if (!stamp && content) {
            const stampMatch = content.match(/(oi-tds-[\w-]+|ax-tds-[\w-]+)/i);
            if (stampMatch) metadata.stamp = stampMatch[0];
        }

        // Build summary from the first 500 chars of the summary section
        const summaryText = (sections.summary || content || '').substring(0, 500).trim();

        // Send final result event
        const result = {
            type: 'result',
            incidentId,
            title: metadata.title || `IcM Incident ${incidentId}`,
            severity: metadata.severity || 'Unknown',
            status: metadata.status || '',
            owner: metadata.owner || '',
            owningTeam: metadata.owningTeam || '',
            stamp: metadata.stamp || '',
            timeRange,
            summary: summaryText,
            raw: content
        };
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();

    } catch (err: any) {
        console.error(`[ICM] Failed to read incident ${incidentId}:`, err);
        const errorEvent = { type: 'error', message: err.message || 'Failed to read ICM incident' };
        res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
        res.end();
    }
});
// --- End ICM Endpoints ---------------------------------------------------

app.post('/api/investigations', async (req, res) => {
    const { query, stamp, timeRange, trackingId, issueType, incidentId, model, productId } = req.body;

    // Validate required fields - stamp and timeRange are optional when incidentId is provided
    if (!incidentId) {
        if (!stamp || typeof stamp !== 'string') {
            return res.status(400).json({ error: 'stamp is required and must be a string (or provide incidentId)' });
        }
        if (!timeRange || typeof timeRange !== 'string') {
            return res.status(400).json({ error: 'timeRange is required and must be a string (or provide incidentId)' });
        }
    }

    // Enforce max concurrent investigations
    const runningCount = Array.from(runners.values()).filter(r => !(r as any)._isTemporary && (r as any).state.status === 'running').length;
    if (runningCount >= config.maxConcurrentInvestigations) {
        return res.status(429).json({ error: `Maximum concurrent investigations (${config.maxConcurrentInvestigations}) reached. Wait for one to complete or pause an active investigation.` });
    }

    // Determine which config to use (product-specific or global)
    let effectiveConfig = config;
    if (productId && config.products && config.products.length > 0) {
        const product = config.products.find(p => p.id === productId);
        if (product) {
            // Validate product paths before starting
            const validation = validateProductPaths(product);
            if (!validation.valid) {
                const issues = validation.paths
                    .filter(p => p.error)
                    .map(p => `${p.label}: ${p.error}`)
                    .join('; ');
                return res.status(400).json({
                    error: `Product "${product.name}" has path issues that must be fixed before starting an investigation: ${issues}`,
                    pathErrors: validation.paths.filter(p => p.error)
                });
            }

            // Merge product-specific paths into the config
            effectiveConfig = {
                ...config,
                repoRoot: product.repoRoot || config.repoRoot,
                systemPromptPath: product.systemPromptPath || config.systemPromptPath,
                knowledgeBasePath: product.knowledgeBasePath || config.knowledgeBasePath,
                workingDirectory: product.workingDirectory || config.workingDirectory,
                investigationsPath: product.investigationsPath || config.investigationsPath
            };
        }
    }

    // Construct the user query for the agent
    let fullQuery = '';
    if (incidentId) {
        fullQuery = `IcM Incident ID: ${incidentId}`;
        if (stamp) fullQuery += `\nStamp: ${stamp}`;
        if (timeRange) fullQuery += `\nTime Range: ${timeRange}`;
    } else {
        fullQuery = `Stamp: ${stamp}\nTime Range: ${timeRange}`;
    }
    if (trackingId) fullQuery += `\nTrackingId: ${trackingId}`;
    if (issueType) fullQuery += `\nIssue Type: ${issueType}`;
    fullQuery += `\n\nUser Question/Context: ${query || (incidentId ? 'Investigate this IcM incident. Extract context and route to the correct investigation guide.' : 'Start general investigation based on provided tracking ID or issue.')}`;

    const runner = new AgentRunner(effectiveConfig, {
        query: fullQuery, // Store the full constructed query for resumption
        stamp,
        timeRange,
        trackingId,
        issueType,
        incidentId,
        model,
        productId
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

    // Create a product name lookup map
    const productMap = new Map<string, string>();
    (config.products || []).forEach((p: Product) => productMap.set(p.id, p.name));

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
        incidentId: s.incidentId,
        model: s.model,
        productId: s.productId,
        productName: s.productId ? productMap.get(s.productId) || 'Unknown' : undefined,
        pausedAt: s.pausedAt,
        totalPausedTime: s.totalPausedTime,
        thoughts: s.thoughts.slice(-1), // Only last thought for preview
        thoughtCount: s.thoughts.length, // Actual count for stale detection & step bar
        actions: [],
        logs: [],
        retrospect: s.retrospect ? {
            messages: [],
            proposals: (s.retrospect.proposals || []).map((p: any) => ({ id: p.id, status: p.status })),
            analysisComplete: s.retrospect.analysisComplete,
            analysisFailed: s.retrospect.analysisFailed,
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
            runner = new AgentRunner(getEffectiveConfig(state), state);
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
                const tempRunner = new AgentRunner(getEffectiveConfig(state), state);
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
                const tempRunner = new AgentRunner(getEffectiveConfig(state), state);
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
                const tempRunner = new AgentRunner(getEffectiveConfig(state), state);
                await (tempRunner as any).saveArtifacts();
            } catch (e: any) {
                console.error(`Failed to persist intervention for ${id}:`, e.message);
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
            runner = new AgentRunner(getEffectiveConfig(state), state);
            runners.set(id, runner);
            attachRunnerListeners(runner, id);

            runner.contestReport(message);

            // Restart execution loop with the original query
            const query = state.query || 'Resume investigation';
            runner.start(query).then(() => {
                history.set(id, (runner as any).state);
                runners.delete(id);
            }).catch(err => {
                console.error(`Runner ${id} failed after contest:`, err);
                history.set(id, (runner as any).state);
                runners.delete(id);
            });

            runner.log(`Investigation ${id} contested and resumed from disk...`);
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
    if (action === 'contest' && message) {
        try {
            runner.contestReport(message);
        } catch (e: any) {
            return res.status(400).json({ error: e.message });
        }
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
            runners.delete(id);
        }
    }).catch((e: any) => {
        console.error(`[retrospect/analyze] Unhandled error for ${id}:`, e.message);
        if (isTemporary) runners.delete(id);
    });
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
        const tempRunner = new AgentRunner(getEffectiveConfig(state), state);
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

    const investigation = history.get(id);
    if (!investigation) {
        return res.status(404).json({ error: 'Investigation not found' });
    }

    // Determine the correct investigations directory based on productId
    let investigationsDir = config.investigationsPath || path.join(process.cwd(), 'investigations');
    if (investigation.productId) {
        const product = (config.products || []).find((p: Product) => p.id === investigation.productId);
        if (product && product.investigationsPath) {
            investigationsDir = product.investigationsPath;
        }
    }

    history.delete(id);

    // Remove from disk - folder is named ${timestamp}_${safeStamp}_${safeId}
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
        runner = new AgentRunner(getEffectiveConfig(state), state);
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
    const authenticated = await copilotClient.isAuthenticated();
    let user = null;
    if (authenticated) {
        user = await copilotClient.getGitHubUser();
    }
    res.json({ authenticated, user });
});

app.get('/api/auth/user', async (req, res) => {
    const user = await copilotClient.getGitHubUser();
    if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(user);
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const data = await copilotClient.startAuth();
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/azure-login', async (req, res) => {
    try {
        // Open `az login` in a visible terminal window so the user can interact with it.
        // On some machines the browser-based flow doesn't work, and the user needs to see
        // the device code or error output. Using `start cmd /k` opens a new cmd window
        // that stays open after `az login` completes so the user can see the result.
        const child = spawn('cmd', ['/c', 'start', 'cmd', '/k', 'az login'], {
            shell: false,
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });
        child.unref();
        child.on('error', (err) => {
            console.error('Failed to spawn az login:', err);
        });
        res.json({ success: true, message: 'Azure login started in a new terminal window.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/auth/azure-status', async (req, res) => {
    try {
        const result = await new Promise<{ authenticated: boolean; error?: string }>((resolve) => {
            let stderr = '';
            const check = spawn('az', ['account', 'show', '--output', 'none'], { shell: true });
            check.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            check.on('close', (code) => {
                if (code === 0) {
                    resolve({ authenticated: true });
                } else {
                    resolve({ authenticated: false, error: stderr.trim() || 'az account show failed' });
                }
            });
            check.on('error', (err) => resolve({ authenticated: false, error: `az CLI not found: ${err.message}` }));
            // Timeout after 10 seconds
            setTimeout(() => { try { check.kill(); } catch {} resolve({ authenticated: false, error: 'az account show timed out' }); }, 10000);
        });
        res.json(result);
    } catch (e: any) {
        res.json({ authenticated: false, error: e.message });
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
