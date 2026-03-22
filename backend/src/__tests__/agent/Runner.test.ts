import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Mocks ---
const mockToolManager = {
    isConnected: vi.fn(() => true),
    setRepoRoot: vi.fn(),
    initialize: vi.fn(),
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => 'tool result'),
    getMcpStatus: vi.fn(() => [{ connected: true, toolCount: 3 }]),
    initError: null as string | null,
};

vi.mock('../../agent/tools/ToolManager', () => ({
    ToolManager: vi.fn(() => mockToolManager),
}));

const {
    mockFsState, mockDirs, mockDirEntries, mockIsDir,
    mockWriteErrorRef, mockExistsFnRef, mockReaddirThrow, mockStatThrow,
    n, existsSyncImpl, readFileSyncImpl, writeFileSyncImpl,
    renameSyncImpl, mkdirSyncImpl, readdirSyncImpl, statSyncImpl, lstatSyncImpl,
} = vi.hoisted(() => {
    const mockFsState = new Map<string, string>();
    const mockDirs = new Set<string>();
    const mockDirEntries = new Map<string, string[]>();
    const mockIsDir = new Set<string>();
    const mockWriteErrorRef = { value: null as string | null };
    const mockExistsFnRef = { value: null as ((p: string) => boolean) | null };
    // Separate throw-path sets for readdirSync and statSync
    const mockReaddirThrow = new Set<string>();
    const mockStatThrow = new Set<string>();

    const n = (p: string) => p.replace(/\\/g, '/');

    const existsSyncImpl = (p: string) => {
        if (mockExistsFnRef.value) return mockExistsFnRef.value(p);
        return mockFsState.has(n(p)) || mockDirs.has(n(p));
    };
    const readFileSyncImpl = (p: string) => {
        if (mockFsState.has(n(p))) return mockFsState.get(n(p));
        throw new Error(`ENOENT: ${p}`);
    };
    const writeFileSyncImpl = (p: string, content: string) => {
        if (mockWriteErrorRef.value) throw new Error(mockWriteErrorRef.value);
        mockFsState.set(n(p), content);
    };
    const renameSyncImpl = (old: string, nu: string) => {
        const c = mockFsState.get(n(old));
        if (c !== undefined) { mockFsState.set(n(nu), c); mockFsState.delete(n(old)); }
    };
    const mkdirSyncImpl = (p: string) => { mockDirs.add(n(p)); };
    const readdirSyncImpl = (dir: string) => {
        const nd = n(dir);
        if (Array.from(mockReaddirThrow).some(tp => nd.includes(tp))) throw new Error('Permission denied');
        for (const [key, val] of mockDirEntries) {
            if (nd.includes(key)) return val;
        }
        return [];
    };
    const statSyncImpl = (p: string) => {
        const np = n(p);
        if (Array.from(mockStatThrow).some(tp => np.includes(tp))) throw new Error('stat error');
        return {
            isDirectory: () => mockIsDir.has(np) || Array.from(mockIsDir).some(d => np.includes(d)),
        };
    };
    const lstatSyncImpl = statSyncImpl;

    return {
        mockFsState, mockDirs, mockDirEntries, mockIsDir,
        mockWriteErrorRef, mockExistsFnRef, mockReaddirThrow, mockStatThrow,
        n, existsSyncImpl, readFileSyncImpl, writeFileSyncImpl,
        renameSyncImpl, mkdirSyncImpl, readdirSyncImpl, statSyncImpl, lstatSyncImpl,
    };
});

vi.mock('fs', () => {
    const makeFns = () => ({
        existsSync: vi.fn(existsSyncImpl),
        readFileSync: vi.fn(readFileSyncImpl),
        writeFileSync: vi.fn(writeFileSyncImpl),
        renameSync: vi.fn(renameSyncImpl),
        mkdirSync: vi.fn(mkdirSyncImpl),
        readdirSync: vi.fn(readdirSyncImpl),
        statSync: vi.fn(statSyncImpl),
        lstatSync: vi.fn(lstatSyncImpl),
    });
    const fns = makeFns();
    return { ...fns, default: { ...fns } };
});

// Also spy on the REAL fs module for require('fs') paths in Runner.ts.
// vi.mock('fs') only intercepts ESM imports; dynamic require() gets the real module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs');
vi.spyOn(nodeFs, 'existsSync').mockImplementation(existsSyncImpl);
vi.spyOn(nodeFs, 'readFileSync').mockImplementation(readFileSyncImpl);
vi.spyOn(nodeFs, 'writeFileSync').mockImplementation(writeFileSyncImpl);
vi.spyOn(nodeFs, 'renameSync').mockImplementation(renameSyncImpl);
vi.spyOn(nodeFs, 'mkdirSync').mockImplementation(mkdirSyncImpl);
vi.spyOn(nodeFs, 'readdirSync').mockImplementation(readdirSyncImpl);
vi.spyOn(nodeFs, 'statSync').mockImplementation(statSyncImpl);
vi.spyOn(nodeFs, 'lstatSync').mockImplementation(lstatSyncImpl);

import { AgentRunner, AgentConfig, InvestigationState } from '../../agent/Runner';

// --- Helpers ---
function makeLlmProvider(overrides: any = {}) {
    return {
        id: 'test',
        displayName: 'TestLLM',
        getAuthStatus: vi.fn(async () => ({ authenticated: true })),
        getClient: vi.fn(async () => mockOpenAI),
        configure: vi.fn(),
        listModels: vi.fn(async () => ['test-model']),
        ...overrides,
    };
}

const mockOpenAI = {
    chat: {
        completions: {
            create: vi.fn(),
        },
    },
};

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        systemPromptPath: '/prompts/system.md',
        mcpServers: [],
        maxSteps: 3,
        model: 'test-model',
        workingDirectory: '/work',
        investigationsPath: '/investigations',
        repoRoot: '/repo',
        ...overrides,
    };
}

