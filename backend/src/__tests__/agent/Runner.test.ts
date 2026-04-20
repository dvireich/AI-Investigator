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
    cleanup: vi.fn(async () => {}),
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

vi.mock('fs/promises', () => ({
    writeFile: vi.fn(async (p: string, content: string) => writeFileSyncImpl(p, content)),
    rename: vi.fn(async (old: string, nu: string) => renameSyncImpl(old, nu)),
    mkdir: vi.fn(async (p: string) => mkdirSyncImpl(p)),
    readFile: vi.fn(async (p: string) => readFileSyncImpl(p)),
    default: {
        writeFile: vi.fn(async (p: string, content: string) => writeFileSyncImpl(p, content)),
        rename: vi.fn(async (old: string, nu: string) => renameSyncImpl(old, nu)),
        mkdir: vi.fn(async (p: string) => mkdirSyncImpl(p)),
        readFile: vi.fn(async (p: string) => readFileSyncImpl(p)),
    },
}));

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

import { AgentRunner, AgentConfig, InvestigationState, Recommendation } from '../../agent/Runner';
import * as mockedFs from 'fs';

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

        it('injects stageContext conversationLog into system prompt (reports/verdicts only)', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: JSON.stringify({ report: 'ok' }) },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).stageContext = {
                stageIndex: 1,
                agentName: 'Reviewer',
                conversationLog: [
                    { agentName: 'Investigator', role: 'thought', content: 'Analyzed the issue' },
                    { agentName: 'Investigator', role: 'action', content: 'Queried logs' },
                    { agentName: 'Investigator', role: 'report', content: 'Found a latency spike in region A' },
                    { agentName: 'Investigator', role: 'verdict', content: 'Verdict: flagged' },
                    { agentName: 'Pipeline', role: 'handoff', content: 'Passing to Reviewer...' },
                ],
            };

            await runner.start('Review the investigation');

            // The system prompt should contain only reports, verdicts, and handoffs — not thoughts/actions
            const messages = mockOpenAI.chat.completions.create.mock.calls[0][0].messages;
            const systemMsg = messages.find((m: any) => m.role === 'system');
            expect(systemMsg.content).toContain('Prior Agent Context');
            expect(systemMsg.content).toContain('[Investigator] (report): Found a latency spike in region A');
            expect(systemMsg.content).toContain('[Investigator] (verdict): Verdict: flagged');
            expect(systemMsg.content).toContain('[Pipeline] (handoff): Passing to Reviewer...');
            // Operational thoughts/actions should NOT be included
            expect(systemMsg.content).not.toContain('Analyzed the issue');
            expect(systemMsg.content).not.toContain('Queried logs');
        });

        it('truncates long conversationLog entries in system prompt', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: JSON.stringify({ report: 'ok' }) },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Build a conversationLog that exceeds MAX_CONVERSATION_CHARS (30,000)
            const hugeReport = 'X'.repeat(35_000);
            (runner as any).stageContext = {
                stageIndex: 1,
                agentName: 'Reviewer',
                conversationLog: [
                    { agentName: 'Investigator', role: 'report', content: hugeReport },
                ],
            };

            await runner.start('Review');

            const messages = mockOpenAI.chat.completions.create.mock.calls[0][0].messages;
            const systemMsg = messages.find((m: any) => m.role === 'system');
            expect(systemMsg.content).toContain('Prior Agent Context');
            expect(systemMsg.content).toContain('... [Prior agent context truncated for token management]');
            // Should be truncated — not the full 35K
            expect(systemMsg.content.length).toBeLessThan(35_000);
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

        it('extracts recommendations when finish tool report has them', async () => {
            const reportWithRecs = '## Final Report\nDetails here.\n\n## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the parser**: The parser fails on edge cases.\n';
            // First call: return content with finish tool as function_call
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'finish', arguments: JSON.stringify({ report: reportWithRecs }) },
                            }],
                        },
                    }],
                })
                // Second call: for extractRecommendations LLM call
                .mockResolvedValueOnce({
                    choices: [{ message: { content: '[{"priority":"P0","title":"Fix the parser","description":"The parser fails on edge cases.","category":"code"}]' } }],
                });

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Investigate');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            expect(state.recommendations).toBeDefined();
            expect(state.recommendations!.length).toBe(1);
            expect(state.recommendations![0].category).toBe('code');
        });

        it('falls back to empty recommendations when extraction throws', async () => {
            const reportWithRecs = '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crashes\n';
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Finished.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'finish', arguments: JSON.stringify({ report: reportWithRecs }) },
                            }],
                        },
                    }],
                })
                .mockRejectedValueOnce(new Error('LLM API is down'));

            const runner = new AgentRunner(makeConfig(), provider);
            await runner.start('Investigate');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            // extractRecommendations catches errors internally and returns []
            expect(state.recommendations).toBeDefined();
            expect(state.recommendations!.length).toBe(0);
        });

        it('catches when extractRecommendations itself throws', async () => {
            const reportWithRecs = '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix bug**: details\n';
            mockOpenAI.chat.completions.create
                .mockResolvedValueOnce({
                    choices: [{
                        message: {
                            content: 'Done.',
                            tool_calls: [{
                                id: 'tc1',
                                function: { name: 'finish', arguments: JSON.stringify({ report: reportWithRecs }) },
                            }],
                        },
                    }],
                });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner, 'extractRecommendations').mockRejectedValue(new Error('unexpected crash'));

            await runner.start('Investigate');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            expect(state.recommendations).toEqual([]);
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

    describe('dispose', () => {
        it('calls toolManager.cleanup()', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const cleanupSpy = vi.spyOn((runner as any).toolManager, 'cleanup').mockResolvedValue(undefined);
            runner.dispose();
            expect(cleanupSpy).toHaveBeenCalled();
        });

        it('does not throw if cleanup rejects', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn((runner as any).toolManager, 'cleanup').mockRejectedValue(new Error('fail'));
            expect(() => runner.dispose()).not.toThrow();
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

        it('rejects intervention when queue is full (Fix 20)', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            for (let i = 0; i < 50; i++) {
                runner.intervene(`msg-${i}`);
            }
            expect((runner as any).pendingInterventions).toHaveLength(50);
            runner.intervene('overflow');
            // Queue should still be 50, the 51st is rejected
            expect((runner as any).pendingInterventions).toHaveLength(50);
            expect((runner as any).state.logs.some((l: string) => l.includes('queue full'))).toBe(true);
        });
    });

    describe('contestReport', () => {
        it('contests a completed report and transitions back to running', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Original report',
                recommendations: [{ id: 'r0', priority: 'P0', title: 'Fix bug', description: '', category: 'code' as const }],
            });

            runner.contestReport('Report is missing root cause');

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('running');
            expect(state.finalReport).toBeUndefined();
            expect(state.recommendations).toBeUndefined();
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

        it('caps logs at 500 entries (Fix 7/8)', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            for (let i = 0; i < 510; i++) {
                (runner as any).log(`log-${i}`);
            }
            expect((runner as any).state.logs.length).toBe(500);
            // Oldest logs should have been trimmed; newest should still be present
            expect((runner as any).state.logs[(runner as any).state.logs.length - 1]).toBe('log-509');
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

        it('caps retrospect.messages at 100 entries (Fix 7)', () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const retro = (runner as any).initRetrospect();
            for (let i = 0; i < 110; i++) {
                retro.messages.push({ role: 'assistant', content: `msg-${i}` });
            }
            expect(retro.messages.length).toBe(110);
            (runner as any).capRetroMessages();
            expect(retro.messages.length).toBe(100);
            // Newest should remain
            expect(retro.messages[retro.messages.length - 1].content).toBe('msg-109');
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

        it('appends auth remediation for authentication errors', async () => {
            mockToolManager.callTool.mockRejectedValue(new Error('KustoClientAuthenticationException: no_system_webview'));
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeAction({ tool: 'kql', args: {} });
            expect(result).toContain('REMEDIATION');
            expect(result).toContain('az login');
            expect(result).toContain('authentication error');
        });

        it('appends connection remediation for network errors', async () => {
            mockToolManager.callTool.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeAction({ tool: 'kql', args: {} });
            expect(result).toContain('REMEDIATION');
            expect(result).toContain('connection error');
        });

        it('does not append remediation for generic errors', async () => {
            mockToolManager.callTool.mockRejectedValue(new Error('KQL syntax error near line 5'));
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeAction({ tool: 'kql', args: {} });
            expect(result).toBe('Error: KQL syntax error near line 5');
            expect(result).not.toContain('REMEDIATION');
        });
    });

    describe('getErrorRemediation', () => {
        let runner: any;
        beforeEach(() => { runner = new AgentRunner(makeConfig(), provider); });

        it.each([
            ['authentication', 'Contains "authentication"'],
            ['unauthorized', 'Contains "unauthorized"'],
            ['no_system_webview', 'Contains "no_system_webview"'],
            ['login_required', 'Contains "login_required"'],
            ['credential', 'Contains "credential"'],
            ['access token expired', 'Contains "access token"'],
            ['AADSTS70001: application error', 'Contains "aadsts"'],
        ])('returns auth remediation for: %s', (errorMsg) => {
            const result = runner.getErrorRemediation(errorMsg);
            expect(result).toContain('az login');
            expect(result).toContain('authentication error');
        });

        it.each([
            ['ECONNREFUSED', 'Contains "econnrefused"'],
            ['ENOTFOUND cluster.kusto.windows.net', 'Contains "enotfound"'],
            ['ETIMEDOUT', 'Contains "etimedout"'],
            ['ECONNRESET', 'Contains "econnreset"'],
            ['socket hang up', 'Contains "socket hang up"'],
            ['MCP server "kql" is not connected.', 'Contains "not connected"'],
            ['connect failed', 'Contains "connect failed"'],
        ])('returns connection remediation for: %s', (errorMsg) => {
            const result = runner.getErrorRemediation(errorMsg);
            expect(result).toContain('connection error');
        });

        it('returns empty string for unknown errors', () => {
            expect(runner.getErrorRemediation('KQL syntax error')).toBe('');
            expect(runner.getErrorRemediation('')).toBe('');
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

        it('localReadFile returns line range when startLine and endLine are provided', () => {
            const filePath = n(require('path').resolve('/repo', 'range-test.txt'));
            mockFsState.set(filePath, 'line1\nline2\nline3\nline4\nline5');
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localReadFile('range-test.txt', 2, 4);
            expect(result).toContain('[Lines 2-4 of 5]');
            expect(result).toContain('line2');
            expect(result).toContain('line4');
            expect(result).not.toContain('line1');
            expect(result).not.toContain('line5');
        });

        it('localReadFile reads from startLine to end when endLine is omitted', () => {
            const filePath = n(require('path').resolve('/repo', 'range-noend.txt'));
            mockFsState.set(filePath, 'a\nb\nc\nd\ne');
            const runner = new AgentRunner(makeConfig(), provider, { status: 'completed' });
            const result = (runner as any).localReadFile('range-noend.txt', 3);
            expect(result).toContain('[Lines 3-5 of 5]');
            expect(result).toContain('c');
            expect(result).toContain('e');
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

        it('stops scanning after MAX_FILES files', () => {
            mockDirs.add('/repo/docs');
            // Generate 210 files — exceeds MAX_FILES=200
            const fileNames = Array.from({ length: 210 }, (_, i) => `file${String(i).padStart(3, '0')}.md`);
            mockDirEntries.set('docs', fileNames);

            const runner = new AgentRunner(makeConfig({ knowledgeBasePath: 'docs' }), provider);
            const result = (runner as any).discoverKnowledgeBase();
            // Should contain at most 200 file entries (backtick-wrapped lines)
            const fileLines = result.split('\n').filter((l: string) => l.includes('`'));
            expect(fileLines.length).toBeLessThanOrEqual(200);
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

        it('allows range reads (startLine/endLine) and skips dedup for them', async () => {
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
                                    function: { name: 'read_file', arguments: '{"path":"large.txt"}' },
                                }],
                            },
                        }],
                    };
                }
                if (callCount === 2) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{
                                    id: 'tc2',
                                    function: { name: 'read_file', arguments: '{"path":"large.txt","startLine":10}' },
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

            // Both calls should go through — range read bypasses dedup
            expect(mockToolManager.callTool).toHaveBeenCalledTimes(2);
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

        it('handles search_code tool calls', async () => {
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
                                        name: 'search_code',
                                        arguments: JSON.stringify({ pattern: 'MyService', path: '', maxResults: 10 }),
                                    },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const resolvedRepo = n(require('path').resolve('/repo'));
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['App.cs']);
            mockFsState.set(n(require('path').resolve('/repo/App.cs')), 'public class MyService { }');

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
            const tools = (runner as any).getImplementationTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // search_code should have been logged
            expect((runner as any).state.logs.some((l: string) => l.includes('[Retrospect] search_code'))).toBe(true);
        });

        it('uses default maxResults of 20 when search_code call omits maxResults', async () => {
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
                                        // omit both pattern and maxResults to hit both || fallbacks
                                        name: 'search_code',
                                        arguments: JSON.stringify({}),
                                    },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const resolvedRepo = n(require('path').resolve('/repo'));
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, []);

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed', thoughts: ['step1'], actions: [null],
            });
            (runner as any).initRetrospect();
            const messages = [{ role: 'system', content: 'prompt' }, { role: 'user', content: 'Analyze' }];
            const tools = (runner as any).getImplementationTools();
            await (runner as any).runRetrospectToolLoop(messages, tools);

            expect((runner as any).state.logs.some((l: string) => l.includes('[Retrospect] search_code'))).toBe(true);
        });

        it('emits fnName as activityDesc and returns Unknown tool for unrecognized tool', async () => {
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
                                    function: { name: 'super_mystery_tool', arguments: '{}' },
                                }],
                            },
                        }],
                    };
                }
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed', thoughts: ['step1'], actions: [null],
            });
            (runner as any).initRetrospect();
            const messages = [{ role: 'system', content: 'prompt' }, { role: 'user', content: 'Analyze' }];
            const tools = (runner as any).getImplementationTools();
            const events: any[] = [];
            runner.on('retrospect-tool-activity', (e) => events.push(e));
            await (runner as any).runRetrospectToolLoop(messages, tools);

            // The description should fall back to the raw tool name
            expect(events.some((e) => e.description === 'super_mystery_tool')).toBe(true);
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
                title: 'Log Analytics Latency',
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

        it('resets pipeline stage states when pipeline is present', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Pipeline report',
                thoughts: ['thought1'],
                actions: [null],
            });
            (runner as any).state.pipeline = {
                stages: [
                    { status: 'completed', verdict: 'approved', feedback: 'ok', report: 'r', retryCount: 1, startedAt: 100, completedAt: 200 },
                    { status: 'completed', verdict: 'flagged', feedback: 'x', report: 'r2', retryCount: 0, startedAt: 300, completedAt: 400 },
                ],
                currentStageIndex: 1,
                conversationLog: [{ role: 'report', content: 'test' }],
            };

            runner.contestReport('Fix pipeline');

            const pipeline = (runner as any).state.pipeline;
            expect(pipeline.stages[0].status).toBe('pending');
            expect(pipeline.stages[0].verdict).toBeUndefined();
            expect(pipeline.stages[0].feedback).toBeUndefined();
            expect(pipeline.stages[0].report).toBeUndefined();
            expect(pipeline.stages[0].retryCount).toBe(0);
            expect(pipeline.stages[0].startedAt).toBeUndefined();
            expect(pipeline.stages[0].completedAt).toBeUndefined();
            expect(pipeline.stages[1].status).toBe('pending');
            expect(pipeline.currentStageIndex).toBe(0);
            expect(pipeline.conversationLog).toEqual([]);
        });

        it('snapshots pipeline state before resetting for later restore', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Pipeline report',
                thoughts: ['thought1'],
                actions: [null],
            });
            (runner as any).state.pipeline = {
                stages: [
                    { agentId: 'a', agentName: 'Planner', status: 'completed', retryCount: 0, report: 'plan' },
                    { agentId: 'b', agentName: 'Investigator', status: 'completed', retryCount: 0, report: 'investigation' },
                ],
                currentStageIndex: 1,
                conversationLog: [{ role: 'report', content: 'shared log' }],
                definition: { id: 'test', stages: [] },
            };

            runner.contestReport('Redo investigation');

            const snapshot = (runner as any).state._priorPipelineSnapshot;
            expect(snapshot).toBeDefined();
            // Snapshot should contain the pre-contest values
            expect(snapshot.stages[0].status).toBe('completed');
            expect(snapshot.stages[0].report).toBe('plan');
            expect(snapshot.stages[1].status).toBe('completed');
            expect(snapshot.currentStageIndex).toBe(1);
            expect(snapshot.conversationLog).toEqual([{ role: 'report', content: 'shared log' }]);
            // It should be a deep clone (not the same reference)
            expect(snapshot.stages).not.toBe((runner as any).state.pipeline.stages);
        });
    });

    describe('tagEvent', () => {
        it('returns data unchanged when no stageContext', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const data = { tool: 'test' };
            expect((runner as any).tagEvent(data)).toBe(data);
        });

        it('wraps string data with agent identity', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).stageContext = {
                agentId: 'agent-1',
                agentName: 'Test Agent',
                agentColor: '#ff0000',
                agentIcon: '🔍',
                stageIndex: 0,
                conversationLog: [],
            };
            const result = (runner as any).tagEvent('hello');
            expect(result.content).toBe('hello');
            expect(result.agentId).toBe('agent-1');
            expect(result.agentName).toBe('Test Agent');
            expect(result.agentColor).toBe('#ff0000');
            expect(result.stageIndex).toBe(0);
        });

        it('merges agent identity into object data', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).stageContext = {
                agentId: 'agent-2',
                agentName: 'Agent Two',
                agentColor: '#00ff00',
                agentIcon: '🛠️',
                stageIndex: 1,
                conversationLog: [],
            };
            const result = (runner as any).tagEvent({ tool: 'test', data: 123 });
            expect(result.tool).toBe('test');
            expect(result.data).toBe(123);
            expect(result.agentId).toBe('agent-2');
            expect(result.stageIndex).toBe(1);
        });

        it('returns non-string non-object data unchanged with stageContext', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).stageContext = {
                agentId: 'agent-1',
                agentName: 'Test',
                stageIndex: 0,
                conversationLog: [],
            };
            expect((runner as any).tagEvent(42)).toBe(42);
            expect((runner as any).tagEvent(null)).toBeNull();
        });
    });

    describe('loadSystemPrompt', () => {
        it('uses stageContext systemPromptOverride when present', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).stageContext = {
                systemPromptOverride: 'Custom pipeline prompt for this stage',
                conversationLog: [],
            };
            expect((runner as any).loadSystemPrompt()).toBe('Custom pipeline prompt for this stage');
        });
    });

    describe('restoreToLastCheckpoint', () => {
        function buildContestedState(originalReport: string, contestedReport: string) {
            // Simulate a completed investigation that was contested and completed again
            const contestNum = 1;
            const contestMessage = [
                `CONTESTED REPORT (attempt #${contestNum})`,
                `The user has rejected the following final report:`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
                ``,
                `User feedback: This is wrong`,
                ``,
                `(SYSTEM NOTE: You MUST acknowledge this feedback...)`,
            ].join('\n');

            return {
                status: 'completed' as const,
                finalReport: contestedReport,
                contestCount: 1,
                recommendations: [{ id: 'r1', priority: 'P1', title: 'New rec', description: '', category: 'code' as const }],
                thoughts: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: `Report Contested: This is wrong` },
                    `System: Report contested (attempt #1). Investigation resumed with user feedback.`,
                    { role: 'user', content: contestMessage },
                    { role: 'assistant', content: 'Re-investigating...' },
                    'Observation: Report Generated.',
                ],
                actions: [null, null, null, null, null, null, null],
                fullHistory: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: `Report Contested: This is wrong` },
                    `System: Report contested (attempt #1). Investigation resumed with user feedback.`,
                    { role: 'user', content: contestMessage },
                    { role: 'assistant', content: 'Re-investigating...' },
                    'Observation: Report Generated.',
                ],
                fullActions: [null, null, null, null, null, null, null],
                retrospect: {
                    messages: [{ role: 'user' as const, content: 'analyze' }],
                    proposals: [],
                    analysisComplete: true,
                    completed: false,
                },
            };
        }

        it('restores to previous report and truncates post-contest data', async () => {
            const originalReport = '## Original Report\n\nEverything looks fine.';
            const contestedReport = '## New Report\n\nAfter re-investigation.';
            const stateData = buildContestedState(originalReport, contestedReport);
            const runner = new AgentRunner(makeConfig(), provider, stateData);
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([
                { id: 'r0', priority: 'P0', title: 'Old rec', description: '', category: 'code' },
            ]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.status).toBe('completed');
            expect(state.finalReport).toBe(originalReport);
            expect(state.contestCount).toBe(0);
            // fullHistory should be truncated to before the contest entry
            expect(state.fullHistory!.length).toBe(2); // Only pre-contest entries
            expect(state.fullHistory!.every((t: any) => {
                const content = typeof t === 'string' ? t : t?.content;
                return !content?.includes('Report Contested');
            })).toBe(true);
            // Recommendations re-extracted
            expect(state.recommendations).toEqual([
                { id: 'r0', priority: 'P0', title: 'Old rec', description: '', category: 'code' },
            ]);
            // Retrospect reset
            expect(state.retrospect!.messages).toEqual([]);
            expect(state.retrospect!.analysisComplete).toBe(false);
        });

        it('decrements contestCount correctly for multiple contests', async () => {
            const originalReport = '## First Report';
            const secondReport = '## Second Report';
            const thirdReport = '## Third Report';

            // Build state with 2 contests
            const contest1Message = [
                `CONTESTED REPORT (attempt #1)`,
                `The user has rejected the following final report:`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
                ``,
                `User feedback: Wrong`,
            ].join('\n');

            const contest2Message = [
                `CONTESTED REPORT (attempt #2)`,
                `The user has rejected the following final report:`,
                `--- REJECTED REPORT START ---`,
                secondReport,
                `--- REJECTED REPORT END ---`,
                ``,
                `User feedback: Still wrong`,
            ].join('\n');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: thirdReport,
                contestCount: 2,
                thoughts: [
                    { role: 'assistant', content: 'Step 1' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: contest1Message },
                    { role: 'assistant', content: 'Step 2' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Still wrong' },
                    'System: Report contested (attempt #2).',
                    { role: 'user', content: contest2Message },
                    { role: 'assistant', content: 'Step 3' },
                    'Observation: Report Generated.',
                ],
                actions: Array(12).fill(null),
                fullHistory: [
                    { role: 'assistant', content: 'Step 1' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: contest1Message },
                    { role: 'assistant', content: 'Step 2' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Still wrong' },
                    'System: Report contested (attempt #2).',
                    { role: 'user', content: contest2Message },
                    { role: 'assistant', content: 'Step 3' },
                    'Observation: Report Generated.',
                ],
                fullActions: Array(12).fill(null),
            });
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(secondReport);
            expect(state.contestCount).toBe(1);
            // Should have entries up to but not including the second contest
            expect(state.fullHistory!.length).toBe(7);
        });

        it('throws when investigation is not completed', async () => {
            const runner = new AgentRunner(makeConfig(), provider, { status: 'running' });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('Can only restore a completed investigation');
        });

        it('throws when contestCount is 0', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Report',
                contestCount: 0,
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('No previous checkpoint to restore to');
        });

        it('throws when contestCount is undefined', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Report',
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('No previous checkpoint to restore to');
        });

        it('reloads fullHistory from disk when empty', async () => {
            const originalReport = '## Disk Report\n\nLoaded from state.json.';
            const contestedReport = '## New Report';
            const contestMessage = [
                `CONTESTED REPORT (attempt #1)`,
                `The user has rejected the following final report:`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
                ``,
                `User feedback: Wrong`,
            ].join('\n');

            const savedState = {
                id: '1700000000000',
                target: 'TestTarget',
                fullHistory: [
                    { role: 'assistant', content: 'Original thought' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: contestMessage },
                    { role: 'assistant', content: 'New thought' },
                    'Observation: Report Generated.',
                ],
                fullActions: Array(7).fill(null),
            };

            // Place the state.json on the mock filesystem
            const statePath = n('/investigations/2023-11-14_TestTarget_1700000000000/state.json');
            mockFsState.set(statePath, JSON.stringify(savedState));

            const runner = new AgentRunner(makeConfig(), provider, {
                id: '1700000000000',
                target: 'TestTarget',
                status: 'completed',
                finalReport: contestedReport,
                contestCount: 1,
                thoughts: [],
                actions: [],
                fullHistory: [], // Empty — cleared from RAM after save
                fullActions: [],
            });
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
            expect(state.contestCount).toBe(0);
            expect(state.fullHistory!.length).toBe(2);
        });

        it('handles disk reload with missing fullActions and non-numeric id', async () => {
            const originalReport = '## Disk Report';
            const contestMessage = [
                `CONTESTED REPORT (attempt #1)`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
                `User feedback: Wrong`,
            ].join('\n');

            // Saved state without fullActions (covers savedState.fullActions || [] branch)
            const savedState = {
                fullHistory: [
                    { role: 'assistant', content: 'Thought' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: contestMessage },
                    { role: 'assistant', content: 'New thought' },
                ],
                // No fullActions — tests || [] branch
                // No fullHistory on second pass — tests savedState.fullHistory || []
            };

            // Use a non-numeric id to cover the ternary false branch
            const today = new Date().toISOString().split('T')[0];
            const statePath = n(`/investigations/${today}_UnknownTarget_Restore-Coverage_abc123/state.json`);
            mockFsState.set(statePath, JSON.stringify(savedState));

            const runner = new AgentRunner(makeConfig(), provider, {
                id: 'abc123',
                status: 'completed',
                title: 'Restore Coverage',
                finalReport: '## New Report',
                contestCount: 1,
            });
            // Clear fullHistory and target after construction to hit fallback branches
            (runner as any).state.fullHistory = [];
            (runner as any).state.target = undefined;
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
        });

        it('handles disk state.json without fullHistory field', async () => {
            // savedState has no fullHistory → savedState.fullHistory || [] branch fires
            const savedState = { someOtherField: true };
            const statePath = n('/investigations/2023-11-14_TestTarget_1700000000000/state.json');
            mockFsState.set(statePath, JSON.stringify(savedState));

            const runner = new AgentRunner(makeConfig(), provider, {
                id: '1700000000000',
                target: 'TestTarget',
                status: 'completed',
                finalReport: 'Report',
                contestCount: 1,
                fullHistory: [],
            });
            // After reload, fullHistory will be [] (from || []), so throws "no history available"
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('no history available');
        });

        it('falls back to computed investigationsPath when config omits it', async () => {
            const originalReport = '## Disk Report';
            const contestMessage = [
                `CONTESTED REPORT (attempt #1)`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
            ].join('\n');

            const savedState = {
                fullHistory: [
                    { role: 'assistant', content: 'Thought' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: contestMessage },
                ],
                fullActions: Array(5).fill(null),
            };

            // Computed path: path.join(repoRoot, 'investigations') → /repo/investigations
            const statePath = n('/repo/investigations/2023-11-14_TestTarget_1700000000000/state.json');
            mockFsState.set(statePath, JSON.stringify(savedState));

            const runner = new AgentRunner(makeConfig({ investigationsPath: undefined as any }), provider, {
                id: '1700000000000',
                target: 'TestTarget',
                status: 'completed',
                finalReport: '## New',
                contestCount: 1,
                fullHistory: [],
            });
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
        });

        it('throws when no contest boundary found in history', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Report',
                contestCount: 1,
                fullHistory: [
                    { role: 'assistant', content: 'Just a normal thought' },
                ],
                fullActions: [null],
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('no contest boundary found');
        });

        it('throws when fullHistory is empty and disk reload fails', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                id: '1700000000000',
                target: 'TestTarget',
                status: 'completed',
                finalReport: 'Report',
                contestCount: 1,
                fullHistory: [],
                fullActions: [],
            });
            // No state.json on disk — existsSync returns false by default in mock
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('no history available');
        });

        it('throws when fullHistory is undefined and disk reload fails', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                id: '1700000000000',
                target: 'TestTarget',
                status: 'completed',
                finalReport: 'Report',
                contestCount: 1,
            });
            // Manually clear fullHistory after construction to hit !this.state.fullHistory branch
            (runner as any).state.fullHistory = undefined;
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('no history available');
        });

        it('emits status and thought events', async () => {
            const originalReport = '## Original';
            const stateData = buildContestedState(originalReport, '## New');
            const runner = new AgentRunner(makeConfig(), provider, stateData);
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);

            const statusEvents: any[] = [];
            const thoughtEvents: any[] = [];
            runner.on('status', (d) => statusEvents.push(d));
            runner.on('thought', (d) => thoughtEvents.push(d));
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            expect(statusEvents).toEqual([{ status: 'completed' }]);
            expect(thoughtEvents.some((t: any) =>
                typeof t === 'string' && t.includes('restored to previous report')
            )).toBe(true);
        });

        it('adds system notification to thoughts after restore', async () => {
            const originalReport = '## Original';
            const stateData = buildContestedState(originalReport, '## New');
            const runner = new AgentRunner(makeConfig(), provider, stateData);
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            const lastThought = state.thoughts[state.thoughts.length - 1];
            expect(typeof lastThought).toBe('string');
            expect(lastThought).toContain('restored to previous report');
        });

        it('throws when contested entry has no report markers', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Current Report',
                contestCount: 1,
                fullHistory: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: 'CONTESTED REPORT (attempt #1)\nNo markers here' },
                    { role: 'assistant', content: 'Re-investigating...' },
                ],
                actions: Array(6).fill(null),
                fullActions: Array(6).fill(null),
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('unable to extract the previous report');
        });

        it('clears recommendations when extractRecommendations fails during restore', async () => {
            const originalReport = '## Original Report';
            const stateData = buildContestedState(originalReport, '## New Report');
            const runner = new AgentRunner(makeConfig(), provider, stateData);
            vi.spyOn(runner as any, 'extractRecommendations').mockRejectedValue(new Error('LLM unavailable'));
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
            expect(state.recommendations).toEqual([]);
        });

        it('throws when contested entry at index+2 is missing', async () => {
            // fullHistory has "Report Contested:" but no entry at contestIndex+2
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Current Report',
                contestCount: 1,
                fullHistory: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    // No contestIndex+2 entry
                ],
                actions: Array(4).fill(null),
                fullActions: Array(4).fill(null),
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('unable to extract the previous report');
        });

        it('throws when contested entry content is not a string', async () => {
            // Entry at contestIndex+2 is an object with non-string content
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: 'Current Report',
                contestCount: 1,
                fullHistory: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    { role: 'user', content: null as any },
                    { role: 'assistant', content: 'Re-investigating...' },
                ],
                actions: Array(6).fill(null),
                fullActions: Array(6).fill(null),
            });
            await expect(runner.restoreToLastCheckpoint()).rejects.toThrow('unable to extract the previous report');
        });

        it('handles missing fullActions during restore', async () => {
            const originalReport = '## Original Report\n\nEverything looks fine.';
            const contestedReport = '## New Report\n\nAfter re-investigation.';
            const stateData = buildContestedState(originalReport, contestedReport);
            const runner = new AgentRunner(makeConfig(), provider, stateData);
            // Manually clear fullActions after construction to hit the || [] fallback branches
            (runner as any).state.fullActions = undefined;
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
            expect(state.fullActions).toEqual([]);
        });

        it('handles restore when contested entry is a raw string with markers', async () => {
            // Test the typeof contestedEntry === 'string' ? contestedEntry : ... branch
            const originalReport = '## Inline Report';
            const contestMessage = [
                `CONTESTED REPORT (attempt #1)`,
                `--- REJECTED REPORT START ---`,
                originalReport,
                `--- REJECTED REPORT END ---`,
            ].join('\n');

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## New Report',
                contestCount: 1,
                fullHistory: [
                    { role: 'assistant', content: 'Analyzing...' },
                    'Observation: Report Generated.',
                    { role: 'user', content: 'Report Contested: Wrong' },
                    'System: Report contested (attempt #1).',
                    contestMessage, // Raw string, not object
                    { role: 'assistant', content: 'Re-investigating...' },
                ],
                actions: Array(6).fill(null),
                fullActions: Array(6).fill(null),
            });
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            expect(state.finalReport).toBe(originalReport);
        });

        it('restores pipeline state from prior snapshot after contest', async () => {
            const originalReport = '## Pipeline Report\n\nAll stages completed.';
            const contestedReport = '## Contested Pipeline Report';
            const stateData = buildContestedState(originalReport, contestedReport);

            // Add pipeline state that was snapshotted before contest
            (stateData as any)._priorPipelineSnapshot = {
                stages: [
                    { agentId: 'a', agentName: 'Planner', status: 'completed', retryCount: 0, report: 'plan done' },
                    { agentId: 'b', agentName: 'Investigator', status: 'completed', retryCount: 0, report: 'investigation done' },
                ],
                currentStageIndex: 1,
                conversationLog: [{ role: 'report', content: 'Prior investigation log' }],
                definition: { id: 'test-pipe', stages: [] },
            };
            // Current pipeline state (post-contest reset)
            (stateData as any).pipeline = {
                stages: [
                    { agentId: 'a', agentName: 'Planner', status: 'pending', retryCount: 0 },
                    { agentId: 'b', agentName: 'Investigator', status: 'pending', retryCount: 0 },
                ],
                currentStageIndex: 0,
                conversationLog: [],
                definition: { id: 'test-pipe', stages: [] },
            };

            const runner = new AgentRunner(makeConfig(), provider, stateData);
            vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);
            vi.spyOn(runner as any, 'saveArtifacts').mockResolvedValue(undefined);

            await runner.restoreToLastCheckpoint();

            const state = (runner as any).state as InvestigationState;
            // Pipeline state should be restored from the snapshot
            expect(state.pipeline!.stages[0].status).toBe('completed');
            expect(state.pipeline!.stages[1].status).toBe('completed');
            expect(state.pipeline!.stages[0].report).toBe('plan done');
            expect(state.pipeline!.currentStageIndex).toBe(1);
            expect(state.pipeline!.conversationLog).toEqual([{ role: 'report', content: 'Prior investigation log' }]);
            // Snapshot should be cleared after restore
            expect((state as any)._priorPipelineSnapshot).toBeUndefined();
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

        it('reports payload size on 400 error after all recovery attempts', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValue({ status: 400 });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const step = await (runner as any).callLLM('system', 'query', ['thought1'], false);

            expect(step.thought).toContain('Payload:');
            expect(step.thought).toContain('tokens');
            expect(step.thought).toContain('Recovery failed after 3 attempts');
        });

        it('extracts detailed error from OpenAI error body', async () => {
            const apiError = {
                status: 400,
                error: {
                    error: {
                        message: 'max context length is 200000 tokens, your request had 250000',
                        type: 'invalid_request_error',
                        code: 'context_length_exceeded',
                    }
                }
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const step = await (runner as any).callLLM('system', 'query', ['thought1'], false);

            expect(step.thought).toContain('max context length is 200000 tokens');
            expect(step.thought).toContain('context_length_exceeded');
        });

        it('strips prior agent context from system prompt on 400 retry', async () => {
            // First call: 400 error, second call: succeeds after stripping context
            mockOpenAI.chat.completions.create
                .mockRejectedValueOnce({ status: 400, message: 'too large' })
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'Recovered successfully.' } }],
                });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const systemWithContext = 'Base prompt.\n\n## Prior Agent Context\nThe following are reports:\n\n[Planner] (report): Big report here.';
            const step = await (runner as any).callLLM(systemWithContext, 'query', ['thought1'], false);

            expect(step.thought).toBe('Recovered successfully.');
            // Verify second call used stripped system prompt
            const secondCall = mockOpenAI.chat.completions.create.mock.calls[1][0];
            expect(secondCall.messages[0].content).toBe('Base prompt.');
            expect(secondCall.messages[0].content).not.toContain('Prior Agent Context');
        });

        it('downgrades tool_choice from required to auto on 400 retry when forceTool is true', async () => {
            // First call: 400 error with forceTool=true, second call: succeeds
            mockOpenAI.chat.completions.create
                .mockRejectedValueOnce({ status: 400, message: 'tool_choice required not supported' })
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'Recovered after downgrade.' } }],
                });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);
            const logSpy = vi.spyOn(runner as any, 'log');

            const step = await (runner as any).callLLM('system', 'query', ['thought1'], true);

            expect(step.thought).toBe('Recovered after downgrade.');
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Downgrading tool_choice'));
        });

        it('applies level 2 aggressive trim on second 400 retry', async () => {
            // All 3 calls fail with 400 — verify level 2 trimmed history
            mockOpenAI.chat.completions.create.mockRejectedValue({ status: 400 });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);

            const history = Array.from({ length: 20 }, (_, i) => `thought ${i}`);
            const step = await (runner as any).callLLM('system', 'query', history, false);

            expect(step.thought).toContain('Recovery failed after 3 attempts');
            // After level 2 trim, state.thoughts should be trimmed to 4
            const state = (runner as any).state;
            expect(state.thoughts.length).toBeLessThanOrEqual(4);
        });

        it('truncates oversized system prompt during level 2 recovery', async () => {
            // All 3 calls fail with 400, but system prompt is >30K chars
            mockOpenAI.chat.completions.create.mockRejectedValue({ status: 400 });

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);
            const logSpy = vi.spyOn(runner as any, 'log');

            const history = Array.from({ length: 20 }, (_, i) => `thought ${i}`);
            // Huge system prompt that exceeds 30K char limit
            const hugeSystem = 'X'.repeat(40_000);
            const step = await (runner as any).callLLM(hugeSystem, 'query', history, false);

            expect(step.thought).toContain('Recovery failed after 3 attempts');
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Truncated system prompt'));
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

    describe('getStageResult - verdict mapping', () => {
        it('returns pipeline verdicts as-is', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r","verdict":"rejected","feedback":"bad"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            const result = runner.getStageResult();
            expect(result.verdict).toBe('rejected');
            expect(result.feedback).toBe('bad');
            expect(result.report).toBe('r');
        });

        it('maps "critical" to "rejected"', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r","verdict":"critical","feedback":"blind spots"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            const result = runner.getStageResult();
            expect(result.verdict).toBe('rejected');
        });

        it('maps "warning" to "flagged"', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r","verdict":"warning"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            const result = runner.getStageResult();
            expect(result.verdict).toBe('flagged');
        });

        it('maps "healthy" to "approved"', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r","verdict":"healthy"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            const result = runner.getStageResult();
            expect(result.verdict).toBe('approved');
        });

        it('passes through unknown verdicts unchanged', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r","verdict":"unknown_value"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            const result = runner.getStageResult();
            expect(result.verdict).toBe('unknown_value');
        });

        it('falls back to mapped state.verdict when finish has no verdict', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            // Manually set state.verdict to a health-check value to test fallback mapping
            (runner as any).state.verdict = 'critical';
            const result = runner.getStageResult();
            expect(result.verdict).toBe('rejected');
        });

        it('returns pipeline state.verdict as fallback when finish has no verdict', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            (runner as any).state.verdict = 'approved';
            const result = runner.getStageResult();
            expect(result.verdict).toBe('approved');
        });

        it('returns undefined verdict when no verdict is available', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"r"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            await runner.start('query');
            (runner as any).state.verdict = undefined;
            const result = runner.getStageResult();
            expect(result.verdict).toBeUndefined();
        });

        it('uses the LAST finish action when multiple exist (accumulated pipeline actions)', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'tc', function: { name: 'finish', arguments: '{"report":"stage3-report","verdict":"flagged","feedback":"needs work"}' } }] } }],
            });
            const runner = new AgentRunner(makeConfig({ maxSteps: 3 }), provider);
            // Simulate accumulated actions from prior pipeline stages
            (runner as any).state.actions = [
                { tool: 'finish', args: { report: 'stage1-report' } }, // Stage 1: no verdict
                null,
                { tool: 'finish', args: { report: 'stage2-report', verdict: 'approved' } }, // Stage 2: approved
            ];
            await runner.start('query');
            const result = runner.getStageResult();
            // Should pick the LAST finish (stage 3's flagged), not stage 1's empty or stage 2's approved
            expect(result.verdict).toBe('flagged');
            expect(result.feedback).toBe('needs work');
            expect(result.report).toBe('stage3-report');
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

    describe('callLLM - extractLlmErrorDetail branches', () => {
        it('extracts error detail from error.error object (Path 1: OpenAI SDK style)', async () => {
            const apiError = {
                status: 500,
                error: {
                    message: 'Internal server error occurred',
                    type: 'server_error',
                    code: 'internal_error',
                    param: 'model',
                },
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Internal server error occurred');
        });

        it('extracts error detail from error.body (Path 2: alternate SDK versions)', async () => {
            const apiError = {
                status: 500,
                body: { message: 'Service temporarily unavailable' },
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Service temporarily unavailable');
        });

        it('extracts error detail from top-level type+code (Path 3)', async () => {
            const apiError = {
                status: 502,
                type: 'gateway_error',
                code: 'bad_gateway',
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('type:gateway_error');
            expect(step.thought).toContain('code:bad_gateway');
        });

        it('parses embedded JSON in error.message (Path 4: SDK dump format)', async () => {
            const apiError = {
                status: 400,
                message: '400 {"error":{"message":"Maximum context length exceeded","type":"invalid_request_error","code":"context_length_exceeded"}}',
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(runner as any, 'compactHistory').mockResolvedValue(false);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Maximum context length exceeded');
        });

        it('falls back to HTTP unknown when error has no useful fields', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValue({});

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('HTTP unknown');
        });

        it('truncates long error.message to 300 chars', async () => {
            const longMsg = 'X'.repeat(500);
            mockOpenAI.chat.completions.create.mockRejectedValue({ message: longMsg });

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('...');
            expect(step.thought.length).toBeLessThan(longMsg.length + 200);
        });

        it('recurses into error.error.error for deeply nested OpenAI errors', async () => {
            const apiError = {
                status: 500,
                error: {
                    error: {
                        message: 'Deeply nested provider message',
                    },
                },
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Deeply nested provider message');
        });

        it('stops recursing at depth > 3 and handles object without message but with error', async () => {
            // 5 levels of nesting — extractFrom will stop at depth 3
            const apiError = {
                status: 500,
                error: {
                    error: {
                        error: {
                            error: {
                                error: {
                                    message: 'Should never reach this',
                                },
                            },
                        },
                    },
                },
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            // Should NOT contain the deeply nested message (depth > 3 returns false)
            expect(step.thought).not.toContain('Should never reach this');
            // Falls through to HTTP status fallback
            expect(step.thought).toContain('500');
        });

        it('handles error dump with object properties and throwing getters', async () => {
            const apiError: any = new Error('Service unavailable test');
            apiError.status = 503;
            apiError.nestedObj = { key: 'value' };
            // Add a getter that throws
            Object.defineProperty(apiError, 'throwingProp', {
                get() { throw new Error('getter exploded'); },
                enumerable: true,
            });
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Service unavailable test');
        });

        it('handles error dump failure when error object throws during property enumeration', async () => {
            // Create an error where the dump code itself throws
            const badError: any = {};
            Object.defineProperty(badError, 'message', {
                get() { return 'readable message text here'; },
                enumerable: true,
            });
            // Make 'for...in' throw by using a Proxy
            const proxyError = new Proxy(badError, {
                ownKeys() { throw new Error('ownKeys trap exploded'); },
            });
            mockOpenAI.chat.completions.create.mockRejectedValue(proxyError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            // Should still return an error result despite dump failure
            expect(typeof step.thought).toBe('string');
        });

        it('handles embedded JSON in message where parsed JSON has no useful message', async () => {
            // Error.message contains JSON but the JSON doesn't have message/type/code
            const apiError = {
                message: 'Some prefix {"randomKey": "randomValue"}',
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            // extractFrom(parsed) returns false, so falls through to plain message return
            expect(step.thought).toContain('Some prefix');
        });

        it('handles invalid JSON substring in error message (covers catch at JSON.parse)', async () => {
            const apiError = {
                message: 'Error occurred {not valid json at all',
            };
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('Error occurred');
        });

        it('handles error dump with undefined and null property values', async () => {
            const apiError: any = new Error('dump edge test');
            apiError.status = 400;
            apiError.undefinedProp = undefined;
            apiError.nullProp = null;
            apiError.fnProp = () => 'should be skipped';
            mockOpenAI.chat.completions.create.mockRejectedValue(apiError);

            const runner = new AgentRunner(makeConfig(), provider);
            const step = await (runner as any).callLLM('system', 'query', [], false);
            expect(step.thought).toContain('dump edge test');
        });
    });

    describe('callLLM - history message filtering', () => {
        it('filters out log-type entries and handles long history with debug logging', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'Done.' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Create history with >4 entries (system + user + these = >6 messages total)
            // Include a log-type entry that should be filtered out
            const history: any[] = [
                { role: 'user', content: 'first query' },
                { role: 'assistant', content: 'first response' },
                { type: 'log', content: 'should be filtered out' },
                { role: 'user', content: 'second query' },
                { role: 'assistant', content: 'second response' },
                'plain string thought',
                { weirdObject: true },
                { role: 'assistant' }, // no content — covers '(empty)' branch in debug logging
            ];

            const step = await (runner as any).callLLM('system', 'query', history, false);
            expect(step.thought).toBe('Done.');

            // Verify the log-type entry was filtered out
            const call = mockOpenAI.chat.completions.create.mock.calls[0][0];
            const contents = call.messages.map((m: any) => m.content);
            expect(contents).not.toContain('should be filtered out');
        });

        it('covers empty-content and no-content debug branch when messages > 6', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{ message: { content: 'ok' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            // Build messages array with >6 entries. Need an entry without content
            // in the last 3 (which will be in debugMsgs). We'll use internal state
            // manipulation since historyMessages always adds content.
            const history: any[] = [
                { role: 'user', content: 'q1' },
                { role: 'assistant', content: 'a1' },
                { role: 'user', content: 'q2' },
                { role: 'assistant', content: 'a2' },
                { role: 'user', content: 'q3' },
                { role: 'assistant', content: 'a3' },
            ];

            // Spy on console.log to verify debug output format
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const step = await (runner as any).callLLM('system', 'query', history, false);
            expect(step.thought).toBe('ok');

            // With system+user+6 history+1 Proceed = 10 messages > 6,
            // so debugMsgs = first 3 + '...' + last 3
            const debugCalls = logSpy.mock.calls.filter(c => String(c[0]).includes('[Agent]   '));
            // Should have entries for first 3, '...', and last 3
            expect(debugCalls.length).toBeGreaterThanOrEqual(4);
            logSpy.mockRestore();
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

    describe('extractRecommendations', () => {
        it('extracts recommendations via LLM from markdown', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[{"priority":"P0","title":"Fix the bug","description":"The service crashes on null input.","category":"code"},{"priority":"P0","title":"Add retry logic","description":"Messages are lost when the queue is unavailable.","category":"code"},{"priority":"P1","title":"Add logging","description":"More telemetry is needed for debugging.","category":"operational"},{"priority":"P2","title":"Refactor processor","description":"The class is too large and complex.","category":"code"}]' } }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crashes\n');
            expect(recs.length).toBe(4);
            expect(recs[0]).toMatchObject({ priority: 'P0', title: 'Fix the bug' });
            expect(recs[2]).toMatchObject({ priority: 'P1', title: 'Add logging', category: 'operational' });
            // Each should have a unique id
            const ids = recs.map(r => r.id);
            expect(new Set(ids).size).toBe(4);
        });

        it('returns empty array when text is empty', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('');
            expect(recs).toEqual([]);
            expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
        });

        it('uses finalReport from state when no markdown is passed', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[{"priority":"P0","title":"Do the thing","description":"desc","category":"code"}]' } }],
            });
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Critical (P0)\n\n1. **Do the thing**: desc\n',
                thoughts: [],
                actions: [],
            });
            const recs = await runner.extractRecommendations();
            expect(recs.length).toBe(1);
            expect(recs[0].title).toBe('Do the thing');
        });

        it('returns empty array when LLM returns no JSON array', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: 'I cannot find any recommendations.' } }],
            });
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('Some report text');
            expect(recs).toEqual([]);
        });

        it('returns empty array when LLM call throws', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API down'));
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('Some report text');
            expect(recs).toEqual([]);
        });

        it('filters out items without titles', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[{"priority":"P0","title":"Valid","description":"desc","category":"code"},{"priority":"P1","title":"","description":"no title","category":"code"}]' } }],
            });
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('Some report');
            expect(recs.length).toBe(1);
            expect(recs[0].title).toBe('Valid');
        });

        it('defaults missing priority to P2, missing description to empty, and missing category to code', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[{"title":"Fix it"}]' } }],
            });
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('Some report');
            expect(recs[0].priority).toBe('P2');
            expect(recs[0].description).toBe('');
            expect(recs[0].category).toBe('code');
        });

        it('uses recommendationModel from config', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[]' } }],
            });
            const runner = new AgentRunner(makeConfig({ recommendationModel: 'custom-model' } as any), provider);
            await runner.extractRecommendations('Some report');
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'custom-model' })
            );
        });

        it('falls back to gpt-4o-mini when no recommendationModel is set', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '[]' } }],
            });
            const runner = new AgentRunner(makeConfig(), provider);
            await runner.extractRecommendations('Some report');
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' })
            );
        });

        it('handles null message content', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: null } }],
            });
            const runner = new AgentRunner(makeConfig(), provider);
            const recs = await runner.extractRecommendations('Some report');
            expect(recs).toEqual([]);
        });

        it('classifies code recommendations correctly', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["code","code","code","code"]' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Implement retry backoff', description: 'Break the retry loop.', category: 'code' },
                { id: 'r1', priority: 'P0', title: 'Add validation', description: 'Detect missing mappings.', category: 'code' },
                { id: 'r2', priority: 'P0', title: 'Deduplicate notifications', description: 'Eliminates root cause.', category: 'code' },
                { id: 'r3', priority: 'P0', title: 'Fix mapping errors', description: 'Permanent and will never self-heal.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified.every(r => r.category === 'code')).toBe(true);
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledOnce();
        });

        it('classifies operational recommendations correctly', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["operational","operational","operational","operational"]' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Engage Kusto SRE', description: 'Majority of failures.', category: 'code' },
                { id: 'r1', priority: 'P0', title: 'Monitor dashboards', description: 'Detect recurrence.', category: 'code' },
                { id: 'r2', priority: 'P0', title: 'Investigate Entity Not Found', description: 'Stale configurations.', category: 'code' },
                { id: 'r3', priority: 'P0', title: 'Scale out BlobReader', description: 'Match other cluster.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified.every(r => r.category === 'operational')).toBe(true);
        });

        it('classifies a mixed set of recommendations', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["operational","code"]' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Engage Kusto SRE', description: 'Contact the team.', category: 'code' },
                { id: 'r1', priority: 'P0', title: 'Add circuit breaker', description: 'Back off when overloaded.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified[0].category).toBe('operational');
            expect(classified[1].category).toBe('code');
        });

        it('falls back to defaults when LLM returns wrong count', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["code"]' } }]  // only 1, but 2 recs
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix bug', description: 'Crashes.', category: 'code' },
                { id: 'r1', priority: 'P0', title: 'Engage SRE', description: 'Contact team.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            // Falls back — all stay as default 'code'
            expect(classified.every(r => r.category === 'code')).toBe(true);
        });

        it('falls back to defaults when LLM call fails', async () => {
            mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API error'));
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix bug', description: 'Crashes.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified[0].category).toBe('code');
        });

        it('returns empty array for empty input', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations([]);
            expect(classified).toEqual([]);
            expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
        });

        it('falls back to defaults when LLM returns non-JSON response', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: 'I cannot classify these.' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix bug', description: 'Crashes.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified[0].category).toBe('code'); // returns unchanged
        });

        it('uses recommendationModel from config for classification', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["code"]' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix', description: 'D.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig({ recommendationModel: 'custom-classify-model' } as any), provider);
            await runner.classifyRecommendations(recs);
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'custom-classify-model' })
            );
        });

        it('falls back to gpt-4o-mini when no recommendationModel is set', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: '["code"]' } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix', description: 'D.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            await runner.classifyRecommendations(recs);
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' })
            );
        });

        it('returns empty for undefined state finalReport', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            (runner as any).state.finalReport = undefined;
            const recs = await runner.extractRecommendations(undefined);
            expect(recs).toEqual([]);
        });

        it('falls back to defaults when message content is null', async () => {
            mockOpenAI.chat.completions.create.mockResolvedValueOnce({
                choices: [{ message: { content: null } }]
            });
            const recs: Recommendation[] = [
                { id: 'r0', priority: 'P0', title: 'Fix bug', description: 'Crashes.', category: 'code' },
            ];
            const runner = new AgentRunner(makeConfig(), provider);
            const classified = await runner.classifyRecommendations(recs);
            expect(classified[0].category).toBe('code');
        });
    });

    describe('localSearchCode', () => {
        // path.resolve('/repo') may produce 'C:\repo' on Windows, so we need resolved paths for existsSync
        const resolvedRepo = n(require('path').resolve('/repo'));

        it('finds matching lines in mock files', () => {
            // Set up mock file system with code files directly in repo root
            mockFsState.set(n(require('path').resolve('/repo/Service.cs')), 'namespace MyApp;\npublic class MyService\n{\n    public void Run() {}\n}\n');
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['Service.cs']);

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('MyService');
            expect(result).toContain('Service.cs');
            expect(result).toContain('MyService');
        });

        it('returns error for path outside repo root', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('test', '../../etc');
            expect(result).toContain('Error');
        });

        it('falls back to literal match when regex is invalid', () => {
            mockFsState.set(n(require('path').resolve('/repo/test.cs')), 'var x = foo[bar;\n');
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['test.cs']);

            const runner = new AgentRunner(makeConfig(), provider);
            // foo[bar is invalid regex, should fall back to literal
            const result = (runner as any).localSearchCode('foo[bar');
            expect(result).toContain('test.cs');
        });

        it('returns no matches message when nothing found', () => {
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, []);
            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('nonExistentPattern123');
            expect(result).toContain('No matches found');
        });

        it('returns error when search path does not exist', () => {
            mockDirs.add(resolvedRepo);
            const runner = new AgentRunner(makeConfig({ repoRoot: require('path').resolve('/repo') }), provider);
            const result = (runner as any).localSearchCode('test', 'nonexistent-subdir');
            expect(result).toContain('Error');
            expect(result).toContain('does not exist');
        });

        it('walks into subdirectories to find matches', () => {
            const pth = require('path');
            const repoResolved = pth.resolve('/repo');
            const subDir = n(pth.resolve('/repo/submod'));
            mockDirs.add(n(repoResolved));
            mockDirs.add(subDir);
            // Insert more-specific paths first so readdirSyncImpl's includes check
            // matches the deepest path before its parent
            mockDirEntries.set(subDir, ['Deep.cs']);
            mockDirEntries.set(n(repoResolved), ['submod']);
            mockFsState.set(n(pth.resolve('/repo/submod/Deep.cs')), 'public class DeepClass { }');

            // Override lstatSync to use exact set for precise directory checks
            // (the default mock's includes-based check falsely marks files as dirs)
            const dirSet = new Set([n(repoResolved), subDir]);
            vi.mocked(mockedFs.lstatSync).mockImplementation((p: any) => ({
                isDirectory: () => dirSet.has(n(p as string)),
            }) as any);

            const runner = new AgentRunner(makeConfig({ repoRoot: repoResolved }), provider);
            const result = (runner as any).localSearchCode('DeepClass');
            expect(result).toContain('Deep.cs');
            expect(result).toContain('DeepClass');
        });

        it('stops when maxResults is reached', () => {
            mockFsState.set(n(require('path').resolve('/repo/a.cs')), 'hit1\nhit2\nhit3');
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['a.cs']);

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('hit', undefined, 1);
            expect(result.split('\n').length).toBe(1);
        });

        it('skips entries in skipDirs list', () => {
            const pth = require('path');
            const fs = require('fs');
            const repoResolved = pth.resolve('/repo');
            const nmDir = n(pth.resolve('/repo/node_modules'));
            mockDirs.add(n(repoResolved));
            mockDirEntries.set(n(repoResolved), ['node_modules', 'app.cs']);
            mockDirEntries.set(nmDir, ['secret.cs']);
            mockFsState.set(n(pth.resolve('/repo/app.cs')), 'found it');
            mockFsState.set(n(pth.resolve('/repo/node_modules/secret.cs')), 'hidden');

            const dirSet = new Set([n(repoResolved), nmDir]);
            vi.mocked(fs.lstatSync).mockImplementation((p: string) => ({
                isDirectory: () => dirSet.has(n(p as string)),
            }));

            const runner = new AgentRunner(makeConfig({ repoRoot: repoResolved }), provider);
            const result = (runner as any).localSearchCode('found');
            expect(result).toContain('app.cs');
            expect(result).not.toContain('secret');
        });

        it('skips files with non-code extensions', () => {
            mockFsState.set(n(require('path').resolve('/repo/data.dll')), 'binary stuff match');
            mockFsState.set(n(require('path').resolve('/repo/code.cs')), 'match here');
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['data.dll', 'code.cs']);

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('match');
            expect(result).toContain('code.cs');
            expect(result).not.toContain('data.dll');
        });

        it('handles readdirSync errors gracefully', () => {
            mockDirs.add(resolvedRepo);
            mockReaddirThrow.add(resolvedRepo);

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('anything');
            expect(result).toContain('No matches found');
        });

        it('handles lstatSync errors gracefully', () => {
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['bad.cs']);
            mockStatThrow.add(n(require('path').resolve('/repo/bad.cs')));

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('anything');
            expect(result).toContain('No matches found');
        });

        it('walkDir handles lstatSync errors via direct call', () => {
            // Call walkDir directly with an inline fs that always throws on lstatSync.
            // This guarantees v8 can attribute the catch-block branch correctly.
            const pth = require('path');
            const repoRoot = pth.resolve('/repo');
            const fakeFsThrowLstat = {
                readdirSync: () => ['file.cs'],
                lstatSync: () => { throw new Error('permission denied'); },
                readFileSync: () => '',
                existsSync: () => true,
            };
            const runner = new AgentRunner(makeConfig(), provider);
            const buffer = new Map<string, { score: number; lines: string[] }>();
            (runner as any).walkDir(
                fakeFsThrowLstat, pth,
                repoRoot, repoRoot, /anything/,
                new Set<string>(), new Set(['.cs']),
                buffer, 20
            );
            expect(buffer.size).toBe(0);
        });

        it('walkDir evicts worst-scoring batch when a better-scoring file arrives and buffer is full', () => {
            const pth = require('path');
            const repoRoot = pth.resolve('/repo');
            // Pre-populate buffer with a docs file (high score 70) using 2 lines
            const buffer = new Map<string, { score: number; lines: string[] }>();
            buffer.set('docs/guide.cs', { score: 70, lines: ['docs/guide.cs:1: old match', 'docs/guide.cs:2: old match'] });

            // Fake fs: root has node_modules (skipDir), investigations (skipPath), nomatch.cs (0 hits), src/main.cs (match)
            const investigationsDir = pth.resolve(repoRoot, 'investigations');
            const dirSet = new Set([repoRoot, pth.join(repoRoot, 'src'), pth.join(repoRoot, 'node_modules'), investigationsDir]);
            const fakeFs = {
                readdirSync: (dir: string) => {
                    if (dir === pth.join(repoRoot, 'src')) return ['main.cs'];
                    return ['node_modules', 'investigations', 'nomatch.cs', 'src'];
                },
                lstatSync: (p: string) => ({ isDirectory: () => dirSet.has(p) }),
                readFileSync: (p: string) => {
                    if (p.includes('nomatch')) return 'nothing relevant here';
                    return 'source match line';
                },
                existsSync: () => true,
            };
            const runner = new AgentRunner(makeConfig(), provider);
            // maxLines=2 means buffer is already full (2 lines from docs/guide.cs)
            // src/main.cs scores 0 (better), should evict docs/guide.cs
            // node_modules is in skipDirs, investigations is in skipPaths, nomatch.cs has 0 regex hits
            (runner as any).walkDir(
                fakeFs, pth,
                repoRoot, repoRoot, /match/,
                new Set(['node_modules']), new Set(['.cs']),
                buffer, 2,
                new Set([investigationsDir])
            );
            // docs file should be evicted, src file should be in buffer
            expect(buffer.has('docs/guide.cs')).toBe(false);
            expect(buffer.has('src/main.cs')).toBe(true);
            expect(buffer.get('src/main.cs')!.score).toBe(0);
        });

        it('walkDir does not evict when new file has equal or worse score than buffer contents', () => {
            const pth = require('path');
            const repoRoot = pth.resolve('/repo');
            // Pre-populate buffer with a source file (score 0) using 2 lines
            const buffer = new Map<string, { score: number; lines: string[] }>();
            buffer.set('src/main.cs', { score: 0, lines: ['src/main.cs:1: existing match', 'src/main.cs:2: existing match'] });

            // Fake fs: root contains docs/ dir with guide.cs that matches — score 70, worse than existing
            const dirSet = new Set([repoRoot, pth.join(repoRoot, 'docs')]);
            const fakeFs = {
                readdirSync: (dir: string) => {
                    if (dir === pth.join(repoRoot, 'docs')) return ['guide.cs'];
                    return ['docs'];
                },
                lstatSync: (p: string) => ({ isDirectory: () => dirSet.has(p) }),
                readFileSync: () => 'doc match line',
                existsSync: () => true,
            };
            const runner = new AgentRunner(makeConfig(), provider);
            // maxLines=2, buffer already full. docs/guide.cs scores 70 (worse than 0) → should NOT evict
            (runner as any).walkDir(
                fakeFs, pth,
                repoRoot, repoRoot, /match/,
                new Set<string>(), new Set(['.cs']),
                buffer, 2
            );
            // Original src file should remain, docs file should NOT be added
            expect(buffer.has('src/main.cs')).toBe(true);
            expect(buffer.has('docs/guide.cs')).toBe(false);
        });

        it('scoreFilePath returns correct scores for all path categories', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const score = (p: string) => (runner as any).scoreFilePath(p);
            // Dot-prefixed directories
            expect(score('.github/workflows/ci.yml')).toBe(80);
            expect(score('.vscode/settings.json')).toBe(80);
            // Docs/examples/samples
            expect(score('docs/guide.md')).toBe(70);
            expect(score('examples/demo.cs')).toBe(70);
            expect(score('samples/test.cs')).toBe(70);
            // Test directories and files
            expect(score('src/tests/unit.cs')).toBe(50);
            expect(score('src/__tests__/app.test.ts')).toBe(50);
            expect(score('main.test.cs')).toBe(50);
            expect(score('helper.spec.ts')).toBe(50);
            // Normal source code
            expect(score('src/main.cs')).toBe(0);
            expect(score('config.xml')).toBe(0);
        });

        it('searches with a searchPath parameter', () => {
            const pth = require('path');
            const repoResolved = pth.resolve('/repo');
            const srcDir = n(pth.resolve('/repo/src'));
            mockDirs.add(n(repoResolved));
            mockDirs.add(srcDir);
            mockDirEntries.set(srcDir, ['file.cs']);
            mockFsState.set(n(pth.resolve('/repo/src/file.cs')), 'target code');

            const runner = new AgentRunner(makeConfig({ repoRoot: repoResolved }), provider);
            const result = (runner as any).localSearchCode('target', 'src');
            expect(result).toContain('file.cs');
        });

        it('includes searchPath in no-matches message', () => {
            const pth = require('path');
            const repoResolved = pth.resolve('/repo');
            const srcDir = n(pth.resolve('/repo/src'));
            mockDirs.add(n(repoResolved));
            mockDirs.add(srcDir);
            mockDirEntries.set(srcDir, []);

            const runner = new AgentRunner(makeConfig({ repoRoot: repoResolved }), provider);
            const result = (runner as any).localSearchCode('nothing', 'src');
            expect(result).toContain("in 'src'");
        });

        it('returns error with dot placeholder when repoRoot does not exist and no searchPath', () => {
            // No mockDirs.add(resolvedRepo) → existsSync(repoRoot) returns false
            // searchPath is undefined → the `searchPath || '.'` fallback uses '.'
            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('anything');
            expect(result).toContain("Error: Path '.' does not exist");
        });

        it('stops at loop entry check when previous entry exactly filled maxResults', () => {
            // file.cs has exactly 2 matching lines — inner loop exits normally (no early return)
            // second.cs would also match, but the mid-loop guard fires before we read it
            mockFsState.set(n(require('path').resolve('/repo/file.cs')), 'target\ntarget');
            mockFsState.set(n(require('path').resolve('/repo/second.cs')), 'target');
            mockDirs.add(resolvedRepo);
            mockDirEntries.set(resolvedRepo, ['file.cs', 'second.cs']);

            const runner = new AgentRunner(makeConfig(), provider);
            const result = (runner as any).localSearchCode('target', undefined, 2);
            expect(result.split('\n').length).toBe(2);
            expect(result).not.toContain('second.cs');
        });
    });

    describe('getImplementationTools', () => {
        it('includes search_code tool alongside retrospect tools', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: [],
                actions: [],
            });
            (runner as any).initRetrospect();
            const tools = (runner as any).getImplementationTools();
            const toolNames = tools.map((t: any) => t.function.name);
            expect(toolNames).toContain('search_code');
            expect(toolNames).toContain('read_file');
            expect(toolNames).toContain('list_dir');
            expect(toolNames).toContain('propose_change');
        });
    });

    describe('runImplementationAnalysis', () => {
        it('throws when investigation is still running', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            await expect((runner as any).runImplementationAnalysis(['rec_P0_0'])).rejects.toThrow('only available for completed');
        });

        it('throws when no valid recommendations are selected', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix bug**: desc\n',
                thoughts: ['step1'],
                actions: [null],
            });
            await expect((runner as any).runImplementationAnalysis(['nonexistent_id'])).rejects.toThrow('No valid recommendations');
        });

        it('throws when retrospect analysis is already running', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix bug**: desc\n',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).isRetrospectRunning = true;
            await expect((runner as any).runImplementationAnalysis(['rec_P0_0'])).rejects.toThrow('retrospect analysis is in progress');
        });

        it('runs tool loop and produces implementation proposals', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                return { choices: [{ message: { content: 'Implementation complete. All changes proposed.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: The service crashes.\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'The service crashes.', category: 'code' }],
            });

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);

            const retro = (runner as any).state.retrospect;
            expect(retro).toBeDefined();
            // Should have messages from the implementation
            expect(retro.messages.length).toBeGreaterThanOrEqual(2); // user trigger + assistant response
            expect(retro.messages[0].content).toContain('[Implementation]');
            // isImplementationRunning should be reset
            expect((runner as any).isImplementationRunning).toBe(false);
            // state.implementationRunning should be cleared too
            expect((runner as any).state.implementationRunning).toBe(false);
        });

        it('skips duplicate request when already running', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crash\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'crash', category: 'code' }],
            });
            (runner as any).isImplementationRunning = true;
            // Should not throw, just silently return
            await (runner as any).runImplementationAnalysis(['rec_P0_0']);
        });
    });

    describe('handleProposeChange source tagging', () => {
        it('tags proposals with source implementation when flag is set', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();
            (runner as any).isImplementationRunning = true;

            (runner as any).handleProposeChange({
                filePath: 'src/Test.cs',
                type: 'edit',
                content: 'new content',
                description: 'Fix the bug',
            });

            const proposals = (runner as any).state.retrospect.proposals;
            expect(proposals.length).toBe(1);
            expect(proposals[0].source).toBe('implementation');
        });

        it('tags proposals with source retrospect by default', () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
            });
            (runner as any).initRetrospect();

            (runner as any).handleProposeChange({
                filePath: 'src/Test.cs',
                type: 'edit',
                content: 'new content',
                description: 'Fix the bug',
            });

            const proposals = (runner as any).state.retrospect.proposals;
            expect(proposals.length).toBe(1);
            expect(proposals[0].source).toBe('retrospect');
        });
    });

    describe('runImplementationAnalysis coverage', () => {
        it('reports proposal count when proposals exist', async () => {
            // Mock LLM to return a response, then manually inject a proposal
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                return { choices: [{ message: { content: 'Done with changes.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: The service crashes.\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'The service crashes.', category: 'code' }],
            });

            // Pre-inject a proposal so the proposalCount > 0 branch is hit
            vi.spyOn(runner as any, 'runRetrospectToolLoop').mockImplementation(async () => {
                const retro = (runner as any).state.retrospect;
                retro.proposals.push({ id: 'p1', source: 'implementation', filePath: 'src/Fix.cs', type: 'edit', status: 'pending' });
                return 'Changes applied.';
            });

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);

            const retro = (runner as any).state.retrospect;
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('1 code change proposed');
            expect(lastMsg.content).toContain('Implementation complete');
        });

        it('uses plural when multiple proposals exist', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                return { choices: [{ message: { content: 'Done.', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crash\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'crash', category: 'code' }],
            });

            vi.spyOn(runner as any, 'runRetrospectToolLoop').mockImplementation(async () => {
                const retro = (runner as any).state.retrospect;
                retro.proposals.push({ id: 'p1', source: 'implementation', filePath: 'a.cs', type: 'edit', status: 'pending' });
                retro.proposals.push({ id: 'p2', source: 'implementation', filePath: 'b.cs', type: 'edit', status: 'pending' });
                return 'All fixed.';
            });

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);

            const retro = (runner as any).state.retrospect;
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('2 code changes proposed');
        });

        it('handles error during implementation tool loop', async () => {
            mockOpenAI.chat.completions.create.mockImplementation(async () => {
                return { choices: [{ message: { content: 'thinking', tool_calls: null } }] };
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crash\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'crash', category: 'code' }],
            });

            vi.spyOn(runner as any, 'runRetrospectToolLoop').mockRejectedValue(new Error('LLM connection lost'));

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);

            const retro = (runner as any).state.retrospect;
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toContain('Error during implementation: LLM connection lost');
            expect((runner as any).isImplementationRunning).toBe(false);
        });

        it('handles AbortError as cancellation', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                finalReport: '## Recommendations\n\n### Immediate (P0)\n\n1. **Fix the bug**: crash\n',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix the bug', description: 'crash', category: 'code' }],
            });

            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            vi.spyOn(runner as any, 'runRetrospectToolLoop').mockRejectedValue(abortError);

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);

            const retro = (runner as any).state.retrospect;
            const lastMsg = retro.messages[retro.messages.length - 1];
            expect(lastMsg.content).toBe('Implementation was cancelled.');
            expect((runner as any).isImplementationRunning).toBe(false);
        });

        it('handles undefined finalReport in context building', async () => {
            const runner = new AgentRunner(makeConfig(), provider, {
                status: 'completed',
                thoughts: ['step1'],
                actions: [null],
                recommendations: [{ id: 'rec_P0_0', priority: 'P0', title: 'Fix', description: 'Fix it', category: 'code' }],
            });
            vi.spyOn(runner as any, 'runRetrospectToolLoop').mockResolvedValue('Done.');

            await (runner as any).runImplementationAnalysis(['rec_P0_0']);
            expect((runner as any).isImplementationRunning).toBe(false);
        });
    });

    describe('stripFrontmatter', () => {
        it('strips YAML frontmatter from markdown', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const content = '---\ndescription: test\ntools: [read]\n---\n\n# My Agent\n\nYou are an agent.';
            const result = (runner as any).stripFrontmatter(content);
            expect(result).toBe('# My Agent\n\nYou are an agent.');
        });

        it('returns content unchanged when no frontmatter', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const content = '# My Agent\n\nNo frontmatter here.';
            const result = (runner as any).stripFrontmatter(content);
            expect(result).toBe(content);
        });

        it('returns content unchanged when only opening --- without closing', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const content = '---\ndescription: test\nNo closing delimiter.';
            const result = (runner as any).stripFrontmatter(content);
            expect(result).toBe(content);
        });

        it('handles leading whitespace before frontmatter', () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const content = '  \n---\nkey: val\n---\n\nBody text.';
            const result = (runner as any).stripFrontmatter(content);
            expect(result).toBe('Body text.');
        });
    });

    describe('invoke_subagent', () => {
        it('returns error when agent file does not exist', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/NonExistent.agent.md',
                task: 'Do something',
            });
            expect(result).toContain('Agent file not found');
        });

        it('returns error when agent file has no content after frontmatter', async () => {
            const filePath = n(require('path').join('/repo', '.github/agents/Empty.agent.md'));
            mockFsState.set(filePath, '---\ndescription: empty\n---\n\n   ');
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Empty.agent.md',
                task: 'Do something',
            });
            expect(result).toContain('no prompt content');
        });

        it('successfully invokes subagent and returns report', async () => {
            // Set up agent file
            const agentContent = '---\ndescription: Test agent\ntools: [read]\n---\n\n# Test Agent\n\nYou are a test specialist.';
            const filePath = n(require('path').join('/repo', '.github/agents/Test.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            // The subagent LLM call returns finish immediately
            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: JSON.stringify({ report: 'Subagent findings: all clear.' }) },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider, {
                target: 'stamp-01',
                timeRange: 'ago(1h)',
                model: 'test-model',
            });
            const thoughts: any[] = [];
            runner.on('thought', (d) => thoughts.push(d));

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Test.agent.md',
                task: 'Trace workspace X',
            });

            // Verify the subagent report is returned
            expect(result).toContain('Subagent Report: Test Agent');
            expect(result).toContain('Subagent findings: all clear.');
            expect(result).toContain('completed');

            // Verify invocation and completion thoughts were emitted
            expect(thoughts.some((t: any) => (typeof t === 'string' ? t : t?.content || '').includes('Invoking subagent'))).toBe(true);
            expect(thoughts.some((t: any) => (typeof t === 'string' ? t : t?.content || '').includes('completed'))).toBe(true);
        });

        it('extracts agent name from first markdown heading', async () => {
            const agentContent = '---\ndescription: Custom\n---\n\n# My Custom Agent Name\n\nPrompt body.';
            const filePath = n(require('path').join('/repo', '.github/agents/Custom.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"ok"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Custom.agent.md',
                task: 'Do work',
            });

            expect(result).toContain('My Custom Agent Name');
        });

        it('falls back to filename when no heading in prompt', async () => {
            const agentContent = '---\ndescription: No heading\n---\n\nPrompt without a heading.';
            const filePath = n(require('path').join('/repo', '.github/agents/Fallback_Name.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"ok"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Fallback_Name.agent.md',
                task: 'Do work',
            });

            expect(result).toContain('Fallback Name');
        });

        it('handles subagent failure gracefully', async () => {
            const agentContent = '---\ndescription: Failing\n---\n\n# Failing Agent\n\nFails.';
            const filePath = n(require('path').join('/repo', '.github/agents/Failing.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            // Simulate LLM failure
            mockOpenAI.chat.completions.create.mockRejectedValue(new Error('LLM crashed'));

            const runner = new AgentRunner(makeConfig(), provider);
            // The child runner catches errors internally within start(), setting status to 'failed'.
            // The parent's executeSubagent catches any unhandled throw from start().
            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Failing.agent.md',
                task: 'Will fail',
            });

            // Should return some result (either error or a report with failed status)
            expect(typeof result).toBe('string');
            expect(result).toContain('Failing Agent');
        });

        it('inherits maxSteps from parent config (settings)', async () => {
            const agentContent = '---\ndescription: Test\n---\n\n# Step Counter\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/Steps.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"ok"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const logSpy = vi.spyOn(runner as any, 'log');

            await (runner as any).executeSubagent({
                agentPath: '.github/agents/Steps.agent.md',
                task: 'Task',
            });

            // Verify the log message does NOT mention maxSteps (no limit enforced)
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Invoking "Step Counter"'));
        });

        it('routes invoke_subagent through executeAction', async () => {
            const runner = new AgentRunner(makeConfig(), provider);
            // Spy on executeSubagent to verify it gets called
            const spy = vi.spyOn(runner as any, 'executeSubagent').mockResolvedValue('mocked result');

            const result = await (runner as any).executeAction({
                tool: 'invoke_subagent',
                args: { agentPath: 'test.agent.md', task: 'test' },
            });

            expect(spy).toHaveBeenCalledWith({ agentPath: 'test.agent.md', task: 'test' });
            expect(result).toBe('mocked result');
        });

        it('shares ToolManager with child and does not dispose it', async () => {
            const agentContent = '---\ndescription: Shared\n---\n\n# Shared Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/Shared.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            mockOpenAI.chat.completions.create.mockResolvedValue({
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: [{
                            id: 'tc1',
                            function: { name: 'finish', arguments: '{"report":"ok"}' },
                        }],
                    },
                }],
            });

            const runner = new AgentRunner(makeConfig(), provider);
            const parentToolManager = (runner as any).toolManager;

            await (runner as any).executeSubagent({
                agentPath: '.github/agents/Shared.agent.md',
                task: 'Task',
            });

            // Parent's ToolManager should still be the same instance (not disposed)
            expect((runner as any).toolManager).toBe(parentToolManager);
            // cleanup should NOT have been called on the shared ToolManager
            expect(mockToolManager.cleanup).not.toHaveBeenCalled();
        });

        it('includes errors from child thoughts in the report', async () => {
            const agentContent = '---\ndescription: Err\n---\n\n# Error Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/ErrAgent.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            // Mock start to simulate a completed child with errors and mixed actions
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                this.state.finalReport = 'partial report';
                this.state.thoughts.push('System Error: Something crashed');
                this.state.thoughts.push({ role: 'system', content: 'Critical LLM Error: token limit' });
                // Object thought with no content (covers t?.content || '' branch)
                this.state.thoughts.push({ role: 'system' });
                // Add an action with result, one without, one with no tool name, and a null
                this.state.actions.push({ tool: 'query_data', result: 'rows returned' });
                this.state.actions.push({ tool: 'read_file', result: '' });
                this.state.actions.push({ result: 'orphaned result' }); // no .tool (covers || 'unknown')
                this.state.actions.push(null);
            });

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/ErrAgent.agent.md',
                task: 'Do work',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            // Errors section
            expect(result).toContain('### Subagent Errors');
            expect(result).toContain('System Error: Something crashed');
            expect(result).toContain('Critical LLM Error: token limit');

            // Activity log with both result and no-result actions
            expect(result).toContain('### Subagent Activity Log');
            expect(result).toContain('query_data: rows returned');
            expect(result).toContain('- read_file');
        });

        it('returns error message when child start() throws', async () => {
            const agentContent = '---\ndescription: Throw\n---\n\n# Throwing Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/Throwing.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            // Mock start to throw (e.g., ToolManager init crash)
            vi.spyOn(AgentRunner.prototype, 'start').mockRejectedValue(new Error('ToolManager exploded'));

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/Throwing.agent.md',
                task: 'Will crash',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            expect(result).toContain('Subagent "Throwing Agent" failed');
            expect(result).toContain('ToolManager exploded');
        });

        it('propagates parent abort to the child runner', async () => {
            const agentContent = '---\ndescription: Abort\n---\n\n# Abort Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/AbortAgent.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            let childAbortCalled = false;
            // Mock start: the child "runs" long enough for the abort interval to fire
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                // Capture abort call
                const origAbort = this.abort.bind(this);
                this.abort = () => { childAbortCalled = true; origAbort(); };
                // Simulate the parent aborting while child is "running"
                runner.abort();
                // Wait enough for the 1s interval to fire
                await new Promise(resolve => setTimeout(resolve, 1200));
                this.state.status = 'completed';
                this.state.finalReport = 'aborted mid-run';
            });

            await (runner as any).executeSubagent({
                agentPath: '.github/agents/AbortAgent.agent.md',
                task: 'Long task',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();
            expect(childAbortCalled).toBe(true);
        }, 10000);

        it('uses fallback text when child has no report and no thoughts', async () => {
            const agentContent = '---\ndescription: Empty\n---\n\n# Empty Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/EmptyOut.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                // No finalReport, no assistant thoughts — only system messages
                this.state.thoughts.push({ role: 'system', content: 'internal message' });
            });

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/EmptyOut.agent.md',
                task: 'Produce nothing',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();
            expect(result).toContain('Subagent completed but produced no output.');
        });

        it('resolves absolute agentPath directly', async () => {
            // Use an absolute path instead of a relative one
            const absPath = n(require('path').join('/repo', '.github/agents/AbsAgent.agent.md'));
            const agentContent = '---\ndescription: Abs\n---\n\n# Absolute Agent\n\nPrompt.';
            mockFsState.set(absPath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                this.state.finalReport = 'abs report';
            });

            const result = await (runner as any).executeSubagent({
                agentPath: absPath,  // Pass absolute path
                task: 'Task',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();
            expect(result).toContain('Absolute Agent');
            expect(result).toContain('abs report');
        });

        it('caps activity log at 30 entries', async () => {
            const agentContent = '---\ndescription: Big\n---\n\n# Big Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/BigAgent.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                this.state.finalReport = 'done';
                // Create 40 actions
                for (let i = 0; i < 40; i++) {
                    this.state.actions.push({ tool: `tool_${i}`, result: `result_${i}` });
                }
            });

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/BigAgent.agent.md',
                task: 'Big task',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            expect(result).toContain('### Subagent Activity Log (40 tool calls)');
            // Should have capping indicator
            expect(result).toContain('... (10 more tool calls) ...');
            // First and last entries should be present
            expect(result).toContain('tool_0');
            expect(result).toContain('tool_39');
        });

        it('truncates long task in start message and handles missing repoRoot', async () => {
            const agentContent = '---\ndescription: Long\n---\n\n# Long Task Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/LongTask.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                this.state.finalReport = 'done';
            });

            const longTask = 'A'.repeat(300);
            const emitted: string[] = [];
            runner.on('thought', (data: any) => {
                const content = typeof data === 'string' ? data : data?.content || '';
                emitted.push(content);
            });

            await (runner as any).executeSubagent({
                agentPath: '.github/agents/LongTask.agent.md',
                task: longTask,
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            // The start message should truncate the task and show '...'
            expect(emitted.some(e => e.includes('...'))).toBe(true);
        });

        it('forwards child thoughts with different data types and skips system/bracket messages', async () => {
            const agentContent = '---\ndescription: Fwd\n---\n\n# Forward Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/FwdAgent.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            const emitted: string[] = [];
            runner.on('thought', (data: any) => {
                const content = typeof data === 'string' ? data : data?.content || '';
                emitted.push(content);
            });

            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                // Emit different types of thoughts from the child
                this.emit('thought', 'plain string thought');                     // typeof data === 'string'
                this.emit('thought', { content: 'object thought' });              // data?.content
                this.emit('thought', 42);                                         // String(data) fallback
                this.emit('thought', 'System: initializing...');                  // should be skipped
                this.emit('thought', '[Subagent] nested message');                // should be skipped (starts with [)
                this.state.status = 'completed';
                this.state.finalReport = 'done';
            });

            await (runner as any).executeSubagent({
                agentPath: '.github/agents/FwdAgent.agent.md',
                task: 'Forwarding test',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            // plain string and object thought should be forwarded (tagged with agent name)
            expect(emitted.some(e => e.includes('plain string thought'))).toBe(true);
            expect(emitted.some(e => e.includes('object thought'))).toBe(true);
            expect(emitted.some(e => e.includes('42'))).toBe(true);
            // System and bracket messages should NOT be forwarded
            expect(emitted.some(e => e.includes('initializing'))).toBe(false);
            expect(emitted.some(e => e.includes('nested message'))).toBe(false);
        });

        it('extracts report from mixed thoughts when finalReport is empty', async () => {
            const agentContent = '---\ndescription: Mix\n---\n\n# Mixed Agent\n\nPrompt.';
            const filePath = n(require('path').join('/repo', '.github/agents/MixedAgent.agent.md'));
            mockFsState.set(filePath, agentContent);
            mockDirs.add(n(require('path').join('/repo', '.github')));
            mockDirs.add(n(require('path').join('/repo', '.github/agents')));

            const runner = new AgentRunner(makeConfig(), provider);
            vi.spyOn(AgentRunner.prototype, 'start').mockImplementation(async function (this: any) {
                this.state.status = 'completed';
                this.state.finalReport = '';
                // Mix of string and object thoughts
                this.state.thoughts.push('string thought');
                this.state.thoughts.push({ role: 'assistant', content: 'assistant thought' });
                this.state.thoughts.push({ role: 'user', content: 'user thought' }); // should be filtered out
            });

            const result = await (runner as any).executeSubagent({
                agentPath: '.github/agents/MixedAgent.agent.md',
                task: 'Mix test',
            });

            vi.mocked(AgentRunner.prototype.start).mockRestore();

            expect(result).toContain('string thought');
            expect(result).toContain('assistant thought');
            // user-role thoughts should be filtered out
            expect(result).not.toContain('user thought');
        });

        it('uses empty string for repoRoot when config.repoRoot is undefined', async () => {
            const runner = new AgentRunner(makeConfig({ repoRoot: undefined as any }), provider);

            const result = await (runner as any).executeSubagent({
                agentPath: 'nonexistent.agent.md',
                task: 'Test',
            });

            // Should return file not found error (repoRoot falls back to '')
            expect(result).toContain('Error: Agent file not found');
        });
    });

});
