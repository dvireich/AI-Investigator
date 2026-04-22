import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    runSingleAgent,
    substituteTemplate,
    loadAgentPrompt,
    extractLastReport,
    SingleAgentContext,
} from '../../../agent/pipeline/SingleAgentRunner';
import { AgentDefinition } from '../../../agent/pipeline/AgentDefinition';
import { AgentConfig } from '../../../agent/Runner';

describe('substituteTemplate', () => {
    it('substitutes all known fields', () => {
        const ctx: SingleAgentContext = {
            goal: 'g', target: 't', category: 'c', status: 's', verdict: 'v',
            report: 'r', recommendationsJson: 'rj', notesText: 'nt',
            scheduleName: 'sn', scheduleTarget: 'st',
            scheduleStatsTable: 'sst', scheduleHistoryDigest: 'shd',
            knowledgeBaseFiles: 'kb', plan: 'p',
        };
        const out = substituteTemplate(
            '{{GOAL}}|{{TARGET}}|{{CATEGORY}}|{{STATUS}}|{{VERDICT}}|{{REPORT}}|{{RECOMMENDATIONS_JSON}}|{{NOTES_TEXT}}|{{SCHEDULE_NAME}}|{{SCHEDULE_TARGET}}|{{SCHEDULE_STATS_TABLE}}|{{SCHEDULE_HISTORY_DIGEST}}|{{KNOWLEDGE_BASE_FILES}}|{{PLAN}}',
            ctx
        );
        expect(out).toBe('g|t|c|s|v|r|rj|nt|sn|st|sst|shd|kb|p');
    });

    it('substitutes missing fields with empty string', () => {
        expect(substituteTemplate('A{{GOAL}}B', {})).toBe('AB');
    });

    it('substitutes custom keys verbatim', () => {
        expect(substituteTemplate('X={{FOO}} Y={{BAR}}', { custom: { FOO: '1', BAR: '2' } })).toBe('X=1 Y=2');
    });

    it('replaces multiple occurrences globally', () => {
        expect(substituteTemplate('{{GOAL}}-{{GOAL}}', { goal: 'x' })).toBe('x-x');
    });
});

describe('extractLastReport', () => {
    it('returns empty when no pipeline', () => {
        expect(extractLastReport({} as any)).toBe('');
    });

    it('returns empty when conversationLog has no report entries', () => {
        const state = { pipeline: { conversationLog: [
            { agentId: 'a', agentName: 'A', role: 'thought', content: 'thinking', timestamp: 0, stageIndex: 0 },
        ] } } as any;
        expect(extractLastReport(state)).toBe('');
    });

    it('returns the most recent report entry', () => {
        const state = { pipeline: { conversationLog: [
            { agentId: 'a', agentName: 'A', role: 'report', content: 'first', timestamp: 0, stageIndex: 0 },
            { agentId: 'b', agentName: 'B', role: 'report', content: 'second', timestamp: 1, stageIndex: 1 },
            { agentId: 'c', agentName: 'C', role: 'thought', content: 'after', timestamp: 2, stageIndex: 1 },
        ] } } as any;
        expect(extractLastReport(state)).toBe('second');
    });
});

describe('loadAgentPrompt', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads inline prompt from agent.promptContent', () => {
        const agent: AgentDefinition = {
            id: 'a', name: 'A', source: 'inline', promptContent: 'hello',
        };
        expect(loadAgentPrompt(agent, {} as AgentConfig)).toBe('hello');
    });

    it('throws when promptPath missing for non-inline agent', () => {
        const agent: AgentDefinition = { id: 'b', name: 'B', source: 'builtin' };
        expect(() => loadAgentPrompt(agent, {} as AgentConfig))
            .toThrow(/no promptPath/);
    });

    it('throws when promptPath file does not exist', () => {
        const agent: AgentDefinition = {
            id: 'c', name: 'C', source: 'builtin',
            promptPath: 'nonexistent/file.md',
        };
        expect(() => loadAgentPrompt(agent, { repoRoot: tmpDir } as AgentConfig))
            .toThrow(/prompt file not found/);
    });

    it('loads relative path from repoRoot', () => {
        const sub = path.join(tmpDir, 'p');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'foo.md'), 'CONTENT');
        const agent: AgentDefinition = {
            id: 'd', name: 'D', source: 'builtin',
            promptPath: 'p/foo.md',
        };
        expect(loadAgentPrompt(agent, { repoRoot: tmpDir } as AgentConfig)).toBe('CONTENT');
    });

    it('loads absolute path verbatim', () => {
        const abs = path.join(tmpDir, 'abs.md');
        fs.writeFileSync(abs, 'ABS');
        const agent: AgentDefinition = {
            id: 'e', name: 'E', source: 'file', promptPath: abs,
        };
        expect(loadAgentPrompt(agent, {} as AgentConfig)).toBe('ABS');
    });

    it('falls back to process.cwd when repoRoot empty', () => {
        // Create file relative to cwd
        const rel = `_test_${Date.now()}.md`;
        const abs = path.join(process.cwd(), rel);
        fs.writeFileSync(abs, 'CWD');
        try {
            const agent: AgentDefinition = {
                id: 'f', name: 'F', source: 'builtin', promptPath: rel,
            };
            expect(loadAgentPrompt(agent, {} as AgentConfig)).toBe('CWD');
        } finally {
            fs.unlinkSync(abs);
        }
    });
});