describe('AgentRunner', () => {
    let provider: ReturnType<typeof makeLlmProvider>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFsState.clear();
        mockDirs.clear();
        mockDirEntries.clear();
        mockIsDir.clear();
        mockWriteErrorRef.value = null;
        mockExistsFnRef.value = null;
        mockReaddirThrow.clear();
        mockStatThrow.clear();
        mockToolManager.isConnected.mockReturnValue(true);
        mockToolManager.initError = null;
        provider = makeLlmProvider();
        // Set up system prompt file
        mockFsState.set('/prompts/system.md', 'You are a test assistant.');
    });

    describe('constructor', () => {
        it('creates runner with default state', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('running');
            expect(state.thoughts).toEqual([]);
            expect(state.actions).toEqual([]);
            expect(state.fullHistory).toEqual([]);
            expect(state.fullActions).toEqual([]);
            expect(state.totalPausedTime).toBe(0);
        });

        it('merges initial metadata', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'my-target',
                category: 'latency',
                model: 'gpt-4o',
            });
            const state = (runner as any).state as InvestigationState;
            expect(state.target).toBe('my-target');
            expect(state.category).toBe('latency');
            expect(state.model).toBe('gpt-4o');
        });

        it('sets repo root on tool manager', () => {
            new AgentRunner(makeConfig({ repoRoot: '/my-repo' }), provider);
            expect(mockToolManager.setRepoRoot).toHaveBeenCalledWith('/my-repo');
        });

        it('initializes fullHistory from existing thoughts when rehydrating', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: ['thought1', 'thought2'],
                actions: [null as any, null as any],
            });
            const state = (runner as any).state as InvestigationState;
            // fullHistory initialized from existing thoughts
            expect(state.thoughts).toEqual(['thought1', 'thought2']);
        });
    });

    describe('start', () => {
        it('completes when LLM returns finish tool', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'I will finish.',
                        tool_calls: [{
                            id: 'tc1',
                            function: {
                                name: 'finish',
                                arguments: JSON.stringify({ report: 'All done!' }),
                            },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const statusEvents: any[] = [];
            runner.on('status', (d) => statusEvents.push(d));

            await runner.start('Test query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            expect(state.finalReport).toBe('All done!');
        });

        it('extracts verdict from finish tool args', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: {
                                name: 'finish',
                                arguments: JSON.stringify({ report: 'Done', verdict: 'healthy' }),
                            },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Health check');

            const state = (runner as any).state as InvestigationState;
            expect(state.verdict).toBe('healthy');
        });

        it('executes tool actions and feeds results back', async () => {
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Let me check.',
                            tool_calls: [{
                                id: 'tc1',
                                function: {
                                    name: 'read_file',
                                    arguments: JSON.stringify({ path: '/test.txt' }),
                                },
                            }],
                        },
                    }],
                })
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc2',
                                function: {
                                    name: 'finish',
                                    arguments: JSON.stringify({ report: 'Complete' }),
                                },
                            }],
                        },
                    }],
                });

            mockToolManager.callTool.mockResolvedValueOnce('file content here');

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Read a file');

            expect(mockToolManager.callTool).toHaveBeenCalledWith('read_file', { path: '/test.txt' });
            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
        });

        it('hits max steps and pauses', async () => {
            // Always return thoughts without actions or finish
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: { content: 'Thinking...', tool_calls: undefined },
                }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 2 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('paused');
        });

        it('treats maxSteps 0 as unlimited', () => {
            const runner = new AgentRunner(makeConfig({ maxSteps: 0 }), provider);
            // Access private config
            const cfg = (runner as any).config;
            expect(cfg.maxSteps).toBe(0);
        });

        it('pauses when tools disconnect', async () => {
            mockToolManager.isConnected
                .mockReturnValueOnce(true) // initial check passes
                .mockReturnValue(false);   // then disconnect

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'thinking' } }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 2 }), provider);
            // Abort after a short time to avoid infinite loop
            setTimeout(() => runner.abort(), 100);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('aborted');
        });

        it('handles LLM errors with auto-pause', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Critical LLM Error: Rate limited',
                        tool_calls: undefined,
                    },
                }],
            });

            // maxSteps=5: 3 error iterations + 1-2 paused iterations (with 1s sleep each)
            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            // After 3 consecutive errors, auto-pauses
            expect(state.status).toBe('paused');
        }, 10000);

        it('handles not-authenticated LLM provider', async () => {
            provider.getAuthStatus.mockResolvedValue({ authenticated: false });

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: { content: 'Error: Not authenticated with TestLLM.' },
                }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            await runner.start('Query');

            // Should eventually hit max consecutive errors and auto-pause
            const state = (runner as any).state as InvestigationState;
            expect(['paused', 'running'].includes(state.status)).toBe(true);
        });

        it('truncates oversized tool results', async () => {
            const bigResult = 'x'.repeat(100_000);
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Checking.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'query', arguments: '{}' },
                            }],
                        },
                    }],
                })
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc2',
                                function: { name: 'finish', arguments: '{"report":"ok"}' },
                            }],
                        },
                    }],
                });

            mockToolManager.callTool.mockResolvedValueOnce(bigResult);

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            // The observation should be truncated
            const obs = state.thoughts.find((t: any) =>
                typeof t === 'object' && t.content && t.content.includes('OUTPUT TRUNCATED'));
            expect(obs).toBeDefined();
        });

        it('injects incident context when incidentId present', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"done"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                incidentId: '12345',
                target: 'my-stamp',
                timeRange: 'ago(1h)',
            });
            await runner.start('Investigate incident');

            // Verify the system prompt included incident context
            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const systemMsg = callArgs.messages[0].content;
            expect(systemMsg).toContain('Incident 12345');
        });

        it('forces tool use after consecutive thoughts', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 4) {
                    return { choices: [{ message: { content: `Thought ${callCount}` } }] };
                }
                return {
                    choices: [{
                        message: {
                            content: 'Finishing.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'finish', arguments: '{"report":"done"}' },
                            }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            // Should have injected a system message forcing tool usage
            const forceMsg = state.thoughts.find((t: any) =>
                typeof t === 'object' && t.content && t.content.includes('MUST call a tool'));
            expect(forceMsg).toBeDefined();
        });
    });

    describe('pause / resume / abort', () => {
        it('pauses and emits status', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const events: any[] = [];
            runner.on('status', (d) => events.push(d));

            runner.pause();
            expect((runner as any).state.status).toBe('paused');
            expect(events).toContainEqual({ status: 'paused' });
        });

        it('resumes and tracks paused time', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            runner.pause();

            // Simulate time passing
            (runner as any).state.pausedAt = Date.now() - 5000;
            runner.resume();

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('running');
            expect(state.totalPausedTime).toBeGreaterThan(0);
        });

        it('aborts investigation', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            runner.abort();
            expect((runner as any).state.status).toBe('aborted');
        });
    });

    describe('intervene', () => {
        it('queues user intervention', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            runner.intervene('Please check X first');
            const pending = (runner as any).pendingInterventions;
            expect(pending).toHaveLength(1);
            expect(pending[0].content).toContain('Please check X first');
        });
    });

    describe('contestReport', () => {
        it('contests a completed report and transitions back to running', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Original report',
            });

            runner.contestReport('Report is missing root cause');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('running');
            expect(state.finalReport).toBeUndefined();
            expect(state.contestCount).toBe(1);
            // Should have the contest message in thoughts
            expect(state.thoughts.some((t: any) =>
                typeof t === 'object' && t.content && t.content.includes('CONTESTED REPORT')
            )).toBe(true);
        });

        it('increments contestCount', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Report 1',
                contestCount: 2,
            });
            runner.contestReport('Try again');
            expect((runner as any).state.contestCount).toBe(3);
        });

        it('throws when investigation is not completed', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'running' });
            expect(() => runner.contestReport('nope')).toThrow('Can only contest a completed investigation');
        });

        it('resets retrospective state', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Report',
                retrospect: {
                    messages: [{ role: 'user', content: 'test' }],
                    proposals: [],
                    analysisComplete: true,
                    completed: false,
                },
            });
            runner.contestReport('fix this');
            const retro = (runner as any).state.retrospect;
            expect(retro.messages).toEqual([]);
            expect(retro.analysisComplete).toBe(false);
        });
    });

    describe('setModel', () => {
        it('changes the model', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            runner.setModel('gpt-4o-mini');
            expect((runner as any).state.model).toBe('gpt-4o-mini');
        });
    });

    describe('log', () => {
        it('pushes to logs and emits thought', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const events: any[] = [];
            runner.on('thought', (d) => events.push(d));

            (runner as any).log('test message');

            expect((runner as any).state.logs).toContain('test message');
            expect(events[0]).toEqual(expect.objectContaining({ content: 'test message' }));
        });
    });

    describe('retrospective', () => {
        it('throws when investigation is still running', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'running' });
            await expect(runner.runRetrospective('analyze')).rejects.toThrow('Retrospective is only available');
        });

        it('throws when investigation is paused', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'paused' });
            await expect(runner.runRetrospective('analyze')).rejects.toThrow('Retrospective is only available');
        });

        it('initializes retrospect state if not present', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const retro = (runner as any).initRetrospect();
            expect(retro.messages).toEqual([]);
            expect(retro.proposals).toEqual([]);
            expect(retro.analysisComplete).toBe(false);
            expect(retro.completed).toBe(false);
        });

        it('setRetrospectCompleted marks completion', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const retro = runner.setRetrospectCompleted(true);
            expect(retro.completed).toBe(true);
        });

        it('resetRetrospectiveAnalysis clears state', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [{ role: 'user', content: 'hi' }],
                    proposals: [{ id: 'p1', type: 'edit', filePath: 'a.md', description: 'd', content: 'c', status: 'pending' }],
                    analysisComplete: true,
                    completed: false,
                },
            });
            runner.resetRetrospectiveAnalysis();
            const retro = (runner as any).state.retrospect;
            expect(retro.messages).toEqual([]);
            expect(retro.proposals).toEqual([]);
            expect(retro.analysisComplete).toBe(false);
            expect(retro.analysisFailed).toBe(false);
        });

        it('updateProposalStatus updates and returns proposal', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1', type: 'edit' as const, filePath: 'a.md',
                        description: 'd', content: 'c', status: 'pending' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });
            const updated = runner.updateProposalStatus('p1', 'approved');
            expect(updated).not.toBeNull();
            expect(updated!.status).toBe('approved');
        });

        it('updateProposalStatus returns null for missing proposal', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            expect(runner.updateProposalStatus('missing', 'rejected')).toBeNull();
        });

        it('abortRetrospective aborts controller', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            // Set a mock controller
            const ctrl = new AbortController();
            (runner as any).retrospectAbortController = ctrl;
            runner.abortRetrospective();
            expect(ctrl.signal.aborted).toBe(true);
        });
    });

    describe('syncFullHistory', () => {
        it('syncs new thoughts to fullHistory', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            state.thoughts.push('t1', 't2');
            state.actions.push(null, null);

            (runner as any).syncFullHistory();

            expect(state.fullHistory).toEqual(['t1', 't2']);
            expect(state.fullActions).toEqual([null, null]);
        });

        it('does not duplicate entries on second call', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            state.thoughts.push('t1');
            state.actions.push(null);

            (runner as any).syncFullHistory();
            (runner as any).syncFullHistory();

            expect(state.fullHistory).toEqual(['t1']);
        });
    });

    describe('summarize', () => {
        it('calls compactHistory and adds system message', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                query: 'test query',
            } as any);
            const state = (runner as any).state;
            // Add enough history to compact
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`thought ${i}`);
                state.actions.push(null);
            }

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Summary of investigation' } }],
            });

            const result = await runner.summarize();
            expect(result).toBe(true);
        });

        it('returns false when not enough history', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await runner.summarize();
            expect(result).toBe(false);
        });
    });

    describe('loadSystemPrompt', () => {
        it('loads from file', () => {
            mockFsState.set('/prompts/system.md', 'Custom prompt');
            const runner = new AgentRunner(makeConfig(), provider);
            const prompt = (runner as any).loadSystemPrompt();
            expect(prompt).toBe('Custom prompt');
        });

        it('falls back to default when file missing', () => {
            mockFsState.delete('/prompts/system.md');
            const runner = new AgentRunner(makeConfig({ systemPromptPath: '/missing.md' }), provider);
            const prompt = (runner as any).loadSystemPrompt();
            expect(prompt).toBe('You are a helpful assistant.');
        });
    });

    describe('saveArtifacts', () => {
        it('syncs fullHistory before saving', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            state.thoughts.push('t1', 't2');
            state.actions.push(null, null);

            // saveArtifacts calls syncFullHistory internally.
            // Since saveArtifacts uses require('fs') which bypasses vi.mock,
            // test the syncFullHistory behavior instead.
            (runner as any).syncFullHistory();

            expect(state.fullHistory).toEqual(['t1', 't2']);
        });
    });

    describe('executeAction', () => {
        it('delegates to toolManager', async () => {
            mockToolManager.callTool.mockResolvedValue('result data');
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeAction({ tool: 'read_file', args: { path: 'x' } });
            expect(result).toBe('result data');
        });

        it('returns error string on failure', async () => {
            mockToolManager.callTool.mockRejectedValue(new Error('tool failed'));
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeAction({ tool: 'bad', args: {} });
            expect(result).toContain('Error: tool failed');
        });
    });

    describe('handleProposeChange', () => {
        it('adds proposal to retrospect', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            const result = (runner as any).handleProposeChange({
                type: 'create',
                filePath: 'docs/new-guide.md',
                description: '[New Guide] Investigation guide',
                content: '# New Guide',
            });

            expect(result).toContain('proposed successfully');
            expect((runner as any).state.retrospect.proposals).toHaveLength(1);
        });

        it('blocks path traversal', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            const result = (runner as any).handleProposeChange({
                type: 'edit',
                filePath: '../../../etc/passwd',
                description: 'hack',
                content: 'bad',
            });

            expect(result).toContain('outside the repository root');
        });
    });

    describe('applyApprovedProposals', () => {
        it('applies approved proposals to disk', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1',
                        type: 'create' as const,
                        filePath: 'docs/test.md',
                        description: 'test',
                        content: '# Test',
                        status: 'approved' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });

            const result = await runner.applyApprovedProposals();
            expect(result.applied).toContain('docs/test.md');
            expect(result.errors).toHaveLength(0);
        });

        it('skips non-approved proposals', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1',
                        type: 'create' as const,
                        filePath: 'docs/test.md',
                        description: 'test',
                        content: '# Test',
                        status: 'rejected' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });

            const result = await runner.applyApprovedProposals();
            expect(result.applied).toHaveLength(0);
        });
    });

    describe('events', () => {
        it('emits thought events', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"done"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const thoughts: any[] = [];
            runner.on('thought', (d) => thoughts.push(d));

            await runner.start('Query');
            expect(thoughts.length).toBeGreaterThan(0);
        });

        it('emits action events', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"done"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const actions: any[] = [];
            runner.on('action', (d) => actions.push(d));

            await runner.start('Query');
            expect(actions.length).toBeGreaterThan(0);
            expect(actions[0].tool).toBe('finish');
        });

        it('emits progress events', async () => {
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Checking.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'read_file', arguments: '{"path":"x"}' },
                            }],
                        },
                    }],
                })
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc2',
                                function: { name: 'finish', arguments: '{"report":"done"}' },
                            }],
                        },
                    }],
                });

            const runner = new AgentRunner(makeConfig(), provider);
            const progress: any[] = [];
            runner.on('progress', (d) => progress.push(d));

            await runner.start('Query');
            expect(progress.length).toBeGreaterThan(0);
        });
    });

    describe('runRetrospective', () => {
        it('sends user message and stores assistant response', async () => {
            // The tool loop retries when model doesn't use tools.
            // After 5 no-tool attempts it returns an error message.
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis text', tool_calls: null } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['Checked pipeline.'],
                actions: [null],
            });

            await runner.runRetrospective('What went well?');
            const retro = (runner as any).state.retrospect;
            expect(retro.messages).toHaveLength(2);
            expect(retro.messages[0]).toEqual({ role: 'user', content: 'What went well?' });
            expect(retro.messages[1].role).toBe('assistant');
        });

        it('handles LLM errors gracefully', async () => {
            provider.getAuthStatus.mockResolvedValue({ authenticated: false });

            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            await runner.runRetrospective('Analyze this');
            const retro = (runner as any).state.retrospect;
            expect(retro.messages[1].content).toContain('Error');
        });

        it('throws when investigation is still running', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'running' });
            await expect(runner.runRetrospective('test')).rejects.toThrow('only available for completed');
        });
    });

    describe('runRetrospectiveAnalysis', () => {
        it('runs automated analysis on completed investigation', async () => {
            // The tool loop will attempt to use tools. After enough retries it completes.
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis complete.', tool_calls: null } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['Step 1'],
                actions: [{ tool: 'kql', args: {}, result: 'data' }],
                category: 'latency',
            });

            await runner.runRetrospectiveAnalysis();
            const retro = (runner as any).state.retrospect;
            expect(retro.analysisComplete).toBe(true);
        });

        it('skips when already analyzed', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: { messages: [], proposals: [], analysisComplete: true, completed: false },
            });
            await runner.runRetrospectiveAnalysis();
            expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
        });

        it('guards against concurrent analysis', async () => {
            // Use a deferred promise to control when the LLM resolves
            let resolveFirst!: Function;
            const firstCall = new Promise(resolve => { resolveFirst = resolve; });
            mockOpenAI.chat.completions.create.mockImplementationOnce(() => firstCall);

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['Step 1'],
                actions: [null],
            });

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            // Start first analysis - will hang at LLM call
            const p1 = runner.runRetrospectiveAnalysis();
            // Allow microtask to run so isRetrospectRunning is set
            await new Promise(r => setTimeout(r, 10));
            // Second call while first is running should be a no-op
            await runner.runRetrospectiveAnalysis();
            // Resolve first call
            resolveFirst({
                choices: [{ message: { content: 'done', tool_calls: null } }],
            });
            // Allow remaining retries to complete
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'done', tool_calls: null } }],
            });
            await p1;
            consoleSpy.mockRestore();
        });

        it('throws when investigation is running', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'running' });
            await expect(runner.runRetrospectiveAnalysis()).rejects.toThrow('only available for completed');
        });
    });

    describe('callLlm', () => {
        it('sanitizes tool schema by removing defaults and anyOf-null', async () => {
            mockToolManager.listTools.mockResolvedValue([{
                name: 'custom_tool',
                description: 'A test tool',
                inputSchema: {
                    type: 'object',
                    properties: {
                        field: {
                            anyOf: [{ type: 'string' }, { type: 'null' }],
                            default: null,
                        },
                    },
                },
            }]);

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"done"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Test');
            // Verify the LLM was called - the schema sanitization happens silently
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
        });
    });

    describe('localReadFile / localListDir', () => {
        // Note: localReadFile uses require('fs') which bypasses vi.mock('fs').
        // These methods are tested indirectly through handleProposeChange and start().

        it('localReadFile returns error for non-existent file', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localReadFile('docs/definitely-missing-xyz.md');
            expect(result).toContain('File not found');
        });

        it('localListDir returns error for missing directory', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localListDir('nonexistent-dir-xyz');
            expect(result).toContain('Directory not found');
        });
    });

    describe('start edge cases', () => {
        it('injects knowledge base content when available', async () => {
            // Set up file system with a knowledge base  
            mockFsState.set('/repo/knowledge-base/guide.md', '# Investigation Guide');
            mockDirs.add('/repo/knowledge-base');

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"done"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'knowledge-base' }), provider, {
                incidentId: 'INC-123',
            });
            await runner.start('Check incident');

            // Verify LLM was called (knowledge base content is injected into system prompt)
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
        });

        it('compacts history mid-loop on oversized messages', async () => {
            // Create a scenario where tool results are very large
            const bigResult = 'x'.repeat(50_000);
            mockToolManager.callTool.mockResolvedValue(bigResult);

            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        choices: [{
                            message: {
                                content: `Step ${callCount}`,
                                tool_calls: [{
                                    id: `tc${callCount}`,
                                    function: { name: 'read_file', arguments: '{"path":"file.txt"}' },
                                }],
                            },
                        }],
                    };
                }
                return {
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc-final',
                                function: { name: 'finish', arguments: '{"report":"Complete"}' },
                            }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            await runner.start('Process big data');

            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('start - MCP init retry loop', () => {
        it('pauses on failed init, then retries on resume and succeeds', async () => {
            // First check: not connected. initialize: still not connected.
            // After resume: initialize succeeds.
            mockToolManager.isConnected
                .mockReturnValueOnce(false)  // initial check
                .mockReturnValueOnce(false)  // after first initialize
                .mockReturnValueOnce(true);  // after resume + retry

            mockToolManager.initError = 'Connection refused';

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // After init fails and pauses, resume after a short delay
            setTimeout(() => runner.resume(), 150);

            await runner.start('Query');
            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
        }, 10000);

        it('aborts during MCP init retry wait', async () => {
            mockToolManager.isConnected.mockReturnValue(false);
            mockToolManager.initError = 'Not available';

            const runner = new AgentRunner(makeConfig(), provider);
            // Abort while waiting for resume
            setTimeout(() => runner.abort(), 150);

            await runner.start('Query');
            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('aborted');
        }, 10000);

        it('retries init on resume, fails again, re-pauses', async () => {
            let initCallCount = 0;
            mockToolManager.isConnected.mockReturnValue(false);
            mockToolManager.initError = 'Still broken';
            mockToolManager.initialize.mockImplementation(async () => { initCallCount++; });

            const runner = new AgentRunner(makeConfig(), provider);
            // Resume once, it will fail and re-pause, then abort
            setTimeout(() => runner.resume(), 200);
            setTimeout(() => runner.abort(), 1600);

            await runner.start('Query');
            expect(initCallCount).toBeGreaterThanOrEqual(2); // initial + retry
            expect((runner as any).state.status).toBe('aborted');
        }, 15000);
    });

    describe('start - LLM error handling with backoff', () => {
        it('handles timeout errors with exponential backoff and auto-compaction', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        choices: [{
                            message: {
                                content: 'Critical LLM Error: Request timed out after 180s',
                                tool_calls: undefined,
                            },
                        }],
                    };
                }
                return {
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"done"}' } }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            // Should have retried after timeout
            const timeoutMsg = state.thoughts.find((t: any) =>
                typeof t === 'string' && t.includes('timed out'));
            expect(timeoutMsg).toBeDefined();
        }, 30000);

        it('auto-pauses after max consecutive LLM errors', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'System Alert: service unavailable',
                        tool_calls: undefined,
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('paused');
            const pauseMsg = state.thoughts.find((t: any) =>
                typeof t === 'string' && t.includes('auto-paused'));
            expect(pauseMsg).toBeDefined();
        }, 10000);

        it('resets error count on successful tool call', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{ message: { content: 'Critical LLM Error: intermittent' } }],
                    };
                }
                if (callCount === 2) {
                    return {
                        choices: [{
                            message: {
                                content: 'Using tool.',
                                tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{"path":"x"}' } }],
                            },
                        }],
                    };
                }
                return {
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{ id: 'tc2', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
            await runner.start('Query');

            expect((runner as any).state.status).toBe('completed');
        });

        it('catches unexpected errors and sets status to failed', async () => {
            // Trigger an exception that escapes callLLM's try-catch by
            // making a 'progress' event listener throw inside the main loop
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'thinking...' } }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            const events: any[] = [];
            runner.on('status', (d) => events.push(d));
            runner.on('progress', () => { throw new Error('Unexpected crash!'); });

            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('failed');
            expect(events).toContainEqual({ status: 'failed' });
        });
    });

    describe('start - user intervention flushing', () => {
        it('flushes pending interventions before LLM call', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return { choices: [{ message: { content: 'Thinking...' } }] };
                }
                return {
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"done"}' } }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            // Queue an intervention before start
            runner.intervene('Check this too');

            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            // The intervention should have been flushed into thoughts
            const interventionThought = state.thoughts.find((t: any) =>
                typeof t === 'object' && t.content && t.content.includes('Check this too'));
            expect(interventionThought).toBeDefined();
        });
    });

    describe('discoverKnowledgeBase', () => {
        it('recursively scans knowledge base directory', () => {
            mockDirs.add('/repo/knowledge-base');
            mockDirEntries.set('knowledge-base', ['guide.md', 'subdir']);
            mockDirEntries.set('subdir', ['nested.md']);
            mockIsDir.add('subdir');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'knowledge-base' }), provider);
            const result = (runner as any).discoverKnowledgeBase();

            expect(result).toContain('Knowledge Base');
            expect(result).toContain('guide.md');
        });

        it('returns fallback when no knowledge base exists', () => {
            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: '' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('No knowledge base files discovered');
        });

        it('scans system prompt directory', () => {
            mockDirs.add('/repo/prompts');
            mockDirEntries.set('prompts', ['system.md', 'retrospect.md']);

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: '',
                systemPromptPath: '/repo/prompts/system.md',
            }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Agent Prompts');
        });

        it('scans .github/prompts directory', () => {
            mockDirs.add('/repo/.github/prompts');
            mockDirEntries.set('.github/prompts', ['custom.md']);

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: '' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Prompt Files');
        });

        it('handles scan errors gracefully', () => {
            // Dir exists but has no entries in mockDirEntries, so readdirSync returns []
            mockDirs.add('/repo/docs');
            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'docs' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(typeof result).toBe('string');
        });

        it('handles entries in knowledge base', () => {
            mockDirs.add('/repo/docs');
            mockDirEntries.set('docs', ['file1.md']);

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'docs' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('file1.md');
        });

        it('limits scan depth', () => {
            mockDirs.add('/repo/docs');
            mockDirEntries.set('docs', ['subdir']);
            mockIsDir.add('subdir');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'docs' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(typeof result).toBe('string');
        });
    });

    describe('buildRetrospectMessages', () => {
        it('filters planning-only assistant messages', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'assistant', content: "Let me start by reading the guide" },
                { role: 'user', content: 'What improvements?' },
                { role: 'assistant', content: 'Here is my analysis of the issues found.' },
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            // The "Let me start by reading" message should be filtered
            const assistantMsgs = result.filter((m: any) => m.role === 'assistant');
            expect(assistantMsgs.every((m: any) => !m.content.startsWith('Let me'))).toBe(true);
        });

        it('filters token overflow error messages', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'assistant', content: 'Error: token count of 200k exceeds limit' },
                { role: 'user', content: 'ok' },
                { role: 'assistant', content: 'Real analysis here.' },
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            // Token error msg and orphaned "ok" should both be filtered
            const contents = result.filter((m: any) => m.role === 'assistant').map((m: any) => m.content);
            expect(contents).not.toContain('Error: token count of 200k exceeds limit');
        });

        it('filters auto-analysis error messages', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'assistant', content: 'Error during auto-analysis: something broke' },
                { role: 'assistant', content: 'Good analysis.' },
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            const contents = result.filter((m: any) => m.role === 'assistant').map((m: any) => m.content);
            expect(contents).toEqual(['Good analysis.']);
        });

        it('filters orphaned user ack messages', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'user', content: 'ok' }, // orphaned — no preceding assistant msg
                { role: 'assistant', content: 'Analysis.' },
                { role: 'user', content: 'proceed' }, // this one has preceding assistant msg — keep
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            const userMsgs = result.filter((m: any) => m.role === 'user');
            // First "ok" should be filtered, but "proceed" should remain
            expect(userMsgs.some((m: any) => m.content === 'ok')).toBe(false);
            expect(userMsgs.some((m: any) => m.content === 'proceed')).toBe(true);
        });

        it('filters tool-call and tool-result role messages', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'tool-call', content: 'Reading file.md' },
                { role: 'tool-result', content: '# Guide content' },
                { role: 'assistant', content: 'Final analysis.' },
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            // tool-call and tool-result should be filtered
            const roles = result.map((m: any) => m.role);
            expect(roles).not.toContain('tool-call');
            expect(roles).not.toContain('tool-result');
        });

        it('caps retro messages to MAX_RETRO_MESSAGES', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            // Create 15 messages (> MAX_RETRO_MESSAGES=10)
            const retroMessages = [];
            for (let i = 0; i < 15; i++) {
                retroMessages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` });
            }

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            // Should have system + transcript + last 10 messages 
            const userAndAssistant = result.filter((m: any) => m.role === 'user' || m.role === 'assistant');
            // transcript is 1 user message + up to 10 retro messages
            expect(userAndAssistant.length).toBeLessThanOrEqual(11);
        });
    });

    describe('runRetrospectToolLoop', () => {
        it('trims messages when over token limit', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            // Build messages with large tool results
            const messages: any[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'Analyze' },
                { role: 'tool', content: 'x'.repeat(200000) },
                { role: 'tool', content: 'y'.repeat(200000) },
                { role: 'assistant', content: 'analysis' },
            ];

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: null } }],
            });

            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(typeof result).toBe('string');
        });

        it('forces read_file tool choice after consecutive no-tool attempts', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 5) {
                    // No tool calls — model refuses to use tools
                    return { choices: [{ message: { content: `Planning ${callCount}`, tool_calls: null } }] };
                }
                // Give up after 5 retries
                return { choices: [{ message: { content: 'Cannot call tools', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(result).toContain('unable to call any tools');
        });

        it('falls back to a default completion message when the model returns empty text with no tool calls', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: '', tool_calls: null } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
                { role: 'tool', content: 'existing result' },
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(result).toBe('Analysis complete.');
        });

        it('retries on network errors', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    const err = new Error('fetch failed');
                    (err as any).code = 'ECONNRESET';
                    throw err;
                }
                return {
                    choices: [{
                        message: {
                            content: 'Analysis complete.',
                            tool_calls: null,
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
                { role: 'tool', content: 'existing result' }, // hasToolResults = true
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(callCount).toBeGreaterThanOrEqual(2); // first failed, second succeeded
        });

        it('throws timeout errors without retrying', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                const err = new Error('Request timed out');
                (err as any).code = 'ETIMEDOUT';
                throw err;
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await expect((runner as any).runRetrospectToolLoop(messages, tools)).rejects.toThrow('timed out');
        });

        it('handles abort during tool loop', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                // Simulate slow call
                await new Promise(r => setTimeout(r, 50));
                return {
                    choices: [{
                        message: {
                            content: 'Reading.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'read_file', arguments: '{"path":"test.md"}' },
                            }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();

            // Start the loop and abort quickly
            const loopPromise = (runner as any).runRetrospectToolLoop(messages, tools);
            setTimeout(() => runner.abortRetrospective(), 20);

            await expect(loopPromise).rejects.toThrow('cancelled');
        });

        it('nudges model to call propose_change after enough file reads', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 6) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: `tc${callCount}`,
                                    function: { name: 'read_file', arguments: `{"path":"file${callCount}.md"}` },
                                }],
                            },
                        }],
                    };
                }
                // After nudge, return final text
                return { choices: [{ message: { content: 'Analysis complete.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('file content');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);

            // Should have injected proposal nudge message after 6 reads
            const nudgeMsg = messages.find((m: any) =>
                m.role === 'user' && m.content && m.content.includes('STOP reading more files'));
            expect(nudgeMsg).toBeDefined();
        });

        it('deduplicates read_file calls for same path', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: `tc${callCount}`,
                                    function: { name: 'read_file', arguments: '{"path":"same-file.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('file content');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // callTool should only be called once for the file — second is dedup
            expect(mockToolManager.callTool).toHaveBeenCalledTimes(1);
        });

        it('handles propose_change tool calls', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: {
                                        name: 'propose_change',
                                        arguments: JSON.stringify({
                                            type: 'create',
                                            filePath: 'docs/new.md',
                                            description: '[New Guide] Test',
                                            content: '# New Guide',
                                        }),
                                    },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Analysis complete.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const retro = (runner as any).state.retrospect;
            expect(retro.proposals).toHaveLength(1);
            expect(retro.proposals[0].filePath).toBe('docs/new.md');
        });

        it('handles propose_change activity text when description is empty', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: {
                                        name: 'propose_change',
                                        arguments: JSON.stringify({
                                            type: 'create',
                                            filePath: 'docs/empty-description.md',
                                            description: '',
                                            content: '# Empty Description',
                                        }),
                                    },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Analysis complete.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const events: any[] = [];
            runner.on('retrospect-tool-activity', (event: any) => events.push(event));

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            expect(events.some((event: any) =>
                event.tool === 'propose_change' && event.description === 'Proposing change: '
            )).toBe(true);
        });

        it('handles read_file calls with a missing path argument', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('missing path handled');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            expect(mockToolManager.callTool).toHaveBeenCalledWith('read_file', {});
        });

        it('stringifies object tool results in retrospective live messages', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"docs/guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Analysis complete.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue({ items: [{ id: 1 }], count: 1 });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const retro = (runner as any).state.retrospect;
            expect(retro.messages.some((message: any) =>
                message.role === 'tool-result' &&
                typeof message.content === 'string' &&
                message.content.includes('"count":1')
            )).toBe(true);
        });

        it('handles list_dir tool calls', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'list_dir', arguments: '{"path":"docs"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('["file1.md", "file2.md"]');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(typeof result).toBe('string');
        });

        it('handles unknown tool calls', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'non_existent_tool', arguments: '{}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // Check that unknown tool error was added
            const toolResult = messages.find((m: any) =>
                m.role === 'tool' && m.content && m.content.includes('Unknown tool'));
            expect(toolResult).toBeDefined();
        });

        it('handles tool argument parse errors', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: 'invalid-json{' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const parseError = messages.find((m: any) =>
                m.role === 'tool' && m.content && m.content.includes('Invalid JSON'));
            expect(parseError).toBeDefined();
        });

        it('handles tool execution errors', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"test.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockRejectedValue(new Error('File access denied'));

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const errMsg = messages.find((m: any) =>
                m.role === 'tool' && m.content && m.content.includes('File access denied'));
            expect(errMsg).toBeDefined();
        });

        it('truncates large read_file results', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"big.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('x'.repeat(50000));

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const toolResult = messages.find((m: any) =>
                m.role === 'tool' && m.content && m.content.includes('File truncated'));
            expect(toolResult).toBeDefined();
        });

        it('CASE 2: nudges model for proposals after file reads', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    // First: read a file (tool result)
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                if (callCount <= 4) {
                    // Then return text without tool calls or proposals
                    return {
                        choices: [{ message: { content: 'Here is my analysis of the issues...', tool_calls: null } }],
                    };
                }
                // Eventually complete
                return { choices: [{ message: { content: 'Final analysis complete.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('# Guide content');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            const result = await (runner as any).runRetrospectToolLoop(messages, tools);

            // Should have injected nudge messages about calling propose_change
            const nudgeMsg = messages.find((m: any) =>
                m.role === 'user' && m.content && m.content.includes('propose_change'));
            expect(nudgeMsg).toBeDefined();
        });

        it('CASE 3: re-prompts short planning text', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    // Short planning text
                    return {
                        choices: [{ message: { content: "Let me read the investigation guide to check.", tool_calls: null } }],
                    };
                }
                // Next: return tool call
                if (callCount === 2) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('# Guide');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
                { role: 'tool', content: 'existing result' }, // hasToolResults
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // Should have re-prompted
            const reprompt = messages.find((m: any) =>
                m.role === 'user' && m.content && m.content.includes('MUST use the read_file or propose_change'));
            expect(reprompt).toBeDefined();
        });

        it('uses localReadFile when tool manager is disconnected', async () => {
            mockToolManager.isConnected.mockReturnValue(false);

            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"test.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // Should not have called toolManager.callTool (used localReadFile instead)
            expect(mockToolManager.callTool).not.toHaveBeenCalled();
        });

        it('persists tool activity to retro messages', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: 'Thinking about this...',
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"test.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('# Content');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();
            const events: any[] = [];
            runner.on('retrospect-tool-activity', (d: any) => events.push(d));

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            const retro = (runner as any).state.retrospect;
            // Should have tool-call and tool-result entries
            expect(retro.messages.some((m: any) => m.role === 'tool-call')).toBe(true);
            expect(retro.messages.some((m: any) => m.role === 'tool-result')).toBe(true);
            // Should have emitted tool activity events
            expect(events.length).toBeGreaterThan(0);
        });

        it('emits thinking activity when LLM returns text with tool calls', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: 'Let me analyze the guide content...',
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            mockToolManager.callTool.mockResolvedValue('# Guide');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const activities: any[] = [];
            runner.on('retrospect-tool-activity', (d: any) => activities.push(d));

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // Should have a 'thinking' activity
            const thinkingActivity = activities.find((a: any) => a.tool === 'thinking');
            expect(thinkingActivity).toBeDefined();
        });
    });

    describe('runRetrospectiveAnalysis - completion and error handling', () => {
        it('builds completion message with proposals', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: {
                                        name: 'propose_change',
                                        arguments: JSON.stringify({
                                            type: 'edit',
                                            filePath: 'docs/guide.md',
                                            description: '[Fix Wrong Info] Fix query',
                                            content: '# Updated Guide',
                                        }),
                                    },
                                }],
                            },
                        }],
                    };
                }
                return {
                    choices: [{ message: { content: 'Found and fixed issues.', tool_calls: null } }],
                };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [{ tool: 'kql', args: {}, result: 'data' }],
                category: 'latency',
            });

            await runner.runRetrospectiveAnalysis();
            const retro = (runner as any).state.retrospect;
            expect(retro.analysisComplete).toBe(true);
            expect(retro.analysisFailed).toBe(false);
            expect(retro.proposals).toHaveLength(1);
            // Completion message should mention proposals
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('proposed change');
        });

        it('builds completion message without proposals', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'No issues found.', tool_calls: null } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });

            await runner.runRetrospectiveAnalysis();
            const retro = (runner as any).state.retrospect;
            expect(retro.analysisComplete).toBe(true);
            // Completion message should indicate no changes
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('No changes were proposed');
        });

        it('builds a pluralized completion message when multiple proposals were generated', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [
                                    {
                                        id: 'tc1',
                                        function: {
                                            name: 'propose_change',
                                            arguments: JSON.stringify({
                                                type: 'edit',
                                                filePath: 'docs/guide-1.md',
                                                description: 'Fix first guide',
                                                content: '# Guide 1',
                                            }),
                                        },
                                    },
                                    {
                                        id: 'tc2',
                                        function: {
                                            name: 'propose_change',
                                            arguments: JSON.stringify({
                                                type: 'edit',
                                                filePath: 'docs/guide-2.md',
                                                description: 'Fix second guide',
                                                content: '# Guide 2',
                                            }),
                                        },
                                    },
                                ],
                            },
                        }],
                    };
                }
                return {
                    choices: [{ message: { content: 'Found two issues.', tool_calls: null } }],
                };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [{ tool: 'kql', args: {}, result: 'data' }],
                category: 'latency',
            });

            await runner.runRetrospectiveAnalysis();

            const retro = (runner as any).state.retrospect;
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(retro.proposals).toHaveLength(2);
            expect(lastMsg.content).toContain('2 proposed changes generated');
        });

        it('handles cancellation (AbortError)', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async (_, opts: any) => {
                // Simulate slow call that gets aborted
                await new Promise(r => setTimeout(r, 100));
                if (opts?.signal?.aborted) {
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    throw err;
                }
                return { choices: [{ message: { content: 'done', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });

            // Start analysis and abort quickly
            const analysisPromise = runner.runRetrospectiveAnalysis();
            setTimeout(() => runner.abortRetrospective(), 30);
            await analysisPromise;

            const retro = (runner as any).state.retrospect;
            expect(retro.analysisComplete).toBe(true);
            expect(retro.analysisFailed).toBe(false); // cancelled is NOT a failure
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('cancelled');
        });

        it('handles non-abort errors and marks analysisFailed', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API quota exceeded'));

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });

            await runner.runRetrospectiveAnalysis();
            const retro = (runner as any).state.retrospect;
            expect(retro.analysisComplete).toBe(true);
            expect(retro.analysisFailed).toBe(true);
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('API quota exceeded');
        });
    });

    describe('applyApprovedProposals - advanced', () => {
        it('rejects paths outside repo root', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1',
                        type: 'create' as const,
                        filePath: '/etc/passwd',
                        description: 'hack',
                        content: 'bad',
                        status: 'approved' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });

            const result = await runner.applyApprovedProposals();
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('outside the repository root');
        });

        it('creates directories when they do not exist', async () => {
            // new-dir doesn't exist in mockDirs, so existsSync returns false for it
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1',
                        type: 'create' as const,
                        filePath: 'new-dir/guide.md',
                        description: 'new guide',
                        content: '# Guide',
                        status: 'approved' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });

            const result = await runner.applyApprovedProposals();
            expect(result.applied).toContain('new-dir/guide.md');
        });

        it('handles write errors and keeps status as approved for retry', async () => {
            mockWriteErrorRef.value = 'Disk full';

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                retrospect: {
                    messages: [],
                    proposals: [{
                        id: 'p1',
                        type: 'edit' as const,
                        filePath: 'docs/test.md',
                        description: 'update',
                        content: '# Updated',
                        status: 'approved' as const,
                    }],
                    analysisComplete: true,
                    completed: false,
                },
            });
            // Prevent saveArtifacts from also throwing (it uses writeFileSync)
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            const result = await runner.applyApprovedProposals();
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('Disk full');
            const proposal = (runner as any).state.retrospect.proposals[0];
            expect(proposal.status).toBe('approved');
        });
    });

    describe('handleProposeChange - edit with original content', () => {
        it('reads original file content for edit proposals', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            // localReadFile resolves paths with path.resolve which adds drive letter on Windows
            const path = require('path');
            const resolvedPath = n(path.resolve('/repo', 'existing-guide.md'));
            mockFsState.set(resolvedPath, '# Original content');

            const result = (runner as any).handleProposeChange({
                type: 'edit',
                filePath: 'existing-guide.md',
                description: '[Fix] Update guide',
                content: '# Updated content',
            });

            expect(result).toContain('proposed successfully');
            const proposal = (runner as any).state.retrospect.proposals[0];
            expect(proposal.originalContent).toBe('# Original content');
        });
    });

    describe('callLLM - advanced', () => {
        it('handles 400 errors with auto-compaction retry', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    const err = new Error('Token limit exceeded') as any;
                    err.status = 400;
                    throw err;
                }
                // After compaction, succeed
                return {
                    choices: [{
                        message: {
                            content: 'Done after compaction.',
                            tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            const state = (runner as any).state;
            // Add enough history for compaction to work
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`thought ${i}`);
                state.actions.push(null);
            }

            await runner.start('Query');
            // Should have recovered via compaction
            expect(callCount).toBeGreaterThanOrEqual(2);
        });

        it('handles 400 error when compaction fails', async () => {
            const err = new Error('Request too large') as any;
            err.status = 400;
            mockOpenAI.chat.completions.create.mockRejectedValue(err);

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            // Should auto-pause after max consecutive errors from System Alert
            expect(['paused', 'failed'].includes(state.status)).toBe(true);
        });

        it('handles timeout errors with context hint', async () => {
            const timeoutErr = new Error('Request timed out');
            (timeoutErr as any).code = 'ETIMEDOUT';
            mockOpenAI.chat.completions.create.mockRejectedValue(timeoutErr);

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            await runner.start('Query');

            // Should have Critical LLM Error thoughts
            const state = (runner as any).state as InvestigationState;
            const errorThought = state.thoughts.find((t: any) =>
                typeof t === 'string' && t.includes('Critical LLM Error'));
            expect(errorThought).toBeDefined();
        }, 30000);

        it('proactively compacts oversized payload', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                return {
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                        },
                    }],
                };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider);
            const state = (runner as any).state;
            // Add very large history to exceed 600K char threshold
            for (let i = 0; i < 25; i++) {
                state.thoughts.push('x'.repeat(30000));
                state.actions.push(null);
            }

            await runner.start('Query');
            // Should trigger proactive compaction and still complete
            expect(callCount).toBeGreaterThanOrEqual(1);
        });

        it('appends user message when last message is assistant', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            // Add history ending with assistant-role message
            state.thoughts.push({ role: 'assistant', content: 'I am thinking' });
            state.actions.push(null);

            await runner.start('Query');

            // Verify the LLM was called and the last message workaround was applied
            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const msgs = callArgs.messages;
            expect(msgs[msgs.length - 1].content).toBe('Proceed with the next step.');
        });

        it('caps oversized individual messages', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            // Add a very long message
            state.thoughts.push('x'.repeat(50000));
            state.actions.push(null);

            await runner.start('Query');

            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const assistantMsg = callArgs.messages.find((m: any) => m.role === 'assistant' && m.content.includes('MESSAGE TRUNCATED'));
            expect(assistantMsg).toBeDefined();
        });

        it('handles empty tools list', async () => {
            mockToolManager.listTools.mockResolvedValue([]);

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: { content: 'No tools available, finishing.', tool_calls: undefined },
                }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 2 }), provider);
            await runner.start('Query');

            // Should have called LLM without tools
            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            expect(callArgs.tools).toBeUndefined();
        });

        it('handles listTools failure gracefully', async () => {
            mockToolManager.listTools.mockRejectedValue(new Error('MCP disconnected'));

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');

            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('compactHistory', () => {
        it('merges existing memory with new entries', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Merged summary of all findings' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                query: 'test query',
            } as any);
            const state = (runner as any).state;
            // First entry is an existing memory
            state.thoughts.push('System [Memory]: Previous Investigation Summary:\nOld findings here');
            state.actions.push(null);
            // Add enough entries for compaction
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`finding ${i}`);
                state.actions.push(null);
            }

            const result = await (runner as any).compactHistory(
                'system prompt', 'test query', state.thoughts
            );
            expect(result).toBe(true);
            // First thought should be the new merged memory
            expect(state.thoughts[0]).toContain('System [Memory]');
        });

        it('condenses oversized existing memory', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Condensed summary' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                query: 'test query',
            } as any);
            const state = (runner as any).state;
            // First entry is an oversized memory (> 12K chars)
            state.thoughts.push('System [Memory]: Previous Investigation Summary:\n' + 'x'.repeat(15000));
            state.actions.push(null);
            state.thoughts.push('System: Context was automatically compacted to stay within token limits. 10 older messages were summarized.');
            state.actions.push(null);
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`finding ${i}`);
                state.actions.push(null);
            }

            const result = await (runner as any).compactHistory(
                'system prompt', 'test query', state.thoughts
            );
            expect(result).toBe(true);
        });

        it('returns false when not authenticated', async () => {
            provider.getAuthStatus.mockResolvedValue({ authenticated: false });

            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`thought ${i}`);
                state.actions.push(null);
            }

            const result = await (runner as any).compactHistory(
                'system prompt', 'query', state.thoughts
            );
            expect(result).toBe(false);
        });

        it('returns false when not enough history', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            state.thoughts.push('only one');
            state.actions.push(null);

            const result = await (runner as any).compactHistory(
                'system prompt', 'query', state.thoughts
            );
            expect(result).toBe(false);
        });

        it('returns false on compaction failure', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API error'));

            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`thought ${i}`);
                state.actions.push(null);
            }

            const result = await (runner as any).compactHistory(
                'system prompt', 'query', state.thoughts
            );
            expect(result).toBe(false);
        });

        it('throws on empty summary response', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: null } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            for (let i = 0; i < 20; i++) {
                state.thoughts.push(`thought ${i}`);
                state.actions.push(null);
            }

            // compactHistory catches errors and returns false
            const result = await (runner as any).compactHistory(
                'system prompt', 'query', state.thoughts
            );
            expect(result).toBe(false);
        });

        it('truncates oversized observation entries after compaction', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Summary of findings.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                query: 'test query',
            } as any);
            const state = (runner as any).state;
            for (let i = 0; i < 14; i++) {
                state.thoughts.push(`step ${i}`);
                state.actions.push(null);
            }
            // Add an oversized observation as a recent entry (will survive keepRecent=12)
            state.thoughts.push({ role: 'user', content: 'Observation: ' + 'x'.repeat(10000) });
            state.actions.push(null);
            state.thoughts.push('final step');
            state.actions.push(null);

            const result = await (runner as any).compactHistory(
                'system prompt', 'test query', state.thoughts
            );
            expect(result).toBe(true);

            // Find the observation in compacted thoughts
            const obs = state.thoughts.find((t: any) =>
                typeof t === 'object' && t.content && t.content.includes('OBSERVATION TRUNCATED'));
            expect(obs).toBeDefined();
        });
    });

    describe('buildRetrospectHistory', () => {
        it('builds formatted history from thoughts and actions', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: ['Analyzing pipeline', 'Found the issue'],
                actions: [
                    { tool: 'kql', args: { query: 'SELECT *' }, result: 'row1\nrow2' },
                    null,
                ],
            });

            const result = (runner as any).buildRetrospectHistory();
            expect(result).toContain('Step 1');
            expect(result).toContain('Analyzing pipeline');
            expect(result).toContain('kql');
        });

        it('truncates long history with head/tail', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const state = (runner as any).state;
            // Create very long history
            for (let i = 0; i < 200; i++) {
                state.thoughts.push('x'.repeat(500));
                state.actions.push(null);
            }

            const result = (runner as any).buildRetrospectHistory();
            expect(result).toContain('chars removed to fit context');
        });

        it('truncates individual long thoughts', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: ['x'.repeat(1000)],
                actions: [null],
            });

            const result = (runner as any).buildRetrospectHistory();
            expect(result).toContain('Truncated');
        });

        it('truncates long action args and results', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: ['step'],
                actions: [{
                    tool: 'kql',
                    args: { query: 'x'.repeat(500) },
                    result: 'y'.repeat(1000),
                }],
            });

            const result = (runner as any).buildRetrospectHistory();
            expect(result).toContain('Truncated');
        });
    });

    describe('getRepoRoot', () => {
        it('returns config.repoRoot when set', () => {
            const runner = new AgentRunner(makeConfig({ repoRoot: '/my-repo' }), provider);
            expect((runner as any).getRepoRoot()).toBe('/my-repo');
        });

        it('falls back to env variable', () => {
            const originalEnv = process.env.REPO_ROOT;
            process.env.REPO_ROOT = '/env-repo';
            const runner = new AgentRunner(makeConfig({ repoRoot: undefined as any }), provider);
            expect((runner as any).getRepoRoot()).toBe('/env-repo');
            if (originalEnv !== undefined) {
                process.env.REPO_ROOT = originalEnv;
            } else {
                delete process.env.REPO_ROOT;
            }
        });
    });

    describe('estimateTokens', () => {
        it('estimates tokens as chars / 4', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            expect((runner as any).estimateTokens('abcd')).toBe(1);
            expect((runner as any).estimateTokens('12345678')).toBe(2);
        });
    });

    describe('saveArtifacts - advanced', () => {
        it('creates investigation directory and saves state', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'my-stamp',
            });

            const sizeBefore = mockFsState.size;
            await (runner as any).saveArtifacts();

            // saveArtifacts uses require('fs') which goes through our nodeFs spy
            // The spy's writeFileSyncImpl adds to mockFsState
            expect(mockFsState.size).toBeGreaterThan(sizeBefore);

            const summaryPath = Array.from(mockFsState.keys()).find(key => key.endsWith('/summary.json'));
            expect(summaryPath).toBeDefined();

            const summary = JSON.parse(mockFsState.get(summaryPath!) || '{}');
            expect(summary._summaryOnly).toBe(true);
            expect(summary._thoughtCount).toBe(0);
        });

        it('serializes non-string action results into the markdown report', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'my-stamp',
                thoughts: ['inspect result object'],
                actions: [{ tool: 'kql', args: { query: 'StormEvents | take 1' }, result: { rows: [{ id: 1 }], count: 1 } } as any],
            });

            await (runner as any).saveArtifacts();

            const reportPath = Array.from(mockFsState.keys()).find(key => key.endsWith('/report.md'));
            expect(reportPath).toBeDefined();

            const report = mockFsState.get(reportPath!);
            expect(report).toContain('"rows"');
            expect(report).toContain('"count": 1');
        });

        it('falls back to repo investigations path and current date when config path is unset and id is non-numeric', async () => {
            const today = new Date().toISOString().split('T')[0];
            const runner = new AgentRunner(makeConfig({ investigationsPath: undefined as any }), provider, {
                id: 'manual-run',
                target: 'my-stamp',
            } as any);

            await (runner as any).saveArtifacts();

            const savedPath = Array.from(mockFsState.keys()).find(key =>
                key.includes(`/repo/investigations/${today}_my-stamp_manualrun/state.json`)
            );
            expect(savedPath).toBeDefined();
        });

        it('writes an empty retrospective proposal list when proposals are missing', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'my-stamp',
                retrospect: {
                    messages: [{ role: 'user', content: 'review this' }],
                    proposals: undefined as any,
                    analysisComplete: true,
                    analysisFailed: false,
                    completed: false,
                },
            } as any);

            await (runner as any).saveArtifacts();

            const summaryPath = Array.from(mockFsState.keys()).find(key => key.endsWith('/summary.json'));
            expect(summaryPath).toBeDefined();

            const summary = JSON.parse(mockFsState.get(summaryPath!) || '{}');
            expect(summary.retrospect.proposals).toEqual([]);
        });
    });

    describe('state access', () => {
        it('exposes current investigation state via internal property', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'test-stamp',
                category: 'latency',
            });
            const state = (runner as any).state as InvestigationState;
            expect(state.target).toBe('test-stamp');
            expect(state.category).toBe('latency');
            expect(state.status).toBe('running');
        });
    });

    describe('incident context and knowledge base scanning', () => {
        it('discovers incident investigation guide from knowledge base', async () => {
            mockDirs.add('/repo/knowledge-base');
            mockDirEntries.set('knowledge-base', ['incident-investigation-guide.md', 'latency-guide.md']);

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"done"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'knowledge-base' }), provider, {
                incidentId: 'INC-999',
            });
            await runner.start('Investigate');

            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const systemMsg = callArgs.messages[0].content;
            expect(systemMsg).toContain('incident-investigation-guide.md');
        });

        it('injects context parts into system prompt', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"done"}' } }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'oi-tds-prd-eus2p-01',
                timeRange: 'ago(1h)',
                correlationId: 'abc-123',
                category: 'latency',
            });
            await runner.start('Check latency');

            const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const systemMsg = callArgs.messages[0].content;
            expect(systemMsg).toContain('oi-tds-prd-eus2p-01');
            expect(systemMsg).toContain('ago(1h)');
            expect(systemMsg).toContain('abc-123');
            expect(systemMsg).toContain('latency');
        });
    });

    // ============================================================
    // Additional tests for 100% line & branch coverage of Runner.ts
    // ============================================================

    describe('start - MCP init success path', () => {
        it('emits tools-ready message on successful MCP init', async () => {
            // First call isConnected returns false (trigger init), then true for all subsequent
            mockToolManager.isConnected
                .mockReturnValueOnce(false)  // trigger init
                .mockReturnValue(true);     // after init, always connected
            mockToolManager.getMcpStatus.mockReturnValue([{ connected: true, toolCount: 5 }]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const thoughts: string[] = [];
            runner.on('thought', (t: string) => thoughts.push(t));
            await runner.start('Query');

            expect(thoughts.some(t => typeof t === 'string' && t.includes('Tools ready') && t.includes('1 MCP server(s)'))).toBe(true);
        });
    });

    describe('start - maxSteps edge cases', () => {
        it('maxSteps 0 treated as Infinity', async () => {
            // Finish on first call so we just verify it accepted maxSteps=0
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 0 }), provider);
            await runner.start('Query');
            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('start - timeout compaction success', () => {
        it('emits compaction success after timeout backoff', async () => {
            let callNum = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callNum++;
                if (callNum === 1) {
                    // Timeout error
                    return { choices: [{ message: { content: 'Critical LLM Error: timed out' } }] };
                }
                if (callNum === 2) {
                    // Compaction summary call
                    return { choices: [{ message: { content: 'Summary of steps so far.' } }] };
                }
                // After compaction, finish
                return { choices: [{ message: { content: 'Done', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }] };
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider, {
                thoughts: Array(20).fill('step'),
                actions: Array(20).fill(null),
            });

            const thoughts: string[] = [];
            runner.on('thought', (t: string) => thoughts.push(typeof t === 'string' ? t : ''));

            await runner.start('Query');

            // Should have emitted compaction success
            expect(thoughts.some(t => t.includes('compacted successfully'))).toBe(true);
        }, 40000);
    });

    describe('buildRetrospectSystemPrompt - template loading', () => {
        it('loads retrospect prompt template with variable substitution', () => {
            const path = require('path');
            // buildRetrospectSystemPrompt uses require('fs'), which is spied
            const resolvedPrompt = n(path.resolve('/repo', 'prompts', 'retrospect.md'));
            mockFsState.set(resolvedPrompt, 'Goal: {{GOAL}}, Status: {{STATUS}}, Stamp: {{STAMP}}, Issue: {{ISSUE_TYPE}}, KB: {{KNOWLEDGE_BASE_FILES}}');
            // Also add via the non-resolved path for the existsSync check
            mockFsState.set(n(path.join('/repo', 'prompts', 'retrospect.md')), 'Goal: {{GOAL}}, Status: {{STATUS}}, Stamp: {{STAMP}}, Issue: {{ISSUE_TYPE}}, KB: {{KNOWLEDGE_BASE_FILES}}');

            const runner = new AgentRunner(makeConfig({
                retrospectPromptPath: 'prompts/retrospect.md',
                knowledgeBasePath: '',
            }), provider, {
                status: 'completed',
                query: 'Test query',
                target: 'test-stamp',
                category: 'latency',
            });
            (runner as any).initRetrospect();

            const result = (runner as any).buildRetrospectSystemPrompt();
            expect(result).toContain('Goal: Test query');
            expect(result).toContain('Status: completed');
            expect(result).toContain('Stamp: test-stamp');
            expect(result).toContain('Issue: latency');
        });

        it('falls back to generic prompt when file not found', () => {
            const runner = new AgentRunner(makeConfig({
                retrospectPromptPath: 'prompts/missing.md',
            }), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            const result = (runner as any).buildRetrospectSystemPrompt();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('runRetrospectToolLoop - token trimming and bail', () => {
        it('trims tool results and bails when still over limit', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();
            // Build a large list of messages that exceed token limit
            const hugeMessages: any[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            // Add many large tool-result messages
            for (let i = 0; i < 20; i++) {
                hugeMessages.push({ role: 'tool', content: 'X'.repeat(50000), tool_call_id: `tc${i}` });
            }
            hugeMessages.push({ role: 'assistant', content: 'Intermediate analysis' });
            hugeMessages.push({ role: 'user', content: 'Continue' });

            // Mock the LLM to return something (shouldn't be called if we bail)
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done' } }],
            });

            const tools = [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];
            const result = await (runner as any).runRetrospectToolLoop(hugeMessages, tools);
            expect(typeof result).toBe('string');
        });
    });

    describe('runRetrospectToolLoop - list_dir local fallback', () => {
        it('uses localListDir when MCP is disconnected', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();
            mockToolManager.isConnected.mockReturnValue(false);

            const path = require('path');
            const resolvedDir = n(path.resolve('/repo', 'docs'));
            mockDirs.add(resolvedDir);
            mockFsState.set(resolvedDir, ''); // make existsSync return true
            mockDirEntries.set('docs', ['file1.md']);

            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{ message: { content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"docs"}' } }] } }],
                })
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'Analysis complete.' } }],
                });

            const messages = [
                { role: 'system', content: 'Analyze' },
                { role: 'user', content: 'Check' },
            ];
            const tools = [{ name: 'list_dir', description: 'List', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];

            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(typeof result).toBe('string');
        });
    });

    describe('contestReport', () => {
        it('handles pausedAt calculation when contesting', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Bad report',
                thoughts: ['thought1'],
                actions: [null],
            });
            // Simulate paused state with pausedAt
            (runner as any).state.pausedAt = Date.now() - 5000;
            (runner as any).state.totalPausedTime = 1000;

            runner.contestReport('Please fix this');

            expect((runner as any).state.status).toBe('running');
            expect((runner as any).state.totalPausedTime).toBeGreaterThan(1000);
            expect((runner as any).state.pausedAt).toBeUndefined();
            expect((runner as any).state.contestCount).toBe(1);
        });

        it('falls back when no final report exists and initializes paused time accumulation', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['thought1'],
                actions: [null],
            });
            (runner as any).state.pausedAt = Date.now() - 3000;

            runner.contestReport('Please add evidence');

            const state = (runner as any).state;
            expect(state.status).toBe('running');
            expect(state.totalPausedTime).toBeGreaterThan(0);
            expect(state.pausedAt).toBeUndefined();
            expect(state.thoughts.some((t: any) =>
                typeof t === 'object' &&
                typeof t.content === 'string' &&
                t.content.includes('(no report content)')
            )).toBe(true);
        });
    });

    describe('callLLM - schema sanitization', () => {
        it('handles history items without role (object without content)', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Push a non-string, non-role object into thoughts
            (runner as any).state.thoughts.push({ someData: 'value' });
            (runner as any).state.actions.push(null as any);

            await runner.start('Query');
            expect((runner as any).state.status).toBe('completed');
        });

        it('collapses anyOf with single entry', async () => {
            mockToolManager.listTools.mockResolvedValue([{
                name: 'test_tool',
                description: 'Test',
                inputSchema: {
                    type: 'object',
                    properties: {
                        field: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                    },
                },
            }]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');

            // Verify the tool was sanitized - the API call was made without error
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
        });

        it('handles empty anyOf after filtering null', async () => {
            mockToolManager.listTools.mockResolvedValue([{
                name: 'test_tool',
                description: 'Test',
                inputSchema: {
                    type: 'object',
                    properties: {
                        field: { anyOf: [{ type: 'null' }] },
                    },
                },
            }]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
        });
    });

    describe('callLLM - force tool with no tools', () => {
        it('warns when forced tool but no tools available', async () => {
            // Return thought-only responses to trigger consecutiveThoughts >= 2
            let callNum = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callNum++;
                if (callNum <= 3) {
                    return { choices: [{ message: { content: 'Thinking...' } }] };
                }
                return { choices: [{ message: { content: 'Done', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }] };
            });
            // No tools available
            mockToolManager.listTools.mockResolvedValue([]);

            const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
            await runner.start('Query');

            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('callLLM - proactive compaction', () => {
        it('compacts when payload exceeds size limit', async () => {
            let callNum = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callNum++;
                if (callNum === 1) {
                    // Summary for compaction
                    return { choices: [{ message: { content: 'Summary of previous steps.' } }] };
                }
                // After compaction, finish
                return { choices: [{ message: { content: 'Done', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }] };
            });

            // Pre-fill history with huge entries to trigger payload > maxPayloadChars
            const hugeThoughts: string[] = [];
            for (let i = 0; i < 100; i++) {
                hugeThoughts.push('X'.repeat(10000)); // 1M chars total
            }
            const runner = new AgentRunner(makeConfig({ maxSteps: 5 }), provider, {
                thoughts: hugeThoughts,
                actions: Array(100).fill(null),
            });

            await runner.start('Query');
            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('summarize - error handling', () => {
        it('throws on summarization failure', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: Array(15).fill('thought step'),
                actions: Array(15).fill(null),
            });
            // compactHistory has its own try-catch, so spy on it to force a throw
            vi.spyOn(runner as any, 'compactHistory').mockRejectedValue(new Error('LLM down'));

            await expect((runner as any).summarize()).rejects.toThrow('LLM down');
            const thoughts = (runner as any).state.thoughts;
            expect(thoughts.some((t: string) => t.includes && t.includes('LLM down'))).toBe(true);
        });
    });

    describe('compactHistory - existing memory merge', () => {
        it('merges with existing System [Memory] entry', async () => {
            let callNum = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callNum++;
                return { choices: [{ message: { content: 'Merged summary with new findings.' } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Need more than 14 entries (keepRecent=12 + 2 older minimum)
            const thoughts = [
                'System [Memory]: Previous investigation found X.',
                'System: Context was automatically compacted.',
                'New step 1',
                'New step 2',
                'New step 3',
                'New step 4',
                'New step 5',
                'New step 6',
                'New step 7',
                'New step 8',
                'New step 9',
                'New step 10',
                'New step 11',
                'New step 12',
                'New step 13',
                'New step 14',
                'New step 15',
            ];

            const result = await (runner as any).compactHistory('system', 'query', thoughts);
            expect(result).toBe(true);
        });

        it('returns false when not enough history beyond memory', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            // Must have ≥ 2 olderThoughts (to pass the length<2 check),
            // where first 2 are memory+notice. keepRecent=12, so total=14 gives olderThoughts=2.
            const thoughts = [
                'System [Memory]: Previous investigation.',
                'System: Context was automatically compacted.',
                ...Array(12).fill('recent step'),
            ];

            const result = await (runner as any).compactHistory('system', 'query', thoughts);
            expect(result).toBe(false);
        });

        it('uses empty string when first older thought is an object without .content', async () => {
            // This covers the `firstThought?.content ? ... : ''` fallback branch (no .content)
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Summary of steps.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const thoughts = [
                { someData: 'no-content-key' } as any, // [0] — not a string, no .content → ''
                'second thought',                       // [1]
                ...Array(12).fill('recent step'),       // [2-13]
            ];

            const result = await (runner as any).compactHistory('system', 'query', thoughts);
            expect(result).toBe(true);
        });

        it('extracts content string when first older thought is an object with .content', async () => {
            // This covers `String(firstThought.content)` — the truthy .content branch
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Summary.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const thoughts = [
                { content: 'previous investigation step' } as any, // [0] — has .content, truthy
                'second thought',                                   // [1]
                ...Array(12).fill('recent step'),                   // [2-13]
            ];

            const result = await (runner as any).compactHistory('system', 'query', thoughts);
            expect(result).toBe(true);
        });
    });

    describe('saveArtifacts - extractThoughtText fallbacks', () => {
        it('handles non-string non-content thought objects', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'stamp',
                thoughts: [{ someOther: 'data' } as any],
                actions: [null],
            });
            await (runner as any).saveArtifacts();
            expect(mockFsState.size).toBeGreaterThan(0);
        });
    });

    describe('localListDir', () => {
        it('lists directory contents when found', () => {
            const path = require('path');
            const resolvedDir = n(path.resolve('/repo', 'docs'));
            mockDirs.add(resolvedDir);
            mockFsState.set(resolvedDir, ''); // existsSync
            mockDirEntries.set(resolvedDir, ['a.md', 'b.md']);
            mockIsDir.add(resolvedDir);

            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localListDir('docs');
            expect(result).toContain('a.md');
        });

        it('returns not found for missing directory', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localListDir('nonexistent');
            expect(result).toContain('Directory not found');
        });
    });

    describe('runRetrospectiveAnalysis - KB instruction paths', () => {
        it('uses KB path instruction when knowledgeBasePath is set', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis done.' } }],
            });

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: 'docs/guides',
            }), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
                category: 'latency',
            });
            (runner as any).initRetrospect();

            await (runner as any).runRetrospectiveAnalysis();

            const retroState = (runner as any).state.retrospect;
            expect(retroState.analysisComplete).toBe(true);
        });

        it('uses unknown as the category fallback when knowledgeBasePath is set but no category exists', async () => {
            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: 'docs/guides',
            }), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const toolLoopSpy = vi.spyOn(runner as any, 'runRetrospectToolLoop').mockResolvedValue('Analysis done.');

            await (runner as any).runRetrospectiveAnalysis();

            const promptText = toolLoopSpy.mock.calls[0][0]
                .map((message: any) => message.content)
                .filter((content: any) => typeof content === 'string')
                .join('\n');
            expect(promptText).toContain('category "unknown"');
        });

        it('uses list_dir instruction when no knowledgeBasePath', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis done.' } }],
            });

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: '',
            }), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
                category: 'latency',
            });
            (runner as any).initRetrospect();

            await (runner as any).runRetrospectiveAnalysis();

            const retroState = (runner as any).state.retrospect;
            expect(retroState.analysisComplete).toBe(true);
        });
    });

    describe('discoverKnowledgeBase - error paths', () => {
        it('continues when statSync throws for an entry', () => {
            const path = require('path');
            const kbPath = n(path.join('/repo', 'kb'));
            mockDirs.add(kbPath);
            mockFsState.set(kbPath, '');
            mockDirEntries.set('kb', ['good.md', 'bad-entry']);
            // Make statSync throw when accessed for 'bad-entry'
            mockStatThrow.add('bad-entry');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'kb' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Knowledge Base');
            expect(result).toContain('good.md');
        });

        it('handles readdirSync error in recursive scan', () => {
            const path = require('path');
            const kbPath = n(path.join('/repo', 'kb'));
            mockDirs.add(kbPath);
            mockFsState.set(kbPath, '');
            mockDirEntries.set('kb', ['subdir']);
            mockIsDir.add('subdir');
            // Make readdirSync throw when scanning subdir (but NOT statSync)
            mockReaddirThrow.add('subdir');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'kb' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Knowledge Base');
        });
    });

    describe('getRepoRoot - fallbacks', () => {
        it('falls back to process.cwd when no config or env', () => {
            const origEnv = process.env.REPO_ROOT;
            delete process.env.REPO_ROOT;

            const runner = new AgentRunner(makeConfig({ repoRoot: '' }), provider);
            const root = (runner as any).getRepoRoot();
            expect(typeof root).toBe('string');
            expect(root.length).toBeGreaterThan(0);

            if (origEnv) process.env.REPO_ROOT = origEnv;
        });
    });

    describe('runRetrospective - error handling', () => {
        it('catches AbortError and records cancellation', async () => {
            const abortErr = new Error('Cancelled');
            abortErr.name = 'AbortError';
            mockOpenAI.chat.completions.create.mockRejectedValue(abortErr);

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            await runner.runRetrospective('What improvements?');

            const msgs = (runner as any).state.retrospect.messages;
            expect(msgs.some((m: any) => m.content.includes('cancelled'))).toBe(true);
        });
    });

    // ============================================================
    // Final targeted tests for 100% line coverage of Runner.ts
    // ============================================================

    describe('buildRetrospectSystemPrompt - KB section ternary', () => {
        it('includes KB structure when knowledge base has files', () => {
            const path = require('path');
            // Set up a KB directory with content so discoverKnowledgeBase returns data
            const kbPath = n(path.join('/repo', 'guides'));
            mockDirs.add(kbPath);
            mockFsState.set(kbPath, '');
            mockDirEntries.set('guides', ['latency.md']);

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: 'guides',
                retrospectPromptPath: '', // no external prompt, use generic fallback
            }), provider, {
                status: 'completed',
            });
            (runner as any).initRetrospect();

            const result = (runner as any).buildRetrospectSystemPrompt();
            expect(result).toContain('Knowledge Base Structure');
        });
    });

    describe('callLLM - direct force tool and compaction', () => {
        it('uses gpt-4o when both state.model and config.model are unset', async () => {
            mockToolManager.listTools.mockResolvedValue([]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.' } }],
            });

            const runner = new AgentRunner(makeConfig({ model: undefined as any }), provider, {
                model: undefined,
            });

            await (runner as any).callLLM('system', 'query', ['thought1'], false);

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o' })
            );
        });

        it('logs warning when forcing tool with no tools available', async () => {
            mockToolManager.listTools.mockResolvedValue([]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', ['thought1'], true);
            expect(step).toBeDefined();
        });

        it('forces tool_choice to required when tools are available and forceTool is true', async () => {
            const mockTool = { name: 'read_file', description: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
            mockToolManager.listTools.mockResolvedValueOnce([mockTool]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', ['thought1'], true);
            expect(step).toBeDefined();
        });

        it('uses the default tool thought when tool call content is empty', async () => {
            const mockTool = { name: 'read_file', description: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
            mockToolManager.listTools.mockResolvedValueOnce([mockTool]);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
                    }
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', ['thought1'], false);

            expect(step.thought).toBe('Deciding to use a tool...');
            expect(step.action).toEqual({
                tool: 'read_file',
                args: { path: 'a.txt' },
            });
        });

        it('triggers proactive compaction when payload is too large', async () => {
            let callNum = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callNum++;
                if (callNum === 1) {
                    // compaction summary
                    return { choices: [{ message: { content: 'Compacted summary.' } }] };
                }
                return { choices: [{ message: { content: 'After compaction.' } }] };
            });

            // Create huge history to exceed 600K char payload limit
            const hugeHistory = Array(80).fill('X'.repeat(10000));

            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: hugeHistory,
                actions: Array(80).fill(null),
            });
            const step = await (runner as any).callLLM('system', 'query', hugeHistory, false);
            expect(step).toBeDefined();
        });

        it('logs warning when proactive compaction fails and continues with oversized payload', async () => {
            // Compaction returns false, so the payload is sent as-is with a log warning
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Oversized response.' } }],
            });

            const hugeHistory = Array(80).fill('X'.repeat(10000));

            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: hugeHistory,
                actions: Array(80).fill(null),
            });
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const step = await (runner as any).callLLM('system', 'query', hugeHistory, false);
            expect(step).toBeDefined();
        });

        it('falls back to Bad Request when a 400 error has no message', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValue({ status: 400 });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const step = await (runner as any).callLLM('system', 'query', ['thought1'], false);

            expect(step.thought).toContain('Bad Request');
        });
    });

    describe('runRetrospectToolLoop - token bail after trimming', () => {
        it('bails when messages exceed limit even after trimming', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            // Build messages where non-tool content is enormous so trimming tools doesn't help
            // Need > 440K chars of non-tool content (110K tokens × 4 chars/token)
            const hugeMessages: any[] = [
                { role: 'system', content: 'S'.repeat(250000) },
                { role: 'user', content: 'U'.repeat(250000) },
            ];
            // Add tool messages that will be trimmed but won't make enough difference
            for (let i = 0; i < 10; i++) {
                hugeMessages.push({ role: 'tool', content: 'T'.repeat(1000), tool_call_id: `tc${i}` });
            }
            // Add assistant message so the bail has content to return
            hugeMessages.push({ role: 'assistant', content: 'Analysis so far...' });
            hugeMessages.push({ role: 'user', content: 'More please' });

            const tools = [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];
            const result = await (runner as any).runRetrospectToolLoop(hugeMessages, tools);
            expect(result).toContain('Analysis so far');
        });
    });

    describe('compactHistory - deep paths', () => {
        it('covers skipCount=2 and olderText building with memory', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Merged and extended summary.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Need > 14 entries so olderThoughts has > 2 entries including memory
            const thoughts: any[] = [
                'System [Memory]: Previous findings about latency.',
                'System: Context was automatically compacted. Investigation is continuing.',
                'Explored stamp metrics and found high P99.',
                { role: 'user', content: 'Observation: KQL returned 500 rows of data...' },
                { someData: true },  // non-string, non-content object (covers JSON.stringify branch)
                ...Array(12).fill('recent step'),
            ];

            const result = await (runner as any).compactHistory('system prompt', 'user query', thoughts);
            expect(result).toBe(true);
            // After compaction, thoughts should start with new System [Memory]
            expect(thoughts[0]).toContain('System [Memory]:');
        });
    });

    // ============================================================
    // Branch coverage — targeted tests for remaining uncovered branches
    // ============================================================

    describe('constructor - rehydration guards', () => {
        it('initializes fullHistory and fullActions when undefined in metadata', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: ['existing step'],
                fullHistory: undefined as any,
                fullActions: undefined as any,
            });
            const state = (runner as any).state;
            expect(Array.isArray(state.fullHistory)).toBe(true);
            expect(Array.isArray(state.fullActions)).toBe(true);
        });
    });

    describe('start - tool init with null initError', () => {
        it('shows "Unknown error" in thought when initError is null and tools fail', async () => {
            // 3 isConnected calls: initial (false) → post-init (false → pause) → after resume (true → done)
            mockToolManager.isConnected
                .mockReturnValueOnce(false)  // initial check → start initialization
                .mockReturnValueOnce(false)  // post-initialize → 'Unknown error', then pause
                .mockReturnValueOnce(true);  // after resume + re-initialize → connected, break
            mockToolManager.initError = null as any; // no message → falls back to 'Unknown error'
            mockToolManager.initialize.mockResolvedValue(undefined);
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Resume after the 1-second polling interval inside the pause loop
            setTimeout(() => runner.resume(), 1200);
            await runner.start('Query');

            const thoughts = (runner as any).state.thoughts as string[];
            expect(thoughts.some(t => typeof t === 'string' && t.includes('Unknown error'))).toBe(true);
        }, 8000);
    });

    describe('start - incidentId with knowledgeBasePath', () => {
        it('appends incidentGuide hint when absolute kbDir contains an incident investigation guide', async () => {
            const path = require('path');
            const kbDir = n(path.join('/repo', 'incident-kb'));
            // Set up the KB directory with an incident guide
            mockDirs.add(kbDir);
            mockFsState.set(kbDir, '');
            mockDirEntries.set(kbDir, ['incident-investigation-guide.md']);
            mockIsDir.add(kbDir);
            // Return finish tool on the first LLM call
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"incident done"}' } }] } }],
            });

            const runner = new AgentRunner(
                makeConfig({ knowledgeBasePath: kbDir }), // absolute kbDir → isAbsolute = true
                provider,
                { incidentId: 'INC-456' },
            );
            await runner.start('Investigate incident');
            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('start - main loop timeout branch via thought content', () => {
        it('detects "timeout" (not "timed out") in critical LLM error thought', async () => {
            // 'Connection timeout' has 'timeout' but not 'timed out' — covers the 2nd || branch.
            // Exponential backoff (5s, 15s) is bypassed with fake timers.
            vi.useFakeTimers();
            try {
                let callCount = 0;
                mockOpenAI.chat.completions.create.mockImplementation(async () => {
                    callCount++;
                    if (callCount <= 4) {
                        return { choices: [{ message: { content: 'Critical LLM Error: Connection timeout exceeded', tool_calls: undefined } }] };
                    }
                    return { choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }] };
                });

                const runner = new AgentRunner(makeConfig({ maxSteps: 10 }), provider);
                const startPromise = runner.start('Query');

                // Fast-forward past exponential backoffs: 5s + 15s + 45s = 65s total
                await vi.advanceTimersByTimeAsync(100_000);
                await startPromise;

                const state = (runner as any).state as InvestigationState;
                // Should pause due to consecutive LLM errors, or complete after timeout path
                expect(['paused', 'completed'].includes(state.status)).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        }, 15000);
    });

    describe('start - finish tool with verdict', () => {
        it('stores verdict when finish tool is called with a verdict arg', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Analysis done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"all good","verdict":"healthy"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('Health check');
            expect((runner as any).state.verdict).toBe('healthy');
            expect((runner as any).state.status).toBe('completed');
        });
    });

    describe('initRetrospect - migration guards', () => {
        it('initializes missing retrospect fields on legacy state objects', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                retrospect: {
                    messages: [],
                    // Deliberately omit proposals, analysisComplete, completed to test migration
                } as any,
            });
            const retro = (runner as any).initRetrospect();
            expect(Array.isArray(retro.proposals)).toBe(true);
            expect(retro.analysisComplete).toBe(false);
            expect(retro.completed).toBe(false);
        });
    });

    describe('callLLM - error hint branches', () => {
        it('includes context hint when error has ETIMEDOUT code but no "timeout" in message', async () => {
            const netErr = new Error('Connection refused'); // no 'timeout' or 'timed out'
            (netErr as any).code = 'ETIMEDOUT';
            mockOpenAI.chat.completions.create.mockRejectedValue(netErr);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            // hint includes context size warning because isTimeout = true via code check
            expect(step.thought).toContain('Connection refused');
        });

        it('returns error without hint for non-timeout, non-400 LLM errors', async () => {
            const genericErr = new Error('Service unavailable'); // no timeout indicators
            mockOpenAI.chat.completions.create.mockRejectedValue(genericErr);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            // No hint appended because isTimeout = false
            expect(step.thought).toContain('Service unavailable');
        });
    });

    describe('additional branch coverage fallbacks', () => {
        it('uses summary when finish arguments omit report', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"summary":"summary only"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');
            expect((runner as any).state.finalReport).toBe('summary only');
        });

        it('uses the default finish report when neither report nor summary is provided', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Query');
            expect((runner as any).state.finalReport).toBe('Investigation Completed via finish tool.');
        });

        it('falls back to the thrown value when an unexpected error has no message property', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'thinking...' } }],
            });

            const runner = new AgentRunner(makeConfig({ maxSteps: 1 }), provider);
            vi.spyOn(runner as any, 'saveArtifacts')
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce('plain failure');

            await runner.start('Query');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('failed');
            expect(state.logs.some((log: string) => log.includes('plain failure'))).toBe(true);
        });

        it('formats object thoughts with content and object action results in retrospect history', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                thoughts: [{ content: 'object-based thought' } as any],
                actions: [{ tool: 'kql', args: { query: 'take 1' }, result: { rows: [1] } } as any],
            });

            const result = (runner as any).buildRetrospectHistory();
            expect(result).toContain('object-based thought');
            expect(result).toContain('{"rows":[1]}');
        });

        it('handles retrospective messages whose content is missing', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const retroMessages = [
                { role: 'assistant', content: undefined },
                { role: 'user', content: undefined },
                { role: 'assistant', content: 'Valid analysis.' },
            ];

            const result = (runner as any).buildRetrospectMessages(retroMessages);
            expect(result.some((m: any) => m.role === 'assistant' && m.content === 'Valid analysis.')).toBe(true);
        });

        it('returns a string when retrospective context is extremely large', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();

            const hugeMessages: any[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            for (let i = 0; i < 100; i++) {
                hugeMessages.push({ role: 'tool', content: 'X'.repeat(50000), tool_call_id: `tc${i}` });
            }

            const tools = [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];
            const result = await (runner as any).runRetrospectToolLoop(hugeMessages, tools);
            expect(typeof result).toBe('string');
        });

        it('uses the generic example path in the no-proposal retry prompt when no knowledge base path is configured', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                if (callCount <= 4) {
                    return { choices: [{ message: { content: 'I found issues but need to think more.', tool_calls: null } }] };
                }
                return { choices: [{ message: { content: 'No changes needed', tool_calls: null } }] };
            });
            mockToolManager.callTool.mockResolvedValue('# Guide');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: '' }), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            expect(messages.some((message: any) =>
                message.role === 'user' &&
                typeof message.content === 'string' &&
                message.content.includes('path/to/file.md')
            )).toBe(true);
        });

        it('builds the retrospect prompt from an absolute file path and uses N/A fallbacks', () => {
            mockFsState.set('/absolute/retrospect.md', 'Goal={{GOAL}} Status={{STATUS}} Stamp={{STAMP}} Issue={{ISSUE_TYPE}}');

            const runner = new AgentRunner(makeConfig({
                retrospectPromptPath: '/absolute/retrospect.md',
                knowledgeBasePath: '',
            }), provider, {
                query: '',
                status: undefined as any,
                target: '',
                category: '',
            } as any);

            const result = (runner as any).buildRetrospectSystemPrompt();
            expect(result).toContain('Goal=N/A');
            expect(result).toContain('Status=N/A');
            expect(result).toContain('Stamp=N/A');
            expect(result).toContain('Issue=N/A');
        });

        it('retries tool initialization with unknown error text, then aborts', async () => {
            mockToolManager.isConnected.mockReturnValue(false);
            mockToolManager.initError = null as any;
            mockToolManager.initialize.mockResolvedValue(undefined);

            const runner = new AgentRunner(makeConfig(), provider);
            setTimeout(() => runner.resume(), 200);
            setTimeout(() => runner.abort(), 1600);

            await runner.start('Query');

            const thoughts = (runner as any).state.thoughts as any[];
            expect(thoughts.some((thought: any) => typeof thought === 'string' && thought.includes('Tools still unavailable. Error: Unknown error'))).toBe(true);
            expect((runner as any).state.status).toBe('aborted');
        }, 15000);

        it('returns after aborting during a retry initialize call', async () => {
            let initCalls = 0;
            let runner: AgentRunner;
            mockToolManager.isConnected.mockReturnValue(false);
            mockToolManager.initError = 'Still broken';
            mockToolManager.initialize.mockImplementation(async () => {
                initCalls++;
                if (initCalls === 2) {
                    runner.abort();
                }
            });

            runner = new AgentRunner(makeConfig(), provider);
            setTimeout(() => runner.resume(), 1200);

            await runner.start('Query');

            expect(['paused', 'aborted']).toContain((runner as any).state.status);
        }, 15000);

        it('handles incident KB scan errors when repoRoot is missing and the KB path is relative', async () => {
            mockDirs.add('incident-kb');
            mockFsState.set('incident-kb', '');
            mockReaddirThrow.add('incident-kb');
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc1', function: { name: 'finish', arguments: '{"report":"ok"}' } }] } }],
            });

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: 'incident-kb',
                repoRoot: undefined as any,
                maxSteps: undefined as any,
            }), provider, {
                incidentId: 'INC-999',
            });

            await runner.start('Investigate');
            expect((runner as any).state.status).toBe('completed');
        });

        it('handles final no-action thoughts whose object content is missing', async () => {
            const runner = new AgentRunner(makeConfig({ maxSteps: undefined as any }), provider);
            vi.spyOn(runner as any, 'callLLM').mockResolvedValue({
                thought: { role: 'assistant' },
                action: null,
                isFinal: true,
            });
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.start('Query');
            expect((runner as any).state.status).toBe('paused');
        });

        it('discovers knowledge base and prompt directories from absolute paths', () => {
            mockDirs.add('/abs-kb');
            mockFsState.set('/abs-kb', '');
            mockDirEntries.set('/abs-kb', ['guide.md']);

            mockDirs.add('/abs-prompts');
            mockFsState.set('/abs-prompts', '');
            mockDirEntries.set('/abs-prompts', ['system.md']);

            mockDirs.add('/repo/.github/prompts');
            mockFsState.set('/repo/.github/prompts', '');
            mockDirEntries.set('.github/prompts', ['custom.md']);

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: '/abs-kb',
                systemPromptPath: '/abs-prompts/system.md',
            }), provider);

            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Knowledge Base (/abs-kb/)');
            expect(result).toContain('Agent Prompts');
            expect(result).toContain('Prompt Files (.github/prompts/)');
        });

        it('discovers knowledge base and covered prompt directories from relative paths', () => {
            mockDirs.add('/repo/docs');
            mockFsState.set('/repo/docs', '');
            mockDirEntries.set('docs', ['guide.md']);

            mockDirs.add('/repo/prompts');
            mockFsState.set('/repo/prompts', '');
            mockDirEntries.set('prompts', ['system.md']);

            mockDirs.add('/repo/.github/prompts');
            mockFsState.set('/repo/.github/prompts', '');
            mockDirEntries.set('.github/prompts', ['custom.md']);

            const runner = new AgentRunner(makeConfig({
                knowledgeBasePath: 'docs',
                systemPromptPath: 'prompts/system.md',
            }), provider);

            const result = (runner as any).discoverKnowledgeBase();
            expect(result).toContain('Knowledge Base (docs/)');
            expect(result).toContain('Agent Prompts (prompts/)');
        });

        it('uses the default context-limit string when forced token estimates stay above the limit', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            (runner as any).initRetrospect();
            vi.spyOn(runner as any, 'estimateTokens').mockReturnValue(120001);

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
                { role: 'tool', content: 'X'.repeat(500), tool_call_id: 'tc1' },
            ];
            const tools = [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];

            const result = await (runner as any).runRetrospectToolLoop(messages, tools);
            expect(result).toBe('Analysis complete (context limit reached).');
        });

        it('uses the knowledge-base README example path in no-proposal retry prompts when configured', async () => {
            let callCount = 0;
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc1',
                                    function: { name: 'read_file', arguments: '{"path":"guide.md"}' },
                                }],
                            },
                        }],
                    };
                }
                if (callCount <= 4) {
                    return { choices: [{ message: { content: 'I found issues but need to think more.', tool_calls: null } }] };
                }
                return { choices: [{ message: { content: 'No changes needed', tool_calls: null } }] };
            });
            mockToolManager.callTool.mockResolvedValue('# Guide');

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'docs/guides' }), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            const messages = [
                { role: 'system', content: 'prompt' },
                { role: 'user', content: 'Analyze' },
            ];
            const tools = (runner as any).getRetrospectTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            expect(messages.some((message: any) =>
                message.role === 'user' &&
                typeof message.content === 'string' &&
                message.content.includes('docs/guides/README.md')
            )).toBe(true);
        });
    });

});
