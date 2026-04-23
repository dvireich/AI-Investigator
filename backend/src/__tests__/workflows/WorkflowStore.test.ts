import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { WorkflowStore, SavedWorkflow, CustomAgentStore, SavedAgent } from '../../workflows/WorkflowStore';

// Normalize paths to forward slashes for cross-platform consistency
const norm = (p: string) => p.replace(/\\/g, '/');
const files = new Map<string, string>();
const dirs = new Set<string>();

vi.mock('fs', () => {
    const n = (p: string) => p.replace(/\\/g, '/');
    return {
        existsSync: vi.fn((p: string) => files.has(n(p)) || dirs.has(n(p))),
        readFileSync: vi.fn((p: string) => {
            if (!files.has(n(p))) throw new Error(`ENOENT: ${p}`);
            return files.get(n(p));
        }),
        writeFileSync: vi.fn((p: string, content: string) => { files.set(n(p), content); }),
        renameSync: vi.fn((old: string, nu: string) => {
            const c = files.get(n(old));
            if (c === undefined) throw new Error(`ENOENT: ${old}`);
            files.set(n(nu), c);
            files.delete(n(old));
        }),
        mkdirSync: vi.fn((p: string) => { dirs.add(n(p)); }),
    };
});

import * as fs from 'fs';

// ── WorkflowStore ─────────────────────────────────────────────────────────