describe('runSingleAgent', () => {
    let tmpDir: string;
    let promptPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-'));
        promptPath = path.join(tmpDir, 'prompt.md');
        fs.writeFileSync(promptPath, 'Goal: {{GOAL}}');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeProvider(content: string) {
        return {
            type: 'mock',
            displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValue({
                            choices: [{ message: { content } }],
                        }),
                    },
                },
            } as any),
            listModels: async () => ['m'],
        };
    }

    it('runs single-shot markdown agent and returns output', async () => {
        const agent: AgentDefinition = {
            id: 'sx', name: 'SX', source: 'file',
            promptPath, executionMode: 'single-shot', outputFormat: 'markdown',
        };
        const r = await runSingleAgent(
            agent, { goal: 'investigate' },
            makeProvider('done') as any,
            { repoRoot: tmpDir } as AgentConfig,
        );
        expect(r.output).toBe('done');
        expect(r.parsedJson).toBeUndefined();
    });

    it('extracts and returns parsed JSON when outputFormat=json', async () => {
        const agent: AgentDefinition = {
            id: 'jx', name: 'JX', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'json',
            outputSchema: { type: 'array', items: { type: 'object', required: ['x'] } },
        };
        const r = await runSingleAgent(
            agent, {},
            makeProvider('[{"x":1}]') as any,
            { repoRoot: tmpDir } as AgentConfig,
        );
        expect(r.parsedJson).toEqual([{ x: 1 }]);
        expect(r.validationErrors).toBeUndefined();
    });

    it('records validationErrors when JSON parses but violates schema', async () => {
        const agent: AgentDefinition = {
            id: 'jbad', name: 'JBAD', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'json',
            outputSchema: { type: 'array', items: { type: 'object', required: ['x'] } },
        };
        const r = await runSingleAgent(
            agent, {},
            makeProvider('[{"y":1}]') as any,
            { repoRoot: tmpDir } as AgentConfig,
        );
        expect(r.parsedJson).toEqual([{ y: 1 }]);
        expect(r.validationErrors!.length).toBeGreaterThan(0);
    });

    it('records validationErrors when response is not parseable JSON', async () => {
        const agent: AgentDefinition = {
            id: 'jno', name: 'JNO', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'json',
        };
        const r = await runSingleAgent(
            agent, {},
            makeProvider('not json at all') as any,
            { repoRoot: tmpDir } as AgentConfig,
        );
        expect(r.parsedJson).toBeUndefined();
        expect(r.validationErrors![0].message).toContain('parseable JSON');
    });

    it('handles empty/missing message content', async () => {
        const agent: AgentDefinition = {
            id: 'em', name: 'EM', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'markdown',
        };
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({
                chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{}] }) } },
            } as any),
            listModels: async () => [],
        };
        const r = await runSingleAgent(agent, {}, provider as any, { repoRoot: tmpDir } as AgentConfig);
        expect(r.output).toBe('');
    });

    it('uses agent.model override over baseConfig.model', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'mo', name: 'MO', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'markdown',
            model: 'agent-model',
        };
        await runSingleAgent(agent, {}, provider as any, { repoRoot: tmpDir, model: 'base-model' } as AgentConfig);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'agent-model' }));
    });

    it('falls back to baseConfig.model when agent has none', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'fb', name: 'FB', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'markdown',
        };
        await runSingleAgent(agent, {}, provider as any, { repoRoot: tmpDir, model: 'base-model' } as AgentConfig);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'base-model' }));
    });

    it('falls back to gpt-4o-mini when no model anywhere', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'def', name: 'DEF', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'markdown',
        };
        await runSingleAgent(agent, {}, provider as any, { repoRoot: tmpDir } as AgentConfig);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
    });

    it('substitutes context into the system prompt', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'sub', name: 'SUB', source: 'file', promptPath,
            executionMode: 'single-shot', outputFormat: 'markdown',
        };
        await runSingleAgent(agent, { goal: 'find-bug' }, provider as any, { repoRoot: tmpDir } as AgentConfig);
        const call = create.mock.calls[0][0];
        expect(call.messages[0].content).toContain('find-bug');
    });

    it('defaults executionMode to tool-loop and runs through PipelineOrchestrator', async () => {
        // Create a pipeline that will succeed via the orchestrator path.
        // The pipeline test setup is heavy; we just verify the function dispatches.
        // Using an inline source agent so prompt loading doesn't need a file.
        const create = vi.fn().mockResolvedValue({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 't1',
                        function: { name: 'finish', arguments: JSON.stringify({ report: 'final-text' }) },
                    }],
                },
            }],
        });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'tl', name: 'TL', source: 'inline',
            promptContent: 'do work',
            // no executionMode → defaults to tool-loop
        };
        const r = await runSingleAgent(agent, { goal: 'q' }, provider as any, {
            mcpServers: [], repoRoot: tmpDir, systemPromptPath: '',
        } as AgentConfig);
        expect(typeof r.output).toBe('string');
    });

    it('forwards events to the supplied emitter for tool-loop agents', async () => {
        const { EventEmitter } = await import('events');
        const emitter = new EventEmitter();
        const create = vi.fn().mockResolvedValue({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 't1',
                        function: { name: 'finish', arguments: JSON.stringify({ report: 'r' }) },
                    }],
                },
            }],
        });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const seen: string[] = [];
        emitter.on('stage-start', () => seen.push('stage-start'));
        emitter.on('stage-complete', () => seen.push('stage-complete'));
        const agent: AgentDefinition = {
            id: 'fwd', name: 'FWD', source: 'inline',
            promptContent: 'do work',
        };
        await runSingleAgent(
            agent, { goal: 'q' }, provider as any,
            { mcpServers: [], repoRoot: tmpDir, systemPromptPath: '' } as AgentConfig,
            { emitter, investigationState: { id: 'inv1' } as any },
        );
        expect(seen).toContain('stage-start');
        expect(seen).toContain('stage-complete');
    });

    it('handles missing goal in tool-loop path (defaults to empty query)', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 't1',
                        function: { name: 'finish', arguments: JSON.stringify({ report: 'noted' }) },
                    }],
                },
            }],
        });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'ng', name: 'NG', source: 'inline', promptContent: 'work',
        };
        // No goal in context, no investigationState in options
        const r = await runSingleAgent(
            agent, {}, provider as any,
            { mcpServers: [], repoRoot: tmpDir, systemPromptPath: '' } as AgentConfig,
        );
        expect(typeof r.output).toBe('string');
    });

    it('returns proposals/messages when retrospect state is carried through', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        id: 't1',
                        function: { name: 'finish', arguments: JSON.stringify({ report: 'ok' }) },
                    }],
                },
            }],
        });
        const provider = {
            type: 'mock', displayName: 'Mock',
            getAuthRequirement: () => ({ type: 'none' as const }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({ chat: { completions: { create } } } as any),
            listModels: async () => [],
        };
        const agent: AgentDefinition = {
            id: 'rp', name: 'RP', source: 'inline', promptContent: 'work',
        };
        // Seed initial state with retrospect — orchestrator preserves non-retrospect-stage state via spread.
        const r = await runSingleAgent(
            agent, { goal: 'q' }, provider as any,
            { mcpServers: [], repoRoot: tmpDir, systemPromptPath: '' } as AgentConfig,
            { investigationState: {
                retrospect: { proposals: [], messages: [], analysisComplete: false, completed: false },
            } as any },
        );
        expect(r.proposals).toEqual([]);
        expect(r.messages).toEqual([]);
    });
});
