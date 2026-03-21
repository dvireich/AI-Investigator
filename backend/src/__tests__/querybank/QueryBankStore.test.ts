import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { QueryBankStore, SavedQuery } from '../../querybank/QueryBankStore';

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

describe('QueryBankStore', () => {
    beforeEach(() => {
        files.clear();
        dirs.clear();
        vi.clearAllMocks();
    });

    it('creates directory on construction if it does not exist', () => {
        new QueryBankStore('/data');
        expect(fs.mkdirSync).toHaveBeenCalledWith('/data', { recursive: true });
    });

    it('loads existing queries from disk', () => {
        const existing: SavedQuery[] = [
            { id: '1', name: 'Q1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ];
        const filePath = norm(path.join('/data', 'query-bank.json'));
        files.set(filePath, JSON.stringify(existing));
        dirs.add(norm('/data'));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const store = new QueryBankStore('/data');
        expect(store.getAll()).toHaveLength(1);
        expect(store.get('1')?.name).toBe('Q1');
        consoleSpy.mockRestore();
    });

    it('handles malformed JSON gracefully on load', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const filePath = norm(path.join('/data', 'query-bank.json'));
        files.set(filePath, 'not json');
        dirs.add(norm('/data'));

        const store = new QueryBankStore('/data');
        expect(store.getAll()).toHaveLength(0);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    describe('CRUD operations', () => {
        let store: QueryBankStore;

        beforeEach(() => {
            dirs.add(norm('/data'));
            store = new QueryBankStore('/data');
        });

        it('create adds a query with auto-generated id and timestamps', () => {
            const result = store.create({ name: 'Test Query', query: 'SELECT 1' });
            expect(result.id).toBeDefined();
            expect(result.name).toBe('Test Query');
            expect(result.query).toBe('SELECT 1');
            expect(result.createdAt).toBeDefined();
            expect(result.updatedAt).toBeDefined();
            expect(store.getAll()).toHaveLength(1);
        });

        it('create persists to disk via atomic write', () => {
            store.create({ name: 'Q1' });
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('get returns undefined for non-existent id', () => {
            expect(store.get('nonexistent')).toBeUndefined();
        });

        it('update modifies existing query', () => {
            const created = store.create({ name: 'Original' });
            const updated = store.update(created.id, { name: 'Updated' });
            expect(updated?.name).toBe('Updated');
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('update returns undefined for non-existent id', () => {
            expect(store.update('nonexistent', { name: 'X' })).toBeUndefined();
        });

        it('update preserves immutable fields (id, createdAt)', () => {
            const created = store.create({ name: 'Test' });
            const updated = store.update(created.id, {
                id: 'hacked-id',
                createdAt: '1970-01-01',
                name: 'Updated',
            } as any);
            expect(updated?.id).toBe(created.id);
            expect(updated?.createdAt).toBe(created.createdAt);
        });

        it('delete removes a query', () => {
            const created = store.create({ name: 'ToDelete' });
            expect(store.delete(created.id)).toBe(true);
            expect(store.getAll()).toHaveLength(0);
        });

        it('delete returns false for non-existent id', () => {
            expect(store.delete('nonexistent')).toBe(false);
        });

        it('delete persists to disk', () => {
            const created = store.create({ name: 'ToDelete' });
            vi.clearAllMocks();
            store.delete(created.id);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('getAll returns all queries', () => {
            let counter = 1000;
            const spy = vi.spyOn(Date, 'now').mockImplementation(() => counter++);
            store.create({ name: 'Q1' });
            store.create({ name: 'Q2' });
            expect(store.getAll()).toHaveLength(2);
            spy.mockRestore();
        });
    });
});
