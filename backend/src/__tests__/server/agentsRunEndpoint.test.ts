/// <summary>
/// Endpoint tests for the generic on-demand agent runner — `/api/agents/run`
/// and `/api/agents/by-kind/:kind`. Mocks `runSingleAgent` so we do not depend
/// on a real LLM provider, prompt files, or pipeline orchestration.
/// </summary>
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock runSingleAgent on the pipeline barrel so server.ts uses the stub.
vi.mock('../../agent/pipeline', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        runSingleAgent: vi.fn().mockResolvedValue({ output: 'stub-output' }),
    };
});

import { __testUtils } from '../../server';
import { runSingleAgent } from '../../agent/pipeline';

const api = () => request(__testUtils.app);
const mockRun = runSingleAgent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    __testUtils.resetRuntimeState();
    mockRun.mockReset();
    mockRun.mockResolvedValue({ output: 'stub-output' });
});

afterEach(() => {
    __testUtils.setActiveLlmProvider(null);
});

describe('POST /api/agents/run', () => {
    it('returns 400 when neither agentId nor kind is provided', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        const res = await api().post('/api/agents/run').send({});
        expect(res.status).toBe(400);
    });

    it('returns 503 when no active LLM provider is configured', async () => {
        __testUtils.setActiveLlmProvider(null);
        const res = await api().post('/api/agents/run').send({ agentId: 'builtin-investigator' });
        expect(res.status).toBe(503);
    });

    it('returns 404 when the agentId is unknown', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        const res = await api().post('/api/agents/run').send({ agentId: 'does-not-exist' });
        expect(res.status).toBe(404);
    });

    it('returns 404 when the kind has no resolvable default', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        const res = await api().post('/api/agents/run').send({ kind: 'totally-unknown-kind' });
        expect(res.status).toBe(404);
    });

    it('runs a built-in agent by id and returns the agent output', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: 'hello world' });
        const res = await api().post('/api/agents/run').send({
            agentId: 'builtin-investigator',
            rawInput: { goal: 'why?' },
        });
        expect(res.status).toBe(200);
        expect(res.body.output).toBe('hello world');
        expect(res.body.kind).toBe('investigator');
        expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('resolves the default agent for a given kind when no agentId is supplied', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: 'extracted' });
        const res = await api().post('/api/agents/run').send({
            kind: 'recommendation-extractor',
            rawInput: {},
        });
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('recommendation-extractor');
    });

    it('persists extracted recommendations onto the investigation state', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        const fakeRecs = [
            { priority: 'P1', title: 'Add retries', description: 'Add backoff', category: 'code' },
            { priority: 'P2', title: 'Doc gap', description: 'Update wiki', category: 'operational' },
            // Missing fields → exercise default-value branches (priority|title|description fallbacks; category default).
            {},
        ];
        mockRun.mockResolvedValue({ output: '[]', parsedJson: fakeRecs });
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-run-test-'));
        const statePath = path.join(tmpDir, 'state.json');
        fs.writeFileSync(statePath, '{}');
        const history = __testUtils.getHistory();
        history.set('inv-99', { id: 'inv-99', recommendations: [], _statePath: statePath } as any);
        const res = await api().post('/api/agents/run').send({
            kind: 'recommendation-extractor',
            investigationId: 'inv-99',
            rawInput: {},
        });
        expect(res.status).toBe(200);
        expect(mockRun).toHaveBeenCalled();
        expect(res.body.parsedJson).toEqual(fakeRecs);
        const updated = history.get('inv-99') as any;
        expect(updated.recommendations).toHaveLength(3);
        expect(updated.recommendations[0].priority).toBe('P1');
        expect(updated.recommendations[1].category).toBe('operational');
        // Defaulted entry: priority='P2', title='', description='', category='code'.
        expect(updated.recommendations[2].priority).toBe('P2');
        expect(updated.recommendations[2].title).toBe('');
        expect(updated.recommendations[2].category).toBe('code');
        // Confirm the persistHistory disk-write branch ran.
        const persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        expect(persisted.recommendations).toHaveLength(3);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });


    it('warns and continues when persistHistory disk-write fails', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: '[]', parsedJson: [] });
        const history = __testUtils.getHistory();
        // _statePath points to an unwritable directory so writeFileSync throws.
        history.set('inv-bad', {
            id: 'inv-bad',
            recommendations: [],
            _statePath: path.join(os.tmpdir(), 'no', 'such', 'dir', 'state.json'),
        } as any);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const res = await api().post('/api/agents/run').send({
            kind: 'recommendation-extractor',
            investigationId: 'inv-bad',
            rawInput: {},
        });
        expect(res.status).toBe(200);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('persistHistory failed'), expect.anything());
        warnSpy.mockRestore();
    });

    it('skips disk persistence when investigation has no _statePath', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: '[]', parsedJson: [{ priority: 'P3', title: 't', description: 'd', category: 'code' }] });
        const history = __testUtils.getHistory();
        history.set('inv-mem', { id: 'inv-mem', recommendations: [] } as any);
        const res = await api().post('/api/agents/run').send({
            kind: 'recommendation-extractor',
            investigationId: 'inv-mem',
            rawInput: {},
        });
        expect(res.status).toBe(200);
        expect((history.get('inv-mem') as any).recommendations).toHaveLength(1);
    });

    it('does not persist when extractor result has no parsedJson array', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: 'unparseable', parsedJson: undefined });
        const history = __testUtils.getHistory();
        history.set('inv-noparse', { id: 'inv-noparse', recommendations: [{ id: 'pre-existing' }] } as any);
        const res = await api().post('/api/agents/run').send({
            kind: 'recommendation-extractor',
            investigationId: 'inv-noparse',
            rawInput: {},
        });
        expect(res.status).toBe(200);
        // Pre-existing recommendations untouched.
        expect((history.get('inv-noparse') as any).recommendations).toEqual([{ id: 'pre-existing' }]);
    });

    it('returns 500 and a sanitized error when runSingleAgent throws', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockRejectedValue(new Error('boom'));
        const res = await api().post('/api/agents/run').send({
            agentId: 'builtin-investigator',
        });
        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });

    it('reads investigation state from an active runner when one exists', async () => {
        __testUtils.setActiveLlmProvider({ type: 'fake' } as any);
        mockRun.mockResolvedValue({ output: 'ok' });
        const runners = __testUtils.getRunners();
        runners.set('runner-active', { state: { id: 'runner-active', target: 'svc-x' } } as any);
        const res = await api().post('/api/agents/run').send({
            agentId: 'builtin-investigator',
            investigationId: 'runner-active',
        });
        expect(res.status).toBe(200);
        runners.delete('runner-active');
    });
});

describe('GET /api/agents/by-kind/:kind', () => {
    it('lists built-in agents for a known kind', async () => {
        const res = await api().get('/api/agents/by-kind/investigator');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0].source).toBe('builtin');
        expect(res.body[0].kind).toBe('investigator');
    });

    it('returns an empty array for an unknown kind', async () => {
        const res = await api().get('/api/agents/by-kind/this-is-not-a-real-kind');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('marks saved custom agents as source=custom in the listing', async () => {
        const customStore = {
            get: vi.fn(),
            getAll: vi.fn().mockReturnValue([
                { id: 'saved-1', agent: { id: 'custom-x', name: 'X', kind: 'investigator' } },
            ]),
        } as any;
        __testUtils.setCustomAgentStore(customStore);
        const res = await api().get('/api/agents/by-kind/investigator');
        expect(res.status).toBe(200);
        const customEntries = res.body.filter((a: any) => a.id === 'custom-x');
        expect(customEntries).toHaveLength(1);
        expect(customEntries[0].source).toBe('custom');
        __testUtils.setCustomAgentStore(null);
    });
});
