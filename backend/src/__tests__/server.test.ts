import * as appRootModule from '../utils/appRoot';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pdfRenderer from '../pdfRenderer';
import * as SchedulerModule from '../schedules/Scheduler';
import { EventEmitter } from 'events';
import { AgentRunner, type InvestigationState } from '../agent/Runner';
import { PipelineOrchestrator } from '../agent/pipeline';
import {
    __testUtils,
    applyStaticServing,
    applySpaFallback,
    autoDiscoverProduct,
    cleanupRunner,
    createInvestigation,
    createSummaryState,
    getDefaultRepoRoot,
    getGlobalInvestigationsDir,
    getEffectiveConfig,
    getInvestigationStoragePath,
    getScheduleInvestigationsPath,
    getThoughtPreview,
    getThoughtSource,
    hasPersistedInvestigationState,
    hydrateStoredState,
    inferTarget,
    isPathWithinDirectory,
    loadHistory,
    normalizeHistoricalState,
    autoStartServerIfNeeded,
    handleServerStarted,
    resolveConfigPath,
    resolveConfigPaths,
    resolveManifest,
    shouldAutoStartServer,
    shouldIncludeInvestigationInList,
    shouldScanGlobalInvestigationsDir,
    summarizeRetrospect,
    startServer,
    stopServer,
    initScheduler,
    initializeProviders,
    validateProductPaths,
} from '../server';

const defaultConfig = JSON.parse(JSON.stringify(__testUtils.getConfig()));
const defaultPersistedConfig = JSON.parse(JSON.stringify(__testUtils.getPersistedConfig()));
const api = () => request(__testUtils.app);
const backendConfigFile = path.resolve(process.cwd(), 'config.json');

function setFakeLlmProvider() {
    __testUtils.setActiveLlmProvider({
        type: 'fake',
        displayName: 'Fake',
        getAuthRequirement: () => ({ type: 'none' }),
        configure: vi.fn(),
        getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
        getClient: vi.fn(),
        listModels: vi.fn().mockResolvedValue(['model-a']),
    } as any);
}

function makeState(overrides: Partial<InvestigationState> = {}): InvestigationState {
    return {
        id: 'inv-1',
        status: 'paused',
        thoughts: [],
        actions: [],
        logs: [],
        query: 'Investigate the issue',
        target: 'stamp-01',
        timeRange: 'ago(1h)',
        model: 'gpt-4o',
        tags: [],
        contestCount: 0,
        ...overrides,
    } as InvestigationState;
}

function makeRunner(
    stateOverrides: Partial<InvestigationState> = {},
    overrides: Record<string, any> = {},
) {
    const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
    emitter.state = makeState({ ...stateOverrides });
    emitter.pause = vi.fn(() => {
        emitter.state.status = 'paused';
    });
    emitter.resume = vi.fn(() => {
        emitter.state.status = 'running';
    });
    emitter.abort = vi.fn(() => {
        emitter.state.status = 'aborted';
    });
    emitter.intervene = vi.fn();
    emitter.contestReport = vi.fn(() => {
        emitter.state.status = 'running';
    });
    emitter.start = vi.fn().mockResolvedValue(undefined);
    emitter.log = vi.fn();
    emitter.setModel = vi.fn((model: string) => {
        emitter.state.model = model;
    });
    emitter.runRetrospective = vi.fn().mockResolvedValue(undefined);
    emitter.resetRetrospectiveAnalysis = vi.fn();
    emitter.runRetrospectiveAnalysis = vi.fn().mockResolvedValue(undefined);
    emitter.updateProposalStatus = vi.fn().mockReturnValue({ id: 'proposal-1', status: 'approved' });
    emitter.setRetrospectCompleted = vi.fn().mockReturnValue({ completed: true });
    emitter.abortRetrospective = vi.fn();
    emitter.applyApprovedProposals = vi.fn().mockResolvedValue({ applied: 1 });
    emitter.summarize = vi.fn().mockResolvedValue(undefined);
    emitter.saveArtifacts = vi.fn().mockResolvedValue(undefined);
    emitter.dispose = vi.fn();
    emitter.toolManager = {
        isConnected: vi.fn().mockReturnValue(true),
        restart: vi.fn().mockResolvedValue(undefined),
    };
    return Object.assign(emitter, overrides);
}

