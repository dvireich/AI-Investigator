import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { ScheduleStore, ScheduleDefinition, ScheduleHistoryEntry } from '../../schedules/ScheduleStore';

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
        rmSync: vi.fn((p: string) => {
            files.delete(n(p));
            for (const k of files.keys()) { if (k.startsWith(n(p) + '/')) files.delete(k); }
            dirs.delete(n(p));
            for (const k of dirs) { if (k.startsWith(n(p) + '/')) dirs.delete(k); }
        }),
    };
});

import * as fs from 'fs';

function minSchedule(overrides: Partial<ScheduleDefinition> = {}): Omit<ScheduleDefinition, 'id' | 'createdAt'> {
    return {
        name: 'Test Schedule',
        enabled: true,
        target: 'test-target',
        query: 'check health',
        intervalMinutes: 15,
        autoEscalate: false,
        ...overrides,
    };
}

describe('ScheduleStore', () => {
    beforeEach(() => {
        files.clear();
        dirs.clear();
        vi.clearAllMocks();
    });

    it('creates schedules directory on construction', () => {
        new ScheduleStore('/data');
        expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('loads existing schedules from disk', () => {
        const existing: ScheduleDefinition[] = [{
            id: '1', name: 'S1', enabled: true, target: 't', query: 'q',
            intervalMinutes: 15, autoEscalate: false, createdAt: '2024-01-01',
        }];
        const schedulesDir = norm(path.join('/data', 'schedules'));
        dirs.add(schedulesDir);
        files.set(norm(path.join(schedulesDir, 'schedules.json')), JSON.stringify(existing));

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const store = new ScheduleStore('/data');
        expect(store.getAll()).toHaveLength(1);
        expect(store.get('1')?.name).toBe('S1');
        consoleSpy.mockRestore();
    });

    it('handles corrupted schedule file gracefully', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const schedulesDir = norm(path.join('/data', 'schedules'));
        dirs.add(schedulesDir);
        files.set(norm(path.join(schedulesDir, 'schedules.json')), 'broken');
        const store = new ScheduleStore('/data');
        expect(store.getAll()).toHaveLength(0);
        consoleSpy.mockRestore();
    });

    describe('CRUD', () => {
        let store: ScheduleStore;

        beforeEach(() => {
            const schedulesDir = norm(path.join('/data', 'schedules'));
            dirs.add(schedulesDir);
            store = new ScheduleStore('/data');
        });

        it('create generates id and createdAt', () => {
            const result = store.create(minSchedule());
            expect(result.id).toBeDefined();
            expect(result.createdAt).toBeDefined();
            expect(result.name).toBe('Test Schedule');
        });

        it('create persists via atomic write', () => {
            store.create(minSchedule());
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('get returns undefined for non-existent id', () => {
            expect(store.get('xxx')).toBeUndefined();
        });

        it('update modifies and returns updated schedule', () => {
            const created = store.create(minSchedule());
            const updated = store.update(created.id, { name: 'Renamed' });
            expect(updated?.name).toBe('Renamed');
            expect(updated?.id).toBe(created.id);
        });

        it('update returns undefined for non-existent id', () => {
            expect(store.update('nope', { name: 'X' })).toBeUndefined();
        });

        it('update preserves immutable id', () => {
            const created = store.create(minSchedule());
            const updated = store.update(created.id, { id: 'hacked' } as any);
            expect(updated?.id).toBe(created.id);
        });

        it('delete removes schedule', () => {
            const created = store.create(minSchedule());
            expect(store.delete(created.id)).toBe(true);
            expect(store.getAll()).toHaveLength(0);
        });

        it('delete returns false for non-existent id', () => {
            expect(store.delete('xxx')).toBe(false);
        });

        it('delete cleans up history directory if it exists', () => {
            const created = store.create(minSchedule());
            const histDir = norm(path.join('/data', 'schedules', created.id));
            dirs.add(histDir);
            store.delete(created.id);
            expect(fs.rmSync).toHaveBeenCalled();
        });

        it('delete handles history cleanup failure gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const created = store.create(minSchedule());
            const histDir = norm(path.join('/data', 'schedules', created.id));
            dirs.add(histDir);
            (fs.rmSync as any).mockImplementationOnce(() => { throw new Error('permission denied'); });
            store.delete(created.id);
            consoleSpy.mockRestore();
        });

        it('getAll returns all schedules', () => {
            let counter = 1000;
            const spy = vi.spyOn(Date, 'now').mockImplementation(() => counter++);
            store.create(minSchedule({ name: 'S1' }));
            store.create(minSchedule({ name: 'S2' }));
            expect(store.getAll()).toHaveLength(2);
            spy.mockRestore();
        });
    });

    describe('History', () => {
        let store: ScheduleStore;

        beforeEach(() => {
            const schedulesDir = norm(path.join('/data', 'schedules'));
            dirs.add(schedulesDir);
            store = new ScheduleStore('/data');
        });

        it('getHistory returns empty array when no history file exists', () => {
            expect(store.getHistory('sch1')).toEqual([]);
        });

        it('getHistory returns entries from disk', () => {
            const entries: ScheduleHistoryEntry[] = [
                { timestamp: new Date().toISOString(), verdict: 'healthy', investigationId: 'inv1' },
            ];
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, JSON.stringify(entries));
            expect(store.getHistory('sch1')).toHaveLength(1);
        });

        it('getHistory respects maxEntries', () => {
            const entries: ScheduleHistoryEntry[] = [
                { timestamp: new Date().toISOString(), verdict: 'healthy', investigationId: 'inv1' },
                { timestamp: new Date().toISOString(), verdict: 'warning', investigationId: 'inv2' },
                { timestamp: new Date().toISOString(), verdict: 'critical', investigationId: 'inv3' },
            ];
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, JSON.stringify(entries));
            const result = store.getHistory('sch1', 2);
            expect(result).toHaveLength(2);
            expect(result[0].investigationId).toBe('inv2');
        });

        it('getHistory returns empty array on corrupted file', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, 'not json');
            expect(store.getHistory('sch1')).toEqual([]);
        });

        it('getHistoryCount returns 0 when no file exists', () => {
            expect(store.getHistoryCount('missing')).toBe(0);
        });

        it('getHistoryCount returns count from disk', () => {
            const entries: ScheduleHistoryEntry[] = [
                { timestamp: new Date().toISOString(), verdict: 'healthy', investigationId: 'inv1' },
                { timestamp: new Date().toISOString(), verdict: 'warning', investigationId: 'inv2' },
            ];
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, JSON.stringify(entries));
            expect(store.getHistoryCount('sch1')).toBe(2);
        });

        it('getHistoryCount returns 0 on corrupted file', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, 'bad json');
            expect(store.getHistoryCount('sch1')).toBe(0);
        });

        it('getHistoryCount returns 0 when readFileSync throws', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, '[{"a":1}]');
            (fs.readFileSync as any).mockImplementationOnce(() => { throw new Error('read error'); });
            expect(store.getHistoryCount('sch1')).toBe(0);
        });

        it('getHistoryCount handles escaped characters in JSON strings', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            // Entry with escaped quotes and braces inside strings
            files.set(histPath, '[{"summary":"line1\\nline2\\"{\\\\}"}]');
            expect(store.getHistoryCount('sch1')).toBe(1);
        });

        it('appendHistory creates directory and appends entry', () => {
            const entry: ScheduleHistoryEntry = {
                timestamp: new Date().toISOString(),
                verdict: 'healthy',
                investigationId: 'inv1',
                summary: 'All good',
            };
            store.appendHistory('sch1', entry);
            expect(fs.mkdirSync).toHaveBeenCalled();
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('appendHistory appends to existing entries', () => {
            const existing: ScheduleHistoryEntry[] = [
                { timestamp: new Date().toISOString(), verdict: 'healthy', investigationId: 'inv1' },
            ];
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, JSON.stringify(existing));

            store.appendHistory('sch1', {
                timestamp: new Date().toISOString(),
                verdict: 'warning',
                investigationId: 'inv2',
            });

            const written = JSON.parse(files.get(histPath)!);
            expect(written).toHaveLength(2);
        });

        it('appendHistory prunes entries older than retention period', () => {
            const old = new Date();
            old.setDate(old.getDate() - 10);
            const existing: ScheduleHistoryEntry[] = [
                { timestamp: old.toISOString(), verdict: 'healthy', investigationId: 'old1' },
            ];
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, JSON.stringify(existing));

            store.appendHistory('sch1', {
                timestamp: new Date().toISOString(),
                verdict: 'warning',
                investigationId: 'new1',
            });

            const written = JSON.parse(files.get(histPath)!);
            expect(written).toHaveLength(1);
            expect(written[0].investigationId).toBe('new1');
        });

        it('appendHistory handles corrupted existing file', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, 'bad json');

            store.appendHistory('sch1', {
                timestamp: new Date().toISOString(),
                verdict: 'healthy',
                investigationId: 'inv1',
            });

            const written = JSON.parse(files.get(histPath)!);
            expect(written).toHaveLength(1);
        });

        it('removeHistoryEntries removes matching investigation IDs', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            const entries = [
                { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy' as const, investigationId: 'inv-1' },
                { timestamp: '2024-01-02T00:00:00Z', verdict: 'critical' as const, investigationId: 'inv-2' },
                { timestamp: '2024-01-03T00:00:00Z', verdict: 'healthy' as const, investigationId: 'inv-3' },
            ];
            files.set(histPath, JSON.stringify(entries));

            store.removeHistoryEntries('sch1', new Set(['inv-1', 'inv-3']));

            const result = JSON.parse(files.get(histPath)!);
            expect(result).toHaveLength(1);
            expect(result[0].investigationId).toBe('inv-2');
        });

        it('removeHistoryEntries does nothing when history file does not exist', () => {
            // Should not throw
            store.removeHistoryEntries('nonexistent', new Set(['inv-1']));
        });

        it('removeHistoryEntries handles corrupted file gracefully', () => {
            const histDir = norm(path.join('/data', 'schedules', 'sch1'));
            const histPath = norm(path.join(histDir, 'history.json'));
            dirs.add(histDir);
            files.set(histPath, 'bad json');

            // Should not throw
            store.removeHistoryEntries('sch1', new Set(['inv-1']));
        });
    });

    describe('Run Reports & Executive Report', () => {
        let store: ScheduleStore;

        beforeEach(() => {
            const schedulesDir = norm(path.join('/data', 'schedules'));
            dirs.add(schedulesDir);
            store = new ScheduleStore('/data');
        });

        it('writeRunReport creates reports directory and writes markdown', () => {
            store.writeRunReport('sch1', 'inv-1', '# Report\nAll good');
            const reportPath = norm(path.join('/data', 'schedules', 'sch1', 'reports', 'inv-1.md'));
            expect(files.get(reportPath)).toBe('# Report\nAll good');
        });

        it('writeExecutiveReport writes executive-report.md', () => {
            store.writeExecutiveReport('sch1', '# Executive Summary\nOverall healthy');
            const reportPath = norm(path.join('/data', 'schedules', 'sch1', 'executive-report.md'));
            expect(files.get(reportPath)).toBe('# Executive Summary\nOverall healthy');
        });

        it('getExecutiveReport returns file content when it exists', () => {
            const reportPath = norm(path.join('/data', 'schedules', 'sch1', 'executive-report.md'));
            const reportDir = norm(path.join('/data', 'schedules', 'sch1'));
            dirs.add(reportDir);
            files.set(reportPath, '# Executive Summary');
            expect(store.getExecutiveReport('sch1')).toBe('# Executive Summary');
        });

        it('getExecutiveReport returns null when file does not exist', () => {
            expect(store.getExecutiveReport('nonexistent')).toBeNull();
        });

        it('getExecutiveReport returns null on read error', () => {
            const reportPath = norm(path.join('/data', 'schedules', 'sch1', 'executive-report.md'));
            const reportDir = norm(path.join('/data', 'schedules', 'sch1'));
            dirs.add(reportDir);
            files.set(reportPath, '# Report');
            (fs.readFileSync as any).mockImplementationOnce(() => { throw new Error('read error'); });
            expect(store.getExecutiveReport('sch1')).toBeNull();
        });
    });
});
