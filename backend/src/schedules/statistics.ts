import { ScheduleHistoryEntry } from './ScheduleStore';

/**
 * Pre-computed deterministic statistics for a scheduled investigation's
 * historical run set. Produced by `computeScheduleStats` and consumed by
 * the `executive-report` agent (no LLM math) plus internal rendering.
 *
 * Every field is non-undefined to keep callers branch-free.
 */
export interface ScheduleStats {
    /** Total runs in the input set. */
    totalRuns: number;
    /** Count by verdict. Keys: every verdict that appears at least once. */
    verdictCounts: Record<string, number>;
    /** Percentage of runs whose verdict is 'healthy' or 'completed'. 0–100, rounded. */
    successRate: number;
    /** Trend over the run set: improving, degrading, or stable. Stable when fewer than 4 entries. */
    trend: 'improving' | 'degrading' | 'stable';
    /** Earliest run timestamp (ISO) or empty string when no runs. */
    firstRunAt: string;
    /** Latest run timestamp (ISO) or empty string when no runs. */
    lastRunAt: string;
    /** Verdict of the most recent run, or 'unknown' when no runs. */
    lastVerdict: string;
    /** Length of the most-recent same-verdict streak (>=1 when there are runs). */
    consecutiveLastStreak: number;
}

/**
 * Compute deterministic statistics over a run-history set. Pure function:
 * no I/O, no time dependence, no LLM. Always returns a fully-populated
 * `ScheduleStats` even on empty input.
 */
export function computeScheduleStats(entries: ScheduleHistoryEntry[]): ScheduleStats {
    /** Empty short-circuit: deterministic zero-state. */
    if (entries.length === 0) {
        return {
            totalRuns: 0,
            verdictCounts: {},
            successRate: 0,
            trend: 'stable',
            firstRunAt: '',
            lastRunAt: '',
            lastVerdict: 'unknown',
            consecutiveLastStreak: 0,
        };
    }

    /** Sorted oldest → newest by timestamp; copy to avoid mutating caller. */
    const sorted: ScheduleHistoryEntry[] = [...entries].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    /** Verdict count map. */
    const verdictCounts: Record<string, number> = {};
    for (const e of sorted) {
        verdictCounts[e.verdict] = (verdictCounts[e.verdict] || 0) + 1;
    }

    /** Successes are healthy + completed verdicts. */
    const successes: number = (verdictCounts.healthy || 0) + (verdictCounts.completed || 0);
    const successRate: number = Math.round((successes / sorted.length) * 100);

    /** Trend by older-half vs newer-half severity averages (needs >=4). */
    const trend: 'improving' | 'degrading' | 'stable' = computeTrend(sorted);

    /** Last verdict and streak. */
    const lastVerdict: string = sorted[sorted.length - 1].verdict;
    let consecutiveLastStreak: number = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].verdict === lastVerdict) consecutiveLastStreak++;
        else break;
    }

    return {
        totalRuns: sorted.length,
        verdictCounts,
        successRate,
        trend,
        firstRunAt: sorted[0].timestamp,
        lastRunAt: sorted[sorted.length - 1].timestamp,
        lastVerdict,
        consecutiveLastStreak,
    };
}

/** Map a verdict string to a numeric severity score (higher = more severe). */
function severityScore(verdict: string): number {
    if (verdict === 'critical') return 4;
    if (verdict === 'error') return 3;
    if (verdict === 'warning') return 2;
    if (verdict === 'paused') return 1;
    return 0;
}

/**
 * Compute trend from an ordered (oldest-first) entry list.
 * Compares the average severity of the older half to the newer half.
 * Returns 'stable' when there's not enough data (< 4 entries) or the
 * difference is within ±0.3.
 */
function computeTrend(sorted: ScheduleHistoryEntry[]): 'improving' | 'degrading' | 'stable' {
    if (sorted.length < 4) return 'stable';
    /** Midpoint index. */
    const mid: number = Math.floor(sorted.length / 2);
    const olderHalf: ScheduleHistoryEntry[] = sorted.slice(0, mid);
    const newerHalf: ScheduleHistoryEntry[] = sorted.slice(mid);
    /** Average severity of older half. */
    const avgOlder: number = olderHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / olderHalf.length;
    /** Average severity of newer half. */
    const avgNewer: number = newerHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / newerHalf.length;
    if (avgNewer < avgOlder - 0.3) return 'improving';
    if (avgNewer > avgOlder + 0.3) return 'degrading';
    return 'stable';
}

/**
 * Render `ScheduleStats` to a compact markdown table for the
 * `executive-report` agent. Pure formatting; no math.
 */
export function renderStatsTable(stats: ScheduleStats): string {
    if (stats.totalRuns === 0) {
        return '_No completed runs yet._';
    }
    /** Verdict rows, sorted descending by count for readability. */
    const verdictRows: string[] = Object.entries(stats.verdictCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([v, c]) => `| ${v} | ${c} | ${Math.round((c / stats.totalRuns) * 100)}% |`);
    return [
        '| Metric | Value |',
        '|--------|-------|',
        `| Total runs | ${stats.totalRuns} |`,
        `| Success rate | ${stats.successRate}% |`,
        `| Trend | ${stats.trend} |`,
        `| Last verdict | ${stats.lastVerdict} |`,
        `| Consecutive same-verdict streak | ${stats.consecutiveLastStreak} |`,
        `| First run | ${stats.firstRunAt} |`,
        `| Last run | ${stats.lastRunAt} |`,
        '',
        '| Verdict | Count | % |',
        '|---------|-------|---|',
        ...verdictRows,
    ].join('\n');
}

/**
 * Render a compact run-history digest (most-recent-first) for the
 * `executive-report` agent. Each entry is one line: timestamp, verdict, summary head.
 */
export function renderHistoryDigest(entries: ScheduleHistoryEntry[], maxEntries: number = 20): string {
    if (entries.length === 0) return '_No history yet._';
    /** Sort newest-first, limit. */
    const sorted: ScheduleHistoryEntry[] = [...entries]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, maxEntries);
    return sorted.map(e => {
        /** First line of summary, truncated. */
        const summaryHead: string = (e.summary || '').split('\n')[0].slice(0, 200);
        return `- **${e.timestamp}** [${e.verdict}] ${summaryHead}`;
    }).join('\n');
}