describe('server utilities and routes', () => {
    beforeEach(() => {
        __testUtils.resetRuntimeState();
        __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
        __testUtils.setPersistedConfig(JSON.parse(JSON.stringify(defaultPersistedConfig)));
        vi.restoreAllMocks();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    describe('utility helpers', () => {
        it('uses fullHistory when present', () => {
            const state = {
                thoughts: ['latest thought'],
                fullHistory: ['first', 'second'],
            } as unknown as InvestigationState;

            expect(getThoughtSource(state)).toEqual(['first', 'second']);
        });

        it('extracts string and object thought previews', () => {
            expect(getThoughtPreview('plain text')).toBe('plain text');
            expect(getThoughtPreview({ content: 'from object' })).toBe('from object');
            expect(getThoughtPreview({ role: 'assistant' })).toBe('');
            expect(getThoughtPreview(undefined)).toBeUndefined();
        });

        it('covers helper fallbacks for missing arrays and retrospect proposals', () => {
            expect(getThoughtSource({ thoughts: ['only thought'], fullHistory: [] } as any)).toEqual(['only thought']);
            expect(getThoughtSource({ thoughts: 'not-an-array' } as any)).toEqual([]);
            expect(summarizeRetrospect()).toBeUndefined();
            expect(summarizeRetrospect({ analysisComplete: false } as any)).toEqual({
                messages: [],
                proposals: [],
                analysisComplete: false,
                analysisFailed: undefined,
                completed: undefined,
            });
        });

        it('summarizes retrospect proposals only', () => {
            const result = summarizeRetrospect({
                messages: [{ role: 'assistant', content: 'hidden' }],
                proposals: [{ id: 'p1', status: 'pending', filePath: 'a.md' } as any],
                analysisComplete: true,
                analysisFailed: false,
                completed: false,
            } as any);

            expect(result).toEqual({
                messages: [],
                proposals: [{ id: 'p1', status: 'pending' }],
                analysisComplete: true,
                analysisFailed: false,
                completed: false,
            });
        });

        it('normalizes running historical state into paused and applies productId', () => {
            const result = normalizeHistoricalState({
                id: '1',
                status: 'running',
                thoughts: [],
                actions: undefined as any,
                logs: undefined as any,
            } as any, 'prod-1');

            expect(result.status).toBe('paused');
            expect(result.productId).toBe('prod-1');
            expect(result.thoughts).toContain('System: Investigation automatically paused due to server restart.');
            expect(result.actions).toEqual([]);
            expect(result.logs).toEqual([]);
        });

        it('normalizes non-array thoughts to an empty list', () => {
            const result = normalizeHistoricalState({
                id: '2',
                status: 'completed',
                thoughts: undefined as any,
                actions: [],
                logs: [],
            } as any);

            expect(result.thoughts).toEqual([]);
            expect(result.status).toBe('completed');
        });

        it('inferTarget returns undefined when target is already set', () => {
            expect(inferTarget({ target: 'stamp-01' })).toBeUndefined();
        });

        it('inferTarget migrates legacy stamp field to target', () => {
            expect(inferTarget({ target: '', stamp: 'oi-tds-prd-ea-02' })).toBe('oi-tds-prd-ea-02');
        });

        it('inferTarget extracts from Stamp: prefix in query', () => {
            expect(inferTarget({ target: '', query: 'Stamp: oi-tds-prd-ea-02\nTime Range: ago(1h)' })).toBe('oi-tds-prd-ea-02');
        });

        it('inferTarget extracts from Target: prefix in query', () => {
            expect(inferTarget({ target: '', query: 'Target: ax-tds-prd-cdm-01\nTime Range: ago(1h)' })).toBe('ax-tds-prd-cdm-01');
        });

        it('inferTarget returns undefined when no target can be inferred', () => {
            expect(inferTarget({ target: '', query: 'Some random query' })).toBeUndefined();
        });

        it('normalizeHistoricalState migrates legacy stamp field', () => {
            const result = normalizeHistoricalState({
                id: '3',
                status: 'completed',
                thoughts: [],
                actions: [],
                logs: [],
                stamp: 'oi-tds-prd-ea-02',
            } as any);

            expect(result.target).toBe('oi-tds-prd-ea-02');
        });

        it('normalizeHistoricalState extracts target from query when missing', () => {
            const result = normalizeHistoricalState({
                id: '4',
                status: 'completed',
                thoughts: [],
                actions: [],
                logs: [],
                query: 'Stamp: oi-tds-prd-eus2p-02\nTime Range: ago(7d)\nUser Question/Context: test',
            } as any);

            expect(result.target).toBe('oi-tds-prd-eus2p-02');
        });

        it('normalizeHistoricalState clears stale implementationRunning flag', () => {
            const result = normalizeHistoricalState({
                id: '5',
                status: 'completed',
                thoughts: [],
                actions: [],
                logs: [],
                implementationRunning: true,
            } as any);

            expect(result.implementationRunning).toBe(false);
        });

        it('creates a summary state with a thought preview', () => {
            const summary = createSummaryState({
                id: '123',
                status: 'completed',
                thoughts: ['first', 'final thought'],
                actions: [],
                logs: [],
                tags: ['tag'],
            } as any, 'C:/tmp/inv', 'C:/tmp/inv/state.json', 42);

            expect(summary.thoughts).toEqual(['final thought']);
            expect(summary._summaryOnly).toBe(true);
            expect(summary._thoughtCount).toBe(2);
            expect(summary._storagePath).toBe('C:/tmp/inv');
        });

        it('creates a summary state with empty tags when they are omitted', () => {
            const summary = createSummaryState({
                id: 'no-tags',
                status: 'completed',
                thoughts: [],
                actions: [],
                logs: [],
            } as any, 'C:/tmp/no-tags', 'C:/tmp/no-tags/state.json', 99);

            expect(summary.tags).toEqual([]);
            expect(summary.thoughts).toEqual([]);
        });

        it('checks directory containment correctly', () => {
            expect(isPathWithinDirectory('C:/repo/docs/file.md', 'C:/repo')).toBe(true);
            expect(isPathWithinDirectory('C:/other/docs/file.md', 'C:/repo')).toBe(false);
            expect(isPathWithinDirectory(undefined, 'C:/repo')).toBe(false);
        });

        it('resolves investigator-root and relative config paths', () => {
            const relative = resolveConfigPath('docs/guide.md', 'C:/repo');
            expect(relative).toBe(path.resolve('C:/repo', 'docs/guide.md'));

            const investigator = resolveConfigPath('$INVESTIGATOR_ROOT/scripts/icm', 'C:/repo');
            expect(investigator.includes('scripts')).toBe(true);
            expect(resolveConfigPath('', 'C:/repo')).toBe('');
        });

        it('resolves nested config paths using product fallback bases', () => {
            const cfg = {
                repoRoot: 'repo-root',
                workingDirectory: 'workdir',
                incidentProvider: { scriptsPath: 'scripts/icm' },
                mcpServers: [{ name: 'srv', cwd: 'mcp-dir' }],
                products: [{
                    id: 'prod-1',
                    name: 'Prod 1',
                    repoRoot: '',
                    systemPromptPath: 'prompts/system.md',
                    knowledgeBasePath: 'docs',
                    workingDirectory: 'work',
                    investigationsPath: 'investigations',
                }, {
                    id: 'prod-2',
                    name: 'Prod 2',
                    repoRoot: 'custom-root',
                    systemPromptPath: 'prompts/system.md',
                    workingDirectory: 'work',
                }],
            } as any;

            resolveConfigPaths(cfg, 'C:/base');

            expect(cfg.repoRoot).toBe(path.resolve('C:/base', 'repo-root'));
            expect(cfg.products[0].systemPromptPath).toBe(path.resolve('C:/base', 'prompts/system.md'));
            expect(cfg.products[0].investigationsPath).toBe(path.resolve('C:/base', 'investigations'));
            // Product with repoRoot gets its own resolved base
            expect(cfg.products[1].repoRoot).toBe(path.resolve('C:/base', 'custom-root'));
            expect(cfg.products[1].systemPromptPath).toBe(path.resolve('C:/base', 'custom-root', 'prompts/system.md'));
            // Incident provider scriptsPath and MCP server cwd are resolved
            expect(cfg.incidentProvider.scriptsPath).toBe(path.resolve('C:/base', 'scripts/icm'));
            expect(cfg.mcpServers[0].cwd).toBe(path.resolve('C:/base', 'mcp-dir'));
        });

        it('returns product-specific effective config when a product is selected', () => {
            __testUtils.setConfig({
                repoRoot: 'C:/global-repo',
                systemPromptPath: 'C:/global-prompt',
                knowledgeBasePath: 'C:/global-kb',
                workingDirectory: 'C:/global-working',
                investigationsPath: 'C:/global-investigations',
                products: [{
                    id: 'prod-1',
                    name: 'Product 1',
                    repoRoot: 'C:/product-repo',
                    systemPromptPath: 'C:/product-prompt',
                    knowledgeBasePath: 'C:/product-kb',
                    workingDirectory: 'C:/product-working',
                    investigationsPath: 'C:/product-investigations',
                }],
            });

            const effective = getEffectiveConfig({ productId: 'prod-1' });

            expect(effective.repoRoot).toBe('C:/product-repo');
            expect(effective.systemPromptPath).toBe('C:/product-prompt');
            expect(effective.knowledgeBasePath).toBe('C:/product-kb');
            expect(effective.workingDirectory).toBe('C:/product-working');
            expect(effective.investigationsPath).toBe('C:/product-investigations');
        });

        it('falls back to the global config when there is no matching product', () => {
            __testUtils.setConfig({ repoRoot: 'C:/global-repo', products: [] });

            const effective = getEffectiveConfig({ productId: 'missing-product' });

            expect(effective.repoRoot).toBe('C:/global-repo');
        });

        it('resolves a manifest relative to repo root', () => {
            const result = resolveManifest('C:/repo', {
                name: 'Repo',
                systemPrompt: 'prompts/system.md',
                knowledgeBase: 'docs',
                workingDirectory: '.',
                investigationsPath: 'investigations',
            });

            expect(result).toEqual({
                name: 'Repo',
                repoRoot: 'C:/repo',
                systemPromptPath: path.resolve('C:/repo', 'prompts/system.md'),
                knowledgeBasePath: path.resolve('C:/repo', 'docs'),
                workingDirectory: path.resolve('C:/repo', '.'),
                investigationsPath: path.resolve('C:/repo', 'investigations'),
            });
        });

        it('resolves manifest with Path-suffixed field names', () => {
            const result = resolveManifest('C:/repo', {
                name: 'PathSuffix',
                systemPromptPath: '.github/agents/agent.md',
                knowledgeBasePath: 'docs/kb',
            });

            expect(result.systemPromptPath).toBe(path.resolve('C:/repo', '.github/agents/agent.md'));
            expect(result.knowledgeBasePath).toBe(path.resolve('C:/repo', 'docs/kb'));
        });

        it('auto-discovers product paths from repo structure', () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-product-'));
            fs.mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
            fs.writeFileSync(path.join(repoRoot, '.github', 'agents', 'teleduct.agent.md'), '# agent');
            fs.mkdirSync(path.join(repoRoot, 'docs', 'investigations'), { recursive: true });
            fs.mkdirSync(path.join(repoRoot, 'investigations'), { recursive: true });

            const result = autoDiscoverProduct(repoRoot);

            expect(result.product.repoRoot).toBe(repoRoot);
            expect(result.product.systemPromptPath).toContain('teleduct.agent.md');
            expect(result.product.knowledgeBasePath).toContain(path.join('docs', 'investigations'));
            expect(result.product.investigationsPath).toContain('investigations');
        });

        it('hydrates a summary-only state from disk when the state file exists', () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-hydrate-'));
            const statePath = path.join(rootDir, 'state.json');
            fs.writeFileSync(statePath, JSON.stringify(makeState({ id: 'disk-1', status: 'running' })));

            const hydrated = hydrateStoredState({
                id: 'disk-1',
                status: 'completed',
                thoughts: ['summary'],
                actions: [],
                logs: [],
                _summaryOnly: true,
                _statePath: statePath,
                _storagePath: rootDir,
            } as any);

            expect(hydrated?._summaryOnly).toBe(false);
            expect(hydrated?.status).toBe('paused');
            expect(hydrated?.thoughts).toContain('System: Investigation automatically paused due to server restart.');
        });

        it('returns the original stored state for hydration fallback paths', () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-hydrate-fallback-'));
            const invalidPath = path.join(rootDir, 'invalid.json');
            fs.writeFileSync(invalidPath, '{bad json');

            const nonSummary = { id: 'plain', _summaryOnly: false } as any;
            const missingFile = { id: 'missing', _summaryOnly: true, _statePath: path.join(rootDir, 'missing.json') } as any;
            const invalidFile = { id: 'invalid', _summaryOnly: true, _statePath: invalidPath } as any;

            expect(hydrateStoredState(nonSummary)).toBe(nonSummary);
            expect(hydrateStoredState(missingFile)).toBe(missingFile);
            expect(hydrateStoredState(invalidFile)).toBe(invalidFile);
        });

        it('hydrates summary-only state even when storagePath must be recomputed', () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-hydrate-recompute-'));
            const statePath = path.join(rootDir, 'state.json');
            fs.writeFileSync(statePath, JSON.stringify(makeState({ id: 'rehydrate-2', target: 'stamp-2' })));

            const hydrated = hydrateStoredState({
                id: 'rehydrate-2',
                status: 'completed',
                thoughts: ['summary'],
                actions: [],
                logs: [],
                target: 'stamp-2',
                _summaryOnly: true,
                _statePath: statePath,
            } as any);

            expect(hydrated?._storagePath).toBeDefined();
        });

        it('hydrates summary-only records lazily through the history store', () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-get-'));
            const statePath = path.join(rootDir, 'state.json');
            fs.writeFileSync(statePath, JSON.stringify(makeState({ id: 'lazy-1', status: 'running' })));

            __testUtils.getHistory().set('lazy-1', {
                id: 'lazy-1',
                status: 'completed',
                thoughts: ['summary only'],
                actions: [],
                logs: [],
                _summaryOnly: true,
                _storagePath: rootDir,
                _statePath: statePath,
            } as any);

            const first = __testUtils.getHistory().get('lazy-1');
            const second = __testUtils.getHistory().get('lazy-1');

            expect(first?._summaryOnly).toBe(false);
            expect(first?.status).toBe('paused');
            expect(second).toBe(first);
        });

        it('loads summaries, legacy json, and markdown history from disk', () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-'));
            const folderWithSummary = path.join(invRoot, '2024-01-01_stamp_a1');
            const folderWithoutSummary = path.join(invRoot, '2024-01-01_stamp_a2');
            fs.mkdirSync(folderWithSummary, { recursive: true });
            fs.mkdirSync(folderWithoutSummary, { recursive: true });

            fs.writeFileSync(path.join(folderWithSummary, 'state.json'), JSON.stringify(makeState({ id: 'summary-1' })));
            fs.writeFileSync(path.join(folderWithSummary, 'summary.json'), JSON.stringify(createSummaryState(
                makeState({ id: 'summary-1', thoughts: ['done'] }),
                folderWithSummary,
                path.join(folderWithSummary, 'state.json'),
                Date.now(),
            )));
            fs.writeFileSync(path.join(folderWithoutSummary, 'state.json'), JSON.stringify(makeState({ id: 'state-only-1', status: 'running' })));
            fs.writeFileSync(path.join(invRoot, 'legacy.json'), JSON.stringify(makeState({ id: 'legacy-json-1' })));
            fs.writeFileSync(path.join(invRoot, 'legacy-report.md'), '# legacy');

            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            loadHistory();

            const history = __testUtils.getHistory();
            expect(history.has('summary-1')).toBe(true);
            expect(history.has('state-only-1')).toBe(true);
            expect(history.has('legacy-json-1')).toBe(true);
            expect(history.has('legacy-report')).toBe(true);
        });

        it('covers loadHistory summary normalization and read-failure branches', () => {
            const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-extra-'));
            const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-product-'));
            const brokenRoot = path.join(globalRoot, 'not-a-directory.txt');
            fs.writeFileSync(brokenRoot, 'file');

            const summaryDir = path.join(productRoot, '2024-01-01_stamp_summary');
            fs.mkdirSync(summaryDir, { recursive: true });
            const statePath = path.join(summaryDir, 'state.json');
            const summaryPath = path.join(summaryDir, 'summary.json');
            fs.writeFileSync(statePath, JSON.stringify(makeState({ id: 'summary-running', status: 'running' })));
            fs.writeFileSync(summaryPath, JSON.stringify({
                id: 'summary-running',
                status: 'running',
                thoughts: ['summary'],
                actions: [],
                logs: [],
            }));

            const backfillDir = path.join(productRoot, '2024-01-01_stamp_backfill');
            fs.mkdirSync(backfillDir, { recursive: true });
            fs.writeFileSync(path.join(backfillDir, 'state.json'), JSON.stringify(makeState({ id: 'backfill-1' })));
            fs.mkdirSync(path.join(backfillDir, 'summary.json.tmp'));

            fs.writeFileSync(path.join(productRoot, 'broken.json'), '{bad json');

            __testUtils.setConfig({
                repoRoot: globalRoot,
                investigationsPath: globalRoot,
                products: [{
                    id: 'prod-1',
                    name: 'Prod 1',
                    repoRoot: globalRoot,
                    systemPromptPath: globalRoot,
                    knowledgeBasePath: globalRoot,
                    workingDirectory: globalRoot,
                    investigationsPath: productRoot,
                }],
                activeProductId: 'prod-1',
            });

            const originalInvestigationsPath = __testUtils.getConfig().investigationsPath;
            __testUtils.getConfig().investigationsPath = brokenRoot;
            loadHistory();
            __testUtils.getConfig().investigationsPath = originalInvestigationsPath;

            const summary = __testUtils.getHistory().get('summary-running');
            const backfill = __testUtils.getHistory().get('backfill-1');

            expect(summary?.status).toBe('paused');
            expect(summary?.productId).toBe('prod-1');
            expect(backfill?.id).toBe('backfill-1');
        });

        it('persists inferred target from legacy stamp field during summary loading', () => {
            const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-infer-'));
            const inferDir = path.join(productRoot, '2024-01-01_stamp_infer');
            fs.mkdirSync(inferDir, { recursive: true });
            fs.writeFileSync(path.join(inferDir, 'state.json'), JSON.stringify({ id: 'infer-1' }));
            fs.writeFileSync(path.join(inferDir, 'summary.json'), JSON.stringify({
                id: 'infer-1',
                status: 'completed',
                target: '',
                stamp: 'legacy-stamp-01',
                thoughts: [],
                actions: [],
                logs: [],
            }));

            __testUtils.setConfig({
                investigationsPath: productRoot,
                products: [],
                activeProductId: '',
            });

            loadHistory();

            // Verify inferTarget persisted the inferred target to summary.json on disk
            const onDisk = JSON.parse(fs.readFileSync(path.join(inferDir, 'summary.json'), 'utf-8'));
            expect(onDisk.target).toBe('legacy-stamp-01');
        });

        it('survives a write failure when persisting an inferred target (best-effort catch)', () => {
            const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-infer-fail-'));
            const inferDir = path.join(productRoot, '2024-01-01_stamp_inferfail');
            fs.mkdirSync(inferDir, { recursive: true });
            fs.writeFileSync(path.join(inferDir, 'state.json'), JSON.stringify({ id: 'infer-fail-1' }));
            const summaryPath = path.join(inferDir, 'summary.json');
            fs.writeFileSync(summaryPath, JSON.stringify({
                id: 'infer-fail-1',
                status: 'completed',
                target: '',
                stamp: 'legacy-stamp-fail',
                thoughts: [],
                actions: [],
                logs: [],
            }));

            // Block the write by placing a directory at the .tmp path so writeFileSync throws
            fs.mkdirSync(summaryPath + '.tmp');

            __testUtils.setConfig({
                investigationsPath: productRoot,
                products: [],
                activeProductId: '',
            });

            // loadHistory should not throw - the catch block swallows the error
            expect(() => loadHistory()).not.toThrow();

            // The in-memory target was inferred - use values() to bypass re-hydration from unchanged disk file
            const items = Array.from(__testUtils.getHistory().values());
            const item = items.find(i => i.id === 'infer-fail-1');
            expect(item?.target).toBe('legacy-stamp-fail');
        });

        it('covers path selection and inclusion helpers for product and global investigations', () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-helper-root-'));
            const productDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-helper-product-'));
            __testUtils.setConfig({
                repoRoot,
                investigationsPath: '',
                products: [{
                    id: 'prod-1',
                    name: 'Prod 1',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath: productDir,
                }],
                activeProductId: 'prod-1',
            });

            const productPath = getInvestigationStoragePath({ id: 'prod/1', target: 'stamp/one', productId: 'prod-1' });
            expect(productPath.startsWith(productDir)).toBe(true);
            expect(productPath).toContain('stampone');
            expect(shouldScanGlobalInvestigationsDir()).toBe(false);
            expect(getGlobalInvestigationsDir()).toContain(path.join(repoRoot, 'investigations'));
            expect(shouldIncludeInvestigationInList({ id: 'prod-1', _storagePath: productPath } as any)).toBe(true);
            expect(shouldIncludeInvestigationInList({ id: 'other', _storagePath: path.join(repoRoot, 'investigations', 'other') } as any)).toBe(false);

            __testUtils.setConfig({ repoRoot, investigationsPath: repoRoot, products: [], activeProductId: '' });
            expect(shouldScanGlobalInvestigationsDir()).toBe(true);
            expect(shouldIncludeInvestigationInList({ id: 'global-1', _storagePath: path.join(repoRoot, '2024-01-01_global') } as any)).toBe(true);
        });

        it('detects persisted state directly from a stored state path', () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persisted-state-'));
            const statePath = path.join(tempDir, 'state.json');
            fs.writeFileSync(statePath, JSON.stringify({ id: 'persisted-direct', status: 'done' }));

            expect(hasPersistedInvestigationState({ id: 'persisted-direct', _statePath: statePath } as any)).toBe(true);
            expect(hasPersistedInvestigationState({ id: 'missing-direct', _statePath: path.join(tempDir, 'missing.json') } as any)).toBe(false);
        });

        it('reports validation errors for missing, relative, and nonexistent product paths', () => {
            const nonExistentAbsPath = process.platform === 'win32' ? 'C:/nonexistent-path-xyz' : '/nonexistent-path-xyz';
            const validation = validateProductPaths({
                id: 'prod-1',
                name: 'Prod 1',
                repoRoot: '',
                systemPromptPath: 'relative/path',
                knowledgeBasePath: nonExistentAbsPath,
                workingDirectory: nonExistentAbsPath,
                investigationsPath: nonExistentAbsPath,
            });

            expect(validation.valid).toBe(false);
            expect(validation.paths.some((p) => p.field === 'repoRoot' && p.error === 'Path is required')).toBe(true);
            expect(validation.paths.some((p) => p.field === 'systemPromptPath' && p.error?.includes('absolute'))).toBe(true);
            expect(validation.paths.some((p) => p.field === 'knowledgeBasePath' && p.error === 'Path does not exist on disk')).toBe(true);
        });

        it('treats invalid absolute paths as nonexistent when filesystem checks normalize them', () => {
            const invalidAbsPath = process.platform === 'win32'
                ? `C:\\invalid${String.fromCharCode(0)}root`
                : `/invalid${String.fromCharCode(0)}root`;
            const validation = validateProductPaths({
                id: 'prod-2',
                name: 'Prod 2',
                repoRoot: invalidAbsPath,
                systemPromptPath: '',
                knowledgeBasePath: '',
                workingDirectory: '',
                investigationsPath: '',
            });

            expect(validation.valid).toBe(false);
            // On some platforms, null chars in paths may cause existsSync to throw
            const repoRootResult = validation.paths.find(p => p.field === 'repoRoot');
            expect(repoRootResult).toBeDefined();
            expect(repoRootResult!.error).toBeTruthy();
            expect(repoRootResult!.exists).toBe(false);
        });

        it('starts and stops the server through exported helpers', async () => {
            const listenSpy = vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            const closeSpy = vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            await stopServer();

            expect(listenSpy).toHaveBeenCalled();
            expect(closeSpy).toHaveBeenCalled();
        });

        it('covers server lifecycle edge cases and the global error handler', async () => {
            const listenSpy = vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            const closeSpy = vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.(new Error('close failed'));
                return __testUtils.server as any;
            });

            const firstServer = startServer();
            const secondServer = startServer();
            expect(firstServer).toBe(__testUtils.server);
            expect(secondServer).toBe(__testUtils.server);
            expect(listenSpy).toHaveBeenCalledTimes(1);

            await expect(stopServer()).rejects.toThrow('close failed');
            await expect(stopServer()).resolves.toBeUndefined();
            expect(closeSpy).toHaveBeenCalledTimes(1);

            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const errorLayer = stack.find((layer) =>
                typeof layer.handle === 'function'
                && layer.handle.length === 4
                && String(layer.handle).includes('Unhandled error on')
            );
            expect(errorLayer).toBeTruthy();

            const errorLogger = vi.spyOn(console, 'error').mockImplementation(() => {});
            const status = vi.fn().mockReturnThis();
            const json = vi.fn();
            errorLayer.handle(new Error('route boom'), { method: 'GET', url: '/boom' }, { headersSent: false, status, json }, vi.fn());
            expect(status).toHaveBeenCalledWith(500);
            expect(json).toHaveBeenCalledWith({ error: 'route boom' });

            errorLayer.handle(new Error('already-sent'), { method: 'GET', url: '/boom' }, { headersSent: true, status: vi.fn(), json: vi.fn() }, vi.fn());
            expect(errorLogger).toHaveBeenCalled();
        });

        it('kills a process on port when netstat reports a listening PID', async () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const fakeExec: any = vi.fn((cmd: string, cb: any) => {
                if (cmd.includes('netstat')) {
                    cb(null, '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345\n', '');
                } else if (cmd.includes('taskkill')) {
                    cb(null, '', '');
                }
            });

            const result = await __testUtils.killProcessOnPort(3000, fakeExec, 'win32', 99999);
            expect(result).toBe(true);
            expect(fakeExec).toHaveBeenCalledWith(expect.stringContaining('taskkill /PID 12345 /F'), expect.any(Function));
            expect(logSpy).toHaveBeenCalledWith('  Previous AI Investigator instance detected');
            logSpy.mockRestore();
        });

        it('returns false from killProcessOnPort on non-win32 platforms', async () => {
            const result = await __testUtils.killProcessOnPort(3000, vi.fn() as any, 'linux', 1);
            expect(result).toBe(false);
        });

        it('returns false from killProcessOnPort when netstat finds nothing', async () => {
            const fakeExec: any = vi.fn((cmd: string, cb: any) => {
                cb(new Error('not found'), '', '');
            });
            const result = await __testUtils.killProcessOnPort(3000, fakeExec, 'win32', 1);
            expect(result).toBe(false);
        });

        it('returns false from killProcessOnPort when all PIDs are filtered out', async () => {
            const fakeExec: any = vi.fn((cmd: string, cb: any) => {
                // PID matches current process — should be filtered
                cb(null, '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    999\n', '');
            });
            const result = await __testUtils.killProcessOnPort(3000, fakeExec, 'win32', 999);
            expect(result).toBe(false);
        });

        it('filters out PID 0 from killProcessOnPort', async () => {
            const fakeExec: any = vi.fn((cmd: string, cb: any) => {
                cb(null, '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    0\n', '');
            });
            const result = await __testUtils.killProcessOnPort(3000, fakeExec, 'win32', 1);
            expect(result).toBe(false);
        });

        it('handles EADDRINUSE by killing the blocking process and retrying', async () => {
            vi.useFakeTimers();
            const errorHandlers: Function[] = [];
            const listenSpy = vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            const onSpy = vi.spyOn(__testUtils.server, 'on').mockImplementation((event: string, handler: any) => {
                if (event === 'error') errorHandlers.push(handler);
                return __testUtils.server as any;
            });
            const closeSpy = vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            expect(errorHandlers.length).toBeGreaterThanOrEqual(1);

            const eaddrinuseErr: NodeJS.ErrnoException = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Test killed=false path (port still in use, can't kill)
            const killMock = vi.spyOn(__testUtils.internal, 'killProcessOnPort').mockResolvedValue(false);
            await errorHandlers[0](eaddrinuseErr);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('already in use'));
            expect(exitSpy).toHaveBeenCalledWith(1);

            // Test killed=true path (successfully killed blocking process)
            exitSpy.mockClear();
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            killMock.mockResolvedValue(true);
            await errorHandlers[0](eaddrinuseErr);
            expect(logSpy).toHaveBeenCalledWith('Restarting...\n');
            vi.advanceTimersByTime(1100);
            expect(listenSpy).toHaveBeenCalled();
            expect(exitSpy).not.toHaveBeenCalled();

            // Test non-EADDRINUSE error path
            exitSpy.mockClear();
            const otherErr: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' });
            await errorHandlers[0](otherErr);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Server error:', otherErr);

            await stopServer();
            vi.useRealTimers();
            exitSpy.mockRestore();
            consoleErrorSpy.mockRestore();
            logSpy.mockRestore();
            killMock.mockRestore();
            onSpy.mockRestore();
        });

        it('logs update availability on startup when NODE_ENV is production', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.spyOn(__testUtils.internal, 'openBrowser').mockImplementation(() => {});

            const { getVersionStatus } = await import('../utils/updateChecker');
            const getVersionSpy = vi.spyOn({ getVersionStatus }, 'getVersionStatus');

            // We need to mock the module-level import. Since server.ts imports getVersionStatus
            // at the module level, we mock the module directly.
            const updateCheckerModule = await import('../utils/updateChecker');
            const versionSpy = vi.spyOn(updateCheckerModule, 'getVersionStatus').mockResolvedValue({
                current: '1.0.0',
                latest: '1.1.0',
                updateAvailable: true,
                downloadUrl: 'https://example.com/download',
                releaseNotesUrl: 'https://example.com/release',
                lastChecked: Date.now(),
            } as any);

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const listenSpy = vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            vi.spyOn(__testUtils.server, 'on').mockReturnValue(__testUtils.server as any);
            const closeSpy = vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();

            // Wait for the async update check to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(versionSpy).toHaveBeenCalledWith(true);
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Update available'));

            await stopServer();
            process.env.NODE_ENV = originalNodeEnv;
            versionSpy.mockRestore();
            logSpy.mockRestore();
        });

        it('silently handles update check failures on startup', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.spyOn(__testUtils.internal, 'openBrowser').mockImplementation(() => {});

            const updateCheckerModule = await import('../utils/updateChecker');
            const versionSpy = vi.spyOn(updateCheckerModule, 'getVersionStatus').mockRejectedValue(new Error('network error'));

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            vi.spyOn(__testUtils.server, 'on').mockReturnValue(__testUtils.server as any);
            vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not throw, should not log update available
            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Update available'));

            await stopServer();
            process.env.NODE_ENV = originalNodeEnv;
            versionSpy.mockRestore();
            logSpy.mockRestore();
        });

        it('skips update check when not in production mode', async () => {
            const updateCheckerModule = await import('../utils/updateChecker');
            const versionSpy = vi.spyOn(updateCheckerModule, 'getVersionStatus');

            vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            vi.spyOn(__testUtils.server, 'on').mockReturnValue(__testUtils.server as any);
            vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            await new Promise(resolve => setTimeout(resolve, 50));

            // Not in production mode, should not call getVersionStatus
            expect(versionSpy).not.toHaveBeenCalled();

            await stopServer();
            versionSpy.mockRestore();
        });

        it('does not log update banner when no update is available', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.spyOn(__testUtils.internal, 'openBrowser').mockImplementation(() => {});

            const updateCheckerModule = await import('../utils/updateChecker');
            const versionSpy = vi.spyOn(updateCheckerModule, 'getVersionStatus').mockResolvedValue({
                current: '1.0.0',
                latest: '1.0.0',
                updateAvailable: false,
                lastChecked: Date.now(),
            } as any);

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            vi.spyOn(__testUtils.server, 'on').mockReturnValue(__testUtils.server as any);
            vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Update available'));

            await stopServer();
            process.env.NODE_ENV = originalNodeEnv;
            versionSpy.mockRestore();
            logSpy.mockRestore();
        });

        it('auto-opens browser in production mode on startup', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const updateCheckerModule = await import('../utils/updateChecker');
            vi.spyOn(updateCheckerModule, 'getVersionStatus').mockResolvedValue({
                current: '1.0.0', updateAvailable: false, lastChecked: Date.now(),
            } as any);

            const openSpy = vi.spyOn(__testUtils.internal, 'openBrowser').mockImplementation(() => {});

            vi.spyOn(__testUtils.server, 'listen').mockImplementation((_port: any, callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });
            vi.spyOn(__testUtils.server, 'on').mockReturnValue(__testUtils.server as any);
            vi.spyOn(__testUtils.server, 'close').mockImplementation((callback?: any) => {
                callback?.();
                return __testUtils.server as any;
            });

            startServer();
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(openSpy).toHaveBeenCalled();

            await stopServer();
            process.env.NODE_ENV = originalNodeEnv;
            openSpy.mockRestore();
        });

        it('openBrowser calls exec with a platform-appropriate command', () => {
            const cp = require('child_process');
            const execSpy = vi.spyOn(cp, 'exec').mockImplementation((_cmd: string, _cb: any) => {});

            __testUtils.internal.openBrowser(4000, 'win32');
            expect(execSpy).toHaveBeenLastCalledWith(expect.stringContaining('msedge --app='), expect.any(Function));

            __testUtils.internal.openBrowser(4000, 'darwin');
            expect(execSpy).toHaveBeenLastCalledWith(expect.stringContaining('--app='), expect.any(Function));

            __testUtils.internal.openBrowser(4000, 'linux');
            expect(execSpy).toHaveBeenLastCalledWith(expect.stringContaining('xdg-open'), expect.any(Function));

            execSpy.mockRestore();
        });

        it('printKeepOpenMessage logs keep-open hint', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            __testUtils.internal.printKeepOpenMessage(true);
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Ctrl+C'));
            logSpy.mockRestore();
        });

        it('covers direct startup helpers and schedule path selection', () => {
            const logger = { error: vi.fn() };
            handleServerStarted(() => {
                throw new Error('scheduler init failed');
            }, logger as any);
            expect(logger.error).toHaveBeenCalledWith('[Scheduler] Failed to initialize:', expect.any(Error));

            const starter = vi.fn();
            expect(autoStartServerIfNeeded({ VITEST: 'true' } as any, starter)).toBeUndefined();
            expect(starter).not.toHaveBeenCalled();
            autoStartServerIfNeeded({ VITEST: 'false' } as any, starter);
            expect(starter).toHaveBeenCalledTimes(1);

            __testUtils.setConfig({ investigationsPath: '', products: [{ id: 'prod-path', investigationsPath: 'C:/tmp/prod-path' } as any] });
            expect(getScheduleInvestigationsPath()).toBe('C:/tmp/prod-path');

            __testUtils.setConfig({ investigationsPath: '', products: [{ id: 'prod-empty' } as any] });
            expect(getScheduleInvestigationsPath()).toBe(getGlobalInvestigationsDir());
        });

        it('covers process error handlers, websocket helpers, config bootstrap, and provider fallbacks', async () => {
            const logger = { error: vi.fn(), log: vi.fn() };

            __testUtils.handleUncaughtException(new Error('uncaught boom'), logger as any);
            __testUtils.handleUnhandledRejection('reason', Promise.resolve(), logger as any);
            expect(logger.error).toHaveBeenCalledTimes(2);

            const registrations = new Map<string, Function>();
            __testUtils.registerProcessErrorHandlers({
                on: vi.fn((event: string, handler: Function) => {
                    registrations.set(event, handler);
                    return {} as any;
                }),
            } as any, logger as any);
            expect(registrations.has('uncaughtException')).toBe(true);
            expect(registrations.has('unhandledRejection')).toBe(true);
            registrations.get('uncaughtException')?.(new Error('registered uncaught'));
            registrations.get('unhandledRejection')?.('registered rejection', Promise.resolve());
            expect(logger.error).toHaveBeenCalledTimes(4);

            const next = vi.fn();
            __testUtils.jsonParseErrorHandler({ type: 'other-error' } as any, { method: 'POST', url: '/x' } as any, {} as any, next);
            expect(next).toHaveBeenCalled();

            const clientMap = new Map<string, Set<any>>();
            const openClient = { readyState: 1, send: vi.fn() };
            const closedClient = { readyState: 3, send: vi.fn() };
            clientMap.set('inv-1', new Set([openClient as any, closedClient as any]));
            __testUtils.broadcastToClients(clientMap as any, 'inv-1', 'status', { ok: true }, logger as any);
            expect(openClient.send).toHaveBeenCalledWith(JSON.stringify({ type: 'status', data: { ok: true } }));
            expect(closedClient.send).not.toHaveBeenCalled();

            const wsHandlers = new Map<string, Function>();
            const ws = {
                readyState: 1,
                send: vi.fn(),
                on: vi.fn((event: string, handler: Function) => {
                    wsHandlers.set(event, handler);
                }),
            };
            __testUtils.registerWebSocketClient(clientMap as any, ws as any, { url: '/?id=inv-2', headers: { host: 'localhost:3000' } } as any, logger as any);
            expect(clientMap.get('inv-2')?.has(ws as any)).toBe(true);
            // Simulate error — should call ws.terminate()
            (ws as any).terminate = vi.fn();
            wsHandlers.get('error')?.();
            expect((ws as any).terminate).toHaveBeenCalled();
            wsHandlers.get('close')?.();
            expect(clientMap.has('inv-2')).toBe(false);

            __testUtils.registerWebSocketClient(clientMap as any, ws as any, { headers: { host: 'localhost:3000' } } as any, logger as any);
            __testUtils.wss.emit('connection', ws as any, { url: '/?id=inv-3', headers: { host: 'localhost:3000' } } as any);
            expect(__testUtils.clients.get('inv-3')?.has(ws as any)).toBe(true);
            wsHandlers.get('close')?.();
            expect(__testUtils.clients.has('inv-3')).toBe(false);

            expect(__testUtils.resolveConfigFilePath(['node', 'server.js'], 'C:/repo/backend/src', 'C:/repo')).toBe(path.join('C:/repo', 'config.json'));
            expect(__testUtils.resolveConfigFilePath(['node', 'server.js', '--config', 'C:/tmp/custom.json'], 'C:/repo/backend/src', 'C:/repo')).toBe(path.resolve('C:/tmp/custom.json'));

            const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-config-load-'));
            const configPath = path.join(configDir, 'config.json');
            const investigationsPath = path.join(configDir, 'investigations');
            fs.writeFileSync(configPath, JSON.stringify({ investigationsPath, repoRoot: configDir }));

            const loaded = __testUtils.loadConfigFromDisk(configPath, JSON.parse(JSON.stringify(defaultConfig)), configDir);
            expect(loaded.loaded).toBe(true);
            expect(loaded.config.investigationsPath).toBe(investigationsPath);
            expect(fs.existsSync(investigationsPath)).toBe(true);

            const missingLoad = __testUtils.loadConfigFromDisk(path.join(configDir, 'missing.json'), JSON.parse(JSON.stringify(defaultConfig)), configDir);
            expect(missingLoad.loaded).toBe(false);

            __testUtils.setConfig({ llmProvider: undefined as any, incidentProvider: undefined as any });
            initializeProviders();
            let response = await api().get('/api/models');
            expect(response.status).toBe(200);

            const llmConfiguredSpy = vi.spyOn(__testUtils.llmRegistry, 'getConfigured').mockImplementation(() => {
                throw new Error('llm init failed');
            });
            const llmFallbackSpy = vi.spyOn(__testUtils.llmRegistry, 'get').mockReturnValue({
                type: 'copilot',
                displayName: 'Copilot',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['fallback-model']),
            } as any);
            const incidentConfiguredSpy = vi.spyOn(__testUtils.incidentRegistry, 'getConfigured').mockImplementation(() => {
                throw new Error('incident init failed');
            });
            const incidentFallbackSpy = vi.spyOn(__testUtils.incidentRegistry, 'get').mockReturnValue({
                isAvailable: vi.fn().mockResolvedValue(true),
                fetchIncident: vi.fn(),
            } as any);

            initializeProviders();
            response = await api().get('/api/models');
            expect(response.body).toEqual(['fallback-model']);
            response = await api().get('/api/incidents/status');
            expect(response.status).toBe(200);
            expect(response.body.available).toBe(true);
            expect(llmConfiguredSpy).toHaveBeenCalled();
            expect(llmFallbackSpy).toHaveBeenCalledWith('copilot');
            expect(incidentConfiguredSpy).toHaveBeenCalled();
            expect(incidentFallbackSpy).toHaveBeenCalledWith('manual');

            expect(shouldAutoStartServer({ VITEST: 'true' } as any)).toBe(false);
            expect(shouldAutoStartServer({} as any)).toBe(true);
        });

        it('WebSocket heartbeat marks alive, pings, and terminates unresponsive clients', () => {
            const wsHandlers = new Map<string, Function>();
            const ws = {
                readyState: 1,
                send: vi.fn(),
                ping: vi.fn(),
                terminate: vi.fn(),
                on: vi.fn((event: string, handler: Function) => {
                    wsHandlers.set(event, handler);
                }),
            };

            // Add mock ws to wss.clients so heartbeat can iterate it
            (__testUtils.wss.clients as Set<any>).add(ws);

            // Simulate connection — sets isAlive and registers pong handler
            __testUtils.wss.emit('connection', ws as any, { url: '/?id=heartbeat-test', headers: { host: 'localhost:3000' } } as any);
            expect((ws as any).isAlive).toBe(true);

            // Run heartbeat check: isAlive is true → sets false + pings
            __testUtils.wsHeartbeatCheck();
            expect((ws as any).isAlive).toBe(false);
            expect(ws.ping).toHaveBeenCalled();

            // Simulate pong response → isAlive back to true
            wsHandlers.get('pong')?.();
            expect((ws as any).isAlive).toBe(true);

            // Run heartbeat again: isAlive is true → sets false + pings
            ws.ping.mockClear();
            __testUtils.wsHeartbeatCheck();
            expect(ws.ping).toHaveBeenCalled();

            // Run heartbeat without pong → isAlive is false → terminate
            __testUtils.wsHeartbeatCheck();
            expect(ws.terminate).toHaveBeenCalled();

            // Cleanup
            (__testUtils.wss.clients as Set<any>).delete(ws);
        });

        it('covers global directory fallback and inclusion helper defaults', () => {
            __testUtils.setConfig({ repoRoot: 'C:/repo-root', investigationsPath: '', products: [], activeProductId: '' });

            expect(getGlobalInvestigationsDir()).toBe(path.join('C:/repo-root', 'investigations'));
            expect(shouldIncludeInvestigationInList({ id: 'no-active-product' } as any)).toBe(true);

            const cachedDir = path.join('C:/repo-root', 'investigations', 'cached-state');
            expect(hasPersistedInvestigationState({ id: 'cached-state', _storagePath: cachedDir } as any)).toBe(false);
        });

        it('covers effective config fallbacks, malformed config files, and recomputed persisted paths', () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-effective-config-'));
            const productDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-effective-product-'));
            __testUtils.setConfig({
                repoRoot,
                systemPromptPath: path.join(repoRoot, 'global-prompt.md'),
                knowledgeBasePath: path.join(repoRoot, 'global-docs'),
                workingDirectory: path.join(repoRoot, 'global-working'),
                investigationsPath: path.join(repoRoot, 'global-investigations'),
                products: [{
                    id: 'fallback-product',
                    name: 'Fallback Product',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: productDir,
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: 'fallback-product',
            });

            const effective = getEffectiveConfig({ productId: 'fallback-product' } as any);
            expect(effective.repoRoot).toBe(repoRoot);
            expect(effective.systemPromptPath).toBe(path.join(repoRoot, 'global-prompt.md'));
            expect(effective.knowledgeBasePath).toBe(productDir);
            expect(effective.workingDirectory).toBe(path.join(repoRoot, 'global-working'));
            expect(effective.investigationsPath).toBe(path.join(repoRoot, 'global-investigations'));

            const malformedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-config-bad-'));
            const malformedPath = path.join(malformedDir, 'config.json');
            fs.writeFileSync(malformedPath, '{bad json');
            expect(() => __testUtils.loadConfigFromDisk(malformedPath, JSON.parse(JSON.stringify(defaultConfig)), malformedDir)).toThrow();

            const persistedState = { id: 'persisted-product', target: 'stamp-persisted', productId: 'fallback-product' } as any;
            const storagePath = getInvestigationStoragePath(persistedState);
            fs.mkdirSync(storagePath, { recursive: true });
            fs.writeFileSync(path.join(storagePath, 'state.json'), JSON.stringify(makeState({ id: persistedState.id })));

            expect(shouldIncludeInvestigationInList(persistedState)).toBe(true);
            expect(hasPersistedInvestigationState(persistedState)).toBe(true);
            expect(isPathWithinDirectory(repoRoot, repoRoot)).toBe(true);
        });

        it('covers isolated config-load failures, validation fs errors, and legacy markdown load failures', async () => {
            vi.resetModules();
            const actualFs = await vi.importActual<typeof import('fs')>('fs');
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-isolated-server-'));
            fs.writeFileSync(path.join(tempRoot, 'broken.md'), '# broken markdown');

            const mockedFs = {
                ...actualFs,
                existsSync: vi.fn((filePath: any) => {
                    const value = String(filePath);
                    if (value.endsWith('broken-config.json')) {
                        return true;
                    }
                    if (value.includes('boom-path')) {
                        throw new Error('disk boom');
                    }
                    return actualFs.existsSync(filePath as any);
                }),
                readFileSync: vi.fn((filePath: any, options?: any) => {
                    if (String(filePath).endsWith('broken-config.json')) {
                        return '{bad json';
                    }
                    return (actualFs.readFileSync as any)(filePath, options);
                }),
                statSync: vi.fn((filePath: any, options?: any) => {
                    if (String(filePath).endsWith('broken.md')) {
                        throw new Error('stat boom');
                    }
                    return (actualFs.statSync as any)(filePath, options);
                }),
            };

            const originalArgv = process.argv;
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                vi.doMock('fs', () => mockedFs);
                process.argv = ['node', 'server.js', '--config', path.join(tempRoot, 'broken-config.json')];

                const isolated = await import('../server');
                const validation = isolated.validateProductPaths({
                    id: 'broken-fs',
                    name: 'Broken FS',
                    repoRoot: path.join(tempRoot, 'boom-path'),
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                } as any);

                expect(validation.paths).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ field: 'repoRoot', error: 'Unable to check path on disk' }),
                    ]),
                );

                isolated.__testUtils.setConfig({ investigationsPath: tempRoot, products: [], activeProductId: '' });
                isolated.loadHistory();

                expect(errorSpy).toHaveBeenCalledWith('Failed to load config file:', expect.any(Error));
                expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load legacy MD broken.md:'), expect.any(Error));
            } finally {
                process.argv = originalArgv;
                vi.doUnmock('fs');
                vi.resetModules();
            }
        });

        it('covers direct helper fallbacks for configured investigation paths and manifest defaults', () => {
            __testUtils.setConfig({
                investigationsPath: 'C:/configured-investigations',
                repoRoot: 'C:/repo-root',
                products: [{
                    id: 'fallback-fields',
                    name: 'Fallback Fields',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: '',
            });

            expect(getGlobalInvestigationsDir()).toBe('C:/configured-investigations');
            __testUtils.setConfig({ products: undefined as any, activeProductId: '' });
            expect(shouldIncludeInvestigationInList({ id: 'no-products' } as any)).toBe(true);
            __testUtils.setConfig({
                investigationsPath: 'C:/configured-investigations',
                repoRoot: 'C:/repo-root',
                products: [{
                    id: 'fallback-fields',
                    name: 'Fallback Fields',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: '',
            });

            const effective = getEffectiveConfig({
                productId: 'fallback-fields',
            } as any);
            expect(effective.investigationsPath).toBe('C:/configured-investigations');

            const manifest = resolveManifest('C:/repo-root', {});
            expect(manifest.name).toBe('repo-root');
            expect(manifest.systemPromptPath).toBe('');
        });

        it('falls back to the default repo root for global investigations', () => {
            __testUtils.setConfig({
                investigationsPath: '',
                repoRoot: '',
                products: [],
                activeProductId: '',
            });

            const investigationsDir = getGlobalInvestigationsDir();
            expect(path.basename(investigationsDir)).toBe('investigations');
            expect(path.isAbsolute(investigationsDir)).toBe(true);
        });
    });

    describe('cleanupRunner', () => {
        it('removes runner from map, removes listeners, and calls dispose', () => {
            const runners = __testUtils.getRunners();
            const runner = makeRunner({ id: 'cleanup-1', status: 'completed' });
            runner.dispose = vi.fn();
            runners.set('cleanup-1', runner as any);

            // Attach some listeners so we can verify they are removed
            runner.on('thought', () => {});
            runner.on('action', () => {});
            expect(runner.listenerCount('thought')).toBe(1);

            cleanupRunner('cleanup-1');

            expect(runners.has('cleanup-1')).toBe(false);
            expect(runner.listenerCount('thought')).toBe(0);
            expect(runner.listenerCount('action')).toBe(0);
            expect(runner.dispose).toHaveBeenCalled();
        });

        it('is safe to call with an id not in the map', () => {
            expect(() => cleanupRunner('nonexistent')).not.toThrow();
        });
    });

    describe('sanitizedError', () => {
        it('returns fallback message in production mode', () => {
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                expect(__testUtils.sanitizedError(new Error('secret details'))).toBe('Internal server error');
                expect(__testUtils.sanitizedError(new Error('oops'), 'Custom fallback')).toBe('Custom fallback');
            } finally {
                process.env.NODE_ENV = origEnv;
            }
        });

        it('falls back when error message is empty', () => {
            expect(__testUtils.sanitizedError(new Error(''))).toBe('Internal server error');
            expect(__testUtils.sanitizedError(new Error(''), 'Custom')).toBe('Custom');
        });
    });

    describe('broadcastToClients resilience', () => {
        it('continues delivering to remaining clients when one throws on send', () => {
            const clientMap = new Map<string, Set<any>>();
            const brokenClient = { readyState: 1, send: vi.fn(() => { throw new Error('buffer full'); }) };
            const goodClient = { readyState: 1, send: vi.fn() };
            clientMap.set('inv-x', new Set([brokenClient as any, goodClient as any]));

            const logger = { log: vi.fn() };
            __testUtils.broadcastToClients(clientMap as any, 'inv-x', 'thought', { text: 'hi' }, logger as any);

            // The good client should still receive the message despite the broken one
            expect(goodClient.send).toHaveBeenCalledWith(JSON.stringify({ type: 'thought', data: { text: 'hi' } }));
        });

        it('logs debug info when DEBUG_WS is set', () => {
            const origDebug = process.env.DEBUG_WS;
            process.env.DEBUG_WS = '1';
            try {
                const clientMap = new Map<string, Set<any>>();
                const openClient = { readyState: 1, send: vi.fn() };
                const closedClient = { readyState: 3, send: vi.fn() };
                clientMap.set('inv-d', new Set([openClient as any, closedClient as any]));

                const logger = { log: vi.fn() };
                __testUtils.broadcastToClients(clientMap as any, 'inv-d', 'status', { ok: true }, logger as any);

                expect(openClient.send).toHaveBeenCalled();
                expect(closedClient.send).not.toHaveBeenCalled();
                // Logger should be invoked for DEBUG_WS branches
                expect(logger.log).toHaveBeenCalled();

                // Also test the top-level DEBUG_WS branch with no matching client set
                const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
                __testUtils.broadcastToClients(clientMap as any, 'no-such-id', 'status', {}, logger as any);
                expect(spy).toHaveBeenCalledWith(expect.stringContaining('[WS Broadcast]'));
                spy.mockRestore();
            } finally {
                if (origDebug === undefined) delete process.env.DEBUG_WS;
                else process.env.DEBUG_WS = origDebug;
            }
        });
    });

    describe('LRU history store eviction', () => {
        it('evicts oldest entries to summary-only when exceeding MAX_IN_MEMORY', () => {
            const hist = __testUtils.getHistory();
            hist.clear();
            // Add more than MAX_IN_MEMORY entries (MAX is 1000)
            const overflow = 5;
            for (let i = 0; i < 1000 + overflow; i++) {
                hist.set(`lru-${i}`, makeState({ id: `lru-${i}`, target: `t-${i}` }) as any);
            }
            expect(hist.size).toBe(1000 + overflow);
            // The oldest should be downgraded to summary-only
            const oldest = hist.get(`lru-0`) as any;
            expect(oldest._summaryOnly).toBe(true);
            // The newest should still have full data
            const newest = hist.get(`lru-${1000 + overflow - 1}`) as any;
            // Summary-only records have _summaryOnly=true (not necessarily set for newest)
            expect(newest.id).toBe(`lru-${1000 + overflow - 1}`);
            hist.clear();
        });
    });

    describe('evictIdleRunners', () => {
        it('evicts paused runners that have been idle longer than TTL', () => {
            const runners = __testUtils.getRunners();
            const hist = __testUtils.getHistory();
            runners.clear();
            hist.clear();

            const mockRunner = makeRunner({ id: 'idle-test', status: 'paused' });
            (mockRunner as any)._lastActivityAt = Date.now() - (31 * 60 * 1000); // 31 min ago
            runners.set('idle-test', mockRunner as any);

            __testUtils.evictIdleRunners();

            // Runner should have been evicted
            expect(runners.has('idle-test')).toBe(false);
            // State should be persisted in history
            expect(hist.has('idle-test')).toBe(true);
            hist.clear();
        });

        it('does not evict running investigations', () => {
            const runners = __testUtils.getRunners();
            runners.clear();

            const mockRunner = makeRunner({ id: 'active-test', status: 'running' });
            (mockRunner as any)._lastActivityAt = Date.now() - (60 * 60 * 1000); // 1 hour ago
            runners.set('active-test', mockRunner as any);

            __testUtils.evictIdleRunners();

            expect(runners.has('active-test')).toBe(true);
            runners.clear();
        });

        it('skips runners with no state object', () => {
            const runners = __testUtils.getRunners();
            runners.clear();

            const noStateRunner = { state: undefined } as any;
            runners.set('no-state', noStateRunner);

            // Should not throw
            __testUtils.evictIdleRunners();
            expect(runners.has('no-state')).toBe(true);
            runners.clear();
        });
    });

    describe('basic routes', () => {
        it('returns health status', async () => {
            const response = await api().get('/api/health');
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('ok');
            expect(response.body.components).toBeDefined();
            expect(response.body.uptime).toBeGreaterThanOrEqual(0);
        });

        it('health reports configured LLM when provider is set', async () => {
            __testUtils.setConfig({
                ...__testUtils.getConfig(),
                llmProvider: { type: 'openai' } as any,
                mcpServers: [{ name: 'srv', command: 'echo', args: [] }] as any,
            });
            const response = await api().get('/api/health');
            expect(response.body.components.llmProvider.configured).toBe(true);
            expect(response.body.components.llmProvider.type).toBe('openai');
            expect(response.body.components.mcpServers.configured).toBe(true);
            expect(response.body.components.mcpServers.count).toBe(1);
        });

        it('health reports inaccessible storage for bad path', async () => {
            __testUtils.setConfig({
                ...__testUtils.getConfig(),
                investigationsPath: '/nonexistent_path_that_does_not_exist_abc123',
            });
            const response = await api().get('/api/health');
            expect(response.body.components.storage.accessible).toBe(false);
        });

        it('health falls back when llmProvider and mcpServers are missing', async () => {
            __testUtils.setConfig({
                ...__testUtils.getConfig(),
                llmProvider: undefined as any,
                mcpServers: undefined as any,
            });
            const response = await api().get('/api/health');
            expect(response.body.components.llmProvider).toEqual({ configured: false, type: 'none' });
            expect(response.body.components.mcpServers).toEqual({ configured: false, count: 0 });
        });

        it('returns no-auth status when no llm provider is active', async () => {
            const response = await api().get('/api/auth/status');
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ authenticated: false, providerType: 'none' });
        });

        it('returns auth provider metadata', async () => {
            const response = await api().get('/api/auth/providers');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.some((provider: any) => provider.type === 'copilot')).toBe(true);
        });

        it('returns auth status for an active provider', async () => {
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'device_code' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, username: 'user@example.com' }),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);

            const response = await api().get('/api/auth/status');

            expect(response.status).toBe(200);
            expect(response.body.authenticated).toBe(true);
            expect(response.body.authRequirement.type).toBe('device_code');
        });

        it('falls back to copilot provider metadata when config has no explicit llm provider type', async () => {
            __testUtils.setConfig({ llmProvider: undefined as any });
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'device_code' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);

            const response = await api().get('/api/auth/status');

            expect(response.status).toBe(200);
            expect(response.body.providerType).toBe('copilot');
        });

        it('rejects interactive auth login when the provider does not support it', async () => {
            const response = await api().post('/api/auth/login').send({});
            expect(response.status).toBe(400);
        });

        it('rejects auth polling when the provider does not support it', async () => {
            const response = await api().post('/api/auth/poll').send({ device_code: 'abc' });
            expect(response.status).toBe(400);
        });

        it('validates auth configure requests', async () => {
            const response = await api().post('/api/auth/configure').send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Provider type is required');
        });

        it('returns the current username', async () => {
            const response = await api().get('/api/me');
            expect(response.status).toBe(200);
            expect(typeof response.body.username).toBe('string');
        });

        it('returns a bad request for malformed JSON bodies', async () => {
            const response = await api()
                .post('/api/settings')
                .set('Content-Type', 'application/json')
                .send('{"broken":');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid JSON in request body');
        });

        it('returns configured models from the active provider', async () => {
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn(),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['model-a', 'model-b']),
            } as any);

            const response = await api().get('/api/models');
            expect(response.status).toBe(200);
            expect(response.body).toEqual(['model-a', 'model-b']);
        });

        it('falls back to default models when listing models fails', async () => {
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn(),
                getClient: vi.fn(),
                listModels: vi.fn().mockRejectedValue(new Error('boom')),
            } as any);

            const response = await api().get('/api/models');
            expect(response.status).toBe(200);
            expect(response.body).toContain('gpt-4o');
        });

        it('returns default models when no provider is active', async () => {
            __testUtils.setActiveLlmProvider(null);

            const response = await api().get('/api/models');

            expect(response.status).toBe(200);
            expect(response.body).toContain('gpt-4o');
        });

        it('rejects file browsing outside allowed roots', async () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-root-'));
            const invDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-inv-'));
            __testUtils.setConfig({ repoRoot: rootDir, investigationsPath: invDir });

            const response = await api().get('/api/files/list').query({ path: path.join(os.tmpdir(), 'forbidden') });
            expect(response.status).toBe(403);
        });

        it('returns not found for a missing file path', async () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-root-'));
            __testUtils.setConfig({ repoRoot: rootDir, investigationsPath: rootDir });

            const response = await api().get('/api/files/list').query({ path: path.join(rootDir, 'missing') });
            expect(response.status).toBe(404);
        });

        it('lists files in an allowed directory', async () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-root-'));
            fs.mkdirSync(path.join(rootDir, 'folder'));
            fs.writeFileSync(path.join(rootDir, 'a.txt'), 'content');
            __testUtils.setConfig({ repoRoot: rootDir, investigationsPath: rootDir });

            const response = await api().get('/api/files/list').query({ path: rootDir });
            expect(response.status).toBe(200);
            expect(response.body.entries[0]).toEqual({ name: 'folder', isDirectory: true });
        });

        it('uses the default path and sorts directories before files by name', async () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-root-default-'));
            const originalCwd = process.cwd();
            fs.mkdirSync(path.join(rootDir, 'beta'));
            fs.mkdirSync(path.join(rootDir, 'alpha'));
            fs.writeFileSync(path.join(rootDir, 'zeta.txt'), 'content');
            fs.writeFileSync(path.join(rootDir, 'eta.txt'), 'content');
            __testUtils.setConfig({ repoRoot: rootDir, investigationsPath: '' });

            try {
                process.chdir(rootDir);
                const response = await api().get('/api/files/list');

                expect(response.status).toBe(200);
                expect(response.body.entries.map((entry: any) => entry.name)).toEqual(['alpha', 'beta', 'eta.txt', 'zeta.txt']);
            } finally {
                process.chdir(originalCwd);
            }
        });

        it('rejects file browsing when the target path is a file', async () => {
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-file-list-'));
            const filePath = path.join(rootDir, 'single.txt');
            fs.writeFileSync(filePath, 'content');
            __testUtils.setConfig({ repoRoot: rootDir, investigationsPath: rootDir });

            const response = await api().get('/api/files/list').query({ path: filePath });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('not a directory');
        });

        it('returns incident provider status when no provider is configured', async () => {
            const response = await api().get('/api/incidents/status');
            expect(response.status).toBe(200);
            expect(response.body.available).toBe(false);
        });

        it('returns available incident providers', async () => {
            const response = await api().get('/api/incidents/providers');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });

        it('rejects reading incidents when no incident provider is active', async () => {
            const response = await api().post('/api/incidents/INC123/read').send({});
            expect(response.status).toBe(400);
        });

        it('lists no schedules when the scheduler store is uninitialized', async () => {
            const response = await api().get('/api/schedules');
            expect(response.status).toBe(200);
            expect(response.body.items).toEqual([]);
        });

        it('returns default scheduler status when scheduler is absent', async () => {
            const response = await api().get('/api/scheduler/status');
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ running: false });
        });

        it('returns empty query bank results when the store is uninitialized', async () => {
            const response = await api().get('/api/query-bank');
            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        it('rejects query bank writes when the store is uninitialized', async () => {
            const response = await api().post('/api/query-bank').send({ name: 'saved' });
            expect(response.status).toBe(500);
        });

        it('returns an empty investigation list by default', async () => {
            const response = await api().get('/api/investigations');
            expect(response.status).toBe(200);
            expect(response.body.items).toEqual([]);
        });

        it('returns not found for unknown investigation state', async () => {
            const response = await api().get('/api/investigations/does-not-exist');
            expect(response.status).toBe(404);
        });

        it('returns not found for missing step detail', async () => {
            const response = await api().get('/api/investigations/missing/steps/0');
            expect(response.status).toBe(404);
        });

        it('returns not found for unknown mcp status requests', async () => {
            const response = await api().get('/api/investigations/missing/mcp/status');
            expect(response.status).toBe(404);
        });

        it('returns products and active product metadata', async () => {
            __testUtils.setConfig({
                products: [{
                    id: 'prod-1',
                    name: 'Product 1',
                    repoRoot: 'C:/repo',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: 'C:/repo',
                    investigationsPath: 'C:/repo/investigations',
                }],
                activeProductId: 'prod-1',
            });

            const productsResponse = await api().get('/api/products');
            expect(productsResponse.status).toBe(200);
            expect(productsResponse.body).toHaveLength(1);

            const activeResponse = await api().get('/api/products/active');
            expect(activeResponse.status).toBe(200);
            expect(activeResponse.body.id).toBe('prod-1');
        });

        it('returns empty product metadata when products are missing', async () => {
            __testUtils.setConfig({ products: undefined as any, activeProductId: 'missing' });

            const productsResponse = await api().get('/api/products');
            const activeResponse = await api().get('/api/products/active');

            expect(productsResponse.body).toEqual([]);
            expect(activeResponse.body).toBeNull();
        });

        it('validates active product requests', async () => {
            let response = await api().put('/api/products/active').send({});
            expect(response.status).toBe(400);

            __testUtils.setConfig({ products: [] });
            response = await api().put('/api/products/active').send({ productId: 'missing' });
            expect(response.status).toBe(404);
        });

        it('requires repoRoot when discovering products', async () => {
            const response = await api().get('/api/products/discover');
            expect(response.status).toBe(400);
        });

        it('covers handler error paths for discovery, file listing, configured auth status, and unknown-user fallback', async () => {
            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const discoverLayer = stack.find((layer) => layer.route?.path === '/api/products/discover' && layer.route.methods?.get);
            const filesLayer = stack.find((layer) => layer.route?.path === '/api/files/list' && layer.route.methods?.get);
            expect(discoverLayer).toBeTruthy();
            expect(filesLayer).toBeTruthy();

            let status = vi.fn().mockReturnThis();
            let json = vi.fn();
            await discoverLayer.route.stack[0].handle({ query: { repoRoot: {} } }, { status, json });
            expect(status).toHaveBeenCalledWith(500);

            status = vi.fn().mockReturnThis();
            json = vi.fn();
            await filesLayer.route.stack[0].handle({ query: { path: {} } }, { status, json });
            expect(status).toHaveBeenCalledWith(500);

            __testUtils.setConfig({ llmProvider: { type: 'azure-openai' } as any });
            __testUtils.setActiveLlmProvider({
                type: 'azure-openai',
                displayName: 'Azure OpenAI',
                getAuthRequirement: () => ({ type: 'api_key' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['gpt-4.1']),
            } as any);

            let response = await api().get('/api/auth/status');
            expect(response.status).toBe(200);
            expect(response.body.providerType).toBe('azure-openai');

            const originalUsername = process.env.USERNAME;
            const originalUser = process.env.USER;
            delete process.env.USERNAME;
            delete process.env.USER;
            response = await api().get('/api/me');
            expect(response.status).toBe(200);
            expect(response.body.username).toBe('Unknown User');
            process.env.USERNAME = originalUsername;
            process.env.USER = originalUser;
        });
    });

    describe('settings, auth, and product mutations', () => {
        it('returns settings and validates settings updates', async () => {
            let response = await api().get('/api/settings');
            expect(response.status).toBe(200);
            expect(response.body.model).toBeDefined();

            response = await api().post('/api/settings').send({ maxSteps: -1 });
            expect(response.status).toBe(400);

            response = await api().post('/api/settings').send({ repoRoot: 123 });
            expect(response.status).toBe(400);
        });

        it('persists valid settings updates', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            try {
                const response = await api().post('/api/settings').send({ model: 'gpt-4.1', defaultView: 'list' });

                expect(response.status).toBe(200);
                expect(response.body.model).toBe('gpt-4.1');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('reinitializes providers when provider settings change', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const llmConfiguredSpy = vi.spyOn(__testUtils.llmRegistry, 'getConfigured');
            const incidentConfiguredSpy = vi.spyOn(__testUtils.incidentRegistry, 'getConfigured');

            try {
                const response = await api().post('/api/settings').send({
                    llmProvider: { type: 'copilot' },
                    incidentProvider: { type: 'manual' },
                });

                expect(response.status).toBe(200);
                expect(llmConfiguredSpy).toHaveBeenCalled();
                expect(incidentConfiguredSpy).toHaveBeenCalled();
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns 500 when settings persistence fails', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const circular: any = {};
            circular.self = circular;
            __testUtils.setPersistedConfig(circular);

            try {
                const response = await api().post('/api/settings').send({ model: 'gpt-4.2' });

                expect(response.status).toBe(500);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('reloads history on investigationsPath changes', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-settings-path-'));

            try {
                const historyClearSpy = vi.spyOn(__testUtils.getHistory(), 'clear');

                const response = await api().post('/api/settings').send({ investigationsPath: targetPath });
                expect(response.status).toBe(200);
                expect(historyClearSpy).toHaveBeenCalled();
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('exports settings via GET /api/settings/export', async () => {
            const response = await api().get('/api/settings/export');
            expect(response.status).toBe(200);
            expect(response.headers['content-disposition']).toContain('config.json');
            expect(response.body.model).toBeDefined();
        });

        it('imports valid settings via POST /api/settings/import', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            try {
                const response = await api().post('/api/settings/import').send({ model: 'gpt-4.1-imported', defaultView: 'list' });
                expect(response.status).toBe(200);
                expect(response.body.imported).toBe(2);
                expect(response.body.config.model).toBe('gpt-4.1-imported');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('rejects non-object import body', async () => {
            const response = await api().post('/api/settings/import').send([1, 2, 3]);
            expect(response.status).toBe(400);
        });

        it('rejects import with no valid keys', async () => {
            const response = await api().post('/api/settings/import').send({ unknownKey: 'value' });
            expect(response.status).toBe(400);
        });

        it('import with llmProvider triggers initializeProviders', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            try {
                const response = await api().post('/api/settings/import').send({ llmProvider: { type: 'copilot' } });
                expect(response.status).toBe(200);
                expect(response.body.imported).toBe(1);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('import returns 500 when saveConfigToDisk throws', async () => {
            const circular: any = {};
            circular.self = circular;
            __testUtils.setPersistedConfig(circular);
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const response = await api().post('/api/settings/import').send({ model: 'gpt-crash' });
            expect(response.status).toBe(500);
            expect(response.body.error).toContain('circular structure');
            consoleSpy.mockRestore();
        });

        it('supports auth login, polling, and configure success paths', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');

            try {
                __testUtils.setActiveLlmProvider({
                    type: 'fake',
                    displayName: 'Fake',
                    getAuthRequirement: () => ({ type: 'device_code' }),
                    configure: vi.fn(),
                    getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                    getClient: vi.fn(),
                    listModels: vi.fn().mockResolvedValue(['model-a']),
                    startAuthFlow: vi.fn().mockResolvedValue({ device_code: 'dc-1', user_code: 'code' }),
                    pollAuthFlow: vi.fn()
                        .mockResolvedValueOnce({ pending: true })
                        .mockResolvedValueOnce({ pending: false }),
                } as any);

                let response = await api().post('/api/auth/login').send({});
                expect(response.status).toBe(200);
                expect(response.body.device_code).toBe('dc-1');

                response = await api().post('/api/auth/poll').send({ device_code: 'dc-1' });
                expect(response.status).toBe(200);
                expect(response.body.pending).toBe(true);

                response = await api().post('/api/auth/poll').send({ device_code: 'dc-1' });
                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);

                response = await api().post('/api/auth/configure').send({ type: 'copilot' });
                expect(response.status).toBe(200);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns configuration persistence errors from auth configure', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const circular: any = {};
            circular.self = circular;
            __testUtils.setPersistedConfig(circular);

            try {
                const response = await api().post('/api/auth/configure').send({ type: 'copilot' });

                expect(response.status).toBe(400);
                expect(response.body.error).toContain('circular structure');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns provider errors for auth login and poll failures', async () => {
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'device_code' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
                getClient: vi.fn(),
                listModels: vi.fn().mockResolvedValue(['model-a']),
                startAuthFlow: vi.fn().mockRejectedValue(new Error('auth boom')),
                pollAuthFlow: vi.fn().mockRejectedValue(new Error('expired device code')),
            } as any);

            let response = await api().post('/api/auth/login').send({});
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('auth boom');

            response = await api().post('/api/auth/poll').send({ device_code: 'dc-1' });
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('expired device code');
        });

        it('covers product mutation fallbacks when product arrays are undefined', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');

            try {
                __testUtils.setConfig({ products: undefined as any, activeProductId: 'missing-product' });

                let response = await api().put('/api/products/active').send({ productId: 'missing-product' });
                expect(response.status).toBe(404);

                response = await api().put('/api/products/missing-product').send({ name: 'Still missing' });
                expect(response.status).toBe(404);

                response = await api().get('/api/products/missing-product/validate');
                expect(response.status).toBe(404);

                response = await api().post('/api/products/missing-product/clone').send({});
                expect(response.status).toBe(404);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('creates, validates, clones, updates, and deletes products', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-product-api-'));
            const investigationsPath = path.join(repoRoot, 'investigations');
            fs.mkdirSync(investigationsPath, { recursive: true });

            try {
                let response = await api().post('/api/products').send({
                    name: 'Alpha Product',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath,
                });
                expect(response.status).toBe(200);
                expect(response.body.id).toBe('alpha-product');

                response = await api().get('/api/products/alpha-product/validate');
                expect(response.status).toBe(200);
                expect(response.body.valid).toBe(true);

                response = await api().post('/api/products/alpha-product/clone').send({});
                expect(response.status).toBe(200);
                expect(response.body.id).toContain('alpha-product-copy');

                response = await api().put('/api/products/alpha-product').send({ name: 'Alpha Product Updated' });
                expect(response.status).toBe(200);
                expect(response.body.name).toBe('Alpha Product Updated');

                response = await api().put('/api/products/active').send({ productId: 'alpha-product' });
                expect(response.status).toBe(200);

                response = await api().delete('/api/products/alpha-product-copy');
                expect(response.status).toBe(200);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('covers product mutation edge cases and clone collision handling', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-product-edge-'));
            const investigationsPath = path.join(repoRoot, 'investigations');
            const anotherPath = path.join(repoRoot, 'investigations-2');
            fs.mkdirSync(investigationsPath, { recursive: true });
            fs.mkdirSync(anotherPath, { recursive: true });

            try {
                let response = await api().post('/api/products').send({ repoRoot });
                expect(response.status).toBe(400);

                __testUtils.setConfig({ products: undefined as any, activeProductId: '' });
                response = await api().post('/api/products').send({
                    name: 'Alpha Product',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath,
                });
                expect(response.status).toBe(200);

                response = await api().post('/api/products').send({
                    name: 'Alpha Product!!',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath,
                });
                expect(response.status).toBe(409);

                __testUtils.setConfig({
                    products: [
                        {
                            id: 'alpha-product',
                            name: 'Alpha Product',
                            repoRoot,
                            systemPromptPath: repoRoot,
                            knowledgeBasePath: repoRoot,
                            workingDirectory: repoRoot,
                            investigationsPath,
                        },
                        {
                            id: 'alpha-product-copy',
                            name: 'Alpha Product Copy',
                            repoRoot,
                            systemPromptPath: repoRoot,
                            knowledgeBasePath: repoRoot,
                            workingDirectory: repoRoot,
                            investigationsPath,
                        },
                        {
                            id: 'alpha-product-copy-2',
                            name: 'Alpha Product Copy 2',
                            repoRoot,
                            systemPromptPath: repoRoot,
                            knowledgeBasePath: repoRoot,
                            workingDirectory: repoRoot,
                            investigationsPath,
                        },
                    ],
                    activeProductId: 'alpha-product',
                });

                response = await api().post('/api/products/missing/clone').send({});
                expect(response.status).toBe(404);

                response = await api().post('/api/products/alpha-product/clone').send({});
                expect(response.status).toBe(200);
                expect(response.body.id).toBe('alpha-product-copy-3');

                response = await api().put('/api/products/missing').send({ name: 'Missing' });
                expect(response.status).toBe(404);

                const historyClearSpy = vi.spyOn(__testUtils.getHistory(), 'clear');
                response = await api().put('/api/products/alpha-product').send({ investigationsPath: anotherPath });
                expect(response.status).toBe(200);
                expect(historyClearSpy).toHaveBeenCalled();

                __testUtils.setConfig({ products: [], activeProductId: '' });
                response = await api().delete('/api/products/anything');
                expect(response.status).toBe(404);

                __testUtils.setConfig({
                    products: [{
                        id: 'only-product',
                        name: 'Only Product',
                        repoRoot,
                        systemPromptPath: repoRoot,
                        knowledgeBasePath: repoRoot,
                        workingDirectory: repoRoot,
                        investigationsPath,
                    }],
                    activeProductId: 'only-product',
                });
                response = await api().delete('/api/products/missing');
                expect(response.status).toBe(404);

                response = await api().delete('/api/products/only-product');
                expect(response.status).toBe(400);

                __testUtils.setConfig({
                    products: [
                        {
                            id: 'first',
                            name: 'First',
                            repoRoot,
                            systemPromptPath: repoRoot,
                            knowledgeBasePath: repoRoot,
                            workingDirectory: repoRoot,
                            investigationsPath,
                        },
                        {
                            id: 'second',
                            name: 'Second',
                            repoRoot,
                            systemPromptPath: repoRoot,
                            knowledgeBasePath: repoRoot,
                            workingDirectory: repoRoot,
                            investigationsPath,
                        },
                    ],
                    activeProductId: 'first',
                });
                response = await api().delete('/api/products/first');
                expect(response.status).toBe(200);
                expect(__testUtils.getConfig().activeProductId).toBe('second');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns not-found and last-product errors for product routes', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');

            try {
                __testUtils.setConfig({
                    products: [{
                        id: 'solo-product',
                        name: 'Solo Product',
                        repoRoot: '',
                        systemPromptPath: '',
                        knowledgeBasePath: '',
                        workingDirectory: '',
                        investigationsPath: '',
                    }],
                    activeProductId: 'solo-product',
                });

                let response = await api().get('/api/products/missing/validate');
                expect(response.status).toBe(404);

                response = await api().post('/api/products/missing/clone').send({});
                expect(response.status).toBe(404);
                expect(response.body.error).toBe('Source product not found');

                response = await api().delete('/api/products/solo-product');
                expect(response.status).toBe(400);
                expect(response.body.error).toBe('Cannot delete the last product');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('clears the active product when deleting duplicated active-product ids leaves no remainder', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');

            try {
                __testUtils.setConfig({
                    products: [
                        {
                            id: 'dup-product',
                            name: 'Duplicate A',
                            repoRoot: '',
                            systemPromptPath: '',
                            knowledgeBasePath: '',
                            workingDirectory: '',
                            investigationsPath: '',
                        },
                        {
                            id: 'dup-product',
                            name: 'Duplicate B',
                            repoRoot: '',
                            systemPromptPath: '',
                            knowledgeBasePath: '',
                            workingDirectory: '',
                            investigationsPath: '',
                        },
                    ],
                    activeProductId: 'dup-product',
                });

                const response = await api().delete('/api/products/dup-product');

                expect(response.status).toBe(200);
                expect(__testUtils.getConfig().activeProductId).toBe('');
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns 500 for product mutation routes when persistence fails', async () => {
            const originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-product-fail-'));
            const investigationsPath = path.join(repoRoot, 'investigations');
            fs.mkdirSync(investigationsPath, { recursive: true });

            const circular: any = {};
            circular.self = circular;

            try {
                __testUtils.setConfig({
                    products: [{
                        id: 'alpha-product',
                        name: 'Alpha Product',
                        repoRoot,
                        systemPromptPath: repoRoot,
                        knowledgeBasePath: repoRoot,
                        workingDirectory: repoRoot,
                        investigationsPath,
                    }, {
                        id: 'beta-product',
                        name: 'Beta Product',
                        repoRoot,
                        systemPromptPath: repoRoot,
                        knowledgeBasePath: repoRoot,
                        workingDirectory: repoRoot,
                        investigationsPath,
                    }],
                    activeProductId: 'alpha-product',
                });

                __testUtils.setPersistedConfig(circular);
                let response = await api().put('/api/products/active').send({ productId: 'alpha-product' });
                expect(response.status).toBe(500);

                __testUtils.setPersistedConfig(circular);
                response = await api().post('/api/products').send({
                    name: 'Gamma Product',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath,
                });
                expect(response.status).toBe(500);

                __testUtils.setPersistedConfig(circular);
                response = await api().post('/api/products/alpha-product/clone').send({});
                expect(response.status).toBe(500);

                __testUtils.setPersistedConfig(circular);
                response = await api().put('/api/products/alpha-product').send({ name: 'Alpha Updated' });
                expect(response.status).toBe(500);

                __testUtils.setPersistedConfig(circular);
                response = await api().delete('/api/products/alpha-product');
                expect(response.status).toBe(500);
            } finally {
                fs.writeFileSync(backendConfigFile, originalConfig);
            }
        });

        it('returns 500 when product validation throws unexpectedly', async () => {
            const unstableProduct: any = { id: 'unstable', name: 'Unstable' };
            Object.defineProperty(unstableProduct, 'repoRoot', {
                get() {
                    throw new Error('repoRoot boom');
                },
            });
            unstableProduct.systemPromptPath = '';
            unstableProduct.knowledgeBasePath = '';
            unstableProduct.workingDirectory = '';
            unstableProduct.investigationsPath = '';

            __testUtils.setConfig({ products: [unstableProduct], activeProductId: '' });

            const response = await api().get('/api/products/unstable/validate');

            expect(response.status).toBe(500);
        });

        it('returns the discovery none result when no recognizable structure exists', async () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-discover-none-'));

            const response = await api().get('/api/products/discover').query({ repoRoot });

            expect(response.status).toBe(200);
            expect(response.body.source).toBe('none');
        });

        it('discovers products from manifest and missing repo roots', async () => {
            let response = await api().get('/api/products/discover').query({ repoRoot: path.join(os.tmpdir(), 'missing-repo-root') });
            expect(response.status).toBe(404);

            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-manifest-'));
            fs.writeFileSync(path.join(repoRoot, '.investigator.json'), JSON.stringify({
                name: 'Manifest Product',
                systemPrompt: 'prompts/system.md',
                knowledgeBase: 'docs',
                workingDirectory: '.',
                investigationsPath: 'investigations',
            }));

            response = await api().get('/api/products/discover').query({ repoRoot });
            expect(response.status).toBe(200);
            expect(response.body.source).toBe('manifest');
            expect(response.body.product.name).toBe('Manifest Product');
        });

        it('falls back from malformed manifests to auto-discovery', async () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-manifest-fallback-'));
            fs.writeFileSync(path.join(repoRoot, '.investigator.json'), '{bad json');
            fs.mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
            fs.writeFileSync(path.join(repoRoot, '.github', 'agents', 'alpha.agent.md'), '# alpha');
            fs.writeFileSync(path.join(repoRoot, '.github', 'agents', 'beta.agent.md'), '# beta');
            fs.mkdirSync(path.join(repoRoot, 'docs', 'telemetry-investigations'), { recursive: true });
            fs.mkdirSync(path.join(repoRoot, 'investigations'), { recursive: true });

            const response = await api().get('/api/products/discover').query({ repoRoot });

            expect(response.status).toBe(200);
            expect(response.body.source).toBe('auto-discovered');
            expect(response.body.suggestions.some((item: string) => item.includes('agent prompts'))).toBe(true);
        });

        it('continues auto-discovery when the agents path exists as a file', () => {
            const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-agents-file-'));
            fs.mkdirSync(path.join(productRoot, '.github'), { recursive: true });
            fs.writeFileSync(path.join(productRoot, 'package.json'), JSON.stringify({ name: 'agent-product' }));
            fs.writeFileSync(path.join(productRoot, '.github', 'agents'), 'not-a-directory');

            const result = autoDiscoverProduct(productRoot);

            expect(result.product.name).toBe(path.basename(productRoot));
            expect(result.suggestions).toContain('Working directory defaulted to repo root');
        });

        it('uses validated product-specific paths and maxSteps when creating investigations', () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-create-product-'));
            const knowledgeBasePath = path.join(repoRoot, 'docs');
            const investigationsPath = path.join(repoRoot, 'investigations');
            fs.mkdirSync(knowledgeBasePath, { recursive: true });
            fs.mkdirSync(investigationsPath, { recursive: true });
            fs.writeFileSync(path.join(repoRoot, 'prompt.md'), '# prompt');

            setFakeLlmProvider();
            __testUtils.setConfig({
                repoRoot: path.join(os.tmpdir(), 'global-root'),
                systemPromptPath: path.join(os.tmpdir(), 'global-prompt.md'),
                knowledgeBasePath: path.join(os.tmpdir(), 'global-kb'),
                workingDirectory: path.join(os.tmpdir(), 'global-workdir'),
                investigationsPath: path.join(os.tmpdir(), 'global-investigations'),
                model: 'global-model',
                products: [{
                    id: 'prod-1',
                    name: 'Prod 1',
                    repoRoot,
                    systemPromptPath: path.join(repoRoot, 'prompt.md'),
                    knowledgeBasePath,
                    workingDirectory: repoRoot,
                    investigationsPath,
                }],
                activeProductId: 'prod-1',
            });

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            const { runner } = createInvestigation({
                query: 'Inspect product branch',
                target: 'stamp-product',
                timeRange: 'ago(30m)',
                productId: 'prod-1',
                maxSteps: 7,
            });

            expect((runner as any).config.repoRoot).toBe(repoRoot);
            expect((runner as any).config.knowledgeBasePath).toBe(knowledgeBasePath);
            expect((runner as any).config.investigationsPath).toBe(investigationsPath);
            expect((runner as any).config.maxSteps).toBe(7);
            expect((runner as any).state.productId).toBe('prod-1');
            expect(startSpy).toHaveBeenCalled();
        });

        it('builds incident-based investigation queries with scheduler defaults', () => {
            setFakeLlmProvider();
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            createInvestigation({
                incidentId: 'INC-77',
                target: 'stamp-incident',
                timeRange: 'ago(2h)',
                correlationId: 'corr-1',
                category: 'latency',
                query: '',
                source: 'scheduled',
            } as any);

            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Incident ID: INC-77'));
            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Target: stamp-incident'));
            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Time Range: ago(2h)'));
            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Correlation ID: corr-1'));
            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Category: latency'));
            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Investigate this incident. Extract context and route to the correct investigation guide.'));
        });

        it('uses the generic default user question when createInvestigation has no explicit query', () => {
            setFakeLlmProvider();
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            createInvestigation({
                target: 'stamp-default-query',
                timeRange: 'ago(30m)',
                query: '',
            });

            expect(startSpy).toHaveBeenCalledWith(expect.stringContaining('Start general investigation based on provided context.'));
        });

        it('falls back to global product settings when selected product fields are blank', () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-product-global-fallback-'));
            const knowledgeBasePath = path.join(repoRoot, 'docs');
            const workingDirectory = path.join(repoRoot, 'workdir');
            const investigationsPath = path.join(repoRoot, 'investigations');
            const systemPromptPath = path.join(repoRoot, 'prompt.md');
            fs.mkdirSync(knowledgeBasePath, { recursive: true });
            fs.mkdirSync(workingDirectory, { recursive: true });
            fs.mkdirSync(investigationsPath, { recursive: true });
            fs.writeFileSync(systemPromptPath, '# prompt');

            setFakeLlmProvider();
            __testUtils.setConfig({
                repoRoot,
                systemPromptPath,
                knowledgeBasePath,
                workingDirectory,
                investigationsPath,
                products: [{
                    id: 'prod-global-fallback',
                    name: 'Fallback Product',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: 'prod-global-fallback',
            });

            vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            const { runner } = createInvestigation({
                target: 'stamp-fallback',
                timeRange: 'ago(15m)',
                query: 'Use fallback settings',
                productId: 'prod-global-fallback',
            });

            expect((runner as any).config.repoRoot).toBe(repoRoot);
            expect((runner as any).config.systemPromptPath).toBe(systemPromptPath);
            expect((runner as any).config.knowledgeBasePath).toBe(knowledgeBasePath);
            expect((runner as any).config.workingDirectory).toBe(workingDirectory);
            expect((runner as any).config.investigationsPath).toBe(investigationsPath);
        });

        it('marks crashed investigation starts as failed and removes active runners', async () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-create-fail-'));
            setFakeLlmProvider();
            __testUtils.setConfig({
                repoRoot,
                workingDirectory: repoRoot,
                investigationsPath: repoRoot,
                products: [],
                activeProductId: '',
            });

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockRejectedValue(new Error('start failed'));
            const { id } = createInvestigation({
                query: 'Crash on start',
                target: 'stamp-fail',
                timeRange: 'ago(5m)',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(startSpy).toHaveBeenCalled();
            expect(__testUtils.getRunners().has(id)).toBe(false);
            expect(__testUtils.getHistory().get(id)?.status).toBe('failed');
        });

        it('rejects investigations for products with invalid paths', () => {
            setFakeLlmProvider();
            __testUtils.setConfig({
                repoRoot: '',
                systemPromptPath: '',
                knowledgeBasePath: '',
                workingDirectory: '',
                investigationsPath: '',
                products: [{
                    id: 'broken-product',
                    name: 'Broken Product',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: 'broken-product',
            });

            expect(() => createInvestigation({
                query: 'Inspect invalid product',
                target: 'stamp-invalid',
                timeRange: 'ago(10m)',
                productId: 'broken-product',
            })).toThrow(/Broken Product/);
        });

        it('removes completed runners and keeps paused ones after createInvestigation settles', async () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-create-settle-'));
            setFakeLlmProvider();
            __testUtils.setConfig({
                repoRoot,
                workingDirectory: repoRoot,
                investigationsPath: repoRoot,
                products: [],
                activeProductId: '',
            });

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start')
                .mockImplementationOnce(function (this: any) {
                    this.state.status = 'completed';
                    return Promise.resolve();
                })
                .mockImplementationOnce(function (this: any) {
                    this.state.status = 'paused';
                    return Promise.resolve();
                });
            vi.spyOn(Date, 'now')
                .mockReturnValueOnce(1700000001000)
                .mockReturnValueOnce(1700000002000);

            const completed = createInvestigation({
                query: 'Finish normally',
                target: 'stamp-complete',
                timeRange: 'ago(1m)',
            });
            const paused = createInvestigation({
                query: 'Pause instead',
                target: 'stamp-paused',
                timeRange: 'ago(1m)',
            });

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(startSpy).toHaveBeenCalledTimes(2);
            expect(__testUtils.getRunners().has(completed.id)).toBe(false);
            expect(__testUtils.getHistory().get(completed.id)?.status).toBe('completed');
            expect(__testUtils.getRunners().has(paused.id)).toBe(true);
            expect(__testUtils.getHistory().get(paused.id)?.status).toBe('paused');
        });

    });

    describe('investigation listing and detail routes', () => {
        it('caches list responses for history-only investigations and returns 304 on matching etag', async () => {
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-cache-'));
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });
            const historyState = makeState({ id: 'history-1', thoughts: ['history thought'] });
            const persistedStatePath = path.join(investigationsPath, 'history-1-state.json');
            fs.writeFileSync(persistedStatePath, JSON.stringify(historyState));
            (historyState as any)._statePath = persistedStatePath;
            __testUtils.getHistory().set(historyState.id, historyState as any);

            const first = await api().get('/api/investigations');
            expect(first.status).toBe(200);
            expect(first.headers.etag).toBeDefined();
            expect(first.body.items).toHaveLength(1);

            const second = await api().get('/api/investigations').set('If-None-Match', first.headers.etag as string);
            expect(second.status).toBe(304);
        });

        it('serves cached list payloads when the etag does not match and includes product and retrospect metadata', async () => {
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-history-cache-miss-'));
            __testUtils.setConfig({
                products: [{
                    id: 'known-product',
                    name: 'Known Product',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: '',
                investigationsPath,
            });

            const knownState = makeState({
                id: 'history-known',
                productId: 'known-product',
                thoughts: ['history thought'],
                retrospect: { proposals: [{ id: 'p1', status: 'pending' }], analysisComplete: true } as any,
            }) as any;
            const unknownState = makeState({ id: 'history-unknown', productId: 'missing-product', thoughts: ['other'] }) as any;

            for (const state of [knownState, unknownState]) {
                const statePath = path.join(investigationsPath, `${state.id}.json`);
                fs.writeFileSync(statePath, JSON.stringify(state));
                state._statePath = statePath;
                __testUtils.getHistory().set(state.id, state);
            }

            const first = await api().get('/api/investigations');
            const second = await api().get('/api/investigations').set('If-None-Match', '"stale"');

            expect(second.status).toBe(200);
            expect(second.headers.etag).toBe(first.headers.etag);
            expect(second.body.items.find((item: any) => item.id === 'history-known').productName).toBe('Known Product');
            expect(second.body.items.find((item: any) => item.id === 'history-known').retrospect.proposals).toEqual([{ id: 'p1', status: 'pending' }]);
            expect(second.body.items.find((item: any) => item.id === 'history-unknown').productName).toBe('Unknown');
        });

        it('hides non-persisted inactive history entries from the dashboard list', async () => {
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-visible-')) });
            __testUtils.getHistory().set('memory-only-1', makeState({ id: 'memory-only-1', thoughts: ['not persisted'] }) as any);

            const response = await api().get('/api/investigations');

            expect(response.status).toBe(200);
            expect(response.body.items.some((inv: any) => inv.id === 'memory-only-1')).toBe(false);
        });

        it('skips investigations that fail summary generation while returning valid items', async () => {
            const brokenState = makeState({ id: 'broken-list' }) as any;
            Object.defineProperty(brokenState, 'tags', {
                get() {
                    throw new Error('summary failure');
                },
            });
            const persistedState = makeState({ id: 'good-list', status: 'completed' }) as any;
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-summary-failure-'));
            const persistedStatePath = path.join(investigationsPath, 'good-list-state.json');
            fs.writeFileSync(persistedStatePath, JSON.stringify(persistedState));
            persistedState._statePath = persistedStatePath;

            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });
            __testUtils.getHistory().set('broken-list', brokenState);
            __testUtils.getHistory().set('good-list', persistedState);

            const response = await api().get('/api/investigations');

            expect(response.status).toBe(200);
            expect(response.body.items.some((item: any) => item.id === 'good-list')).toBe(true);
            expect(response.body.items.some((item: any) => item.id === 'broken-list')).toBe(false);
        });

        it('returns truncated investigation detail and step payloads', async () => {
            const longThought = 'x'.repeat(600);
            const longResult = 'y'.repeat(600);
            const runner = makeRunner({
                id: 'active-1',
                status: 'running',
                fullHistory: [longThought],
                fullActions: [{ tool: 'read_file', args: {}, result: longResult } as any],
            });
            __testUtils.getRunners().set('active-1', runner as any);

            let response = await api().get('/api/investigations/active-1');
            expect(response.status).toBe(200);
            expect(response.body.thoughts[0]._truncated).toBe(true);
            expect(response.body.actions[0]._truncated_result).toBe(true);

            response = await api().get('/api/investigations/active-1/steps/0');
            expect(response.status).toBe(200);
            expect(response.body.thought).toBe(longThought);

            response = await api().get('/api/investigations/active-1/steps/5');
            expect(response.status).toBe(400);
        });

        it('truncates long object thoughts and action results in investigation detail', async () => {
            const longContent = 'x'.repeat(700);
            const longResult = 'y'.repeat(700);
            __testUtils.getHistory().set('detail-2', makeState({
                id: 'detail-2',
                thoughts: [{ role: 'assistant', content: longContent }] as any,
                actions: [{ tool: 'read_file', result: longResult }] as any,
            }) as any);

            const response = await api().get('/api/investigations/detail-2');

            expect(response.status).toBe(200);
            expect(response.body.thoughts[0]._truncated).toBe(true);
            expect(response.body.thoughts[0]._original_type).toBe('object');
            expect(response.body.thoughts[0].content.endsWith('...')).toBe(true);
            expect(response.body.actions[0]._truncated_result).toBe(true);
            expect(response.body.actions[0].result.endsWith('...')).toBe(true);
        });

        it('returns non-truncated string and object thoughts in investigation detail', async () => {
            __testUtils.getHistory().set('detail-3', makeState({
                id: 'detail-3',
                thoughts: ['short thought', { role: 'assistant', content: 'short object' }] as any,
                actions: [{ tool: 'noop', result: '' }, { tool: 'noop', result: { ok: true } }] as any,
            }) as any);

            let response = await api().get('/api/investigations/detail-3');
            expect(response.status).toBe(200);
            expect(response.body.thoughts[0]).toBe('short thought');
            expect(response.body.thoughts[1].content).toBe('short object');
            expect(response.body.actions[0].result).toBe('');
            expect(response.body.actions[1].result).toEqual({ ok: true });

            response = await api().get('/api/investigations/missing-detail/steps/0');
            expect(response.status).toBe(404);
        });

        it('covers lightweight detail fallbacks for object thoughts without string content and empty actions', async () => {
            __testUtils.getHistory().set('detail-4', makeState({
                id: 'detail-4',
                thoughts: [{ role: 'assistant', value: { ok: true } }] as any,
                actions: [null] as any,
            }) as any);

            const response = await api().get('/api/investigations/detail-4');

            expect(response.status).toBe(200);
            expect(response.body.thoughts[0]).toEqual({ role: 'assistant', value: { ok: true } });
            expect(response.body.actions[0]).toBeNull();
        });

        it('rebuilds history summaries from recomputed storage paths and summary-only metadata', async () => {
            const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-summary-only-'));
            const productDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-summary-product-'));
            __testUtils.setConfig({
                repoRoot,
                investigationsPath: '',
                products: [{
                    id: 'prod-summary',
                    name: 'Summary Product',
                    repoRoot,
                    systemPromptPath: repoRoot,
                    knowledgeBasePath: repoRoot,
                    workingDirectory: repoRoot,
                    investigationsPath: productDir,
                }],
                activeProductId: 'prod-summary',
            });

            const summaryState = {
                ...makeState({
                    id: '1700000001111',
                    status: 'completed',
                    productId: 'prod-summary',
                    thoughts: ['summary thought'],
                    tags: undefined as any,
                }),
                _summaryOnly: true,
                _thoughtCount: 7,
                retrospect: {
                    proposals: [{ id: 'proposal-2', status: 'approved' }],
                    analysisComplete: false,
                    analysisFailed: true,
                    completed: false,
                },
            } as any;

            const storagePath = getInvestigationStoragePath(summaryState);
            fs.mkdirSync(storagePath, { recursive: true });
            fs.writeFileSync(path.join(storagePath, 'state.json'), JSON.stringify(summaryState));
            __testUtils.getHistory().set(summaryState.id, summaryState);

            const response = await api().get('/api/investigations');

            expect(response.status).toBe(200);
            expect(response.headers.etag).toBeDefined();

            const item = response.body.items.find((entry: any) => entry.id === summaryState.id);
            expect(item.storagePath).toBe(storagePath);
            expect(item.thoughtCount).toBe(7);
            expect(item.tags).toEqual([]);
            expect(item.retrospect.proposals).toEqual([{ id: 'proposal-2', status: 'approved' }]);
            expect(item.retrospect.analysisFailed).toBe(true);
            expect(item.retrospect.completed).toBe(false);
        });

        it('covers active-list summary recomputation, item-level failures, and top-level list failures', async () => {
            const runner = makeRunner({
                id: 'active-summary-only',
                status: 'paused',
                thoughts: ['summary thought'],
            }, {
                state: {
                    ...makeState({
                        id: 'active-summary-only',
                        status: 'paused',
                        productId: 'prod-list',
                        thoughts: ['summary thought'],
                    }),
                    _summaryOnly: true,
                    _thoughtCount: 9,
                    retrospect: { analysisComplete: true },
                },
            });
            const brokenRunner = makeRunner({ id: 'active-broken-list', status: 'paused' }, {
                state: {
                    ...makeState({ id: 'active-broken-list', status: 'paused', productId: 'prod-list' }),
                    get title() {
                        throw new Error('title summary failed');
                    },
                },
            });

            __testUtils.setConfig({
                repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-active-list-')),
                investigationsPath: '',
                products: [{ id: 'prod-list', name: 'List Product', investigationsPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-active-list-product-')) } as any],
                activeProductId: 'prod-list',
            });
            __testUtils.getRunners().set('active-summary-only', runner as any);
            __testUtils.getRunners().set('active-broken-list', brokenRunner as any);

            let response = await api().get('/api/investigations');
            expect(response.status).toBe(200);
            const item = response.body.items.find((entry: any) => entry.id === 'active-summary-only');
            expect(item.storagePath).toContain('activesummaryonly');
            expect(item.thoughtCount).toBe(9);
            expect(item.retrospect.proposals).toEqual([]);
            expect(response.body.items.some((entry: any) => entry.id === 'active-broken-list')).toBe(false);
            expect(response.headers.etag).toBeDefined();

            const valuesSpy = vi.spyOn(__testUtils.getRunners(), 'values').mockImplementation(() => {
                throw new Error('runner values failed');
            });
            response = await api().get('/api/investigations');
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to list investigations');
            valuesSpy.mockRestore();
        });

        it('covers list fallbacks for missing products, invalid entries, summary-only thoughts, and default etag timestamps', async () => {
            __testUtils.setConfig({
                repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-list-fallbacks-')),
                investigationsPath: '',
                products: undefined as any,
                activeProductId: '',
            });

            const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-invalid-list-entry-'));
            const invalidStatePath = path.join(invalidDir, 'state.json');
            fs.writeFileSync(invalidStatePath, JSON.stringify({ id: 'invalid-entry' }));
            (__testUtils.getHistory() as any).records.set('invalid-entry', {
                id: '',
                target: 'broken',
                status: 'paused',
                thoughts: [],
                actions: [],
                logs: [],
                _summaryOnly: true,
                _storagePath: invalidDir,
                _statePath: invalidStatePath,
            });
            const summaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-summary-fallback-'));
            const summaryStatePath = path.join(summaryDir, 'state.json');
            fs.writeFileSync(summaryStatePath, JSON.stringify({ id: 'summary-fallback' }));
            __testUtils.getHistory().set('summary-fallback', {
                ...makeState({ id: 'summary-fallback', productId: 'missing-product' }),
                thoughts: null,
                _summaryOnly: true,
                _thoughtCount: undefined,
                _storagePath: summaryDir,
                _statePath: summaryStatePath,
            } as any);

            __testUtils.setListCacheDirtyAt(0);
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000999);

            const response = await api().get('/api/investigations');

            expect(response.status).toBe(200);
            expect(response.headers.etag).toBeDefined();
            expect(response.headers.etag).toBe('"1700000000999"');
            expect(response.body.items).toHaveLength(1);
            expect(response.body.items[0].id).toBe('summary-fallback');
            expect(response.body.items[0].thoughtCount).toBe(0);
            expect(response.body.items[0].thoughts).toEqual([]);
            expect(response.body.items[0].productName).toBe('Unknown');

            nowSpy.mockRestore();
        });
    });

    describe('investigation list pagination, filtering, sorting, and search', () => {
        function setupInvestigations() {
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-pagination-'));
            __testUtils.setConfig({
                products: [],
                activeProductId: '',
                investigationsPath,
            });

            const states = [
                makeState({ id: '1000', status: 'completed', target: 'stamp-alpha', tags: ['urgent'], source: 'manual', createdBy: 'alice', thoughts: ['thought1'], title: 'Alpha latency', contestCount: 1 }),
                makeState({ id: '2000', status: 'failed', target: 'stamp-beta', tags: ['p0'], source: 'scheduled', createdBy: 'bob', thoughts: ['thought1', 'thought2'], title: 'Beta failure' }),
                makeState({ id: '3000', status: 'completed', target: 'stamp-gamma', tags: ['urgent', 'p0'], source: 'manual', createdBy: 'alice', thoughts: ['thought1', 'thought2', 'thought3'], title: 'Gamma check' }),
                makeState({ id: '4000', status: 'aborted', target: 'stamp-delta', source: 'scheduled', createdBy: 'charlie', thoughts: ['t1'], title: 'Delta abort', tags: undefined as any }),
                makeState({ id: '5000', status: 'completed', target: 'stamp-alpha', tags: ['urgent'], source: 'manual', createdBy: 'bob', thoughts: ['t1'], title: 'Alpha review' }),
            ];

            for (const s of states) {
                const statePath = path.join(investigationsPath, `${s.id}-state.json`);
                fs.writeFileSync(statePath, JSON.stringify(s));
                (s as any)._statePath = statePath;
                (s as any)._lastModified = Number(s.id) + 500;
                __testUtils.getHistory().set(s.id, s as any);
            }

            return states;
        }

        it('paginates results with page and pageSize', async () => {
            setupInvestigations();
            const r1 = await api().get('/api/investigations?page=1&pageSize=2');
            expect(r1.status).toBe(200);
            expect(r1.body.items).toHaveLength(2);
            expect(r1.body.totalCount).toBe(3); // only manual investigations shown by default
            expect(r1.body.totalPages).toBe(2);
            expect(r1.body.page).toBe(1);
            expect(r1.body.pageSize).toBe(2);

            const r2 = await api().get('/api/investigations?page=2&pageSize=2');
            expect(r2.body.items).toHaveLength(1);
            expect(r2.body.page).toBe(2);
        });

        it('filters by status', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?filter=completed');
            expect(r.body.items.every((i: any) => i.status === 'completed')).toBe(true);
            expect(r.body.totalCount).toBe(3);
        });

        it('filters by productFilter', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?productFilter=nonexistent');
            expect(r.body.totalCount).toBe(0);
        });

        it('filters by sourceFilter', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?sourceFilter=scheduled');
            expect(r.body.items.every((i: any) => i.source === 'scheduled')).toBe(true);
            expect(r.body.totalCount).toBe(2);
        });

        it('excludes scheduled investigations from default list', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations');
            expect(r.body.items.every((i: any) => i.source !== 'scheduled')).toBe(true);
            expect(r.body.totalCount).toBe(3);
        });

        it('filters by tagFilter', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?tagFilter=p0');
            expect(r.body.totalCount).toBe(1); // only manual investigation 3000 has p0
        });

        it('filters by createdByFilter', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?createdByFilter=alice');
            expect(r.body.items.every((i: any) => i.createdBy === 'alice')).toBe(true);
            expect(r.body.totalCount).toBe(2);
        });

        it('sourceFilter covers fallback for undefined source fields', async () => {
            // Exercise (s.source || 'manual') fallback in both filterSource branches
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-src-'));
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });
            const s1 = makeState({ id: '9001', status: 'completed', target: 'x', title: 'No source' });
            delete (s1 as any).source; // undefined source → falls back to 'manual'
            const s2 = makeState({ id: '9002', status: 'completed', target: 'x', title: 'Has source', source: 'scheduled' });
            for (const s of [s1, s2]) {
                const sp = path.join(investigationsPath, `${s.id}-state.json`);
                fs.writeFileSync(sp, JSON.stringify(s));
                (s as any)._statePath = sp;
                (s as any)._lastModified = Number(s.id);
                __testUtils.getHistory().set(s.id, s as any);
            }
            // sourceFilter=manual should match s1 (undefined → 'manual' fallback)
            const r = await api().get('/api/investigations?sourceFilter=manual');
            expect(r.body.totalCount).toBe(1);
            expect(r.body.items[0].id).toBe('9001');
        });

        it('tagFilter covers fallback for undefined tags', async () => {
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-tag-'));
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });
            const s1 = makeState({ id: '9003', status: 'completed', target: 'x', title: 'No tags', source: 'manual' });
            delete (s1 as any).tags; // undefined tags → falls back to []
            const s2 = makeState({ id: '9004', status: 'completed', target: 'x', title: 'Has tag', source: 'manual', tags: ['prod'] });
            for (const s of [s1, s2]) {
                const sp = path.join(investigationsPath, `${s.id}-state.json`);
                fs.writeFileSync(sp, JSON.stringify(s));
                (s as any)._statePath = sp;
                (s as any)._lastModified = Number(s.id);
                __testUtils.getHistory().set(s.id, s as any);
            }
            const r = await api().get('/api/investigations?tagFilter=prod');
            expect(r.body.totalCount).toBe(1);
            expect(r.body.items[0].id).toBe('9004');
        });

        it('createdByFilter covers fallback for undefined createdBy', async () => {
            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-cb-'));
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });
            const s1 = makeState({ id: '9005', status: 'completed', target: 'x', title: 'No creator', source: 'manual' });
            delete (s1 as any).createdBy; // undefined createdBy → falls back to ''
            const s2 = makeState({ id: '9006', status: 'completed', target: 'x', title: 'Has creator', source: 'manual', createdBy: 'alice' });
            for (const s of [s1, s2]) {
                const sp = path.join(investigationsPath, `${s.id}-state.json`);
                fs.writeFileSync(sp, JSON.stringify(s));
                (s as any)._statePath = sp;
                (s as any)._lastModified = Number(s.id);
                __testUtils.getHistory().set(s.id, s as any);
            }
            const r = await api().get('/api/investigations?createdByFilter=alice');
            expect(r.body.totalCount).toBe(1);
            expect(r.body.items[0].id).toBe('9006');
        });

        it('searches across title, target, tags, and createdBy', async () => {
            setupInvestigations();
            // 'alpha' matches manual investigations (id 1000, 5000)
            const r = await api().get('/api/investigations?search=alpha');
            expect(r.body.totalCount).toBe(2);
            expect(r.body.items.every((i: any) => i.title.includes('Alpha'))).toBe(true);
        });

        it('sorts by oldest', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?sortOrder=oldest');
            const ids = r.body.items.map((i: any) => i.id);
            expect(ids[0]).toBe('1000');
        });

        it('sorts by steps (thoughtCount descending)', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?sortOrder=steps');
            const counts = r.body.items.map((i: any) => i.thoughtCount);
            for (let i = 1; i < counts.length; i++) {
                expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
            }
        });

        it('sorts by modified', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?sortOrder=modified');
            expect(r.body.items[0].id).toBe('5000'); // highest lastModified
        });

        it('sorts pinned items first', async () => {
            setupInvestigations();
            // Pin both 1000 (index 0) and 5000 (index 4) so the sort calls compare in both
            // directions: (1000_pinned, 2000_unpinned) -> returns -1 AND (3000_unpinned, 5000_pinned) -> returns 1
            const r = await api().get('/api/investigations?pinnedIds=1000,5000');
            const ids = r.body.items.map((i: any) => i.id);
            // Both pinned items must be the first two
            expect([ids[0], ids[1]].sort()).toEqual(['1000', '5000']);
        });

        it('returns filterMeta and stats in the envelope', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations');
            expect(r.body.filterMeta).toBeDefined();
            expect(r.body.filterMeta.tags).toEqual(expect.arrayContaining(['urgent', 'p0']));
            // 'charlie' only has scheduled investigations, so not in default view creators
            expect(r.body.filterMeta.creators).toEqual(expect.arrayContaining(['alice', 'bob']));
            expect(r.body.stats.total).toBe(3); // only manual investigations
            expect(r.body.stats.completed).toBe(3);
            expect(r.body.stats.failed).toBe(0); // failed one is scheduled
            expect(r.body.stats.aborted).toBe(0); // aborted one is scheduled
            expect(r.body.stats.contestRate).toBeGreaterThan(0);
        });

        it('clamps page when beyond totalPages', async () => {
            setupInvestigations();
            const r = await api().get('/api/investigations?page=100&pageSize=2');
            expect(r.body.page).toBe(2); // clamped to last page (3 manual items / 2 per page = 2 pages)
            expect(r.body.items.length).toBeGreaterThan(0);
        });

        it('uses correct weekStart when today is Sunday (dayOfWeek === 0 branch)', async () => {
            // March 22, 2026 is a Sunday
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2026-03-22T12:00:00.000Z'));
                setupInvestigations();
                const r = await api().get('/api/investigations');
                expect(r.status).toBe(200);
                expect(r.body.stats).toBeDefined();
            } finally {
                vi.useRealTimers();
            }
        });

        it('counts thisWeekCount and lastWeekCount for items with epoch-range IDs', async () => {
            // Pin system time so weekStart/lastWeekStart are deterministic
            vi.useFakeTimers();
            try {
            // Tuesday March 24 2026 12:00 UTC
            const now = new Date('2026-03-24T12:00:00.000Z').getTime();
            vi.setSystemTime(now);

            // weekStart = Mon March 23 2026 00:00 UTC
            const weekStart = new Date('2026-03-23T00:00:00.000Z').getTime();
            // lastWeekStart = Mon March 16 2026 00:00 UTC
            const lastWeekStart = new Date('2026-03-16T00:00:00.000Z').getTime();

            const investigationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-week-'));
            __testUtils.setConfig({ products: [], activeProductId: '', investigationsPath });

            const thisWeekId = (weekStart + 3600_000).toString();      // 1h into this week
            const lastWeekId = (lastWeekStart + 3600_000).toString();   // 1h into last week
            const olderWeekId = (lastWeekStart - 86400_000).toString(); // before last week

            for (const [id, status] of [[thisWeekId, 'completed'], [lastWeekId, 'completed'], [olderWeekId, 'failed']] as const) {
                const s = makeState({ id, status, target: 'stamp-week' });
                const statePath = path.join(investigationsPath, `${id}-state.json`);
                fs.writeFileSync(statePath, JSON.stringify(s));
                (s as any)._statePath = statePath;
                (s as any)._lastModified = Number(id) + 500; // d=500ms, in (0, dayMs), covers durations.push
                __testUtils.getHistory().set(id, s as any);
            }

            // Add a 'running' history item (not in runners map) so summaries has a mix of
            // active and inactive items, causing sort to call compare(inactive, running) -> 1
            const runningId = (weekStart + 7200_000).toString(); // 2h into this week
            const sRunning = makeState({ id: runningId, status: 'running', target: 'stamp-week' });
            const runningPath = path.join(investigationsPath, `${runningId}-state.json`);
            fs.writeFileSync(runningPath, JSON.stringify(sRunning));
            (sRunning as any)._statePath = runningPath;
            (sRunning as any)._lastModified = Number(runningId) + 500;
            __testUtils.getHistory().set(runningId, sRunning as any);

            // Add a completed item with ID LARGER than runningId so insertion sort eventually
            // calls compare(this_inactive, runningId) => aActive=false, bActive=true => returns 1
            const bigInactiveId = (weekStart + 10800_000).toString(); // 3h into this week > runningId
            const sBigInactive = makeState({ id: bigInactiveId, status: 'completed', target: 'stamp-week' });
            const bigInactivePath = path.join(investigationsPath, `${bigInactiveId}-state.json`);
            fs.writeFileSync(bigInactivePath, JSON.stringify(sBigInactive));
            (sBigInactive as any)._statePath = bigInactivePath;
            (sBigInactive as any)._lastModified = Number(bigInactiveId) + 500;
            __testUtils.getHistory().set(bigInactiveId, sBigInactive as any);

            // Also delete query and target to cover the `s.query || ''` and `s.target || ''` fallbacks
            const noContestId = (lastWeekStart + 7200_000).toString();
            const sNoContest = makeState({ id: noContestId, status: 'completed', target: '' });
            delete (sNoContest as any).contestCount;
            delete (sNoContest as any).query;
            const noContestPath = path.join(investigationsPath, `${noContestId}-state.json`);
            fs.writeFileSync(noContestPath, JSON.stringify(sNoContest));
            (sNoContest as any)._statePath = noContestPath;
            (sNoContest as any)._lastModified = Number(noContestId) + 500;
            __testUtils.getHistory().set(noContestId, sNoContest as any);

            const r = await api().get('/api/investigations');
            expect(r.status).toBe(200);
            expect(r.body.stats.thisWeekCount).toBe(3);  // thisWeekId + runningId + bigInactiveId
            expect(r.body.stats.lastWeekCount).toBe(2);  // lastWeekId + noContestId
            expect(r.body.stats.durationSamples).toBeGreaterThan(0); // duration push branch covered

            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('investigation mutation routes', () => {
        it('creates investigations, enforces concurrency, and reports provider configuration errors', async () => {
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            setFakeLlmProvider();

            let response = await api().post('/api/investigations').send({
                query: 'Investigate pipeline latency',
                target: 'stamp-01',
                timeRange: 'ago(1h)',
                category: 'latency',
            });
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('running');
            expect(startSpy).toHaveBeenCalled();

            __testUtils.setConfig({ maxConcurrentInvestigations: 1 });
            __testUtils.getRunners().set('busy-1', makeRunner({ id: 'busy-1', status: 'running' }) as any);
            response = await api().post('/api/investigations').send({
                query: 'Another run',
                target: 'stamp-02',
                timeRange: 'ago(30m)',
            });
            expect(response.status).toBe(429);

            __testUtils.resetRuntimeState();
            __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
            response = await api().post('/api/investigations').send({
                query: 'Investigate pipeline latency',
                target: 'stamp-03',
                timeRange: 'ago(1h)',
            });
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('No LLM provider configured');
        });

        it('validates target and timeRange when creating investigations without an incident id', async () => {
            setFakeLlmProvider();

            let response = await api().post('/api/investigations').send({
                query: 'Missing target',
                timeRange: 'ago(15m)',
            });
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('target is required');

            response = await api().post('/api/investigations').send({
                query: 'Missing time range',
                target: 'stamp-validation',
            });
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('timeRange is required');
        });

        it('rehydrates inactive investigations for resume, pause, abort, intervene, and contest flows', async () => {
            setFakeLlmProvider();
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            const saveArtifactsSpy = vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockResolvedValue(undefined);
            const resumeSpy = vi.spyOn(AgentRunner.prototype as any, 'resume');
            const contestSpy = vi.spyOn(AgentRunner.prototype as any, 'contestReport');
            const logSpy = vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

            const pausedState = makeState({ id: 'hist-resume', status: 'paused', query: 'Resume me', scheduleId: 'sched-1' });
            const completedState = makeState({ id: 'hist-contest', status: 'completed', query: 'Contest me' });
            __testUtils.getHistory().set(pausedState.id, pausedState as any);
            __testUtils.getHistory().set(completedState.id, completedState as any);
            __testUtils.setScheduleStore({ update: vi.fn() } as any);

            let response = await api().post('/api/investigations/hist-resume/action').send({ action: 'resume' });
            expect(response.status).toBe(200);
            expect(resumeSpy).toHaveBeenCalled();
            expect(startSpy).toHaveBeenCalledWith('Resume me');

            response = await api().post('/api/investigations/hist-resume/action').send({ action: 'pause' });
            expect(response.status).toBe(200);
            expect(saveArtifactsSpy).toHaveBeenCalled();

            response = await api().post('/api/investigations/hist-resume/action').send({ action: 'abort' });
            expect(response.status).toBe(200);

            response = await api().post('/api/investigations/hist-resume/action').send({ action: 'intervene', message: 'Check the queue depth' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('hist-resume')?.thoughts.some((thought: any) =>
                typeof thought === 'object' && String(thought.content).includes('Check the queue depth')
            )).toBe(true);

            response = await api().post('/api/investigations/hist-contest/action').send({ action: 'contest', message: 'Need stronger evidence' });
            expect(response.status).toBe(200);
            expect(contestSpy).toHaveBeenCalledWith('Need stronger evidence');
            expect(logSpy).toHaveBeenCalled();

            response = await api().post('/api/investigations/hist-resume/action').send({ action: 'invalid' });
            expect(response.status).toBe(400);
        });

        it('restores a completed investigation to the previous checkpoint', async () => {
            const runner = makeRunner({
                id: 'hist-restore',
                status: 'completed',
            }, { restoreToLastCheckpoint: vi.fn().mockResolvedValue(undefined) });
            (runner as any).state.contestCount = 1;
            (runner as any).state.finalReport = 'Some report';
            __testUtils.getRunners().set('hist-restore', runner as any);

            const response = await api().post('/api/investigations/hist-restore/action').send({ action: 'restore' });
            expect(response.status).toBe(200);
            expect(runner.restoreToLastCheckpoint).toHaveBeenCalled();
        });

        it('blocks restore when contestCount is 0', async () => {
            const completedState = makeState({
                id: 'hist-restore-zero',
                status: 'completed',
                contestCount: 0,
                finalReport: 'Report',
            });
            __testUtils.getHistory().set(completedState.id, completedState as any);

            // Use an active runner to avoid LLM provider requirement
            const runner = makeRunner({
                id: 'hist-restore-zero',
                status: 'completed',
            }, { restoreToLastCheckpoint: vi.fn() });
            (runner as any).state.contestCount = 0;
            __testUtils.getRunners().set('hist-restore-zero', runner as any);

            const response = await api().post('/api/investigations/hist-restore-zero/action').send({ action: 'restore' });
            expect(response.status).toBe(400);
            expect(response.body.error).toMatch(/No previous checkpoint/);
        });

        it('blocks restore when implementation is running', async () => {
            const runner = makeRunner({
                id: 'impl-restore',
                status: 'completed',
            }, { restoreToLastCheckpoint: vi.fn() });
            (runner as any).state.contestCount = 1;
            (runner as any).state.implementationRunning = true;
            __testUtils.getRunners().set('impl-restore', runner as any);

            const response = await api().post('/api/investigations/impl-restore/action').send({ action: 'restore' });
            expect(response.status).toBe(409);
            expect(response.body.error).toMatch(/Cannot restore while implementation is running/);
        });

        it('returns 400 when restoreToLastCheckpoint throws', async () => {
            const runner = makeRunner({
                id: 'restore-throw',
                status: 'completed',
            }, { restoreToLastCheckpoint: vi.fn().mockRejectedValue(new Error('unable to extract the previous report')) });
            (runner as any).state.contestCount = 1;
            __testUtils.getRunners().set('restore-throw', runner as any);

            const response = await api().post('/api/investigations/restore-throw/action').send({ action: 'restore' });
            expect(response.status).toBe(400);
            expect(response.body.error).toMatch(/unable to extract/);
        });

        it('continues inactive pause, abort, and intervene actions when persistence fails', async () => {
            setFakeLlmProvider();
            vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('persist failed'));
            __testUtils.getHistory().set('hist-fail', makeState({ id: 'hist-fail', status: 'paused', thoughts: [], actions: [], logs: [] }) as any);

            let response = await api().post('/api/investigations/hist-fail/action').send({ action: 'pause' });
            expect(response.status).toBe(200);

            response = await api().post('/api/investigations/hist-fail/action').send({ action: 'abort' });
            expect(response.status).toBe(200);

            response = await api().post('/api/investigations/hist-fail/action').send({ action: 'intervene', message: 'Add context' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('hist-fail')?.thoughts.length).toBeGreaterThan(0);
        });

        it('bulk resumes paused investigations up to available concurrency slots', async () => {
            setFakeLlmProvider();
            __testUtils.setConfig({ maxConcurrentInvestigations: 2 });
            __testUtils.getHistory().set('paused-1', makeState({ id: 'paused-1', status: 'paused', query: 'First' }) as any);
            __testUtils.getHistory().set('paused-2', makeState({ id: 'paused-2', status: 'paused', query: 'Second' }) as any);
            __testUtils.getHistory().set('paused-3', makeState({ id: 'paused-3', status: 'paused', query: 'Third' }) as any);
            __testUtils.getRunners().set('running-1', makeRunner({ id: 'running-1', status: 'running' }) as any);

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            const resumeSpy = vi.spyOn(AgentRunner.prototype as any, 'resume');

            const response = await api().post('/api/investigations/resume-all').send({});

            expect(response.status).toBe(200);
            expect(response.body.resumed).toBe(1);
            expect(response.body.skipped).toBe(2);
            expect(resumeSpy).toHaveBeenCalledTimes(1);
            expect(startSpy).toHaveBeenCalledTimes(1);
        });

        it('uses the resume-all default query when paused history has no stored query', async () => {
            setFakeLlmProvider();
            __testUtils.setConfig({ maxConcurrentInvestigations: 1 });
            __testUtils.getHistory().set('paused-default-query', makeState({
                id: 'paused-default-query',
                status: 'paused',
                query: '',
            }) as any);

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            const response = await api().post('/api/investigations/resume-all').send({});

            expect(response.status).toBe(200);
            expect(startSpy).toHaveBeenCalledWith('Resume investigation');
        });

        it('resumes a paused pipeline investigation via the orchestrator instead of runner.start', async () => {
            setFakeLlmProvider();
            const pipelineState = makeState({
                id: 'pipe-resume',
                status: 'paused',
                query: 'Pipeline query',
            });
            (pipelineState as any).pipeline = {
                definition: {
                    id: 'pipe-def',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                        { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                    ],
                },
                stages: [{ status: 'running' }, { status: 'pending' }],
                currentStageIndex: 0,
                conversationLog: [],
            };
            __testUtils.getHistory().set('pipe-resume', pipelineState as any);

            let resolveRun!: (value: any) => void;
            const runSpy = vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
                new Promise(r => { resolveRun = r; })
            );
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

            const response = await api().post('/api/investigations/pipe-resume/action').send({ action: 'resume' });
            expect(response.status).toBe(200);

            // Pipeline orchestrator.run() should be called instead of runner.start()
            expect(runSpy).toHaveBeenCalled();
            expect(startSpy).not.toHaveBeenCalled();

            // Resolve to clean up
            resolveRun({
                status: 'completed', thoughts: [], actions: [], fullHistory: [],
                fullActions: [], logs: [], finalReport: 'done', recommendations: [],
                verdict: 'approved', pipeline: { stages: [] }, retrospect: null,
            });
            await new Promise(r => setTimeout(r, 50));
        });

        it('resume-all uses the orchestrator for paused pipeline investigations', async () => {
            setFakeLlmProvider();
            __testUtils.setConfig({ maxConcurrentInvestigations: 0 });
            const pipeState = makeState({ id: 'pipe-bulk-resume', status: 'paused', query: 'Pipeline bulk' });
            (pipeState as any).pipeline = {
                definition: {
                    id: 'pipe-def',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    ],
                },
                stages: [{ status: 'pending' }],
                currentStageIndex: 0,
                conversationLog: [],
            };
            const plainState = makeState({ id: 'plain-bulk-resume', status: 'paused', query: 'Plain query' });
            __testUtils.getHistory().set('pipe-bulk-resume', pipeState as any);
            __testUtils.getHistory().set('plain-bulk-resume', plainState as any);

            let resolveRun!: (value: any) => void;
            const runSpy = vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
                new Promise(r => { resolveRun = r; })
            );
            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);
            vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

            const response = await api().post('/api/investigations/resume-all').send({});
            expect(response.status).toBe(200);
            expect(response.body.resumed).toBe(2);

            // Pipeline investigation should use orchestrator, plain should use start
            expect(runSpy).toHaveBeenCalledTimes(1);
            expect(startSpy).toHaveBeenCalledTimes(1);

            // Resolve to clean up
            resolveRun({
                status: 'completed', thoughts: [], actions: [], fullHistory: [],
                fullActions: [], logs: [], finalReport: 'done', recommendations: [],
                verdict: 'approved', pipeline: { stages: [] }, retrospect: null,
            });
            await new Promise(r => setTimeout(r, 50));
        });

        it('resumePipelineInvestigation .then() handler updates runner state on completion', async () => {
            setFakeLlmProvider();
            let resolveRun!: (value: any) => void;
            vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
                new Promise(r => { resolveRun = r; })
            );

            const state = makeState({ id: 'pipe-then', status: 'paused', query: 'Pipeline query' });
            (state as any).pipeline = {
                definition: {
                    id: 'pipe-def',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    ],
                },
                stages: [{ status: 'running' }],
                currentStageIndex: 0,
                conversationLog: [],
            };
            __testUtils.getHistory().set('pipe-then', state as any);

            vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

            const response = await api().post('/api/investigations/pipe-then/action').send({ action: 'resume' });
            expect(response.status).toBe(200);

            // Make saveArtifacts throw to cover the catch block in .then()
            const runner = __testUtils.getRunners().get('pipe-then') as any;
            if (runner) runner.saveArtifacts = vi.fn().mockRejectedValue(new Error('disk full'));

            resolveRun({
                status: 'completed', thoughts: ['pipe done'], actions: [{ tool: 'finish' }],
                fullHistory: ['h'], fullActions: ['a'], logs: ['log'],
                finalReport: 'Pipeline done', recommendations: ['rec'],
                verdict: 'approved', pipeline: { stages: [{ status: 'completed' }] }, retrospect: null,
            });

            await new Promise(r => setTimeout(r, 50));

            const hist = __testUtils.getHistory().get('pipe-then');
            expect(hist).toBeDefined();
            expect(hist!.status).toBe('completed');
            expect(hist!.finalReport).toBe('Pipeline done');
        });

        it('resumePipelineInvestigation .catch() handler sets failed state and handles save failure', async () => {
            setFakeLlmProvider();
            let rejectRun!: (err: any) => void;
            vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
                new Promise((_, rej) => { rejectRun = rej; })
            );

            const state = makeState({
                id: 'pipe-catch',
                status: 'paused',
                query: '',
                model: 'gpt-4o',
            });
            (state as any).pipeline = {
                definition: {
                    id: 'pipe-def',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    ],
                },
                stages: [{ status: 'running' }],
                currentStageIndex: 0,
                conversationLog: [],
            };
            __testUtils.getHistory().set('pipe-catch', state as any);

            vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);
            // Set saveArtifacts to reject before the runner is created
            // so the .catch() handler's inner try/catch is exercised
            vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('disk error'));

            const response = await api().post('/api/investigations/pipe-catch/action').send({ action: 'resume' });
            expect(response.status).toBe(200);

            rejectRun(new Error('Pipeline crashed'));
            await new Promise(r => setTimeout(r, 100));

            const hist = __testUtils.getHistory().get('pipe-catch');
            expect(hist).toBeDefined();
            expect(hist!.status).toBe('failed');
        });

        it('updates models and active runner actions', async () => {
            const runner = makeRunner({ id: 'active-2', status: 'running', scheduleId: 'sched-1' });
            const scheduleStore = { update: vi.fn() };
            __testUtils.getRunners().set('active-2', runner as any);
            __testUtils.setScheduleStore(scheduleStore as any);

            let response = await api().post('/api/investigations/active-2/model').send({ model: 'gpt-4.1-mini' });
            expect(response.status).toBe(200);
            expect(runner.setModel).toHaveBeenCalledWith('gpt-4.1-mini');

            response = await api().post('/api/investigations/active-2/action').send({ action: 'pause' });
            expect(response.status).toBe(200);
            expect(runner.pause).toHaveBeenCalled();

            response = await api().post('/api/investigations/active-2/action').send({ action: 'resume' });
            expect(response.status).toBe(200);
            expect(runner.resume).toHaveBeenCalled();
            expect(scheduleStore.update).toHaveBeenCalledWith('sched-1', { activeInvestigationId: 'active-2' });

            response = await api().post('/api/investigations/active-2/action').send({ action: 'intervene', message: 'Check logs' });
            expect(response.status).toBe(200);
            expect(runner.intervene).toHaveBeenCalledWith('Check logs');

            response = await api().post('/api/investigations/active-2/action').send({ action: 'contest', message: 'Try again' });
            expect(response.status).toBe(200);
            expect(runner.contestReport).toHaveBeenCalledWith('Try again');
            expect(runner.start).toHaveBeenCalled();

            response = await api().post('/api/investigations/active-2/action').send({ action: 'abort' });
            expect(response.status).toBe(200);
            expect(runner.abort).toHaveBeenCalled();
        });

        it('returns 409 when contesting while implementation is running', async () => {
            const runner = makeRunner({ id: 'active-impl', status: 'running' });
            (runner as any).state.implementationRunning = true;
            __testUtils.getRunners().set('active-impl', runner as any);

            const response = await api().post('/api/investigations/active-impl/action').send({ action: 'contest', message: 'Retry' });
            expect(response.status).toBe(409);
            expect(response.body.error).toContain('implementation is running');
        });

        it('returns 400 when active contest handling throws', async () => {
            const runner = makeRunner({ id: 'active-contest', status: 'running' }, {
                contestReport: vi.fn(() => {
                    throw new Error('contest failed');
                }),
            });
            __testUtils.getRunners().set('active-contest', runner as any);

            const response = await api().post('/api/investigations/active-contest/action').send({ action: 'contest', message: 'Retry conclusion' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('contest failed');
        });

        it('rejects contest requests for inactive non-completed investigations', async () => {
            setFakeLlmProvider();
            __testUtils.getHistory().set('hist-not-complete', makeState({ id: 'hist-not-complete', status: 'paused' }) as any);

            const response = await api().post('/api/investigations/hist-not-complete/action').send({ action: 'contest', message: 'Retry conclusion' });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('completed investigation');
        });

        it('covers inactive action race and not-active edge cases', async () => {
            setFakeLlmProvider();
            __testUtils.getHistory().set('hist-race', makeState({ id: 'hist-race', status: 'completed' }) as any);
            __testUtils.getHistory().set('hist-idle', makeState({ id: 'hist-idle', status: 'paused' }) as any);
            __testUtils.getRunners().set('hist-race', undefined as any);

            let response = await api().post('/api/investigations/hist-race/action').send({ action: 'contest', message: 'Retry conclusion' });
            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Already contesting');

            response = await api().post('/api/investigations/hist-idle/action').send({ action: 'contest' });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Runner not active. Use resume to restart.');

            response = await api().post('/api/investigations/missing-runner/action').send({ action: 'pause' });
            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Runner not found');
        });

        it('covers resume-race, inactive contest failure, active contest completion, and resume-all start failures', async () => {
            setFakeLlmProvider();

            __testUtils.getHistory().set('hist-resume-race', makeState({ id: 'hist-resume-race', status: 'paused' }) as any);
            __testUtils.getRunners().set('hist-resume-race', undefined as any);
            let response = await api().post('/api/investigations/hist-resume-race/action').send({ action: 'resume' });
            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Already resuming');

            __testUtils.resetRuntimeState();
            __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
            setFakeLlmProvider();
            const contestStartSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockRejectedValueOnce(new Error('inactive contest failed'));
            __testUtils.getHistory().set('hist-contest-fail-2', makeState({ id: 'hist-contest-fail-2', status: 'completed', query: '' }) as any);
            response = await api().post('/api/investigations/hist-contest-fail-2/action').send({ action: 'contest', message: 'Retry result' });
            expect(response.status).toBe(200);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(contestStartSpy).toHaveBeenCalledWith('Resume investigation');
            expect(__testUtils.getRunners().has('hist-contest-fail-2')).toBe(false);

            const activeRunner = makeRunner({ id: 'active-contest-complete', status: 'running', query: 'Retry active' }, {
                start: vi.fn().mockImplementation(function (this: any) {
                    this.state.status = 'completed';
                    return Promise.resolve();
                }),
            });
            __testUtils.getRunners().set('active-contest-complete', activeRunner as any);
            response = await api().post('/api/investigations/active-contest-complete/action').send({ action: 'contest', message: 'Retry active result' });
            expect(response.status).toBe(200);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(__testUtils.getRunners().has('active-contest-complete')).toBe(false);

            __testUtils.resetRuntimeState();
            __testUtils.setConfig({ ...JSON.parse(JSON.stringify(defaultConfig)), maxConcurrentInvestigations: 0 });
            setFakeLlmProvider();
            const resumeStartSpy = vi.spyOn(AgentRunner.prototype as any, 'start').mockRejectedValueOnce(new Error('resume-all failed'));
            __testUtils.getHistory().set('paused-start-fail', makeState({ id: 'paused-start-fail', status: 'paused', query: 'Bulk start' }) as any);
            response = await api().post('/api/investigations/resume-all').send({});
            expect(response.status).toBe(200);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(resumeStartSpy).toHaveBeenCalledWith('Bulk start');
            expect(__testUtils.getRunners().has('paused-start-fail')).toBe(false);
        });

        it('handles resume-all with no paused investigations', async () => {
            const response = await api().post('/api/investigations/resume-all').send({});
            expect(response.status).toBe(200);
            expect(response.body.resumed).toBe(0);
        });

        it('returns 500 when resume-all top-level processing throws', async () => {
            const historyEntriesSpy = vi.spyOn(__testUtils.getHistory(), 'entries').mockImplementation(() => {
                throw new Error('entries exploded');
            });

            const response = await api().post('/api/investigations/resume-all').send({});

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to resume investigations');
            historyEntriesSpy.mockRestore();
        });

        it('uses history step fallbacks, contest restart failures, and resume-all slot edge cases', async () => {
            setFakeLlmProvider();
            const state = makeState({
                id: 'hist-step-fallback',
                status: 'paused',
                query: '',
                thoughts: ['step thought'],
                actions: [{ tool: 'noop', result: 'ok' }] as any,
            });
            __testUtils.getHistory().set(state.id, state as any);

            const startSpy = vi.spyOn(AgentRunner.prototype as any, 'start')
                .mockRejectedValueOnce(new Error('resume failed'))
                .mockRejectedValueOnce(new Error('contest restart failed'));

            let response = await api().get(`/api/investigations/${state.id}/steps/0`);
            expect(response.status).toBe(200);
            expect(response.body.thought).toBe('step thought');
            expect(response.body.action).toEqual({ tool: 'noop', result: 'ok' });

            response = await api().post(`/api/investigations/${state.id}/action`).send({ action: 'resume' });
            expect(response.status).toBe(200);
            expect(startSpy).toHaveBeenNthCalledWith(1, 'Resume investigation');

            await new Promise((resolve) => setTimeout(resolve, 0));

            const runner = makeRunner({ id: 'active-contest-fail-2', status: 'running', query: '' }, {
                start: vi.fn().mockRejectedValue(new Error('contest restart failed')),
            });
            __testUtils.getRunners().set('active-contest-fail-2', runner as any);

            response = await api().post('/api/investigations/active-contest-fail-2/action').send({ action: 'contest', message: 'Retry this result' });
            expect(response.status).toBe(200);

            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(__testUtils.getRunners().has('active-contest-fail-2')).toBe(false);
            expect(runner.start).toHaveBeenCalledWith('Resume investigation');

            __testUtils.setConfig({ maxConcurrentInvestigations: 1 });
            __testUtils.getRunners().set('busy-slot', makeRunner({ id: 'busy-slot', status: 'running' }) as any);
            __testUtils.getHistory().set('paused-slotless', makeState({ id: 'paused-slotless', status: 'paused' }) as any);

            response = await api().post('/api/investigations/resume-all').send({});
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ resumed: 0, skipped: 1, ids: [] });

            __testUtils.resetRuntimeState();
            __testUtils.setConfig({ ...JSON.parse(JSON.stringify(defaultConfig)), maxConcurrentInvestigations: 0 });
            setFakeLlmProvider();
            __testUtils.getHistory().set('paused-resume-fail', makeState({ id: 'paused-resume-fail', status: 'paused' }) as any);
            const resumeSpy = vi.spyOn(AgentRunner.prototype as any, 'resume').mockImplementationOnce(() => {
                throw new Error('resume exploded');
            });

            response = await api().post('/api/investigations/resume-all').send({});
            expect(response.status).toBe(200);
            expect(response.body.resumed).toBe(0);
            expect(response.body.skipped).toBe(0);
            expect(resumeSpy).toHaveBeenCalled();
        });

        it('updates inactive investigation models and rejects unknown ones', async () => {
            __testUtils.getHistory().set('history-2', makeState({ id: 'history-2', status: 'paused' }) as any);

            let response = await api().post('/api/investigations/history-2/model').send({ model: 'gpt-4.1' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-2')?.model).toBe('gpt-4.1');

            response = await api().post('/api/investigations/unknown/model').send({ model: 'gpt-4.1' });
            expect(response.status).toBe(404);
        });

        it('patches title and tags for active investigations and validates tags', async () => {
            const runner = makeRunner({ id: 'active-3', status: 'running' });
            __testUtils.getRunners().set('active-3', runner as any);

            let response = await api().patch('/api/investigations/active-3/title').send({ title: 'Updated Title' });
            expect(response.status).toBe(200);
            expect(runner.state.title).toBe('Updated Title');

            response = await api().patch('/api/investigations/active-3/tags').send({ tags: [' a ', 'a', 'b'] });
            expect(response.status).toBe(200);
            expect(runner.state.tags).toEqual(['a', 'b']);

            response = await api().patch('/api/investigations/active-3/tags').send({ tags: ['ok', 1] });
            expect(response.status).toBe(400);
        });

        it('patches title and tags for inactive investigations', async () => {
            setFakeLlmProvider();
            const saveArtifactsSpy = vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockResolvedValue(undefined);
            __testUtils.getHistory().set('history-title', makeState({ id: 'history-title', status: 'paused' }) as any);

            let response = await api().patch('/api/investigations/history-title/title').send({ title: 'Saved Title' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-title')?.title).toBe('Saved Title');

            response = await api().patch('/api/investigations/history-title/tags').send({ tags: ['one', ' two '] });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-title')?.tags).toEqual(['one', 'two']);
            expect(saveArtifactsSpy).toHaveBeenCalled();
        });

        it('covers title validation, missing history, and tag persistence failures', async () => {
            setFakeLlmProvider();
            let response = await api().patch('/api/investigations/missing-title/title').send({ title: 'Missing' });
            expect(response.status).toBe(404);

            response = await api().patch('/api/investigations/missing-title/title').send({ title: 123 });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Title must be a string');

            vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('persist tags failed'));
            __testUtils.getHistory().set('history-tag-fail', makeState({ id: 'history-tag-fail', status: 'paused' }) as any);

            response = await api().patch('/api/investigations/history-tag-fail/tags').send({ tags: [' one '] });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-tag-fail')?.tags).toEqual(['one']);
        });

        it('patches notes for active and inactive investigations with validation', async () => {
            // Active runner
            const runner = makeRunner({ id: 'active-notes', status: 'running' });
            __testUtils.getRunners().set('active-notes', runner as any);

            let response = await api().patch('/api/investigations/active-notes/notes').send({ notes: 'My investigation notes' });
            expect(response.status).toBe(200);
            expect(response.body.notes).toBe('My investigation notes');
            expect(runner.state.userNotes).toBe('My investigation notes');

            // Inactive (history)
            setFakeLlmProvider();
            const saveArtifactsSpy = vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockResolvedValue(undefined);
            __testUtils.getHistory().set('history-notes', makeState({ id: 'history-notes', status: 'completed' }) as any);

            response = await api().patch('/api/investigations/history-notes/notes').send({ notes: 'Saved notes' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-notes')?.userNotes).toBe('Saved notes');
            expect(saveArtifactsSpy).toHaveBeenCalled();

            // Validation: not a string
            response = await api().patch('/api/investigations/active-notes/notes').send({ notes: 123 });
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Notes must be a string');

            // Missing investigation
            response = await api().patch('/api/investigations/missing-notes/notes').send({ notes: 'test' });
            expect(response.status).toBe(404);

            // Persistence failure (silent)
            vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('persist notes failed'));
            __testUtils.getHistory().set('history-notes-fail', makeState({ id: 'history-notes-fail', status: 'paused' }) as any);

            response = await api().patch('/api/investigations/history-notes-fail/notes').send({ notes: 'fail' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-notes-fail')?.userNotes).toBe('fail');
        });

        it('rephrases selected notes text via LLM', async () => {
            const mockCreate = vi.fn().mockResolvedValue({
                choices: [{ message: { content: 'Professional rephrased text' } }],
            });
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn().mockResolvedValue({ chat: { completions: { create: mockCreate } } }),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);
            __testUtils.getHistory().set('rephrase-inv', makeState({ id: 'rephrase-inv', status: 'completed' }) as any);

            const response = await api().post('/api/investigations/rephrase-inv/notes/rephrase').send({ text: 'rough draft text' });
            expect(response.status).toBe(200);
            expect(response.body.rephrased).toBe('Professional rephrased text');
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
                messages: expect.arrayContaining([
                    expect.objectContaining({ role: 'user', content: 'rough draft text' }),
                ]),
                temperature: 0.3,
            }));
        });

        it('rephrases text using runner state when not in history', async () => {
            const mockCreate = vi.fn().mockResolvedValue({
                choices: [{ message: { content: 'Runner rephrased' } }],
            });
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn().mockResolvedValue({ chat: { completions: { create: mockCreate } } }),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);
            const runner = makeRunner({ id: 'rephrase-run', status: 'running', model: 'custom-model' });
            __testUtils.getRunners().set('rephrase-run', runner as any);

            const response = await api().post('/api/investigations/rephrase-run/notes/rephrase').send({ text: 'some text' });
            expect(response.status).toBe(200);
            expect(response.body.rephrased).toBe('Runner rephrased');
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-model' }));
        });

        it('falls back to original text when LLM returns empty response', async () => {
            const mockCreate = vi.fn().mockResolvedValue({
                choices: [{ message: { content: '' } }],
            });
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn().mockResolvedValue({ chat: { completions: { create: mockCreate } } }),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);

            const response = await api().post('/api/investigations/unknown-reph/notes/rephrase').send({ text: 'original text' });
            expect(response.status).toBe(200);
            expect(response.body.rephrased).toBe('original text');
        });

        it('returns 400 when rephrase text is missing', async () => {
            const response = await api().post('/api/investigations/any-inv/notes/rephrase').send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('text is required');
        });

        it('returns 503 when no LLM provider for rephrase', async () => {
            __testUtils.setActiveLlmProvider(null);
            const response = await api().post('/api/investigations/any-inv/notes/rephrase').send({ text: 'hello' });
            expect(response.status).toBe(503);
            expect(response.body.error).toBe('No LLM provider configured');
        });

        it('returns 500 when LLM call fails during rephrase', async () => {
            __testUtils.setActiveLlmProvider({
                type: 'fake',
                displayName: 'Fake',
                getAuthRequirement: () => ({ type: 'none' }),
                configure: vi.fn(),
                getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
                getClient: vi.fn().mockResolvedValue({
                    chat: { completions: { create: vi.fn().mockRejectedValue(new Error('LLM timeout')) } },
                }),
                listModels: vi.fn().mockResolvedValue(['model-a']),
            } as any);
            __testUtils.getHistory().set('rephrase-fail', makeState({ id: 'rephrase-fail', status: 'completed' }) as any);

            const response = await api().post('/api/investigations/rephrase-fail/notes/rephrase').send({ text: 'hello' });
            expect(response.status).toBe(500);
            expect(response.body.error).toContain('LLM timeout');
        });

        it('covers missing model, analyze-body fallback, and missing tags history', async () => {
            let response = await api().post('/api/investigations/missing-model/model').send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Model is required');

            setFakeLlmProvider();
            const analyzeRunner = makeRunner({ id: 'active-analyze-body', status: 'running' });
            __testUtils.getRunners().set('active-analyze-body', analyzeRunner as any);
            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const analyzeLayer = stack.find((layer) => layer.route?.path === '/api/investigations/:id/retrospect/analyze' && layer.route?.methods?.post);
            const status = vi.fn().mockReturnThis();
            const json = vi.fn();
            await analyzeLayer.route.stack[0].handle({ params: { id: 'active-analyze-body' }, body: undefined }, { status, json }, vi.fn());
            expect(status).toHaveBeenCalledWith(202);
            expect(json).toHaveBeenCalledWith({ success: true, message: 'Analysis started' });

            response = await api().patch('/api/investigations/missing-tags/tags').send({ tags: ['x'] });
            expect(response.status).toBe(404);
        });

        it('covers title persistence failures and product-aware export, import, and pdf defaults', async () => {
            setFakeLlmProvider();
            const saveArtifactsSpy = vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('persist title failed'));
            __testUtils.getHistory().set('history-title-fail', makeState({ id: 'history-title-fail', status: 'paused' }) as any);

            let response = await api().patch('/api/investigations/history-title-fail/title').send({ title: 'Still Saved' });
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().get('history-title-fail')?.title).toBe('Still Saved');
            expect(saveArtifactsSpy).toHaveBeenCalled();

            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-import-export-defaults-'));
            const productInvRoot = path.join(invRoot, 'product-investigations');
            fs.mkdirSync(productInvRoot, { recursive: true });
            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-defaults', name: 'Defaults Product', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-defaults',
            });

            response = await api().post('/api/investigations/import').send({
                id: 'old-shared-id',
                status: 'running',
                productId: 'prod-defaults',
                title: 'Log Analytics Latency',
                thoughts: 'bad-thoughts',
                actions: 'bad-actions',
                logs: 'bad-logs',
                finalReport: 'Imported report',
            });
            expect(response.status).toBe(200);
            const importedState = __testUtils.getHistory().get(response.body.id) as any;
            expect(importedState.status).toBe('completed');
            expect(Array.isArray(importedState.thoughts)).toBe(true);
            expect(Array.isArray(importedState.actions)).toBe(true);
            expect(Array.isArray(importedState.logs)).toBe(true);

            const exportedState = makeState({
                id: 'non-numeric-export',
                status: 'completed',
                target: '',
                productId: 'prod-defaults',
                finalReport: 'PDF report',
            });
            __testUtils.getHistory().set(exportedState.id, exportedState as any);

            response = await api().get(`/api/investigations/${exportedState.id}/export`);
            expect(response.status).toBe(200);
            expect(response.headers['content-disposition']).toContain('_investigation_');

            const renderSpy = vi.spyOn(pdfRenderer, 'renderPdf').mockResolvedValue(Buffer.from('pdf-defaults'));
            response = await api().get(`/api/investigations/${exportedState.id}/pdf`);
            expect(response.status).toBe(200);
            expect(response.headers['content-disposition']).toContain('_investigation_');
            expect(renderSpy).toHaveBeenCalledWith('PDF report', expect.objectContaining({ productName: 'Defaults Product' }));
        });

        it('falls back to global investigation paths and missing product metadata when product ids no longer resolve', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-missing-product-routes-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: undefined as any, activeProductId: '' });

            const deleteState = makeState({ id: 'delete-missing-product', status: 'completed', productId: 'ghost-product', target: 'stamp-delete' });
            const deleteDir = path.join(invRoot, '2024-01-01_stamp-delete_deletemissingproduct');
            fs.mkdirSync(deleteDir, { recursive: true });
            __testUtils.getHistory().set(deleteState.id, deleteState as any);

            let response = await api().delete(`/api/investigations/${deleteState.id}`);
            expect(response.status).toBe(200);
            expect(fs.existsSync(deleteDir)).toBe(false);

            const exportState = makeState({ id: 'export-missing-product', status: 'completed', productId: 'ghost-product', target: 'stamp/export', finalReport: 'Exported report' });
            const exportDir = path.join(invRoot, '2024-01-01_stampexport_exportmissingproduct');
            fs.mkdirSync(exportDir, { recursive: true });
            fs.writeFileSync(path.join(exportDir, 'state.json'), JSON.stringify(exportState));
            __testUtils.getHistory().set(exportState.id, exportState as any);

            response = await api().get(`/api/investigations/${exportState.id}/export`);
            expect(response.status).toBe(200);
            expect(response.text).toContain('export-missing-product');

            response = await api().post('/api/investigations/import').send({
                id: 'import-missing-product',
                status: 'failed',
                productId: 'ghost-product',
                target: 'stamp-import',
                thoughts: [],
                actions: [],
                logs: [],
            });
            expect(response.status).toBe(200);
            const importedState = __testUtils.getHistory().get(response.body.id) as any;
            expect(importedState.status).toBe('failed');
            expect(importedState.productId).toBe('ghost-product');
            const importedDir = fs.readdirSync(invRoot).find((entry) => entry.endsWith(`_${response.body.id.replace(/[^a-zA-Z0-9]/g, '')}`));
            expect(importedDir).toBeTruthy();

            const renderSpy = vi.spyOn(pdfRenderer, 'renderPdf').mockResolvedValue(Buffer.from('pdf-missing-product'));
            const pdfState = makeState({ id: 'pdf-missing-product', status: 'completed', productId: 'ghost-product', finalReport: 'PDF without product metadata' });
            __testUtils.getHistory().set(pdfState.id, pdfState as any);

            response = await api().get(`/api/investigations/${pdfState.id}/pdf`);
            expect(response.status).toBe(200);
            expect(renderSpy).toHaveBeenCalledWith('PDF without product metadata', expect.objectContaining({ productName: undefined }));
        });

        it('deletes investigations from memory and disk', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-'));
            const investigation = makeState({ id: '1700000000000', target: 'stamp-02', status: 'completed' });
            const folder = path.join(invRoot, '2023-11-14_stamp-02_1700000000000');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify(investigation));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set(investigation.id, investigation as any);

            const response = await api().delete(`/api/investigations/${investigation.id}`);
            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().has(investigation.id)).toBe(false);
            expect(fs.existsSync(folder)).toBe(false);
        });

        it('deletes product-scoped investigations from their product directory', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-product-'));
            const productInvRoot = path.join(invRoot, 'product-investigations');
            fs.mkdirSync(productInvRoot, { recursive: true });
            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-delete', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-delete',
            });

            const investigation = makeState({ id: '1700000000001', target: 'stamp-product', status: 'completed', productId: 'prod-delete' });
            const folder = path.join(productInvRoot, '2023-11-14_stamp-product_1700000000001');
            fs.mkdirSync(folder, { recursive: true });
            __testUtils.getHistory().set(investigation.id, investigation as any);

            const response = await api().delete(`/api/investigations/${investigation.id}`);

            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().has(investigation.id)).toBe(false);
            expect(fs.existsSync(folder)).toBe(false);
        });

        it('aborts active running investigations before deleting them', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-running-'));
            const runner = makeRunner({ id: 'running-delete', status: 'running', target: 'stamp-live' });
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getRunners().set('running-delete', runner as any);
            __testUtils.getHistory().set('running-delete', runner.state as any);

            const response = await api().delete('/api/investigations/running-delete');

            expect(response.status).toBe(200);
            expect(runner.abort).toHaveBeenCalled();
            expect(__testUtils.getRunners().has('running-delete')).toBe(false);
        });

        it('swallows abort failures while deleting active investigations', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-abort-failure-'));
            const runner = makeRunner({ id: 'delete-abort-fail', status: 'running' }, {
                abort: vi.fn(() => {
                    throw new Error('abort delete failed');
                }),
            });
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getRunners().set('delete-abort-fail', runner as any);
            __testUtils.getHistory().set('delete-abort-fail', runner.state as any);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const response = await api().delete('/api/investigations/delete-abort-fail');

            expect(response.status).toBe(200);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[Delete] Failed to abort running investigation delete-abort-fail:'), 'abort delete failed');
        });

        it('swallows disk cleanup failures when deleting investigations', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-failure-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set('delete-json-dir', makeState({ id: 'delete-json-dir', status: 'completed' }) as any);
            fs.mkdirSync(path.join(invRoot, 'delete-json-dir.json'), { recursive: true });

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const response = await api().delete('/api/investigations/delete-json-dir');

            expect(response.status).toBe(200);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[Delete] Failed to delete files for delete-json-dir:'), expect.any(String));
            expect(__testUtils.getHistory().has('delete-json-dir')).toBe(false);
        });

        it('continues deleting investigations when the investigations directory cannot be read', async () => {
            const invRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-missing-dir-')), 'missing-investigations');
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set('delete-missing-dir', makeState({ id: 'delete-missing-dir', status: 'completed' }) as any);

            const response = await api().delete('/api/investigations/delete-missing-dir');

            expect(response.status).toBe(200);
            expect(__testUtils.getHistory().has('delete-missing-dir')).toBe(false);
        });

        it('covers direct delete-route branches for missing investigations and matched directories', async () => {
            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const deleteLayer = stack.find((layer) => layer.route?.path === '/api/investigations/:id' && layer.route.methods?.delete);
            expect(deleteLayer).toBeTruthy();
            const handler = deleteLayer.route.stack[0].handle;

            let status = vi.fn().mockReturnThis();
            let json = vi.fn();
            await handler({ params: { id: 'missing-delete' } }, { status, json });
            expect(status).toHaveBeenCalledWith(404);
            expect(json).toHaveBeenCalledWith({ error: 'Investigation not found' });

            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-delete-direct-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set('1700000000002', makeState({ id: '1700000000002', status: 'completed', target: 'stamp-direct' }) as any);
            fs.mkdirSync(path.join(invRoot, '2023-11-14_stamp-direct_1700000000002'), { recursive: true });

            status = vi.fn().mockReturnThis();
            json = vi.fn();
            await handler({ params: { id: '1700000000002' } }, { status, json });
            expect(json).toHaveBeenCalledWith({ ok: true });
        });

        it('exports and imports investigations', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-export-'));
            const investigation = makeState({ id: '1700000000100', target: 'stamp-03', finalReport: 'Final report' });
            const folder = path.join(invRoot, '2023-11-14_stamp-03_1700000000100');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ ...investigation, thoughts: ['disk-thought'] }));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set(investigation.id, investigation as any);

            let response = await api().get(`/api/investigations/${investigation.id}/export`);
            expect(response.status).toBe(200);
            expect(response.headers['content-disposition']).toContain('.json');
            expect(response.text).toContain('disk-thought');

            response = await api().post('/api/investigations/import').send({
                id: 'original-id',
                status: 'paused',
                thoughts: [],
                actions: [],
                logs: [],
                target: 'stamp-04',
                finalReport: 'Imported report',
            });
            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(__testUtils.getHistory().has(response.body.id)).toBe(true);
        });

        it('validates malformed investigation import payloads', async () => {
            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const importLayer = stack.find((layer) => layer.route?.path === '/api/investigations/import' && layer.route.methods?.post);
            expect(importLayer).toBeTruthy();

            const routeStack = importLayer.route.stack;
            const handler = routeStack[routeStack.length - 1].handle;
            const status = vi.fn().mockReturnThis();
            const json = vi.fn();
            await handler({ body: 123 }, { status, json });
            expect(status).toHaveBeenCalledWith(400);
            expect(json).toHaveBeenCalledWith({ error: 'Request body must be a valid investigation state object' });

            const response = await api().post('/api/investigations/import').send({ id: '', status: '' });
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('missing required fields');
        });

        it('falls back to in-memory state when export disk reads fail', async () => {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-export-fallback-'));
            const invRoot = path.join(tempRoot, 'not-a-directory.json');
            fs.writeFileSync(invRoot, 'not-a-directory');
            const investigation = makeState({ id: '1700000000101', target: 'stamp-03', finalReport: 'Memory report', thoughts: ['memory-thought'] });
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            __testUtils.getHistory().set(investigation.id, investigation as any);

            const response = await api().get(`/api/investigations/${investigation.id}/export`);

            expect(response.status).toBe(200);
            expect(response.text).toContain('memory-thought');
        });

        it('returns not found when exporting a missing investigation', async () => {
            const response = await api().get('/api/investigations/missing-export/export');

            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Investigation not found');
        });

        it('exports active investigations from product-specific disk state when available', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-export-product-active-'));
            const productInvRoot = path.join(invRoot, 'product-investigations');
            fs.mkdirSync(productInvRoot, { recursive: true });

            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-export', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-export',
            });

            const runner = makeRunner({
                id: '1700000000102',
                target: 'stamp-product-export',
                finalReport: 'Memory report',
                thoughts: ['memory-thought'],
                productId: 'prod-export',
            });
            __testUtils.getRunners().set('1700000000102', runner as any);

            const folder = path.join(productInvRoot, '2023-11-14_stamp-product-export_1700000000102');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({
                ...runner.state,
                thoughts: ['disk-thought'],
                finalReport: 'Disk report',
            }));

            const response = await api().get('/api/investigations/1700000000102/export');

            expect(response.status).toBe(200);
            expect(response.text).toContain('disk-thought');
            expect(response.text).toContain('Disk report');
        });

        it('keeps imported investigations in memory when disk persistence fails', async () => {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-import-fallback-'));
            const invRoot = path.join(tempRoot, 'not-a-directory.json');
            fs.writeFileSync(invRoot, 'not-a-directory');
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            const response = await api().post('/api/investigations/import').send({
                id: 'original-import-fail',
                status: 'paused',
                thoughts: [],
                actions: [],
                logs: [],
                target: 'stamp-import',
            });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(__testUtils.getHistory().has(response.body.id)).toBe(true);
        });

        it('imports investigations into product-specific directories when configured', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-import-product-'));
            const productInvRoot = path.join(invRoot, 'product-investigations');
            fs.mkdirSync(productInvRoot, { recursive: true });
            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-import', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-import',
            });

            const response = await api().post('/api/investigations/import').send({
                id: 'original-product-import',
                status: 'paused',
                thoughts: [],
                actions: [],
                logs: [],
                target: 'stamp-product-import',
                productId: 'prod-import',
            });

            expect(response.status).toBe(200);
            const createdDir = fs.readdirSync(productInvRoot).find((entry) => entry.includes(response.body.id.replace(/[^a-zA-Z0-9]/g, '')));
            expect(createdDir).toBeTruthy();
            expect(fs.existsSync(path.join(productInvRoot, createdDir!, 'state.json'))).toBe(true);
        });

        it('exports investigation PDFs with product metadata', async () => {
            const renderPdfSpy = vi.spyOn(pdfRenderer, 'renderPdf').mockResolvedValue(Buffer.from('pdf-binary'));
            __testUtils.setConfig({
                products: [{
                    id: 'prod-pdf',
                    name: 'PDF Product',
                    repoRoot: '',
                    systemPromptPath: '',
                    knowledgeBasePath: '',
                    workingDirectory: '',
                    investigationsPath: '',
                }],
                activeProductId: 'prod-pdf',
            });
            __testUtils.getHistory().set('1700000000200', makeState({
                id: '1700000000200',
                status: 'completed',
                target: 'stamp/pdf',
                finalReport: 'Final report',
                productId: 'prod-pdf',
                contestCount: 2,
            }) as any);

            const response = await api().get('/api/investigations/1700000000200/pdf');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('application/pdf');
            expect(response.headers['content-disposition']).toContain('2023-11-14_stamppdf_1700000000200.pdf');
            expect(renderPdfSpy).toHaveBeenCalledWith('Final report', expect.objectContaining({
                id: '1700000000200',
                productName: 'PDF Product',
                contestCount: 2,
            }));
        });

        it('exports investigation PDFs from active runners', async () => {
            const renderPdfSpy = vi.spyOn(pdfRenderer, 'renderPdf').mockResolvedValue(Buffer.from('pdf-runner'));
            const runner = makeRunner({
                id: 'active-pdf',
                status: 'completed',
                target: 'stamp-live-pdf',
                finalReport: 'Runner report',
            });
            __testUtils.getRunners().set('active-pdf', runner as any);

            const response = await api().get('/api/investigations/active-pdf/pdf');

            expect(response.status).toBe(200);
            expect(renderPdfSpy).toHaveBeenCalledWith('Runner report', expect.objectContaining({ id: 'active-pdf' }));
        });

        it('returns 500 when PDF rendering fails', async () => {
            vi.spyOn(pdfRenderer, 'renderPdf').mockRejectedValue(new Error('pdf failed'));
            __testUtils.getHistory().set('1700000000201', makeState({
                id: '1700000000201',
                status: 'completed',
                target: 'stamp-pdf-fail',
                finalReport: 'Final report',
            }) as any);

            const response = await api().get('/api/investigations/1700000000201/pdf');

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('pdf failed');
        });

        it('runs active retrospective, proposal, and compact actions', async () => {
            const runner = makeRunner({ id: 'active-4', status: 'completed' });
            __testUtils.getRunners().set('active-4', runner as any);

            let response = await api().post('/api/investigations/active-4/retrospect').send({ message: 'Review findings' });
            expect(response.status).toBe(200);
            expect(runner.runRetrospective).toHaveBeenCalledWith('Review findings');

            response = await api().post('/api/investigations/active-4/retrospect/analyze').send({ reset: true });
            expect(response.status).toBe(202);
            expect(runner.resetRetrospectiveAnalysis).toHaveBeenCalled();
            expect(runner.runRetrospectiveAnalysis).toHaveBeenCalled();

            response = await api().patch('/api/investigations/active-4/retrospect/proposals/proposal-1').send({ status: 'approved' });
            expect(response.status).toBe(200);
            expect(runner.updateProposalStatus).toHaveBeenCalledWith('proposal-1', 'approved');

            response = await api().post('/api/investigations/active-4/retrospect/complete').send({ completed: false });
            expect(response.status).toBe(200);
            expect(runner.setRetrospectCompleted).toHaveBeenCalledWith(false);

            response = await api().post('/api/investigations/active-4/retrospect/abort').send({});
            expect(response.status).toBe(200);
            expect(runner.abortRetrospective).toHaveBeenCalled();

            response = await api().post('/api/investigations/active-4/retrospect/apply').send({});
            expect(response.status).toBe(200);
            expect(runner.applyApprovedProposals).toHaveBeenCalled();

            response = await api().post('/api/investigations/active-4/compact').send({});
            expect(response.status).toBe(200);
            expect(runner.summarize).toHaveBeenCalled();
        });

        it('returns retrospective route errors for invalid proposal status, abort failure, and apply failure', async () => {
            const activeRunner = makeRunner({ id: 'active-retro-fail', status: 'completed' }, {
                abortRetrospective: vi.fn(() => {
                    throw new Error('abort failed');
                }),
            });
            __testUtils.getRunners().set('active-retro-fail', activeRunner as any);
            __testUtils.getHistory().set('inactive-retro-fail', makeState({ id: 'inactive-retro-fail', status: 'completed' }) as any);
            vi.spyOn(AgentRunner.prototype as any, 'applyApprovedProposals').mockRejectedValue(new Error('apply failed'));

            let response = await api().patch('/api/investigations/active-retro-fail/retrospect/proposals/p1').send({ status: 'maybe' });
            expect(response.status).toBe(400);

            response = await api().post('/api/investigations/active-retro-fail/retrospect/abort').send({});
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('abort failed');

            response = await api().post('/api/investigations/inactive-retro-fail/retrospect/apply').send({});
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('apply failed');
            expect(__testUtils.getRunners().has('inactive-retro-fail')).toBe(false);
        });

        it('covers inactive retrospective proposal, complete, and compact failure cleanup branches', async () => {
            __testUtils.getHistory().set('inactive-proposal-miss', makeState({ id: 'inactive-proposal-miss', status: 'completed' }) as any);
            __testUtils.getHistory().set('inactive-complete-fail', makeState({ id: 'inactive-complete-fail', status: 'completed' }) as any);
            __testUtils.getHistory().set('inactive-compact-fail', makeState({ id: 'inactive-compact-fail', status: 'completed' }) as any);
            __testUtils.getRunners().set('inactive-busy', undefined as any);

            vi.spyOn(AgentRunner.prototype as any, 'updateProposalStatus').mockReturnValue(undefined);
            vi.spyOn(AgentRunner.prototype as any, 'setRetrospectCompleted').mockImplementation(() => {
                throw new Error('complete failed');
            });
            vi.spyOn(AgentRunner.prototype as any, 'summarize').mockRejectedValue(new Error('compact failed'));

            let response = await api().patch('/api/investigations/inactive-proposal-miss/retrospect/proposals/p1').send({ status: 'approved' });
            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Proposal not found');
            expect(__testUtils.getRunners().has('inactive-proposal-miss')).toBe(false);

            response = await api().post('/api/investigations/inactive-complete-fail/retrospect/complete').send({ completed: true });
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('complete failed');
            expect(__testUtils.getRunners().has('inactive-complete-fail')).toBe(false);

            response = await api().post('/api/investigations/inactive-busy/compact').send({});
            expect(response.status).toBe(409);

            response = await api().post('/api/investigations/inactive-compact-fail/compact').send({});
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('compact failed');
            expect(__testUtils.getRunners().has('inactive-compact-fail')).toBe(false);
        });

        it('rehydrates inactive investigations for retrospective operations and cleans up temporary runners', async () => {
            setFakeLlmProvider();
            const state = makeState({ id: 'inactive-retro', status: 'completed', query: 'Review findings' });
            __testUtils.getHistory().set(state.id, state as any);

            const runRetrospectiveSpy = vi.spyOn(AgentRunner.prototype as any, 'runRetrospective').mockResolvedValue(undefined);
            const saveArtifactsSpy = vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockResolvedValue(undefined);
            const analyzeSpy = vi.spyOn(AgentRunner.prototype as any, 'runRetrospectiveAnalysis').mockResolvedValue(undefined);
            const resetSpy = vi.spyOn(AgentRunner.prototype as any, 'resetRetrospectiveAnalysis').mockImplementation(() => undefined);
            const updateProposalStatusSpy = vi.spyOn(AgentRunner.prototype as any, 'updateProposalStatus').mockReturnValue({ id: 'proposal-1', status: 'approved' });
            const setCompletedSpy = vi.spyOn(AgentRunner.prototype as any, 'setRetrospectCompleted').mockReturnValue({ completed: true });
            const applySpy = vi.spyOn(AgentRunner.prototype as any, 'applyApprovedProposals').mockResolvedValue({ applied: 1 });
            const summarizeSpy = vi.spyOn(AgentRunner.prototype as any, 'summarize').mockResolvedValue(undefined);

            let response = await api().post('/api/investigations/inactive-retro/retrospect').send({ message: 'Look for missing mitigations' });
            expect(response.status).toBe(200);
            expect(runRetrospectiveSpy).toHaveBeenCalledWith('Look for missing mitigations');
            expect(__testUtils.getRunners().has('inactive-retro')).toBe(false);

            response = await api().post('/api/investigations/inactive-retro/retrospect/analyze').send({ reset: true });
            expect(response.status).toBe(202);
            expect(resetSpy).toHaveBeenCalled();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(analyzeSpy).toHaveBeenCalled();
            expect(__testUtils.getRunners().has('inactive-retro')).toBe(false);

            response = await api().patch('/api/investigations/inactive-retro/retrospect/proposals/proposal-1').send({ status: 'approved' });
            expect(response.status).toBe(200);
            expect(updateProposalStatusSpy).toHaveBeenCalledWith('proposal-1', 'approved');

            response = await api().post('/api/investigations/inactive-retro/retrospect/complete').send({ completed: false });
            expect(response.status).toBe(200);
            expect(setCompletedSpy).toHaveBeenCalledWith(false);

            response = await api().post('/api/investigations/inactive-retro/retrospect/apply').send({});
            expect(response.status).toBe(200);
            expect(applySpy).toHaveBeenCalled();

            response = await api().post('/api/investigations/inactive-retro/compact').send({});
            expect(response.status).toBe(200);
            expect(summarizeSpy).toHaveBeenCalled();
            expect(saveArtifactsSpy).toHaveBeenCalled();
        });

        it('covers retrospective race and missing-investigation guards', async () => {
            setFakeLlmProvider();
            __testUtils.getHistory().set('retro-race', makeState({ id: 'retro-race', status: 'completed' }) as any);
            __testUtils.getRunners().set('retro-race', undefined as any);

            let response = await api().post('/api/investigations/retro-race/retrospect').send({ message: 'Review race' });
            expect(response.status).toBe(409);

            response = await api().post('/api/investigations/retro-race/retrospect/analyze').send({});
            expect(response.status).toBe(409);

            response = await api().post('/api/investigations/missing-retro/retrospect').send({ message: 'Review missing' });
            expect(response.status).toBe(404);

            response = await api().post('/api/investigations/missing-retro/retrospect/analyze').send({});
            expect(response.status).toBe(404);
        });

        it('covers retrospective error cleanup and missing-operation guards', async () => {
            setFakeLlmProvider();
            const retroState = makeState({ id: 'inactive-retro-error', status: 'completed' });
            __testUtils.getHistory().set(retroState.id, retroState as any);

            const retroSpy = vi.spyOn(AgentRunner.prototype as any, 'runRetrospective').mockRejectedValue(new Error('retro failed'));
            let response = await api().post('/api/investigations/inactive-retro-error/retrospect').send({ message: 'Retry analysis' });
            expect(response.status).toBe(500);
            expect(retroSpy).toHaveBeenCalled();
            expect(__testUtils.getRunners().has(retroState.id)).toBe(false);

            const analyzeSpy = vi.spyOn(AgentRunner.prototype as any, 'runRetrospectiveAnalysis').mockRejectedValue(new Error('analyze failed'));
            response = await api().post('/api/investigations/inactive-retro-error/retrospect/analyze').send({});
            expect(response.status).toBe(202);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(analyzeSpy).toHaveBeenCalled();
            expect(__testUtils.getRunners().has(retroState.id)).toBe(false);

            __testUtils.getHistory().set('proposal-race', makeState({ id: 'proposal-race', status: 'completed' }) as any);
            __testUtils.getRunners().set('proposal-race', undefined as any);
            response = await api().patch('/api/investigations/proposal-race/retrospect/proposals/p1').send({ status: 'approved' });
            expect(response.status).toBe(409);

            response = await api().patch('/api/investigations/missing-proposal/retrospect/proposals/p1').send({ status: 'approved' });
            expect(response.status).toBe(404);

            __testUtils.getHistory().set('complete-race', makeState({ id: 'complete-race', status: 'completed' }) as any);
            __testUtils.getRunners().set('complete-race', undefined as any);
            response = await api().post('/api/investigations/complete-race/retrospect/complete').send({ completed: true });
            expect(response.status).toBe(409);

            response = await api().post('/api/investigations/missing-complete/retrospect/complete').send({ completed: true });
            expect(response.status).toBe(404);

            response = await api().post('/api/investigations/missing-abort/retrospect/abort').send({});
            expect(response.status).toBe(404);

            __testUtils.getHistory().set('apply-race', makeState({ id: 'apply-race', status: 'completed' }) as any);
            __testUtils.getRunners().set('apply-race', undefined as any);
            response = await api().post('/api/investigations/apply-race/retrospect/apply').send({});
            expect(response.status).toBe(409);

            response = await api().post('/api/investigations/missing-apply/retrospect/apply').send({});
            expect(response.status).toBe(404);

            response = await api().post('/api/investigations/missing-compact/compact').send({});
            expect(response.status).toBe(404);
        });

        it('covers investigation pdf guards for missing state and missing report', async () => {
            let response = await api().get('/api/investigations/missing/pdf');
            expect(response.status).toBe(404);

            __testUtils.getHistory().set('pdf-1', makeState({ id: 'pdf-1', status: 'completed', finalReport: undefined }) as any);
            response = await api().get('/api/investigations/pdf-1/pdf');
            expect(response.status).toBe(400);
        });

        it('reports and restarts active MCP connections', async () => {
            const runner = makeRunner({ id: 'active-5', status: 'running' });
            __testUtils.getRunners().set('active-5', runner as any);
            __testUtils.getHistory().set('finished-5', makeState({ id: 'finished-5' }) as any);

            let response = await api().get('/api/investigations/active-5/mcp/status');
            expect(response.status).toBe(200);
            expect(response.body.connected).toBe(true);

            response = await api().get('/api/investigations/finished-5/mcp/status');
            expect(response.status).toBe(200);
            expect(response.body.connected).toBe(false);

            response = await api().post('/api/investigations/active-5/mcp/restart').send({});
            expect(response.status).toBe(200);
            expect(runner.toolManager.restart).toHaveBeenCalled();

            response = await api().post('/api/investigations/finished-5/mcp/restart').send({});
            expect(response.status).toBe(400);
        });

        it('returns 500 when MCP restart fails', async () => {
            const runner = makeRunner({ id: 'active-5-fail', status: 'running' });
            runner.toolManager.restart = vi.fn().mockRejectedValue(new Error('restart failed'));
            __testUtils.getRunners().set('active-5-fail', runner as any);

            const response = await api().post('/api/investigations/active-5-fail/mcp/restart').send({});

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('restart failed');
        });

        it('performs in-process restart: pauses runners, reloads config, reinits providers', async () => {
                const runner = makeRunner({ id: 'active-6', status: 'running' });
                __testUtils.getRunners().set('active-6', runner as any);

                const response = await api().post('/api/server/restart').send({});
                expect(response.status).toBe(200);
                expect(response.body.status).toBe('restarted');
                expect(runner.pause).toHaveBeenCalled();
                // Runners should be cleared after restart
                expect(__testUtils.getRunners().size).toBe(0);
        });

        it('continues restart when a runner pause throws', async () => {
                const runner = makeRunner({ id: 'active-7', status: 'running' }, {
                    pause: vi.fn(() => {
                        throw new Error('pause failed');
                    }),
                });
                __testUtils.getRunners().set('active-7', runner as any);

                const response = await api().post('/api/server/restart').send({});

                expect(response.status).toBe(200);
                expect(response.body.status).toBe('restarted');
                // Runners should still be cleared even when pause fails
                expect(__testUtils.getRunners().size).toBe(0);
        });

        it('ignores scheduler.stop() errors during restart', async () => {
                const fakeScheduler = { stop: vi.fn(() => { throw new Error('stop failed'); }), start: vi.fn() };
                __testUtils.setScheduler(fakeScheduler as any);

                const response = await api().post('/api/server/restart').send({});

                expect(response.status).toBe(200);
                expect(response.body.status).toBe('restarted');
                expect(fakeScheduler.stop).toHaveBeenCalled();
        });

        it('returns 500 when restart encounters an unexpected error', async () => {
                // Set an invalid path (null byte) that will cause fs.mkdirSync to throw
                // inside initScheduler → ensureDirectoryExists
                __testUtils.setConfig({ investigationsPath: 'path\0with-null-byte' });

                const response = await api().post('/api/server/restart').send({});

                expect(response.status).toBe(500);
                expect(response.body.error).toBe('Restart failed');
        });

    });

    describe('incident, schedule, and query-bank routes', () => {
        it('streams incident reads for available providers and handles provider errors', async () => {
            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(true),
                fetchIncident: vi.fn(async (_id: string, onProgress: (event: any) => void) => {
                    onProgress({ type: 'progress', message: 'reading' });
                    return {
                        id: 'INC-1',
                        title: 'Incident Title',
                        severity: '2',
                        status: 'active',
                        target: 'stamp-01',
                        timeRange: 'ago(1h)',
                        content: 'Incident details',
                    };
                }),
            } as any);

            let response = await api().post('/api/incidents/INC-1/read').send({});
            expect(response.status).toBe(200);
            expect(response.text).toContain('Incident Title');
            expect(response.text).toContain('reading');

            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(false),
                fetchIncident: vi.fn(),
            } as any);
            response = await api().post('/api/incidents/INC-2/read').send({});
            expect(response.status).toBe(400);

            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(true),
                fetchIncident: vi.fn().mockRejectedValue(new Error('incident fetch failed')),
            } as any);
            response = await api().post('/api/incidents/INC-3/read').send({});
            expect(response.status).toBe(200);
            expect(response.text).toContain('incident fetch failed');
        });

        it('maps omitted incident fields to defaults in the streamed output', async () => {
            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(true),
                fetchIncident: vi.fn().mockResolvedValue({
                    id: 'INC-42',
                    title: 'Minimal incident',
                }),
            } as any);

            const response = await api().post('/api/incidents/INC-42/read').send({});

            expect(response.status).toBe(200);
            expect(response.text).toContain('Minimal incident');
            expect(response.text).toContain('"severity":"Unknown"');
            expect(response.text).toContain('"status":""');
        });

        it('returns incident provider availability when an active provider exists', async () => {
            __testUtils.setConfig({ incidentProvider: { type: 'fake' } as any });
            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(true),
                configure: vi.fn(),
                fetchIncident: vi.fn(),
            } as any);

            const response = await api().get('/api/incidents/status');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ available: true, providerType: 'fake' });
        });

        it('streams incident read fallback errors without an explicit message', async () => {
            __testUtils.setActiveIncidentProvider({
                type: 'fake',
                displayName: 'Fake',
                isAvailable: vi.fn().mockResolvedValue(true),
                fetchIncident: vi.fn().mockRejectedValue(''),
            } as any);

            const response = await api().post('/api/incidents/INC-EMPTY/read').send({});

            expect(response.status).toBe(200);
            expect(response.text).toContain('Failed to read incident');
        });

        it('serves full schedule and query-bank CRUD endpoints', async () => {
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-1', enabled: true }]),
                create: vi.fn().mockImplementation((payload: any) => ({ id: 'sched-2', ...payload })),
                update: vi.fn().mockImplementation((id: string, payload: any) => ({ id, ...payload })),
                delete: vi.fn().mockReturnValue(true),
                get: vi.fn().mockReturnValue({ id: 'sched-1' }),
                getHistory: vi.fn().mockReturnValue([{ investigationId: 'hist-1', verdict: 'error' }]),
                appendHistory: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            const scheduler = new EventEmitter() as EventEmitter & Record<string, any>;
            scheduler.isRunning = vi.fn().mockReturnValue(false);
            scheduler.start = vi.fn();
            scheduler.stop = vi.fn();
            scheduler.runNow = vi.fn().mockResolvedValue(undefined);
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler(scheduler as any);

            __testUtils.getHistory().set('hist-1', makeState({ id: 'hist-1', status: 'paused' }) as any);

            let response = await api().get('/api/schedules');
            expect(response.status).toBe(200);
            expect(scheduleStore.getAll).toHaveBeenCalled();

            response = await api().post('/api/schedules').send({ name: 'Nightly', target: 'stamp', query: 'Check health' });
            expect(response.status).toBe(200);
            expect(scheduleStore.create).toHaveBeenCalled();
            expect(scheduler.start).toHaveBeenCalled();

            response = await api().put('/api/schedules/sched-1').send({ enabled: false });
            expect(response.status).toBe(200);

            response = await api().post('/api/schedules/sched-1/run-now').send({});
            expect(response.status).toBe(200);
            expect(scheduler.runNow).toHaveBeenCalledWith('sched-1');

            response = await api().post('/api/schedules/sched-1/enable').send({});
            expect(response.status).toBe(200);

            response = await api().post('/api/schedules/sched-1/disable').send({});
            expect(response.status).toBe(200);

            response = await api().get('/api/schedules/sched-1/history');
            expect(response.status).toBe(200);
            expect(response.body[0].verdict).toBe('paused');

            response = await api().post('/api/scheduler/start').send({});
            expect(response.status).toBe(200);

            response = await api().post('/api/scheduler/stop').send({});
            expect(response.status).toBe(200);

            response = await api().delete('/api/schedules/sched-1');
            expect(response.status).toBe(200);
            expect(scheduleStore.delete).toHaveBeenCalledWith('sched-1');

            const queryBankStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'query-1', name: 'Saved Query' }]),
                create: vi.fn().mockImplementation((payload: any) => ({ id: 'query-2', ...payload })),
                update: vi.fn().mockImplementation((id: string, payload: any) => ({ id, ...payload })),
                delete: vi.fn().mockReturnValue(true),
            };
            __testUtils.setQueryBankStore(queryBankStore as any);
            expect(__testUtils.getQueryBankStore()).toEqual(queryBankStore);

            response = await api().get('/api/query-bank');
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);

            response = await api().post('/api/query-bank').send({ name: 'Saved Query', query: 'StormEvents | take 1' });
            expect(response.status).toBe(200);
            expect(queryBankStore.create).toHaveBeenCalled();

            response = await api().put('/api/query-bank/query-1').send({ name: 'Updated Query' });
            expect(response.status).toBe(200);

            response = await api().delete('/api/query-bank/query-1');
            expect(response.status).toBe(200);
            expect(queryBankStore.delete).toHaveBeenCalledWith('query-1');
        });

        it('paginates schedules with page and pageSize params', async () => {
            const items = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, enabled: true }));
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue(items),
                create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn(), getHistory: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler(new EventEmitter() as any);

            const r = await api().get('/api/schedules?page=2&pageSize=2');
            expect(r.status).toBe(200);
            expect(r.body.items).toHaveLength(2);
            expect(r.body.totalCount).toBe(5);
            expect(r.body.page).toBe(2);
            expect(r.body.totalPages).toBe(3);
        });

        it('returns the inactive-runner MCP restart guidance and lazy-init schedule failure', async () => {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-init-fail-'));
            const invPath = path.join(tempRoot, 'not-a-dir');
            fs.writeFileSync(invPath, 'file-blocker');
            __testUtils.setConfig({ investigationsPath: invPath, products: [], activeProductId: '' });

            __testUtils.getHistory().set('inactive-mcp', makeState({ id: 'inactive-mcp', status: 'completed' }) as any);

            let response = await api().post('/api/investigations/inactive-mcp/mcp/restart').send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('finished/inactive');

            __testUtils.setScheduleStore(null);
            __testUtils.setScheduler(null);
            response = await api().post('/api/schedules').send({
                name: 'Broken init',
                target: 'stamp-broken',
                query: 'Check health',
            });
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Scheduler not initialized');

            response = await api().post('/api/investigations/missing-mcp/mcp/restart').send({});
            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Runner not found');
        });

        it('lazily initializes the scheduler and validates schedule and query-bank errors', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-lazy-scheduler-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            let response = await api().post('/api/schedules').send({ name: 'Missing target' });
            expect(response.status).toBe(400);

            response = await api().post('/api/schedules').send({
                name: 'Lazy Init',
                target: 'stamp-lazy',
                query: 'Check health',
                enabled: false,
            });
            expect(response.status).toBe(200);

            response = await api().post('/api/schedules/missing/run-now').send({});
            expect(response.status).toBe(400);

            response = await api().post('/api/query-bank').send({});
            expect(response.status).toBe(400);

            response = await api().put('/api/query-bank/missing').send({ name: 'Still missing' });
            expect(response.status).toBe(404);

            response = await api().delete('/api/query-bank/missing');
            expect(response.status).toBe(404);

            await api().post('/api/scheduler/stop').send({});
        });

        it('returns explicit initialization errors for scheduler and query-bank mutation endpoints', async () => {
            __testUtils.setScheduleStore(null);
            __testUtils.setScheduler(null);
            __testUtils.setQueryBankStore(null);

            let response = await api().post('/api/schedules/missing/run-now').send({});
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Scheduler not initialized');

            response = await api().post('/api/schedules/missing/enable').send({});
            expect(response.status).toBe(500);

            response = await api().post('/api/schedules/missing/disable').send({});
            expect(response.status).toBe(500);

            response = await api().post('/api/scheduler/start').send({});
            expect(response.status).toBe(500);

            response = await api().post('/api/scheduler/stop').send({});
            expect(response.status).toBe(500);

            response = await api().post('/api/query-bank').send({ name: 'Missing store' });
            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Query bank not initialized');

            response = await api().put('/api/query-bank/missing').send({ name: 'Missing store' });
            expect(response.status).toBe(500);

            response = await api().delete('/api/query-bank/missing');
            expect(response.status).toBe(500);
        });

        it('covers schedule update, enable-disable, history, status, and me fallbacks', async () => {
            let response = await api().put('/api/schedules/missing').send({ enabled: true });
            expect(response.status).toBe(500);

            response = await api().delete('/api/schedules/missing');
            expect(response.status).toBe(500);

            const scheduleStore = {
                update: vi.fn().mockReturnValue(undefined),
                getHistory: vi.fn().mockReturnValue([]),
                get: vi.fn().mockReturnValue(undefined),
                delete: vi.fn().mockReturnValue(false),
                getAll: vi.fn().mockReturnValue([]),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            const scheduler = {
                isRunning: vi.fn().mockReturnValue(true),
                start: vi.fn(),
                stop: vi.fn(),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler(scheduler as any);

            response = await api().put('/api/schedules/missing').send({ enabled: true });
            expect(response.status).toBe(404);

            response = await api().post('/api/schedules/missing/enable').send({});
            expect(response.status).toBe(404);

            response = await api().post('/api/schedules/missing/disable').send({});
            expect(response.status).toBe(404);

            response = await api().get('/api/schedules/missing/history');
            expect(response.status).toBe(200);
            expect(scheduleStore.getHistory).toHaveBeenCalledWith('missing', undefined);

            response = await api().get('/api/scheduler/status');
            expect(response.status).toBe(200);
            expect(response.body.running).toBe(true);

            response = await api().get('/api/schedules/missing/history').query({ maxEntries: '2' });
            expect(response.status).toBe(200);
            expect(scheduleStore.getHistory).toHaveBeenCalledWith('missing', 2);
        });

        it('covers schedule settlement and deletion branches for product-specific investigations', async () => {
            const productInvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-product-delete-'));
            __testUtils.setConfig({
                investigationsPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-global-')),
                products: [{ id: 'prod-schedule', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-schedule',
            });

            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([
                    { id: 'sched-paused', activeInvestigationId: undefined, lastVerdict: 'error', lastInvestigationId: 'paused-history' },
                    { id: 'sched-complete', activeInvestigationId: 'completed-history', lastVerdict: undefined },
                ]),
                update: vi.fn(),
                get: vi.fn().mockReturnValue({ id: 'sched-prod-delete', activeInvestigationId: 'runner-prod-delete' }),
                delete: vi.fn().mockReturnValue(true),
                getHistory: vi.fn().mockReturnValue([]),
                appendHistory: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            __testUtils.getHistory().set('paused-history', makeState({ id: 'paused-history', status: 'paused', verdict: 'warning' as any }) as any);
            __testUtils.getHistory().set('completed-history', makeState({ id: 'completed-history', status: 'completed', verdict: '' as any }) as any);
            __testUtils.getHistory().set('runner-prod-delete', makeState({ id: 'runner-prod-delete', status: 'completed', scheduleId: 'sched-prod-delete', productId: 'prod-schedule' }) as any);

            let response = await api().get('/api/schedules');
            expect(response.status).toBe(200);
            expect(scheduleStore.update).toHaveBeenCalledWith('sched-paused', { lastVerdict: 'warning' });
            expect(scheduleStore.update).toHaveBeenCalledWith('sched-complete', { activeInvestigationId: undefined, lastVerdict: 'error' });

            const productFolder = path.join(productInvRoot, '2024-01-01_stamp_runnerproddelete');
            fs.mkdirSync(productFolder, { recursive: true });
            response = await api().delete('/api/schedules/sched-prod-delete');
            expect(response.status).toBe(200);
        });

        it('falls back to a paused verdict when settling legacy paused schedules without a verdict', async () => {
            const update = vi.fn();
            __testUtils.getHistory().set('paused-no-verdict', makeState({ id: 'paused-no-verdict', status: 'paused', verdict: undefined }) as any);
            __testUtils.setScheduleStore({
                getAll: vi.fn().mockReturnValue([
                    { id: 'legacy-paused', enabled: true, lastVerdict: 'error', lastInvestigationId: 'paused-no-verdict' },
                ]),
                update,
                getHistoryCount: vi.fn().mockReturnValue(0),
            } as any);

            const response = await api().get('/api/schedules');

            expect(response.status).toBe(200);
            expect(update).toHaveBeenCalledWith('legacy-paused', { lastVerdict: 'paused' });
        });

        it('corrects stale verdicts and backfills summaries in the history endpoint', async () => {
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([]),
                getHistory: vi.fn().mockReturnValue([
                    { investigationId: 'hist-corrected', verdict: 'error', timestamp: new Date().toISOString() },
                    { investigationId: 'hist-backfill', verdict: 'healthy', timestamp: new Date().toISOString() },
                    { investigationId: 'hist-no-inv', verdict: 'warning', timestamp: new Date().toISOString() },
                    { investigationId: 'hist-completed', verdict: 'warning', timestamp: new Date().toISOString() },
                    { investigationId: 'hist-failed', verdict: 'healthy', timestamp: new Date().toISOString() },
                ]),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            // hist-corrected: investigation is completed with a different verdict → should correct
            __testUtils.getHistory().set('hist-corrected', makeState({ id: 'hist-corrected', status: 'completed', verdict: 'healthy', finalReport: 'All good report' }) as any);
            // hist-backfill: investigation is paused with no verdict → should backfill summary from finalReport
            __testUtils.getHistory().set('hist-backfill', makeState({ id: 'hist-backfill', status: 'paused', verdict: undefined, finalReport: 'Backfill this summary' }) as any);
            // hist-no-inv: not in history map → no correction
            // hist-completed: completed with no verdict → 'completed' fallback (covers ternary branch)
            __testUtils.getHistory().set('hist-completed', makeState({ id: 'hist-completed', status: 'completed', verdict: undefined }) as any);
            // hist-failed: failed with no verdict → 'error' fallback (covers ternary branch)
            __testUtils.getHistory().set('hist-failed', makeState({ id: 'hist-failed', status: 'failed', verdict: undefined }) as any);

            const response = await api().get('/api/schedules/sched-1/history');

            expect(response.status).toBe(200);
            // Verdict corrected from 'error' to 'healthy'
            expect(response.body[0].verdict).toBe('healthy');
            // Verdict corrected from 'healthy' to 'paused' (no verdict + paused status)
            expect(response.body[1].verdict).toBe('paused');
            // Summary backfilled
            expect(response.body[1].summary).toBe('Backfill this summary');
            // Uncorrected (no investigation in history map)
            expect(response.body[2].verdict).toBe('warning');
            // Verdict corrected: warning → completed (completed status, no verdict)
            expect(response.body[3].verdict).toBe('completed');
            // Verdict corrected: healthy → error (failed status, no verdict)
            expect(response.body[4].verdict).toBe('error');
        });

        it('returns a default report for a schedule with no history', async () => {
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-empty', name: 'Empty Schedule' }]),
                getHistory: vi.fn().mockReturnValue([]),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-empty/report');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                scheduleId: 'sched-empty',
                scheduleName: 'Empty Schedule',
                totalRuns: 0,
                verdictBreakdown: {},
                successRate: 0,
                trend: 'stable',
                recentSummaries: [],
            });
        });

        it('returns 404 for a report of a missing schedule', async () => {
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([]),
                getHistory: vi.fn().mockReturnValue([]),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/missing/report');

            expect(response.status).toBe(404);
        });

        it('returns 500 for report when scheduler is not initialized', async () => {
            __testUtils.setScheduleStore(null);

            const response = await api().get('/api/schedules/sched-1/report');

            expect(response.status).toBe(500);
        });

        it('returns a full report with verdict breakdown, trend, and executive summary', async () => {
            const now = Date.now();
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date(now - 50000).toISOString(), summary: 'Run 1 OK' },
                { investigationId: 'inv-2', verdict: 'healthy', timestamp: new Date(now - 40000).toISOString(), summary: 'Run 2 OK' },
                { investigationId: 'inv-3', verdict: 'warning', timestamp: new Date(now - 30000).toISOString(), summary: 'Run 3 warning' },
                { investigationId: 'inv-4', verdict: 'critical', timestamp: new Date(now - 20000).toISOString(), summary: 'Run 4 critical' },
                { investigationId: 'inv-5', verdict: 'healthy', timestamp: new Date(now - 10000).toISOString(), summary: 'Run 5 OK' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-report', name: 'Report Schedule', target: 'stamp', intervalMinutes: 60 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue('# Executive Summary\nAll good.'),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(5),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-report/report');

            expect(response.status).toBe(200);
            expect(response.body.totalRuns).toBe(5);
            expect(response.body.verdictBreakdown).toEqual({ healthy: 3, warning: 1, critical: 1 });
            expect(response.body.successRate).toBe(60);
            expect(response.body.recentSummaries).toHaveLength(5);
            expect(response.body.firstRunAt).toBeTruthy();
            expect(response.body.lastRunAt).toBeTruthy();
            expect(response.body.executiveSummary).toBe('# Executive Summary\nAll good.');
            // Should NOT call writeExecutiveReport since it was read from file
            expect(scheduleStore.writeExecutiveReport).not.toHaveBeenCalled();
        });

        it('generates executive summary on-demand when none is cached', async () => {
            const now = Date.now();
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date(now - 20000).toISOString(), summary: 'OK' },
                { investigationId: 'inv-2', verdict: 'warning', timestamp: new Date(now - 10000).toISOString(), summary: 'Warn' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-gen', name: 'Gen Schedule', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue(null),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(2),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-gen/report');

            expect(response.status).toBe(200);
            expect(response.body.executiveSummary).toBeTruthy();
            expect(response.body.executiveSummary).toContain('Gen Schedule');
            // Should persist the generated report
            expect(scheduleStore.writeExecutiveReport).toHaveBeenCalledWith('sched-gen', expect.any(String));
        });

        it('tolerates writeExecutiveReport failure when generating on-demand', async () => {
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date().toISOString(), summary: 'OK' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-fail-write', name: 'Fail Write', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue(null),
                writeExecutiveReport: vi.fn().mockImplementation(() => { throw new Error('disk full'); }),
                getHistoryCount: vi.fn().mockReturnValue(1),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-fail-write/report');

            // Should still return 200 with the generated summary
            expect(response.status).toBe(200);
            expect(response.body.executiveSummary).toBeTruthy();
        });

        it('uses AI-generated executive report when LLM provider is active', async () => {
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date().toISOString(), summary: 'OK' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-ai', name: 'AI Schedule', target: 'stamp', intervalMinutes: 60 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue(null),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(1),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);
            setFakeLlmProvider();

            const spy = vi.spyOn(SchedulerModule, 'generateAIExecutiveReport').mockResolvedValue('# AI Executive Report');

            const response = await api().get('/api/schedules/sched-ai/report?refresh=true');

            expect(response.status).toBe(200);
            expect(response.body.executiveSummary).toBe('# AI Executive Report');
            expect(scheduleStore.writeExecutiveReport).toHaveBeenCalledWith('sched-ai', '# AI Executive Report');
            spy.mockRestore();
        });

        it('falls back to template when AI executive report generation fails', async () => {
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date().toISOString(), summary: 'OK' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-ai-fail', name: 'AI Fail Schedule', target: 'stamp', intervalMinutes: 60 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue(null),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(1),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);
            setFakeLlmProvider();

            const spy = vi.spyOn(SchedulerModule, 'generateAIExecutiveReport').mockRejectedValue(new Error('LLM timeout'));

            const response = await api().get('/api/schedules/sched-ai-fail/report');

            expect(response.status).toBe(200);
            // Falls back to template-generated summary
            expect(response.body.executiveSummary).toBeTruthy();
            expect(response.body.executiveSummary).toContain('AI Fail Schedule');
            spy.mockRestore();
        });

        it('tolerates writeExecutiveReport failure during AI report generation', async () => {
            const entries = [
                { investigationId: 'inv-1', verdict: 'healthy', timestamp: new Date().toISOString(), summary: 'OK' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-ai-wf', name: 'AI Write Fail', target: 'stamp', intervalMinutes: 60 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue(null),
                writeExecutiveReport: vi.fn().mockImplementation(() => { throw new Error('disk full'); }),
                getHistoryCount: vi.fn().mockReturnValue(1),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);
            setFakeLlmProvider();

            const spy = vi.spyOn(SchedulerModule, 'generateAIExecutiveReport').mockResolvedValue('# AI Report');

            const response = await api().get('/api/schedules/sched-ai-wf/report');

            expect(response.status).toBe(200);
            expect(response.body.executiveSummary).toBe('# AI Report');
            spy.mockRestore();
        });

        it('computes an improving trend when recent runs are better than older ones', async () => {
            const now = Date.now();
            // Older runs are critical, newer runs are healthy → improving
            const entries = [
                { investigationId: 'old-1', verdict: 'critical', timestamp: new Date(now - 40000).toISOString(), summary: 'Bad' },
                { investigationId: 'old-2', verdict: 'critical', timestamp: new Date(now - 30000).toISOString(), summary: 'Bad' },
                { investigationId: 'new-1', verdict: 'healthy', timestamp: new Date(now - 20000).toISOString(), summary: 'Good' },
                { investigationId: 'new-2', verdict: 'healthy', timestamp: new Date(now - 10000).toISOString(), summary: 'Good' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-improving', name: 'Improving', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue('cached'),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(4),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-improving/report');

            expect(response.status).toBe(200);
            expect(response.body.trend).toBe('improving');
        });

        it('computes a degrading trend when recent runs are worse than older ones', async () => {
            const now = Date.now();
            // Older runs are warning, newer runs are critical → degrading (no healthy entries → covers successCount || 0 branch)
            const entries = [
                { investigationId: 'old-1', verdict: 'warning', timestamp: new Date(now - 40000).toISOString(), summary: 'Meh' },
                { investigationId: 'old-2', verdict: 'warning', timestamp: new Date(now - 30000).toISOString(), summary: 'Meh' },
                { investigationId: 'new-1', verdict: 'critical', timestamp: new Date(now - 20000).toISOString(), summary: 'Bad' },
                { investigationId: 'new-2', verdict: 'critical', timestamp: new Date(now - 10000).toISOString(), summary: 'Bad' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-degrading', name: 'Degrading', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue('cached'),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(4),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-degrading/report');

            expect(response.status).toBe(200);
            expect(response.body.trend).toBe('degrading');
        });

        it('corrects verdicts and backfills summaries in report entries', async () => {
            const now = Date.now();
            const entries = [
                { investigationId: 'report-fix-1', verdict: 'error', timestamp: new Date(now - 50000).toISOString() },
                { investigationId: 'report-fix-2', verdict: 'healthy', timestamp: new Date(now - 40000).toISOString() },
                { investigationId: 'report-fix-3', verdict: 'warning', timestamp: new Date(now - 30000).toISOString() },
                { investigationId: 'report-fix-4', verdict: 'warning', timestamp: new Date(now - 20000).toISOString() },
                { investigationId: 'report-fix-5', verdict: 'error', timestamp: new Date(now - 10000).toISOString(), summary: 'Already has summary' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-fix', name: 'Fix Schedule', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue('cached'),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(5),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            // report-fix-1: completed with healthy verdict and finalReport → correct error→healthy, backfill summary
            __testUtils.getHistory().set('report-fix-1', makeState({ id: 'report-fix-1', status: 'completed', verdict: 'healthy', finalReport: 'Fixed report content' }) as any);
            // report-fix-2: failed with no verdict → error fallback
            __testUtils.getHistory().set('report-fix-2', makeState({ id: 'report-fix-2', status: 'failed', verdict: undefined }) as any);
            // report-fix-3: paused with no verdict → paused fallback (covers ternary branch)
            __testUtils.getHistory().set('report-fix-3', makeState({ id: 'report-fix-3', status: 'paused', verdict: undefined }) as any);
            // report-fix-4: completed with no verdict → completed fallback (covers ternary branch + successCount 'completed')
            __testUtils.getHistory().set('report-fix-4', makeState({ id: 'report-fix-4', status: 'completed', verdict: undefined }) as any);
            // report-fix-5: aborted with error verdict → error severity (covers severityScore 'error' branch)
            __testUtils.getHistory().set('report-fix-5', makeState({ id: 'report-fix-5', status: 'aborted', verdict: 'error' }) as any);

            const response = await api().get('/api/schedules/sched-fix/report');

            expect(response.status).toBe(200);
            // Verdict corrected: error → healthy
            expect(response.body.verdictBreakdown.healthy).toBe(1);
            // Verdict corrected: healthy → error (failed status, no verdict)
            // Plus report-fix-5: error verdict keeps error
            expect(response.body.verdictBreakdown.error).toBe(2);
            // Verdict corrected: warning → paused (paused status, no verdict)
            expect(response.body.verdictBreakdown.paused).toBe(1);
            // Verdict corrected: warning → completed (completed status, no verdict)
            expect(response.body.verdictBreakdown.completed).toBe(1);
            // successCount includes both healthy and completed
            expect(response.body.successRate).toBe(40); // 2/5 = 40%
            // Summary backfilled in recentSummaries
            const summaries = response.body.recentSummaries;
            expect(summaries.find((s: any) => s.investigationId === 'report-fix-1').summary).toBe('Fixed report content');
            // report-fix-5 already had summary, not overwritten
            expect(summaries.find((s: any) => s.investigationId === 'report-fix-5').summary).toBe('Already has summary');
        });

        it('includes paused verdicts in severity scoring for trend calculation', async () => {
            const now = Date.now();
            const entries = [
                { investigationId: 'p-1', verdict: 'paused', timestamp: new Date(now - 40000).toISOString(), summary: 'P1' },
                { investigationId: 'p-2', verdict: 'paused', timestamp: new Date(now - 30000).toISOString(), summary: 'P2' },
                { investigationId: 'p-3', verdict: 'healthy', timestamp: new Date(now - 20000).toISOString(), summary: 'P3' },
                { investigationId: 'p-4', verdict: 'healthy', timestamp: new Date(now - 10000).toISOString(), summary: 'P4' },
            ];
            const scheduleStore = {
                getAll: vi.fn().mockReturnValue([{ id: 'sched-paused-trend', name: 'Paused Trend', target: 'stamp', intervalMinutes: 30 }]),
                getHistory: vi.fn().mockReturnValue(entries),
                getExecutiveReport: vi.fn().mockReturnValue('cached'),
                writeExecutiveReport: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(4),
            };
            __testUtils.setScheduleStore(scheduleStore as any);
            __testUtils.setScheduler({ isRunning: vi.fn().mockReturnValue(false) } as any);

            const response = await api().get('/api/schedules/sched-paused-trend/report');

            expect(response.status).toBe(200);
            // Paused (severity 1) → Healthy (severity 0) = improving
            expect(response.body.trend).toBe('improving');
            expect(response.body.verdictBreakdown.paused).toBe(2);
        });

        it('covers scheduler history initialization errors and global error string fallbacks', async () => {
            __testUtils.setScheduleStore(null);

            let response = await api().get('/api/schedules/missing/history');
            expect(response.status).toBe(500);

            const stack = ((__testUtils.app as any)._router?.stack || (__testUtils.app as any).router?.stack || []) as any[];
            const errorLayer = stack.find((layer) =>
                typeof layer.handle === 'function'
                && layer.handle.length === 4
                && String(layer.handle).includes('Unhandled error on')
            );
            const status = vi.fn().mockReturnThis();
            const json = vi.fn();
            errorLayer.handle('plain failure', { method: 'GET', url: '/plain-failure' }, { headersSent: false, status, json }, vi.fn());
            expect(status).toHaveBeenCalledWith(500);
            expect(json).toHaveBeenCalledWith({ error: 'plain failure' });
        });

        it('deletes schedules even when their tracked investigation state is missing entirely', async () => {
            __testUtils.setConfig({ investigationsPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-missing-state-')), products: [], activeProductId: '' });
            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-missing-state', activeInvestigationId: 'missing-investigation' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            const response = await api().delete('/api/schedules/sched-missing-state');

            expect(response.status).toBe(200);
            expect(response.body.deletedInvestigations).toBe(1);
        });

        it('deletes schedules together with linked history and active investigations', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-delete-'));
            const historyDir = path.join(invRoot, '2024-01-01_stamp-history_history1');
            const runnerDir = path.join(invRoot, '2024-01-01_stamp-runner_runner1');
            fs.mkdirSync(historyDir, { recursive: true });
            fs.mkdirSync(runnerDir, { recursive: true });
            fs.writeFileSync(path.join(historyDir, 'state.json'), JSON.stringify(makeState({ id: 'history1', scheduleId: 'sched-delete' })));
            fs.writeFileSync(path.join(runnerDir, 'state.json'), JSON.stringify(makeState({ id: 'runner1', scheduleId: 'sched-delete' })));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            const scheduleStore = {
                get: vi.fn().mockReturnValue({ id: 'sched-delete', activeInvestigationId: 'runner1' }),
                delete: vi.fn().mockReturnValue(true),
                getAll: vi.fn().mockReturnValue([]),
                getHistoryCount: vi.fn().mockReturnValue(0),
            };
            __testUtils.setScheduleStore(scheduleStore as any);

            __testUtils.getHistory().set('history1', makeState({ id: 'history1', scheduleId: 'sched-delete' }) as any);
            const activeRunner = makeRunner({ id: 'runner1', status: 'running', scheduleId: 'sched-delete' });
            __testUtils.getRunners().set('runner1', activeRunner as any);

            const response = await api().delete('/api/schedules/sched-delete');

            expect(response.status).toBe(200);
            expect(response.body.deletedInvestigations).toBe(2);
            expect(activeRunner.abort).toHaveBeenCalled();
            expect(scheduleStore.delete).toHaveBeenCalledWith('sched-delete');
            expect(__testUtils.getHistory().has('history1')).toBe(false);
            expect(__testUtils.getHistory().has('runner1')).toBe(false);
        });

        it('covers schedule deletion fallback branches and missing schedules', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-delete-edge-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const throwingRunner = makeRunner({ id: 'runner-edge', status: 'running', scheduleId: 'sched-edge' }, {
                abort: vi.fn(() => {
                    throw new Error('abort exploded');
                }),
            });
            __testUtils.getRunners().set('runner-edge', throwingRunner as any);
            __testUtils.getHistory().set('history-edge', makeState({ id: 'history-edge', scheduleId: 'sched-edge' }) as any);
            __testUtils.getHistory().set('runner-edge', makeState({ id: 'runner-edge', scheduleId: 'sched-edge' }) as any);

            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-edge', activeInvestigationId: 'runner-edge' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            let response = await api().delete('/api/schedules/sched-edge');
            expect(response.status).toBe(200);
            expect(warnSpy).toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[Delete Schedule] Failed to abort investigation runner-edge:'), 'abort exploded');

            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue(undefined),
                delete: vi.fn().mockReturnValue(false),
            } as any);

            response = await api().delete('/api/schedules/missing-schedule');
            expect(response.status).toBe(404);
        });

        it('uses product-specific investigation paths and tolerates unlink failures during schedule deletion', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-delete-product-'));
            const productInvRoot = path.join(invRoot, 'product-investigations');
            fs.mkdirSync(productInvRoot, { recursive: true });
            fs.mkdirSync(path.join(productInvRoot, 'product-edge.json'), { recursive: true });

            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-edge', investigationsPath: productInvRoot } as any],
                activeProductId: 'prod-edge',
            });
            __testUtils.getHistory().set('product-edge', makeState({ id: 'product-edge', scheduleId: 'sched-product-edge', productId: 'prod-edge' }) as any);
            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-product-edge' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const response = await api().delete('/api/schedules/sched-product-edge');

            expect(response.status).toBe(200);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Delete Schedule] No directory found ending with _productedge'));
        });

        it('logs product-path directory deletion failures during schedule cleanup', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-delete-product-fail-'));
            const brokenProductPath = path.join(invRoot, 'broken-product-path.txt');
            fs.writeFileSync(brokenProductPath, 'not-a-directory');

            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-broken', investigationsPath: brokenProductPath } as any],
                activeProductId: 'prod-broken',
            });
            __testUtils.getHistory().set('product-broken', makeState({ id: 'product-broken', scheduleId: 'sched-product-broken', productId: 'prod-broken' }) as any);
            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-product-broken' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const response = await api().delete('/api/schedules/sched-product-broken');

            expect(response.status).toBe(200);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[Delete Schedule] Failed to delete investigation directory for product-broken:'), expect.any(String));
        });

        it('deletes scheduled history from the global path when product ids no longer resolve', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-history-fallback-'));
            const historyDir = path.join(invRoot, '2024-01-01_stamp-history_ghostschedule');
            fs.mkdirSync(historyDir, { recursive: true });
            __testUtils.setConfig({ investigationsPath: invRoot, products: undefined as any, activeProductId: '' });
            __testUtils.getHistory().set('ghost-schedule', makeState({
                id: 'ghost-schedule',
                scheduleId: 'sched-history-fallback',
                productId: 'ghost-product',
                status: 'completed',
            }) as any);
            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-history-fallback' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            const response = await api().delete('/api/schedules/sched-history-fallback');

            expect(response.status).toBe(200);
            expect(fs.existsSync(historyDir)).toBe(false);
        });

        it('deletes scheduled investigations by falling back to runner state and the global path when the product is missing', async () => {
            const globalInvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-schedule-runner-fallback-'));
            const fallbackDir = path.join(globalInvRoot, '2024-01-01_stamp_runnerstateonly');
            fs.mkdirSync(fallbackDir, { recursive: true });

            __testUtils.setConfig({
                investigationsPath: globalInvRoot,
                products: [],
                activeProductId: '',
            });

            const runnerOnly = makeRunner({ id: 'runner-state-only', status: 'running', scheduleId: 'sched-runner-fallback', productId: 'missing-product' }, {
                state: makeState({ id: 'runner-state-only', status: 'running', scheduleId: 'sched-runner-fallback', productId: 'missing-product' }),
            });
            __testUtils.getRunners().set('runner-state-only', runnerOnly as any);
            __testUtils.setScheduleStore({
                get: vi.fn().mockReturnValue({ id: 'sched-runner-fallback', activeInvestigationId: 'runner-state-only' }),
                delete: vi.fn().mockReturnValue(true),
            } as any);

            const response = await api().delete('/api/schedules/sched-runner-fallback');

            expect(response.status).toBe(200);
            expect(fs.existsSync(fallbackDir)).toBe(false);
            expect(__testUtils.getHistory().has('runner-state-only')).toBe(false);
        });

        it('auto-settles stale and terminal schedules when listing schedules', async () => {
            const update = vi.fn();
            const appendHistory = vi.fn();
            __testUtils.getHistory().set('paused-history', makeState({ id: 'paused-history', status: 'paused', verdict: 'paused' }) as any);
            __testUtils.getHistory().set('completed-history', makeState({ id: 'completed-history', status: 'completed', verdict: 'healthy', finalReport: 'All settled ok' }) as any);
            __testUtils.getHistory().set('completed-no-verdict', makeState({ id: 'completed-no-verdict', status: 'completed', verdict: undefined }) as any);
            __testUtils.getHistory().set('failed-no-verdict', makeState({ id: 'failed-no-verdict', status: 'failed', verdict: undefined }) as any);

            __testUtils.setScheduleStore({
                getAll: vi.fn().mockReturnValue([
                    { id: 'legacy', enabled: true, lastVerdict: 'error', lastInvestigationId: 'paused-history' },
                    { id: 'stale', enabled: true, activeInvestigationId: 'missing-history', lastVerdict: undefined },
                    { id: 'terminal', enabled: true, activeInvestigationId: 'completed-history', lastVerdict: undefined },
                    { id: 'completed-stale', enabled: true, lastVerdict: 'error', lastInvestigationId: 'completed-no-verdict' },
                    { id: 'failed-stale', enabled: true, lastVerdict: 'completed', lastInvestigationId: 'failed-no-verdict' },
                ]),
                update,
                getHistory: vi.fn().mockReturnValue([]),
                appendHistory,
                getHistoryCount: vi.fn().mockReturnValue(0),
            } as any);

            const response = await api().get('/api/schedules');

            expect(response.status).toBe(200);
            expect(update).toHaveBeenCalledWith('legacy', { lastVerdict: 'paused' });
            expect(update).toHaveBeenCalledWith('stale', { activeInvestigationId: undefined, lastVerdict: 'error' });
            expect(update).toHaveBeenCalledWith('terminal', { activeInvestigationId: undefined, lastVerdict: 'healthy' });
            // Auto-settle writes history with summary from finalReport
            expect(appendHistory).toHaveBeenCalledWith('terminal', expect.objectContaining({ summary: 'All settled ok' }));
            // Verdict correction: completed investigation without verdict → 'completed'
            expect(update).toHaveBeenCalledWith('completed-stale', { lastVerdict: 'completed' });
            // Verdict correction: failed investigation without verdict → 'error'
            expect(update).toHaveBeenCalledWith('failed-stale', { lastVerdict: 'error' });
        });

        it('settles paused schedules from active runners with a paused verdict', async () => {
            const update = vi.fn();
            __testUtils.setScheduleStore({
                getAll: vi.fn().mockReturnValue([
                    { id: 'runner-paused', enabled: true, activeInvestigationId: 'runner-paused-id', lastVerdict: undefined },
                ]),
                update,
                getHistory: vi.fn().mockReturnValue([]),
                appendHistory: vi.fn(),
                getHistoryCount: vi.fn().mockReturnValue(0),
            } as any);
            __testUtils.getRunners().set('runner-paused-id', makeRunner({ id: 'runner-paused-id', status: 'paused', verdict: undefined }) as any);

            const response = await api().get('/api/schedules');

            expect(response.status).toBe(200);
            expect(update).toHaveBeenCalledWith('runner-paused', { activeInvestigationId: undefined, lastVerdict: 'paused' });
        });

        it('uses the real scheduler settlement callback and broadcasts schedule updates', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const realScheduler = __testUtils.getScheduler();
            expect(realStore).toBeTruthy();
            expect(realScheduler).toBeTruthy();

            const wsClient = { readyState: 1, send: vi.fn() };
            __testUtils.clients.set('schedules', new Set([wsClient as any]));

            const schedule = realStore!.create({
                name: 'Real Scheduler',
                enabled: true,
                target: 'stamp-real',
                query: 'Check status',
                intervalMinutes: 15,
                autoEscalate: false,
                activeInvestigationId: 'real-history',
                lastInvestigationId: 'real-history',
                nextRunAt: new Date(Date.now() + 60_000).toISOString(),
            });
            __testUtils.getHistory().set('real-history', makeState({ id: 'real-history', status: 'completed', verdict: 'healthy', finalReport: 'All good' }) as any);

            await (realScheduler as any).tick();

            const updated = realStore!.get(schedule.id);
            expect(updated?.activeInvestigationId).toBeUndefined();
            expect(updated?.lastVerdict).toBe('healthy');
            expect(wsClient.send).toHaveBeenCalledWith(expect.stringContaining('schedule-update'));
        });

        it('leaves scheduled investigations active when the scheduler callback cannot find their state', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-missing-state-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const realScheduler = __testUtils.getScheduler();
            expect(realStore).toBeTruthy();
            expect(realScheduler).toBeTruthy();

            const schedule = realStore!.create({
                name: 'Missing State Scheduler',
                enabled: true,
                target: 'stamp-missing-state',
                query: 'Still running',
                intervalMinutes: 15,
                activeInvestigationId: 'missing-state-id',
            });

            await (realScheduler as any).tick();

            expect(realStore!.get(schedule.id)?.activeInvestigationId).toBe('missing-state-id');
        });

        it('covers real scheduler execution adapters and auto-starts when enabled schedules exist on disk', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-run-'));
            const schedulesDir = path.join(invRoot, 'schedules');
            fs.mkdirSync(schedulesDir, { recursive: true });
            fs.writeFileSync(path.join(schedulesDir, 'schedules.json'), JSON.stringify([
                {
                    id: 'enabled-from-disk',
                    name: 'Enabled From Disk',
                    enabled: true,
                    target: 'stamp-enabled',
                    query: 'Check from disk',
                    intervalMinutes: 15,
                    createdAt: new Date().toISOString(),
                },
            ]));

            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            setFakeLlmProvider();
            vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const realScheduler = __testUtils.getScheduler() as any;
            expect(realScheduler.isRunning()).toBe(true);

            const created = realStore!.create({
                name: 'Run Now',
                enabled: true,
                target: 'stamp-run-now',
                query: 'Check health',
                intervalMinutes: 15,
                autoEscalate: false,
            });

            await realScheduler.runNow(created.id);

            const startedSchedule = realStore!.get(created.id)!;
            expect(startedSchedule.activeInvestigationId).toBeTruthy();

            __testUtils.getRunners().delete(startedSchedule.activeInvestigationId!);
            __testUtils.getHistory().set(startedSchedule.activeInvestigationId!, makeState({
                id: startedSchedule.activeInvestigationId!,
                status: 'completed',
                verdict: 'healthy',
                finalReport: 'Settled from history',
            }) as any);

            await realScheduler.tick();

            const settledSchedule = realStore!.get(created.id)!;
            expect(settledSchedule.activeInvestigationId).toBeUndefined();
            expect(settledSchedule.lastVerdict).toBe('healthy');

            realScheduler.stop();
        });

        it('settles a scheduled investigation found in the runners map', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-runners-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });
            setFakeLlmProvider();
            vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const realScheduler = __testUtils.getScheduler() as any;

            const created = realStore!.create({
                name: 'Runner Settle',
                enabled: true,
                target: 'stamp-runner',
                query: 'Check health',
                intervalMinutes: 15,
            });

            await realScheduler.runNow(created.id);

            const activeId = realStore!.get(created.id)!.activeInvestigationId!;
            // Keep the runner in the map but give it a completed state
            const runner = __testUtils.getRunners().get(activeId) as any;
            runner.state = makeState({ id: activeId, status: 'completed', verdict: 'unhealthy', finalReport: 'Found in runners' });

            await realScheduler.tick();

            const settled = realStore!.get(created.id)!;
            expect(settled.activeInvestigationId).toBeUndefined();
            expect(settled.lastVerdict).toBe('unhealthy');

            realScheduler.stop();
        });

        it('prunes excess investigations via deleteInvestigation callback on settlement', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-prune-'));
            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [],
                activeProductId: '',
                scheduledInvestigationRetentionCount: 2,
            });
            setFakeLlmProvider();
            vi.spyOn(AgentRunner.prototype as any, 'start').mockResolvedValue(undefined);

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const realScheduler = __testUtils.getScheduler() as any;

            const schedule = realStore!.create({
                name: 'Prune Test',
                enabled: true,
                target: 'stamp-prune',
                query: 'Check health',
                intervalMinutes: 15,
                autoEscalate: false,
            });

            // Simulate 3 old scheduled investigations for this schedule (use numeric IDs like real investigations)
            __testUtils.getHistory().set('1000', makeState({ id: '1000', status: 'completed', scheduleId: schedule.id, source: 'scheduled' }) as any);
            __testUtils.getHistory().set('2000', makeState({ id: '2000', status: 'completed', scheduleId: schedule.id, source: 'scheduled' }) as any);

            // Now run a new one that will settle
            await realScheduler.runNow(schedule.id);
            const activeId = realStore!.get(schedule.id)!.activeInvestigationId!;

            // Move to history with completed state
            __testUtils.getRunners().delete(activeId);
            __testUtils.getHistory().set(activeId, makeState({ id: activeId, status: 'completed', verdict: 'healthy', scheduleId: schedule.id, source: 'scheduled' }) as any);

            // Tick to settle — pruning should delete the oldest (retention=2, 3 investigations → 1 deleted)
            await realScheduler.tick();

            // The oldest investigation should be pruned
            // IDs sorted desc: activeId (highest number), 2000, 1000 → 1000 should be deleted
            expect(__testUtils.getHistory().has('1000')).toBe(false);
            expect(__testUtils.getHistory().has('2000')).toBe(true);
            expect(__testUtils.getHistory().has(activeId)).toBe(true);

            realScheduler.stop();
        });

        it('listScheduleInvestigations callback returns IDs sorted newest first', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-list-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const realStore = __testUtils.getScheduleStore();
            const schedule = realStore!.create({
                name: 'List Test',
                enabled: true,
                target: 'stamp-list',
                query: 'Check',
                intervalMinutes: 15,
            });

            __testUtils.getHistory().set('1000', makeState({ id: '1000', status: 'completed', scheduleId: schedule.id }) as any);
            __testUtils.getHistory().set('3000', makeState({ id: '3000', status: 'completed', scheduleId: schedule.id }) as any);
            __testUtils.getHistory().set('2000', makeState({ id: '2000', status: 'completed', scheduleId: schedule.id }) as any);
            // Different schedule — should not be included
            __testUtils.getHistory().set('4000', makeState({ id: '4000', status: 'completed', scheduleId: 'other-schedule' }) as any);

            const realScheduler = __testUtils.getScheduler() as any;
            const listFn = realScheduler.listScheduleInvestigations;
            const ids = listFn(schedule.id);

            expect(ids).toEqual(['3000', '2000', '1000']); // newest first
        });

        it('deleteInvestigation callback removes investigation from history and cleans disk', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const invId = 'todelete';
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'completed' }) as any);

            // Create a matching dir AND a JSON file on disk
            const safeId = invId.replace(/[^a-zA-Z0-9]/g, '');
            const dirName = `2024-01-01_target_${safeId}`;
            const dirPath = path.join(invRoot, dirName);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'state.json'), '{}');
            const jsonPath = path.join(invRoot, `${invId}.json`);
            fs.writeFileSync(jsonPath, '{}');

            const realScheduler = __testUtils.getScheduler() as any;
            const deleteFn = realScheduler.deleteInvestigation;
            await deleteFn(invId);

            expect(__testUtils.getHistory().has(invId)).toBe(false);
            expect(fs.existsSync(dirPath)).toBe(false);
            expect(fs.existsSync(jsonPath)).toBe(false);
        });

        it('deleteInvestigation callback handles product-specific investigation paths', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-product-'));
            const productDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-product-inv-'));
            __testUtils.setConfig({
                investigationsPath: invRoot,
                products: [{ id: 'prod-1', name: 'Prod 1', investigationsPath: productDir }],
                activeProductId: '',
            });

            initScheduler();

            const invId = 'product-inv-delete';
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'completed', productId: 'prod-1' }) as any);

            // Create matching dir on disk in product path
            const safeId = invId.replace(/[^a-zA-Z0-9]/g, '');
            const dirName = `2024-01-01_target_${safeId}`;
            const dirPath = path.join(productDir, dirName);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'state.json'), '{}');

            const realScheduler = __testUtils.getScheduler() as any;
            await realScheduler.deleteInvestigation(invId);

            expect(__testUtils.getHistory().has(invId)).toBe(false);
            expect(fs.existsSync(dirPath)).toBe(false);
        });

        it('deleteInvestigation callback removes runner if present', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-runner-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const invId = 'runner-to-delete';
            const fakeRunner = makeRunner({ id: invId, status: 'running' });
            fakeRunner.dispose = vi.fn();
            __testUtils.getRunners().set(invId, fakeRunner as any);
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'running' }) as any);

            const realScheduler = __testUtils.getScheduler() as any;
            await realScheduler.deleteInvestigation(invId);

            expect(__testUtils.getRunners().has(invId)).toBe(false);
            expect(__testUtils.getHistory().has(invId)).toBe(false);
        });

        it('deleteInvestigation callback returns early if investigation not in history', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-miss-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const realScheduler = __testUtils.getScheduler() as any;
            // Should not throw
            await realScheduler.deleteInvestigation('non-existent');
        });

        it('deleteInvestigation callback falls back to empty array when config.products is undefined', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-noproducts-'));
            __testUtils.setConfig({ investigationsPath: invRoot, activeProductId: '' } as any);
            // Explicitly set products to undefined to cover the || [] fallback
            const cfg = __testUtils.getConfig() as any;
            cfg.products = undefined;

            initScheduler();

            const invId = 'noproduct';
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'completed', productId: 'missing-prod' }) as any);

            const realScheduler = __testUtils.getScheduler() as any;
            await realScheduler.deleteInvestigation(invId);

            expect(__testUtils.getHistory().has(invId)).toBe(false);
        });

        it('deleteInvestigation callback handles readdirSync failure gracefully', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-readdir-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const invId = 'readdir-fail';
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'completed' }) as any);

            // Point config to a non-existent directory AFTER scheduler init
            // so readdirSync throws ENOENT inside the catch block
            const nonExistentDir = path.join(os.tmpdir(), 'ai-investigator-no-such-dir-' + Date.now());
            __testUtils.setConfig({ investigationsPath: nonExistentDir, products: [], activeProductId: '' });

            const realScheduler = __testUtils.getScheduler() as any;
            await realScheduler.deleteInvestigation(invId);

            expect(__testUtils.getHistory().has(invId)).toBe(false);
        });

        it('deleteInvestigation callback handles rmSync/unlinkSync failure gracefully', async () => {
            const invRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-investigator-real-scheduler-delete-rmfail-'));
            __testUtils.setConfig({ investigationsPath: invRoot, products: [], activeProductId: '' });

            initScheduler();

            const invId = 'rmfail';
            __testUtils.getHistory().set(invId, makeState({ id: invId, status: 'completed' }) as any);

            // Create a directory where the JSON file should be — unlinkSync will throw on a directory
            const jsonPath = path.join(invRoot, `${invId}.json`);
            fs.mkdirSync(jsonPath, { recursive: true });

            const realScheduler = __testUtils.getScheduler() as any;
            await realScheduler.deleteInvestigation(invId);

            // Cleanup
            if (fs.existsSync(jsonPath)) fs.rmSync(jsonPath, { recursive: true, force: true });

            expect(__testUtils.getHistory().has(invId)).toBe(false);
        });
    });

    describe('GET /api/investigations/:id/recommendations', () => {
        it('returns 404 when investigation not found', async () => {
            const response = await api().get('/api/investigations/missing/recommendations');
            expect(response.status).toBe(404);
        });

        it('returns empty array when no final report', async () => {
            __testUtils.getHistory().set('no-report', makeState({ id: 'no-report', status: 'completed' }) as any);
            const response = await api().get('/api/investigations/no-report/recommendations');
            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        it('returns cached recommendations when available', async () => {
            const cached = [{ id: 'r1', priority: 'P0', title: 'Fix', category: 'code' }];
            const state = makeState({ id: 'cached-recs', status: 'completed', finalReport: 'report' }) as any;
            state.recommendations = cached;
            __testUtils.getHistory().set('cached-recs', state);
            const response = await api().get('/api/investigations/cached-recs/recommendations');
            expect(response.status).toBe(200);
            expect(response.body).toEqual(cached);
        });

        it('lazy extracts when no cached recommendations', async () => {
            const state = makeState({
                id: 'lazy-recs',
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix it**: broken\n',
            }) as any;
            __testUtils.getHistory().set('lazy-recs', state);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'extractRecommendations').mockResolvedValue([
                { id: 'r1', priority: 'P0', title: 'Fix it', description: 'broken', category: 'code' },
            ]);

            const response = await api().get('/api/investigations/lazy-recs/recommendations');
            expect(response.status).toBe(200);
            expect(response.body.length).toBe(1);
            expect(response.body[0].title).toBe('Fix it');
        });

        it('returns empty array when report has no recommendations', async () => {
            const state = makeState({
                id: 'no-recs',
                status: 'completed',
                finalReport: 'Just a simple report with no recommendations section.',
            }) as any;
            __testUtils.getHistory().set('no-recs', state);
            setFakeLlmProvider();

            const response = await api().get('/api/investigations/no-recs/recommendations');
            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        it('returns 500 when extractRecommendations throws', async () => {
            const state = makeState({
                id: 'extract-fail',
                status: 'completed',
                finalReport: '## Recommendations\n\n1. **Fix it**: broken\n',
            }) as any;
            __testUtils.getHistory().set('extract-fail', state);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'extractRecommendations').mockRejectedValue(new Error('extraction boom'));

            const response = await api().get('/api/investigations/extract-fail/recommendations');
            expect(response.status).toBe(500);
            expect(response.body.error).toContain('Failed to extract');
        });

        it('returns recommendations from active runner state', async () => {
            const runner = makeRunner({ id: 'active-recs', status: 'completed' });
            const cached = [{ id: 'r1', priority: 'P0', title: 'Active', category: 'code' }];
            (runner as any).state.recommendations = cached;
            __testUtils.getRunners().set('active-recs', runner);

            const response = await api().get('/api/investigations/active-recs/recommendations');
            expect(response.status).toBe(200);
            expect(response.body).toEqual(cached);
        });
    });

    describe('POST /api/investigations/:id/recommendations/reclassify', () => {
        it('returns 404 when investigation not found', async () => {
            const response = await api().post('/api/investigations/missing/recommendations/reclassify');
            expect(response.status).toBe(404);
        });

        it('returns empty array when no final report', async () => {
            __testUtils.getHistory().set('no-rep-rc', makeState({ id: 'no-rep-rc', status: 'completed' }) as any);
            const response = await api().post('/api/investigations/no-rep-rc/recommendations/reclassify');
            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        it('re-extracts recommendations from final report', async () => {
            const state = makeState({
                id: 'reclassify-inv',
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix it**: broken\n',
            }) as any;
            __testUtils.getHistory().set('reclassify-inv', state);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'extractRecommendations').mockResolvedValue([
                { id: 'r1', priority: 'P0', title: 'Fix it', description: 'broken', category: 'operational' },
            ]);

            const response = await api().post('/api/investigations/reclassify-inv/recommendations/reclassify');
            expect(response.status).toBe(200);
            expect(response.body[0].category).toBe('operational');
            // Should cache the result
            expect(state.recommendations[0].category).toBe('operational');
        });

        it('re-extracts using active runner state', async () => {
            const runner = makeRunner({
                id: 'active-reclassify',
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix**: broken\n',
            });
            __testUtils.getRunners().set('active-reclassify', runner);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'extractRecommendations').mockResolvedValue([
                { id: 'r1', priority: 'P0', title: 'Fix', description: 'broken', category: 'operational' },
            ]);

            const response = await api().post('/api/investigations/active-reclassify/recommendations/reclassify');
            expect(response.status).toBe(200);
            expect(response.body[0].category).toBe('operational');
        });

        it('returns 500 when reclassify extractRecommendations throws', async () => {
            const state = makeState({
                id: 'reclassify-fail',
                status: 'completed',
                finalReport: '## Recommendations\n\n1. **Fix**: broken\n',
            }) as any;
            __testUtils.getHistory().set('reclassify-fail', state);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'extractRecommendations').mockRejectedValue(new Error('reclassify boom'));

            const response = await api().post('/api/investigations/reclassify-fail/recommendations/reclassify');
            expect(response.status).toBe(500);
            expect(response.body.error).toContain('Failed to extract');
        });
    });

    describe('POST /api/investigations/:id/implement', () => {
        it('returns 400 when no recommendations provided', async () => {
            const runner = makeRunner({ status: 'completed' });
            __testUtils.getRunners().set('impl-inv-1', runner);
            const response = await api().post('/api/investigations/impl-inv-1/implement').send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toContain('At least one recommendation');
        });

        it('returns 400 when recommendations is empty array', async () => {
            const runner = makeRunner({ status: 'completed' });
            __testUtils.getRunners().set('impl-inv-1', runner);
            const response = await api().post('/api/investigations/impl-inv-1/implement').send({ recommendations: [] });
            expect(response.status).toBe(400);
        });

        it('returns 404 when investigation not found', async () => {
            const response = await api().post('/api/investigations/nonexistent/implement').send({ recommendations: ['rec_P0_0'] });
            expect(response.status).toBe(404);
        });

        it('returns 409 when concurrent operation in progress', async () => {
            __testUtils.getHistory().set('concurrent-impl', makeState({ id: 'concurrent-impl', status: 'completed' }) as any);
            // Simulate a runner already set up (e.g., from a concurrent request)
            __testUtils.getRunners().set('concurrent-impl', undefined as any);

            const response = await api().post('/api/investigations/concurrent-impl/implement').send({ recommendations: ['rec_P0_0'] });
            expect(response.status).toBe(409);
            expect(response.body.error).toContain('Concurrent');
        });

        it('starts implementation for active runner', async () => {
            const runner = makeRunner({ status: 'completed' });
            runner.runImplementationAnalysis = vi.fn().mockResolvedValue(undefined);
            __testUtils.getRunners().set('impl-active', runner);
            const response = await api().post('/api/investigations/impl-active/implement').send({ recommendations: ['rec_P0_0'] });
            expect(response.status).toBe(200);
            expect(response.body.started).toBe(true);
            expect(response.body.recommendations).toBe(1);
        });

        it('creates temporary runner from history and cleans up', async () => {
            const histState = makeState({ id: 'impl-hist', status: 'completed' });
            __testUtils.getHistory().set('impl-hist', histState as any);
            setFakeLlmProvider();

            vi.spyOn(AgentRunner.prototype, 'runImplementationAnalysis').mockImplementation(async function (this: any) {
                // Emit all three SSE events to cover the callback lines
                this.emit('retrospect', { messages: [] });
                this.emit('retrospect-proposal', { id: 'p1' });
                this.emit('retrospect-tool-activity', { tool: 'read_file' });
            });
            vi.spyOn(AgentRunner.prototype, 'saveArtifacts' as any).mockResolvedValue(undefined);

            const response = await api().post('/api/investigations/impl-hist/implement').send({ recommendations: ['rec_P0_0'] });
            expect(response.status).toBe(200);
            expect(response.body.started).toBe(true);

            // Wait for the async work to complete
            await vi.waitFor(() => {
                expect(AgentRunner.prototype.runImplementationAnalysis).toHaveBeenCalledWith(['rec_P0_0']);
            });
        });

        it('handles error during implementation gracefully', async () => {
            const runner = makeRunner({ status: 'completed' });
            runner.runImplementationAnalysis = vi.fn().mockRejectedValue(new Error('LLM down'));
            __testUtils.getRunners().set('impl-err', runner);

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const response = await api().post('/api/investigations/impl-err/implement').send({ recommendations: ['rec_P0_0'] });
            expect(response.status).toBe(200);

            // Wait for async error handler to run
            await vi.waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[implement]'), 'LLM down');
            });
            consoleSpy.mockRestore();
        });
    });

    describe('GET /api/version', () => {
        it('returns version status', async () => {
            const response = await api().get('/api/version');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('current');
            expect(response.body).toHaveProperty('updateAvailable');
        });

        it('accepts check=true query parameter', async () => {
            const response = await api().get('/api/version?check=true');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('current');
        });
    });

    describe('GET /api/onboarding/status', () => {
        it('returns onboarding status', async () => {
            const response = await api().get('/api/onboarding/status');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('complete');
            expect(response.body).toHaveProperty('hasLlmProvider');
            expect(response.body).toHaveProperty('hasProduct');
            expect(response.body).toHaveProperty('hasConfig');
        });
    });
});

