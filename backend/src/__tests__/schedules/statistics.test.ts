import { describe, it, expect } from 'vitest';
import {
    computeScheduleStats,
    renderStatsTable,
    renderHistoryDigest,
} from '../../schedules/statistics';
import { ScheduleHistoryEntry } from '../../schedules/ScheduleStore';

function entry(timestamp: string, verdict: ScheduleHistoryEntry['verdict'], summary?: string): ScheduleHistoryEntry {
    return { timestamp, verdict, investigationId: 'x', summary };
}

describe('computeScheduleStats', () => {
    it('returns deterministic zero-state on empty input', () => {
        const s = computeScheduleStats([]);
        expect(s).toEqual({
            totalRuns: 0,
            verdictCounts: {},
            successRate: 0,
            trend: 'stable',
            firstRunAt: '',
            lastRunAt: '',
            lastVerdict: 'unknown',
            consecutiveLastStreak: 0,
        });
    });

    it('counts verdicts and computes success rate', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'healthy'),
            entry('2024-01-01T01:00:00Z', 'healthy'),
            entry('2024-01-01T02:00:00Z', 'critical'),
            entry('2024-01-01T03:00:00Z', 'completed'),
        ]);
        expect(s.totalRuns).toBe(4);
        expect(s.verdictCounts).toEqual({ healthy: 2, critical: 1, completed: 1 });
        expect(s.successRate).toBe(75); // 3/4
    });

    it('marks trend stable when fewer than 4 entries', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'critical'),
            entry('2024-01-01T01:00:00Z', 'critical'),
            entry('2024-01-01T02:00:00Z', 'critical'),
        ]);
        expect(s.trend).toBe('stable');
    });

    it('detects improving trend (newer half less severe)', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'critical'),
            entry('2024-01-01T01:00:00Z', 'critical'),
            entry('2024-01-01T02:00:00Z', 'healthy'),
            entry('2024-01-01T03:00:00Z', 'healthy'),
        ]);
        expect(s.trend).toBe('improving');
    });

    it('detects degrading trend (newer half more severe)', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'healthy'),
            entry('2024-01-01T01:00:00Z', 'healthy'),
            entry('2024-01-01T02:00:00Z', 'critical'),
            entry('2024-01-01T03:00:00Z', 'critical'),
        ]);
        expect(s.trend).toBe('degrading');
    });

    it('returns stable when severity averages are within ±0.3', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'warning'),
            entry('2024-01-01T01:00:00Z', 'warning'),
            entry('2024-01-01T02:00:00Z', 'warning'),
            entry('2024-01-01T03:00:00Z', 'warning'),
        ]);
        expect(s.trend).toBe('stable');
    });

    it('counts consecutive same-verdict streak from end', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'critical'),
            entry('2024-01-01T01:00:00Z', 'healthy'),
            entry('2024-01-01T02:00:00Z', 'healthy'),
            entry('2024-01-01T03:00:00Z', 'healthy'),
        ]);
        expect(s.consecutiveLastStreak).toBe(3);
        expect(s.lastVerdict).toBe('healthy');
    });

    it('breaks streak at first different verdict', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'critical'),
            entry('2024-01-01T01:00:00Z', 'healthy'),
        ]);
        expect(s.consecutiveLastStreak).toBe(1);
    });

    it('records first/last run timestamps after sorting', () => {
        const s = computeScheduleStats([
            entry('2024-01-01T03:00:00Z', 'healthy'),
            entry('2024-01-01T01:00:00Z', 'critical'),
        ]);
        expect(s.firstRunAt).toBe('2024-01-01T01:00:00Z');
        expect(s.lastRunAt).toBe('2024-01-01T03:00:00Z');
        expect(s.lastVerdict).toBe('healthy');
    });

    it('uses severity scoring for error/paused too', () => {
        // error=3, paused=1 → newer side avg=(3+3)/2=3 vs older=(1+1)/2=1 → degrading
        const s = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'paused'),
            entry('2024-01-01T01:00:00Z', 'paused'),
            entry('2024-01-01T02:00:00Z', 'error'),
            entry('2024-01-01T03:00:00Z', 'error'),
        ]);
        expect(s.trend).toBe('degrading');
    });
});

describe('renderStatsTable', () => {
    it('returns placeholder when totalRuns is zero', () => {
        expect(renderStatsTable(computeScheduleStats([]))).toContain('No completed runs');
    });

    it('renders a table with all metrics and verdict breakdown', () => {
        const stats = computeScheduleStats([
            entry('2024-01-01T00:00:00Z', 'healthy'),
            entry('2024-01-01T01:00:00Z', 'critical'),
        ]);
        const out = renderStatsTable(stats);
        expect(out).toContain('| Total runs | 2 |');
        expect(out).toContain('| Success rate | 50% |');
        expect(out).toContain('| Verdict | Count | % |');
        expect(out).toContain('| healthy | 1 | 50% |');
        expect(out).toContain('| critical | 1 | 50% |');
    });
});

describe('renderHistoryDigest', () => {
    it('returns placeholder when empty', () => {
        expect(renderHistoryDigest([])).toContain('No history yet');
    });

    it('returns most-recent-first lines with verdict + summary head', () => {
        const out = renderHistoryDigest([
            entry('2024-01-01T00:00:00Z', 'healthy', 'all good\nlots more text'),
            entry('2024-01-01T01:00:00Z', 'critical', 'BAD: queue depth high'),
        ]);
        const lines = out.split('\n');
        expect(lines[0]).toContain('2024-01-01T01:00:00Z');
        expect(lines[0]).toContain('[critical]');
        expect(lines[0]).toContain('BAD');
        expect(lines[1]).toContain('healthy');
        expect(lines[1]).toContain('all good');
    });

    it('truncates summary to first line and 200 chars', () => {
        const long = 'x'.repeat(500);
        const out = renderHistoryDigest([entry('2024-01-01T00:00:00Z', 'healthy', long)]);
        // Should not contain full 500-char string
        expect(out.length).toBeLessThan(300);
    });

    it('limits to maxEntries', () => {
        const entries = Array.from({ length: 30 }, (_, i) =>
            entry(`2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, 'healthy')
        );
        const out = renderHistoryDigest(entries, 5);
        expect(out.split('\n')).toHaveLength(5);
    });

    it('handles missing summary gracefully', () => {
        const out = renderHistoryDigest([entry('2024-01-01T00:00:00Z', 'healthy')]);
        expect(out).toContain('healthy');
    });
});