describe('WorkflowStore', () => {
    beforeEach(() => {
        files.clear();
        dirs.clear();
        vi.clearAllMocks();
    });

    it('creates directory on construction if it does not exist', () => {
        new WorkflowStore('/data');
        expect(fs.mkdirSync).toHaveBeenCalledWith('/data', { recursive: true });
    });

    it('loads existing workflows from disk', () => {
        const existing: SavedWorkflow[] = [
            { id: '1', name: 'W1', pipeline: { name: 'P1', stages: [], agents: [] }, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ];
        const filePath = norm(path.join('/data', 'workflows.json'));
        files.set(filePath, JSON.stringify(existing));
        dirs.add(norm('/data'));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const store = new WorkflowStore('/data');
        expect(store.getAll()).toHaveLength(1);
        expect(store.get('1')?.name).toBe('W1');
        consoleSpy.mockRestore();
    });

    it('handles malformed JSON gracefully on load', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const filePath = norm(path.join('/data', 'workflows.json'));
        files.set(filePath, 'not json');
        dirs.add(norm('/data'));

        const store = new WorkflowStore('/data');
        expect(store.getAll()).toHaveLength(0);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    describe('legacy _savedId migration', () => {
        it('promotes stage.agent._savedId into stage.savedAgentId and strips the hint', () => {
            const legacy: any[] = [{
                id: 'w1',
                name: 'Legacy',
                pipeline: {
                    id: 'p',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', _savedId: 'saved-42' } },
                        { agent: { id: 'b', name: 'B', source: 'inline' } },
                    ],
                },
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
            }];
            const filePath = norm(path.join('/data', 'workflows.json'));
            files.set(filePath, JSON.stringify(legacy));
            dirs.add(norm('/data'));

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const store = new WorkflowStore('/data');
            const migrated = store.get('w1')!;
            const stages: any[] = migrated.pipeline.stages as any[];

            expect(stages[0].savedAgentId).toBe('saved-42');
            expect(stages[0].agent._savedId).toBeUndefined();
            expect(stages[0].agent.name).toBe('A');
            expect(stages[1].savedAgentId).toBeUndefined();
            expect(stages[1].agent._savedId).toBeUndefined();

            // Migration must be persisted to disk exactly once on load.
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.renameSync).toHaveBeenCalled();
            logSpy.mockRestore();
        });

        it('does not overwrite an explicit savedAgentId that already exists alongside a legacy hint', () => {
            const legacy: any[] = [{
                id: 'w2',
                name: 'MixedLegacy',
                pipeline: {
                    id: 'p',
                    stages: [
                        { savedAgentId: 'new-id', agent: { id: 'a', name: 'A', source: 'inline', _savedId: 'old-id' } },
                    ],
                },
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
            }];
            const filePath = norm(path.join('/data', 'workflows.json'));
            files.set(filePath, JSON.stringify(legacy));
            dirs.add(norm('/data'));

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const store = new WorkflowStore('/data');
            const stages: any[] = store.get('w2')!.pipeline.stages as any[];
            // The explicit savedAgentId wins; the legacy hint is still stripped.
            expect(stages[0].savedAgentId).toBe('new-id');
            expect(stages[0].agent._savedId).toBeUndefined();
            logSpy.mockRestore();
        });

        it('does not rewrite the file when no workflows need migration', () => {
            const clean: any[] = [{
                id: 'w3',
                name: 'Clean',
                pipeline: { id: 'p', stages: [{ savedAgentId: 'x' }] },
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
            }];
            const filePath = norm(path.join('/data', 'workflows.json'));
            files.set(filePath, JSON.stringify(clean));
            dirs.add(norm('/data'));
            vi.clearAllMocks();

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            new WorkflowStore('/data');
            // Only read the file; no writes.
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(fs.renameSync).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });

        it('ignores _savedId values that are not non-empty strings', () => {
            const weird: any[] = [{
                id: 'w4',
                name: 'Weird',
                pipeline: {
                    id: 'p',
                    stages: [
                        { agent: { id: 'a', name: 'A', source: 'inline', _savedId: '' } },
                        { agent: { id: 'b', name: 'B', source: 'inline', _savedId: 42 } },
                        { agent: { id: 'c', name: 'C', source: 'inline' } },
                    ],
                },
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
            }];
            const filePath = norm(path.join('/data', 'workflows.json'));
            files.set(filePath, JSON.stringify(weird));
            dirs.add(norm('/data'));
            vi.clearAllMocks();

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const store = new WorkflowStore('/data');
            const stages: any[] = store.get('w4')!.pipeline.stages as any[];
            expect(stages[0].savedAgentId).toBeUndefined();
            expect(stages[1].savedAgentId).toBeUndefined();
            expect(stages[2].savedAgentId).toBeUndefined();
            // Nothing was migratable, so no write should happen.
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });

        it('tolerates a workflow whose pipeline has no stages field', () => {
            const noStages: any[] = [{
                id: 'w5',
                name: 'NoStages',
                pipeline: { id: 'p' }, // no stages array at all
                createdAt: '2024-01-01',
                updatedAt: '2024-01-01',
            }];
            const filePath = norm(path.join('/data', 'workflows.json'));
            files.set(filePath, JSON.stringify(noStages));
            dirs.add(norm('/data'));
            vi.clearAllMocks();

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            // Must not throw when iterating an absent stages array.
            const store = new WorkflowStore('/data');
            expect(store.get('w5')).toBeDefined();
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });
    });

    describe('CRUD operations', () => {
        let store: WorkflowStore;

        beforeEach(() => {
            dirs.add(norm('/data'));
            store = new WorkflowStore('/data');
        });

        it('create adds a workflow with auto-generated id and timestamps', () => {
            const result = store.create({ name: 'Test Workflow', pipeline: { name: 'P', stages: [], agents: [] } });
            expect(result.id).toBeDefined();
            expect(result.name).toBe('Test Workflow');
            expect(result.pipeline.name).toBe('P');
            expect(result.createdAt).toBeDefined();
            expect(result.updatedAt).toBeDefined();
            expect(store.getAll()).toHaveLength(1);
        });

        it('create persists to disk via atomic write', () => {
            store.create({ name: 'W1', pipeline: { name: 'P', stages: [], agents: [] } });
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('get returns undefined for non-existent id', () => {
            expect(store.get('nonexistent')).toBeUndefined();
        });

        it('update modifies existing workflow', () => {
            const created = store.create({ name: 'Original', pipeline: { name: 'P', stages: [], agents: [] } });
            const updated = store.update(created.id, { name: 'Updated' });
            expect(updated?.name).toBe('Updated');
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('update returns undefined for non-existent id', () => {
            expect(store.update('nonexistent', { name: 'X' })).toBeUndefined();
        });

        it('update preserves immutable fields (id, createdAt)', () => {
            const created = store.create({ name: 'Test', pipeline: { name: 'P', stages: [], agents: [] } });
            const updated = store.update(created.id, {
                id: 'hacked-id',
                createdAt: '1970-01-01',
                name: 'Updated',
            } as any);
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('delete removes a workflow', () => {
            const created = store.create({ name: 'ToDelete', pipeline: { name: 'P', stages: [], agents: [] } });
            expect(store.delete(created.id)).toBe(true);
            expect(store.getAll()).toHaveLength(0);
        });

        it('delete returns false for non-existent id', () => {
            expect(store.delete('nonexistent')).toBe(false);
        });

        it('delete persists to disk', () => {
            const created = store.create({ name: 'ToDelete', pipeline: { name: 'P', stages: [], agents: [] } });
            vi.clearAllMocks();
            store.delete(created.id);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('getAll returns all workflows', () => {
            let counter = 1000;
            const spy = vi.spyOn(Date, 'now').mockImplementation(() => counter++);
            store.create({ name: 'W1', pipeline: { name: 'P1', stages: [], agents: [] } });
            store.create({ name: 'W2', pipeline: { name: 'P2', stages: [], agents: [] } });
            expect(store.getAll()).toHaveLength(2);
            spy.mockRestore();
        });
    });
});

// ── CustomAgentStore ─────────────────────────────────────────────────────

describe('CustomAgentStore', () => {
    beforeEach(() => {
        files.clear();
        dirs.clear();
        vi.clearAllMocks();
    });

    const makeAgent = (name: string) => ({
        agent: { id: 'a1', name, source: 'custom' as const, builtinType: '', color: '#fff', description: '' },
    });

    it('creates directory on construction if it does not exist', () => {
        new CustomAgentStore('/data');
        expect(fs.mkdirSync).toHaveBeenCalledWith('/data', { recursive: true });
    });

    it('loads existing agents from disk', () => {
        const existing: SavedAgent[] = [
            { id: '1', agent: { id: 'a1', name: 'A1', source: 'custom', builtinType: '', color: '#fff', description: '' }, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ];
        const filePath = norm(path.join('/data', 'custom-agents.json'));
        files.set(filePath, JSON.stringify(existing));
        dirs.add(norm('/data'));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const store = new CustomAgentStore('/data');
        expect(store.getAll()).toHaveLength(1);
        expect(store.get('1')?.agent.name).toBe('A1');
        consoleSpy.mockRestore();
    });

    it('handles malformed JSON gracefully on load', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const filePath = norm(path.join('/data', 'custom-agents.json'));
        files.set(filePath, 'not json');
        dirs.add(norm('/data'));

        const store = new CustomAgentStore('/data');
        expect(store.getAll()).toHaveLength(0);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    describe('CRUD operations', () => {
        let store: CustomAgentStore;

        beforeEach(() => {
            dirs.add(norm('/data'));
            store = new CustomAgentStore('/data');
        });

        it('create adds an agent with auto-generated id and timestamps', () => {
            const result = store.create(makeAgent('Test Agent'));
            expect(result.id).toBeDefined();
            expect(result.agent.name).toBe('Test Agent');
            expect(result.createdAt).toBeDefined();
            expect(result.updatedAt).toBeDefined();
            expect(store.getAll()).toHaveLength(1);
        });

        it('create persists to disk via atomic write', () => {
            store.create(makeAgent('A1'));
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('get returns undefined for non-existent id', () => {
            expect(store.get('nonexistent')).toBeUndefined();
        });

        it('update modifies existing agent', () => {
            const created = store.create(makeAgent('Original'));
            const updated = store.update(created.id, { agent: { ...created.agent, name: 'Updated' } });
            expect(updated?.agent.name).toBe('Updated');
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('update returns undefined for non-existent id', () => {
            expect(store.update('nonexistent', makeAgent('X'))).toBeUndefined();
        });

        it('update preserves immutable fields (id, createdAt)', () => {
            const created = store.create(makeAgent('Test'));
            const updated = store.update(created.id, {
                id: 'hacked-id',
                createdAt: '1970-01-01',
            } as any);
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('delete removes an agent', () => {
            const created = store.create(makeAgent('ToDelete'));
            expect(store.delete(created.id)).toBe(true);
            expect(store.getAll()).toHaveLength(0);
        });

        it('delete returns false for non-existent id', () => {
            expect(store.delete('nonexistent')).toBe(false);
        });

        it('delete persists to disk', () => {
            const created = store.create(makeAgent('ToDelete'));
            vi.clearAllMocks();
            store.delete(created.id);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('getAll returns all agents', () => {
            let counter = 1000;
            const spy = vi.spyOn(Date, 'now').mockImplementation(() => counter++);
            store.create(makeAgent('A1'));
            store.create(makeAgent('A2'));
            expect(store.getAll()).toHaveLength(2);
            spy.mockRestore();
        });
    });
});