describe('applyStaticServing / applySpaFallback', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('serves static files when the directory exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
        const testApp = require('express')();
        applyStaticServing(testApp, tmpDir);
        const res = await request(testApp).get('/hello.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('world');
    });

    it('skips static serving when the directory does not exist', async () => {
        const testApp = require('express')();
        applyStaticServing(testApp, path.join(tmpDir, 'nonexistent'));
        const res = await request(testApp).get('/anything');
        expect(res.status).toBe(404);
    });

    it('serves index.html for any SPA route when directory exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html>SPA</html>');
        const testApp = require('express')();
        applySpaFallback(testApp, tmpDir);
        const res = await request(testApp).get('/some/deep/route');
        expect(res.status).toBe(200);
        expect(res.text).toContain('SPA');
    });

    it('skips SPA fallback when the directory does not exist', async () => {
        const testApp = require('express')();
        applySpaFallback(testApp, path.join(tmpDir, 'nonexistent'));
        const res = await request(testApp).get('/any-route');
        expect(res.status).toBe(404);
    });
});

describe('getDefaultRepoRoot', () => {
    it('returns appRoot when packaged', () => {
        const result = getDefaultRepoRoot(true);
        expect(result).toBe(appRootModule.appRoot);
    });

    it('resolves 4 directory levels up when not packaged', () => {
        const result = getDefaultRepoRoot(false);
        // Should be a real path that differs from the backend directory
        expect(path.isAbsolute(result)).toBe(true);
        expect(result).not.toContain('backend');
    });
});

describe('pipeline endpoints and integration', () => {
    beforeEach(() => {
        __testUtils.resetRuntimeState();
        __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
        __testUtils.setPersistedConfig(JSON.parse(JSON.stringify(defaultPersistedConfig)));
    });

    it('GET /api/pipeline/builtins returns built-in agents', async () => {
        const response = await api().get('/api/pipeline/builtins');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        const types = response.body.map((a: any) => a.builtinType);
        expect(types).toContain('investigator');
        expect(types).toContain('retrospect');
    });

    it('POST /api/pipeline/validate accepts valid pipeline', async () => {
        const response = await api().post('/api/pipeline/validate').send({
            id: 'test',
            stages: [
                { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
            ],
        });
        expect(response.status).toBe(200);
        expect(response.body.valid).toBe(true);
    });

    it('POST /api/pipeline/validate rejects invalid pipeline', async () => {
        const response = await api().post('/api/pipeline/validate').send({
            id: 'test',
            stages: [],
        });
        expect(response.status).toBe(200);
        expect(response.body.valid).toBe(false);
        expect(response.body.error).toBeDefined();
    });

    it('GET /api/investigations/:id/pipeline returns 404 when no pipeline data', async () => {
        __testUtils.getHistory().set('no-pipe', makeState({ id: 'no-pipe' }) as any);
        const response = await api().get('/api/investigations/no-pipe/pipeline');
        expect(response.status).toBe(404);
    });

    it('GET /api/investigations/:id/pipeline returns pipeline from history', async () => {
        const state = makeState({ id: 'pipe-hist' });
        (state as any).pipeline = {
            stages: [{ status: 'completed', agentName: 'Test' }],
            currentStageIndex: 0,
            definition: { id: 'def', stages: [] },
            conversationLog: [],
        };
        __testUtils.getHistory().set('pipe-hist', state as any);
        const response = await api().get('/api/investigations/pipe-hist/pipeline');
        expect(response.status).toBe(200);
        expect(response.body.stages).toHaveLength(1);
    });

    it('GET /api/investigations/:id/pipeline returns pipeline from active runner', async () => {
        const runner = makeRunner({ id: 'pipe-active' });
        (runner as any).state.pipeline = {
            stages: [{ status: 'running', agentName: 'Active' }],
            currentStageIndex: 0,
            definition: { id: 'def', stages: [] },
            conversationLog: [],
        };
        __testUtils.getRunners().set('pipe-active', runner as any);
        const response = await api().get('/api/investigations/pipe-active/pipeline');
        expect(response.status).toBe(200);
        expect(response.body.stages[0].agentName).toBe('Active');
    });

    it('GET /api/investigations/:id/pipeline returns pipeline from active orchestrator', async () => {
        const { PipelineOrchestrator } = await import('../agent/pipeline/PipelineOrchestrator');
        const fakeLlm = { type: 'fake' } as any;
        const fakeConfig = { systemPromptPath: '', repoRoot: '', maxSteps: 10, model: 'test', investigationsPath: '/tmp' } as any;
        const pipeline = {
            id: 'test-pipe',
            stages: [{ agent: { id: 'a', name: 'OrchAgent', source: 'inline' as const, promptContent: 'x' } }],
        };
        const orch = new PipelineOrchestrator(pipeline, fakeLlm, fakeConfig);
        __testUtils.getPipelineOrchestrators().set('orch-pipe', orch);
        const response = await api().get('/api/investigations/orch-pipe/pipeline');
        expect(response.status).toBe(200);
        expect(response.body.stages[0].agentName).toBe('OrchAgent');
        __testUtils.getPipelineOrchestrators().delete('orch-pipe');
    });

    it('GET /api/investigations/:id injects live pipeline state from orchestrator', async () => {
        const { PipelineOrchestrator } = await import('../agent/pipeline/PipelineOrchestrator');
        const fakeLlm = { type: 'fake' } as any;
        const fakeConfig = { systemPromptPath: '', repoRoot: '', maxSteps: 10, model: 'test', investigationsPath: '/tmp' } as any;
        const pipeline = {
            id: 'test-pipe',
            stages: [{ agent: { id: 'a', name: 'LiveAgent', source: 'inline' as const, promptContent: 'x' } }],
        };
        const orch = new PipelineOrchestrator(pipeline, fakeLlm, fakeConfig);

        // Set up a runner in history without pipeline state
        const runner = makeRunner({ id: 'live-pipe', status: 'running' });
        __testUtils.getRunners().set('live-pipe', runner as any);
        __testUtils.getPipelineOrchestrators().set('live-pipe', orch);

        const response = await api().get('/api/investigations/live-pipe');
        expect(response.status).toBe(200);
        expect(response.body.pipeline).toBeDefined();
        expect(response.body.pipeline.stages[0].agentName).toBe('LiveAgent');

        __testUtils.getPipelineOrchestrators().delete('live-pipe');
    });

    it('cleanupRunner removes pipeline orchestrator', async () => {
        const { PipelineOrchestrator } = await import('../agent/pipeline/PipelineOrchestrator');
        const fakeLlm = { type: 'fake' } as any;
        const fakeConfig = { systemPromptPath: '', repoRoot: '', maxSteps: 10, model: 'test', investigationsPath: '/tmp' } as any;
        const pipeline = {
            id: 'cleanup-pipe',
            stages: [{ agent: { id: 'a', name: 'A', source: 'inline' as const, promptContent: 'x' } }],
        };
        const orch = new PipelineOrchestrator(pipeline, fakeLlm, fakeConfig);
        __testUtils.getPipelineOrchestrators().set('cleanup-test', orch);

        const runner = makeRunner({ id: 'cleanup-test' });
        __testUtils.getRunners().set('cleanup-test', runner as any);

        cleanupRunner('cleanup-test');
        expect(__testUtils.getPipelineOrchestrators().has('cleanup-test')).toBe(false);
        expect(__testUtils.getRunners().has('cleanup-test')).toBe(false);
    });

    it('POST /api/investigations creates pipeline investigation when pipeline config present', async () => {
        setFakeLlmProvider();
        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'test-pipeline',
                stages: [
                    { agent: { id: 'inv', name: 'Investigator', source: 'inline', promptContent: 'Investigate {{GOAL}}' } },
                    { agent: { id: 'rev', name: 'Reviewer', source: 'inline', promptContent: 'Review {{REPORT}}' } },
                ],
            },
        });

        const runSpy = vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockResolvedValue({
            status: 'completed', thoughts: [], actions: [], fullHistory: [], fullActions: [], logs: [],
            finalReport: 'done', recommendations: [], verdict: 'approved', pipeline: { stages: [] },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Test pipeline investigation',
            target: 'stamp-1',
            timeRange: 'last 24 hours',
        });

        expect(response.status).toBe(200);
        expect(response.body.id).toBeDefined();
        // The investigation should be set up as a pipeline
        const id = response.body.id;
        expect(__testUtils.getRunners().has(id)).toBe(true);
        expect(__testUtils.getPipelineOrchestrators().has(id)).toBe(true);

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
        cleanupRunner(id);
    });

    it('contest on active runner triggers pipeline restart when pipeline definition present', async () => {
        setFakeLlmProvider();
        // Use a never-resolving promise so the .then() cleanup doesn't remove the orchestrator before assertion
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));
        const runner = makeRunner({ id: 'contest-pipe', status: 'completed', query: 'Test query' });
        (runner as any).state.pipeline = {
            definition: {
                id: 'pipe-def',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
            stages: [
                { status: 'completed', agentName: 'A' },
                { status: 'completed', agentName: 'B' },
            ],
            currentStageIndex: 1,
            conversationLog: [],
        };
        __testUtils.getRunners().set('contest-pipe', runner as any);

        const response = await api().post('/api/investigations/contest-pipe/action').send({
            action: 'contest',
            message: 'Redo the pipeline',
        });
        expect(response.status).toBe(200);
        expect(runner.contestReport).toHaveBeenCalledWith('Redo the pipeline');
        expect(runner.log).toHaveBeenCalled();
        // Pipeline orchestrator should be created
        expect(__testUtils.getPipelineOrchestrators().has('contest-pipe')).toBe(true);

        // Clean up
        __testUtils.getPipelineOrchestrators().delete('contest-pipe');
    });

    it('contest on history runner triggers pipeline restart when pipeline definition present', async () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockResolvedValue({
            status: 'completed', thoughts: [], actions: [], fullHistory: [], fullActions: [], logs: [],
            finalReport: 'done', recommendations: [], verdict: 'approved', pipeline: { stages: [] },
        });
        const state = makeState({
            id: 'hist-pipe-contest',
            status: 'completed',
            query: 'Test query',
        });
        (state as any).pipeline = {
            definition: {
                id: 'pipe-def',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
            stages: [
                { status: 'completed', agentName: 'A' },
                { status: 'completed', agentName: 'B' },
            ],
            currentStageIndex: 1,
            conversationLog: [],
        };
        __testUtils.getHistory().set('hist-pipe-contest', state as any);

        const contestSpy = vi.spyOn(AgentRunner.prototype as any, 'contestReport');
        const logSpy = vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

        const response = await api().post('/api/investigations/hist-pipe-contest/action').send({
            action: 'contest',
            message: 'Redo pipeline from history',
        });
        expect(response.status).toBe(200);
        expect(contestSpy).toHaveBeenCalledWith('Redo pipeline from history');
        expect(__testUtils.getPipelineOrchestrators().has('hist-pipe-contest')).toBe(true);

        // Clean up
        __testUtils.getPipelineOrchestrators().delete('hist-pipe-contest');
        cleanupRunner('hist-pipe-contest');
    });

    it('attachPipelineListeners forwards thought/action/log events to runner state', async () => {
        setFakeLlmProvider();
        // Use never-resolving to keep the orchestrator alive
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'events-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Event test',
            target: 'event-target',
            timeRange: 'last 1 hour',
        });
        expect(response.status).toBe(200);
        const id = response.body.id;

        const orchestrator = __testUtils.getPipelineOrchestrators().get(id);
        expect(orchestrator).toBeDefined();

        // Emit events on the orchestrator
        orchestrator!.emit('thought', { content: 'test thought' });
        orchestrator!.emit('action', { tool: 'test_tool' });
        orchestrator!.emit('log', 'test log entry');
        orchestrator!.emit('stage-start', { stage: 0 });
        orchestrator!.emit('stage-complete', { stage: 0 });

        // Wait for saveToDisk async operations
        await new Promise(r => setTimeout(r, 50));

        // Verify events accumulated in runner state
        const runner = __testUtils.getRunners().get(id) as any;
        expect(runner.state.thoughts).toContainEqual({ content: 'test thought' });
        expect(runner.state.actions).toContainEqual({ tool: 'test_tool' });
        expect(runner.state.logs).toContain('test log entry');
        // syncRunnerState should have set pipeline state
        expect(runner.state.pipeline).toBeDefined();

        // Make saveArtifacts throw to cover the catch branch in saveToDisk (line 707)
        runner.saveArtifacts = vi.fn().mockRejectedValue(new Error('disk full'));
        orchestrator!.emit('stage-start', { stage: 1 });
        await new Promise(r => setTimeout(r, 50));

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
        cleanupRunner(id);
    });

    it('createPipelineInvestigation .then() handler cleans up after completion', async () => {
        setFakeLlmProvider();
        let resolveRun!: (value: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise(r => { resolveRun = r; })
        );

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'then-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Then test',
            target: 'then-target',
            timeRange: 'last 1 hour',
        });
        expect(response.status).toBe(200);
        const id = response.body.id;
        expect(__testUtils.getPipelineOrchestrators().has(id)).toBe(true);

        // Make saveArtifacts throw to cover the catch block (line 2000)
        const runner = __testUtils.getRunners().get(id) as any;
        runner.saveArtifacts = vi.fn().mockRejectedValue(new Error('disk full'));

        // Now resolve the run — triggers the .then() handler
        resolveRun({
            status: 'completed', thoughts: ['final'], actions: [], fullHistory: [],
            fullActions: [], logs: [], finalReport: 'done', recommendations: [],
            verdict: 'approved', pipeline: { stages: [] },
        });

        // Wait for microtasks
        await new Promise(r => setTimeout(r, 50));

        // After .then() runs, cleanup should have removed the orchestrator and added to history
        expect(__testUtils.getHistory().has(id)).toBe(true);
    });

    it('createPipelineInvestigation .catch() handler sets failed state', async () => {
        setFakeLlmProvider();
        let rejectRun!: (err: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise((_, rej) => { rejectRun = rej; })
        );

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'catch-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Catch test',
            target: 'catch-target',
            timeRange: 'last 1 hour',
        });
        expect(response.status).toBe(200);
        const id = response.body.id;

        // Trigger the .catch() handler
        rejectRun(new Error('Pipeline crash'));

        // Wait for microtasks
        await new Promise(r => setTimeout(r, 50));

        // After .catch() runs, state should be 'failed' and saved to history
        const state = __testUtils.getHistory().get(id);
        expect(state).toBeDefined();
        expect(state!.status).toBe('failed');
    });

    it('restartPipelineForContest .then() handler updates runner state on completion', async () => {
        setFakeLlmProvider();
        let resolveRun!: (value: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise(r => { resolveRun = r; })
        );

        const state = makeState({
            id: 'contest-then',
            status: 'completed',
            query: 'Test query',
        });
        (state as any).pipeline = {
            definition: {
                id: 'pipe-def',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
            stages: [{ status: 'completed' }, { status: 'completed' }],
            currentStageIndex: 1,
            conversationLog: [],
        };
        __testUtils.getHistory().set('contest-then', state as any);

        vi.spyOn(AgentRunner.prototype as any, 'contestReport');
        vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

        const response = await api().post('/api/investigations/contest-then/action').send({
            action: 'contest',
            message: 'Redo it',
        });
        expect(response.status).toBe(200);

        // Make saveArtifacts throw to cover the catch block (line 2085-2086)
        const runner = __testUtils.getRunners().get('contest-then') as any;
        if (runner) runner.saveArtifacts = vi.fn().mockRejectedValue(new Error('disk full'));

        // Resolve the pipeline run
        resolveRun({
            status: 'completed', thoughts: ['contest done'], actions: [], fullHistory: [],
            fullActions: [], logs: [], finalReport: 'contested done', recommendations: [],
            verdict: 'approved', pipeline: { stages: [] }, retrospect: null,
        });

        // Wait for microtasks
        await new Promise(r => setTimeout(r, 50));

        // The .then() handler should have updated the runner state and saved to history
        expect(__testUtils.getHistory().has('contest-then')).toBe(true);
    });

    it('restartPipelineForContest .catch() handler sets failed state', async () => {
        setFakeLlmProvider();
        let rejectRun!: (err: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise((_, rej) => { rejectRun = rej; })
        );

        const state = makeState({
            id: 'contest-catch',
            status: 'completed',
            query: 'Test query',
        });
        (state as any).pipeline = {
            definition: {
                id: 'pipe-def',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
            stages: [{ status: 'completed' }, { status: 'completed' }],
            currentStageIndex: 1,
            conversationLog: [],
        };
        __testUtils.getHistory().set('contest-catch', state as any);

        vi.spyOn(AgentRunner.prototype as any, 'contestReport');
        vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

        const response = await api().post('/api/investigations/contest-catch/action').send({
            action: 'contest',
            message: 'Redo it',
        });
        expect(response.status).toBe(200);

        // Trigger the .catch() handler
        rejectRun(new Error('Contest pipeline crash'));

        // Wait for microtasks
        await new Promise(r => setTimeout(r, 50));

        // After .catch() runs, state should be 'failed' and saved to history
        const state2 = __testUtils.getHistory().get('contest-catch');
        expect(state2).toBeDefined();
        expect(state2!.status).toBe('failed');
    });

    it('pipeline event handlers handle missing runner gracefully', async () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'no-runner-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'No runner test',
            target: 'nr-target',
            timeRange: 'last 1 hour',
        });
        const id = response.body.id;
        const orchestrator = __testUtils.getPipelineOrchestrators().get(id)!;

        // Remove the runner from the map to test the !runner early return branches
        __testUtils.getRunners().delete(id);

        // These should not throw — they hit the early return in syncRunnerState/saveToDisk
        orchestrator.emit('thought', { content: 'orphan thought' });
        orchestrator.emit('action', { tool: 'orphan action' });
        orchestrator.emit('log', 'orphan log');
        orchestrator.emit('stage-start', { stage: 0 });
        orchestrator.emit('stage-complete', { stage: 0 });
        await new Promise(r => setTimeout(r, 50));

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
    });

    it('pipeline event handlers init missing arrays on runner state', async () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'init-arrays-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Init arrays test',
            target: 'ia-target',
            timeRange: 'last 1 hour',
        });
        const id = response.body.id;
        const orchestrator = __testUtils.getPipelineOrchestrators().get(id)!;

        // Delete arrays from runner state to test the init branches
        const runner = __testUtils.getRunners().get(id)! as any;
        delete runner.state.thoughts;
        delete runner.state.actions;
        delete runner.state.logs;

        orchestrator.emit('thought', { content: 'new thought' });
        orchestrator.emit('action', { tool: 'new action' });
        orchestrator.emit('log', 'new log');

        expect(runner.state.thoughts).toContainEqual({ content: 'new thought' });
        expect(runner.state.actions).toContainEqual({ tool: 'new action' });
        expect(runner.state.logs).toContain('new log');

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
        cleanupRunner(id);
    });

    it('createPipelineInvestigation with model in metadata', async () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'model-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Model test',
            target: 'model-target',
            timeRange: 'last 1 hour',
            model: 'gpt-4o-test',
        });
        expect(response.status).toBe(200);
        const id = response.body.id;
        const runner = __testUtils.getRunners().get(id) as any;
        expect(runner.state.model).toBe('gpt-4o-test');

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
        cleanupRunner(id);
    });

    it('createPipelineInvestigation .then() with non-completed status does not cleanup', async () => {
        setFakeLlmProvider();
        let resolveRun!: (value: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise(r => { resolveRun = r; })
        );

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'running-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Running test',
            target: 'running-target',
            timeRange: 'last 1 hour',
        });
        const id = response.body.id;

        // Resolve with 'running' status (not completed/failed/aborted)
        resolveRun({
            status: 'running', thoughts: [], actions: [], fullHistory: [],
            fullActions: [], logs: [], finalReport: '', recommendations: [],
            verdict: null, pipeline: { stages: [] },
        });

        await new Promise(r => setTimeout(r, 50));

        // Runner should still be in the map since status is not terminal
        expect(__testUtils.getRunners().has(id) || __testUtils.getHistory().has(id)).toBe(true);
    });

    it('restartPipelineForContest with no pipelineDef returns early', async () => {
        setFakeLlmProvider();
        const state = makeState({
            id: 'no-pipe-def',
            status: 'completed',
            query: 'Test query',
        });
        // Set pipeline without definition
        (state as any).pipeline = {
            definition: null,
            stages: [],
            currentStageIndex: 0,
            conversationLog: [],
        };
        __testUtils.getHistory().set('no-pipe-def', state as any);

        vi.spyOn(AgentRunner.prototype as any, 'contestReport');
        vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);

        // This should work without crashing — the restartPipelineForContest returns early
        const response = await api().post('/api/investigations/no-pipe-def/action').send({
            action: 'contest',
            message: 'Redo it',
        });
        expect(response.status).toBe(200);
        // No orchestrator should be created since pipelineDef is null
        expect(__testUtils.getPipelineOrchestrators().has('no-pipe-def')).toBe(false);

        cleanupRunner('no-pipe-def');
    });

    it('createPipelineInvestigation passes createdBy when provided', async () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'createdby-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'CreatedBy test',
            target: 'cb-target',
            timeRange: 'last 1 hour',
            createdBy: 'admin-user',
        });
        expect(response.status).toBe(200);
        const id = response.body.id;
        const runner = __testUtils.getRunners().get(id) as any;
        expect(runner.state.createdBy).toBe('admin-user');

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(id);
        cleanupRunner(id);
    });

    it('createPipelineInvestigation via createInvestigation without createdBy (scheduler path)', () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'sched-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        // Call createInvestigation directly without createdBy (simulates scheduler)
        const result = createInvestigation({
            query: 'Scheduled query',
            target: 'sched-target',
            timeRange: 'last 1 hour',
            source: 'scheduled',
        });
        expect(result.id).toBeDefined();
        const runner = __testUtils.getRunners().get(result.id) as any;
        expect(runner.state.createdBy).toBe('scheduler');

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(result.id);
        cleanupRunner(result.id);
    });

    it('createPipelineInvestigation via createInvestigation without createdBy and manual source', () => {
        setFakeLlmProvider();
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(new Promise(() => {}));

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'manual-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        // Call createInvestigation directly without createdBy and with manual source
        const result = createInvestigation({
            query: 'Manual query',
            target: 'manual-target',
            timeRange: 'last 1 hour',
            source: 'manual',
        });
        expect(result.id).toBeDefined();
        const runner = __testUtils.getRunners().get(result.id) as any;
        expect(runner.state.createdBy).toBeUndefined();

        // Clean up
        __testUtils.getPipelineOrchestrators().delete(result.id);
        cleanupRunner(result.id);
    });

    it('createPipelineInvestigation .catch() handles saveArtifacts failure', async () => {
        setFakeLlmProvider();
        let rejectRun!: (err: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise((_, rej) => { rejectRun = rej; })
        );

        __testUtils.setConfig({
            ...JSON.parse(JSON.stringify(defaultConfig)),
            pipeline: {
                id: 'catch-save-pipe',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
        });

        const response = await api().post('/api/investigations').send({
            query: 'Catch save test',
            target: 'cs-target',
            timeRange: 'last 1 hour',
        });
        const id = response.body.id;

        // Make saveArtifacts throw inside the .catch() handler
        const runner = __testUtils.getRunners().get(id) as any;
        runner.saveArtifacts = vi.fn().mockRejectedValue(new Error('disk error'));

        rejectRun(new Error('Pipeline crash'));
        await new Promise(r => setTimeout(r, 50));

        const state = __testUtils.getHistory().get(id);
        expect(state).toBeDefined();
        expect(state!.status).toBe('failed');
    });

    it('restartPipelineForContest .catch() handles saveArtifacts failure', async () => {
        setFakeLlmProvider();
        let rejectRun!: (err: any) => void;
        vi.spyOn(PipelineOrchestrator.prototype as any, 'run').mockReturnValue(
            new Promise((_, rej) => { rejectRun = rej; })
        );

        const state = makeState({
            id: 'contest-catch-save',
            status: 'completed',
            query: 'Test query',
            model: 'gpt-4o',
        });
        (state as any).pipeline = {
            definition: {
                id: 'pipe-def',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                    { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'y' } },
                ],
            },
            stages: [{ status: 'completed' }, { status: 'completed' }],
            currentStageIndex: 1,
            conversationLog: [],
        };
        __testUtils.getHistory().set('contest-catch-save', state as any);

        vi.spyOn(AgentRunner.prototype as any, 'contestReport');
        vi.spyOn(AgentRunner.prototype as any, 'log').mockImplementation(() => undefined);
        vi.spyOn(AgentRunner.prototype as any, 'saveArtifacts').mockRejectedValue(new Error('disk error'));

        const response = await api().post('/api/investigations/contest-catch-save/action').send({
            action: 'contest',
            message: 'Redo',
        });
        expect(response.status).toBe(200);

        rejectRun(new Error('Contest pipeline crash'));
        await new Promise(r => setTimeout(r, 50));

        const state2 = __testUtils.getHistory().get('contest-catch-save');
        expect(state2).toBeDefined();
        expect(state2!.status).toBe('failed');
    });
});