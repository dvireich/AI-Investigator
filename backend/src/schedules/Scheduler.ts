import { EventEmitter } from 'events';
import { ScheduleStore, ScheduleDefinition, ScheduleHistoryEntry } from './ScheduleStore';
import { LlmProvider } from '../agent/llm/LlmProvider';

/**
 * Callback the Scheduler uses to create an investigation.
 * Mirrors the signature extracted from server.ts (createInvestigation).
 * Returns { id: string } on success.
 */
export type CreateInvestigationFn = (params: {
    target: string;
    query: string;
    timeRange: string;
    category?: string;
    productId?: string;
    model?: string;
    maxSteps?: number;
    source?: 'manual' | 'scheduled';
    scheduleId?: string;
    createdBy?: string;
}) => Promise<{ id: string }>;

/**
 * Callback to check if an investigation has finished and what verdict it produced.
 * Returns undefined if the investigation is still running.
 */
export type GetInvestigationResultFn = (investigationId: string) => {
    status: string;
    verdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    finalReport?: string;
} | undefined;

/**
 * Callback to delete a single investigation by ID (reuses server delete logic).
 */
export type DeleteInvestigationFn = (investigationId: string) => void;

/**
 * Callback to list all investigation IDs for a given scheduleId, sorted newest-first.
 */
export type ListScheduleInvestigationsFn = (scheduleId: string) => string[];

export interface SchedulerConfig {
    maxConcurrentScheduledInvestigations: number;
    scheduledInvestigationMaxSteps: number;
    scheduledInvestigationRetentionCount: number;
    globalMaxSteps: number;        // from settings.maxSteps — 0 means unlimited
    defaultTimeRange: string;
    scheduledReportModel: string;  // LLM model for AI-enhanced executive reports
}

const DEFAULT_CONFIG: SchedulerConfig = {
    maxConcurrentScheduledInvestigations: 2,
    scheduledInvestigationMaxSteps: 20,
    scheduledInvestigationRetentionCount: 10,
    globalMaxSteps: 50,
    defaultTimeRange: 'ago(1h)',
    scheduledReportModel: 'gpt-4o-mini',
};

/**
 * Generic, product-agnostic scheduler that periodically triggers investigations
 * based on user-defined ScheduleDefinitions. Zero domain logic — all intelligence
 * is delegated to the configured agent via the free-form query.
 *
 * Events emitted:
 *  - 'schedule-update'  →  { schedule: ScheduleDefinition }
 *  - 'log'              →  string
 */
export class Scheduler extends EventEmitter {
    private store: ScheduleStore;
    private config: SchedulerConfig;
    private masterTimer: ReturnType<typeof setInterval> | null = null;
    private createInvestigation: CreateInvestigationFn;
    private getInvestigationResult: GetInvestigationResultFn;
    private deleteInvestigation: DeleteInvestigationFn;
    private listScheduleInvestigations: ListScheduleInvestigationsFn;
    private running: boolean = false;
    private llmProvider: LlmProvider | null = null;

    // Track how many scheduled investigations are currently active
    private activeCount: number = 0;

    // Guard against overlapping tick() invocations (Fix 8)
    private tickInProgress: boolean = false;

    constructor(
        store: ScheduleStore,
        createInvestigation: CreateInvestigationFn,
        getInvestigationResult: GetInvestigationResultFn,
        deleteInvestigation: DeleteInvestigationFn,
        listScheduleInvestigations: ListScheduleInvestigationsFn,
        config?: Partial<SchedulerConfig>,
    ) {
        super();
        this.store = store;
        this.createInvestigation = createInvestigation;
        this.getInvestigationResult = getInvestigationResult;
        this.deleteInvestigation = deleteInvestigation;
        this.listScheduleInvestigations = listScheduleInvestigations;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /** Set the LLM provider for AI-enhanced report generation. */
    setLlmProvider(provider: LlmProvider): void {
        this.llmProvider = provider;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    start(): void {
        if (this.running) return;
        this.running = true;

        // Master tick every 60 seconds — checks each schedule's due time
        this.masterTimer = setInterval(() => this.tick(), 60_000);
        this.log('Scheduler started (1-minute master tick).');

        // Run an immediate tick so schedules that are already due fire right away
        this.tick();
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;
        if (this.masterTimer) {
            clearInterval(this.masterTimer);
            this.masterTimer = null;
        }
        this.log('Scheduler stopped.');
    }

    isRunning(): boolean {
        return this.running;
    }

    updateConfig(partial: Partial<SchedulerConfig>): void {
        this.config = { ...this.config, ...partial };
    }

    /** Trigger a single schedule immediately, bypassing the interval timer. */
    async runNow(scheduleId: string): Promise<void> {
        const schedule = this.store.get(scheduleId);
        if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
        await this.executeSchedule(schedule);
    }

    // ── Core tick ─────────────────────────────────────────────────────────

    private async tick(): Promise<void> {
        // Prevent overlapping ticks (e.g., when a tick takes longer than 60s)
        if (this.tickInProgress) return;
        this.tickInProgress = true;
        try {
        const schedules = this.store.getAll().filter(s => s.enabled);
        const now = Date.now();

        for (const schedule of schedules) {
            // Check if a previous investigation is still running — settle it first
            if (schedule.activeInvestigationId) {
                await this.settleInvestigation(schedule);
                if (schedule.activeInvestigationId) continue; // still running — skip
            }

            // Also check escalation
            if (schedule.activeEscalationId) {
                await this.settleEscalation(schedule);
            }

            // Is this schedule due?
            if (schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() > now) {
                continue; // not due yet
            }

            // Check concurrency limit (0 = unlimited)
            if (this.config.maxConcurrentScheduledInvestigations > 0 && this.activeCount >= this.config.maxConcurrentScheduledInvestigations) {
                continue; // skip until a slot opens
            }

            await this.executeSchedule(schedule);
        }
        } finally {
            this.tickInProgress = false;
        }
    }

    // ── Execution ─────────────────────────────────────────────────────────

    private async executeSchedule(schedule: ScheduleDefinition): Promise<void> {
        const timeRange = schedule.timeRange || this.config.defaultTimeRange;
        // Priority: schedule-level maxSteps > scheduledInvestigationMaxSteps (if != default) > global maxSteps
        // If global maxSteps is 0 (unlimited), honour that unless the schedule explicitly overrides.
        const maxSteps = schedule.maxSteps
            ?? (this.config.scheduledInvestigationMaxSteps !== DEFAULT_CONFIG.scheduledInvestigationMaxSteps
                ? this.config.scheduledInvestigationMaxSteps
                : this.config.globalMaxSteps);

        // Build the query with a scheduling preamble so the agent knows to be concise
        const preamble = [
            'This is a SCHEDULED health check. Be concise and efficient.',
            'Execute the necessary checks, then call the finish tool with:',
            '  - verdict: "healthy", "warning", or "critical"',
            '  - summary: a brief explanation of what you found',
            'Keep your investigation focused and within a few steps.',
            '',
            '--- User Query ---',
        ].join('\n');

        const fullQuery = `${preamble}\n${schedule.query}`;

        try {
            this.log(`[Schedule ${schedule.name}] Starting check for target "${schedule.target}"...`);

            const result = await this.createInvestigation({
                target: schedule.target,
                query: fullQuery,
                timeRange,
                category: schedule.category,
                productId: schedule.productId,
                model: schedule.model,
                maxSteps,
                source: 'scheduled',
                scheduleId: schedule.id,
                createdBy: schedule.createdBy || 'scheduler',
            });

            this.activeCount++;

            // Update schedule state
            this.store.update(schedule.id, {
                lastRunAt: new Date().toISOString(),
                nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60_000).toISOString(),
                activeInvestigationId: result.id,
                lastInvestigationId: result.id,
            });

            this.emitUpdate(schedule.id);
            this.log(`[Schedule ${schedule.name}] Investigation ${result.id} started.`);
        } catch (err: any) {
            this.log(`[Schedule ${schedule.name}] Failed to start investigation: ${err.message}`);

            // Still advance the next-run timer so we don't spin-loop
            this.store.update(schedule.id, {
                lastRunAt: new Date().toISOString(),
                nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60_000).toISOString(),
                lastVerdict: 'error',
            });
            this.emitUpdate(schedule.id);
        }
    }

    // ── Settlement ────────────────────────────────────────────────────────

    private async settleInvestigation(schedule: ScheduleDefinition): Promise<void> {
        if (!schedule.activeInvestigationId) return;

        const result = this.getInvestigationResult(schedule.activeInvestigationId);
        if (!result) return; // investigation still running or not found

        const terminal = ['completed', 'failed', 'aborted', 'paused'].includes(result.status);
        if (!terminal) return; // still running

        this.activeCount = Math.max(0, this.activeCount - 1);

        // Determine verdict
        let verdict = result.verdict || this.inferVerdictFromReport(result.finalReport);

        if (result.status === 'failed' || result.status === 'aborted') {
            verdict = 'error';
        } else if (result.status === 'paused') {
            if (!verdict || verdict === 'unknown') verdict = 'paused'; // hit max steps — not an error, just incomplete
        } else if (result.status === 'completed' && (!verdict || verdict === 'unknown')) {
            // Non-health-check investigation completed successfully — no health verdict expected
            verdict = 'completed';
        }

        // Record history
        const historyEntry: ScheduleHistoryEntry = {
            timestamp: new Date().toISOString(),
            verdict,
            investigationId: schedule.activeInvestigationId,
            summary: result.finalReport?.substring(0, 2000),
        };
        this.store.appendHistory(schedule.id, historyEntry);

        // Write per-run report file & regenerate aggregate executive report
        // Both methods handle their own errors internally (non-blocking)
        this.writeRunReport(schedule, verdict, result, historyEntry);
        this.regenerateExecutiveReport(schedule).catch(() => {/* errors logged internally */});

        // Update schedule
        const consecutiveCritical = verdict === 'critical'
            ? (schedule.consecutiveCriticalCount || 0) + 1
            : 0;

        this.store.update(schedule.id, {
            activeInvestigationId: undefined,
            lastVerdict: verdict,
            consecutiveCriticalCount: consecutiveCritical,
        });

        this.log(`[Schedule ${schedule.name}] Investigation settled: verdict="${verdict}"`);
        this.emitUpdate(schedule.id);

        // Prune old investigations per retention policy
        this.pruneScheduleInvestigations(schedule);

        // Auto-escalate on critical
        if (verdict === 'critical' && schedule.autoEscalate && !schedule.activeEscalationId) {
            await this.escalate(schedule);
        }
    }

    private async settleEscalation(schedule: ScheduleDefinition): Promise<void> {
        if (!schedule.activeEscalationId) return;

        const result = this.getInvestigationResult(schedule.activeEscalationId);
        if (!result) return;

        const terminal = ['completed', 'failed', 'aborted', 'paused'].includes(result.status);
        if (!terminal) return;

        this.activeCount = Math.max(0, this.activeCount - 1);

        this.store.update(schedule.id, { activeEscalationId: undefined });
        this.log(`[Schedule ${schedule.name}] Escalation investigation ${schedule.activeEscalationId} completed (${result.status}).`);
        this.emitUpdate(schedule.id);
    }

    private async escalate(schedule: ScheduleDefinition): Promise<void> {
        const timeRange = schedule.timeRange || this.config.defaultTimeRange;
        const escalationQuery = schedule.escalationQuery || schedule.query;

        const preamble = [
            'ESCALATED: A scheduled health check detected a CRITICAL issue on this target.',
            'Perform a thorough investigation. Provide detailed findings, root cause analysis, and recommended actions.',
            '',
            '--- User Query ---',
        ].join('\n');

        try {
            this.log(`[Schedule ${schedule.name}] Auto-escalating — launching full investigation...`);

            const result = await this.createInvestigation({
                target: schedule.target,
                query: `${preamble}\n${escalationQuery}`,
                timeRange,
                category: schedule.category,
                productId: schedule.productId,
                model: schedule.model,
                // No maxSteps override — full investigation
                source: 'scheduled',
                scheduleId: schedule.id,
                createdBy: schedule.createdBy || 'scheduler',
            });

            this.activeCount++;
            this.store.update(schedule.id, { activeEscalationId: result.id });
            this.emitUpdate(schedule.id);

            this.log(`[Schedule ${schedule.name}] Escalation investigation ${result.id} started.`);
        } catch (err: any) {
            this.log(`[Schedule ${schedule.name}] Failed to escalate: ${err.message}`);
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /**
     * Infer verdict from the final report text when the finish tool didn't
     * include an explicit verdict field.
     */
    private inferVerdictFromReport(report?: string): 'healthy' | 'warning' | 'critical' | 'unknown' {
        if (!report) return 'unknown';
        const lower = report.toLowerCase();
        // Check for critical indicators first
        if (lower.includes('verdict: critical') || lower.includes('verdict:**critical') || lower.includes('critical')) {
            // Avoid false positives — "critical" must appear near "verdict" or as a standalone signal
            if (lower.includes('verdict') && lower.includes('critical')) return 'critical';
        }
        if (lower.includes('verdict: warning') || lower.includes('verdict:**warning') ||
            (lower.includes('verdict') && lower.includes('warning'))) {
            return 'warning';
        }
        if (lower.includes('verdict: healthy') || lower.includes('verdict:**healthy') ||
            (lower.includes('verdict') && lower.includes('healthy'))) {
            return 'healthy';
        }
        return 'unknown';
    }

    private async pruneScheduleInvestigations(schedule: ScheduleDefinition): Promise<void> {
        const retentionCount = schedule.retentionCount ?? this.config.scheduledInvestigationRetentionCount;
        if (retentionCount <= 0) return; // 0 means keep all

        try {
            const investigationIds = this.listScheduleInvestigations(schedule.id);
            if (investigationIds.length <= retentionCount) return;

            // investigationIds are sorted newest-first; delete the excess oldest
            const toDelete = investigationIds.slice(retentionCount);
            const deletedIds: string[] = [];
            for (const id of toDelete) {
                try {
                    await this.deleteInvestigation(id);
                    deletedIds.push(id);
                    this.log(`[Schedule ${schedule.name}] Pruned old investigation ${id} (retention=${retentionCount})`);
                } catch (err: any) {
                    this.log(`[Schedule ${schedule.name}] Failed to prune investigation ${id}: ${err.message}`);
                }
            }

            // Remove pruned entries from history and regenerate report
            if (deletedIds.length > 0) {
                this.store.removeHistoryEntries(schedule.id, new Set(deletedIds));
                this.regenerateExecutiveReport(schedule).catch(() => {/* errors logged internally */});
            }
        } catch (err: any) {
            this.log(`[Schedule ${schedule.name}] Failed to list investigations for pruning: ${err.message}`);
        }
    }

    private emitUpdate(scheduleId: string): void {
        const schedule = this.store.get(scheduleId);
        if (schedule) {
            this.emit('schedule-update', { schedule });
        }
    }

    /** Write a per-run markdown report for a settled investigation. */
    private writeRunReport(
        schedule: ScheduleDefinition,
        verdict: string,
        result: { status: string; verdict?: string; finalReport?: string },
        entry: ScheduleHistoryEntry,
    ): void {
        const lines = [
            `# Investigation Report`,
            ``,
            `| Field | Value |`,
            `|-------|-------|`,
            `| **Schedule** | ${schedule.name} |`,
            `| **Target** | ${schedule.target} |`,
            `| **Date** | ${new Date(entry.timestamp).toLocaleString()} |`,
            `| **Verdict** | ${verdict} |`,
            `| **Investigation ID** | ${entry.investigationId} |`,
            ``,
            `## Summary`,
            ``,
            entry.summary || '_No summary available._',
            ``,
            `## Full Report`,
            ``,
            result.finalReport || '_No report generated._',
        ];
        try {
            this.store.writeRunReport(schedule.id, entry.investigationId, lines.join('\n'));
        } catch (err: any) {
            this.log(`[Schedule ${schedule.name}] Failed to write run report: ${err.message}`);
        }
    }

    /** Regenerate the aggregate executive report for a schedule. */
    private async regenerateExecutiveReport(schedule: ScheduleDefinition): Promise<void> {
        const entries = this.store.getHistory(schedule.id);

        // Try AI-enhanced report first, fall back to template
        if (this.llmProvider) {
            try {
                const content = await generateAIExecutiveReport(schedule, entries, this.llmProvider, schedule.model || this.config.scheduledReportModel);
                this.store.writeExecutiveReport(schedule.id, content);
                this.log(`[Schedule ${schedule.name}] AI executive report generated.`);
                return;
            } catch (err: any) {
                this.log(`[Schedule ${schedule.name}] AI report failed (${err.message}), falling back to template.`);
            }
        }

        // Template-based fallback
        try {
            const content = generateExecutiveReport(schedule, entries);
            this.store.writeExecutiveReport(schedule.id, content);
        } catch (err: any) {
            this.log(`[Schedule ${schedule.name}] Failed to write executive report: ${err.message}`);
        }
    }

    private log(message: string): void {
        console.log(`[Scheduler] ${message}`);
        this.emit('log', message);
    }
}

// ── Executive Report Generator ─────────────────────────────────────────────

/**
 * Generate a markdown executive report from schedule definition + history entries.
 * Pure function — no LLM needed. Used by both Scheduler (file persistence)
 * and the API (on-demand generation for old schedules).
 */
export function generateExecutiveReport(
    schedule: Pick<ScheduleDefinition, 'name' | 'target' | 'query' | 'intervalMinutes'>,
    entries: ScheduleHistoryEntry[],
): string {
    if (entries.length === 0) {
        return `# Executive Summary: ${schedule.name}\n\n_No completed runs yet._`;
    }

    const sorted = [...entries].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // ── Stats ──
    const verdictBreakdown: Record<string, number> = {};
    for (const e of sorted) {
        verdictBreakdown[e.verdict] = (verdictBreakdown[e.verdict] || 0) + 1;
    }

    const successCount = (verdictBreakdown['healthy'] || 0) + (verdictBreakdown['completed'] || 0);
    const successRate = Math.round((successCount / sorted.length) * 1000) / 10;

    const severityScore = (v: string) => {
        if (v === 'critical') return 4;
        if (v === 'error') return 3;
        if (v === 'warning') return 2;
        if (v === 'paused') return 1;
        return 0;
    };

    let trend: 'Improving' | 'Degrading' | 'Stable' = 'Stable';
    if (sorted.length >= 4) {
        const mid = Math.floor(sorted.length / 2);
        const olderHalf = sorted.slice(0, mid);
        const newerHalf = sorted.slice(mid);
        const avgOlder = olderHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / olderHalf.length;
        const avgNewer = newerHalf.reduce((s, e) => s + severityScore(e.verdict), 0) / newerHalf.length;
        if (avgNewer < avgOlder - 0.3) trend = 'Improving';
        else if (avgNewer > avgOlder + 0.3) trend = 'Degrading';
    }

    const firstRunAt = sorted[0].timestamp;
    const lastRunAt = sorted[sorted.length - 1].timestamp;
    const lastVerdict = sorted[sorted.length - 1].verdict;

    // Count consecutive recent same-verdicts
    let consecutiveLast = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].verdict === lastVerdict) consecutiveLast++;
        else break;
    }

    // ── Verdict emoji helper ──
    const verdictEmoji = (v: string) => {
        if (v === 'healthy' || v === 'completed') return '✅';
        if (v === 'warning') return '⚠️';
        if (v === 'error') return '❌';
        if (v === 'critical') return '🔴';
        if (v === 'paused') return '⏸️';
        return '❓';
    };

    // ── Breach category label ──
    const breachCategoryLabel: Record<string, string> = {
        critical: '🔴 Critical Breaches',
        error: '❌ Error Breaches',
        warning: '⚠️ Warning Breaches',
        paused: '⏸️ Paused Runs',
        unknown: '❓ Unknown Issues',
    };

    // ── Extract structured fields from summary ──
    const parseSummary = (summary: string | undefined) => {
        if (!summary) return { title: 'No details available', body: '', impact: '', rootCause: '' };
        const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);
        const title = lines[0]?.replace(/^#+\s*/, '').substring(0, 120) || 'Investigation finding';

        // Try to extract Impact and Root Cause from structured text
        const impactMatch = summary.match(/impact[:\s]*([^\n]+)/i);
        const causeMatch = summary.match(/(?:root\s*cause|cause|reason)[:\s]*([^\n]+)/i);
        const impact = impactMatch ? impactMatch[1].trim() : '';
        const rootCause = causeMatch ? causeMatch[1].trim() : '';

        // Build readable body: skip title, strip markdown noise, exclude impact/cause lines
        const impactLine = impactMatch ? impactMatch[0].trim() : '';
        const causeLine = causeMatch ? causeMatch[0].trim() : '';
        const bodyLines = lines.slice(1)
            .map(l => l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, ''))
            .filter(l => l.length > 0 && l !== impactLine && l !== causeLine);
        const body = bodyLines.join(' ');

        return { title, body, impact, rootCause };
    };

    // ── Status line ──
    let statusLine: string;
    if (successRate >= 90) {
        statusLine = `✅ **Healthy** — ${successRate}% success rate across ${sorted.length} runs`;
    } else if (successRate >= 70) {
        statusLine = `⚠️ **Mostly Healthy** — ${successRate}% success rate across ${sorted.length} runs`;
    } else if (successRate >= 50) {
        statusLine = `❌ **Needs Attention** — ${successRate}% success rate across ${sorted.length} runs`;
    } else {
        statusLine = `🔴 **Critical** — only ${successRate}% success rate across ${sorted.length} runs`;
    }

    // ── Trend line ──
    let trendLine = `- **Trend:** Stable`;
    if (trend === 'Improving') {
        trendLine = `- **Trend:** 📈 Improving — recent runs are healthier than earlier ones`;
    } else if (trend === 'Degrading') {
        trendLine = `- **Trend:** 📉 Degrading — recent runs show more issues than earlier ones`;
    }

    // ── Alert lines ──
    const alertLines: string[] = [];
    if (consecutiveLast >= 3 && lastVerdict === 'critical') {
        alertLines.push(`> 🔴 **${consecutiveLast} consecutive CRITICAL runs** — immediate investigation recommended`);
    } else if (consecutiveLast >= 3 && lastVerdict === 'error') {
        alertLines.push(`> ❌ **${consecutiveLast} consecutive ERROR runs** — review monitoring config or target availability`);
    }

    // ── Verdict breakdown bullets ──
    const verdictOrder = ['healthy', 'completed', 'warning', 'paused', 'error', 'critical', 'unknown'];
    const activeVerdicts = verdictOrder.filter(v => (verdictBreakdown[v] || 0) > 0);
    const verdictBullets = activeVerdicts.map(v => {
        const count = verdictBreakdown[v];
        const pct = Math.round((count / sorted.length) * 100);
        const label = v.charAt(0).toUpperCase() + v.slice(1);
        return `- ${verdictEmoji(v)} **${label}:** ${count} runs (${pct}%)`;
    });

    // ── Group non-healthy entries by verdict as breach categories ──
    const breachVerdicts = ['critical', 'error', 'warning', 'paused', 'unknown'] as const;
    const breachSections: string[] = [];
    const allBreachEntries: { verdict: string; entry: ScheduleHistoryEntry; parsed: ReturnType<typeof parseSummary> }[] = [];
    for (const bv of breachVerdicts) {
        const breaches = sorted.filter(e => e.verdict === bv);
        if (breaches.length === 0) continue;
        breachSections.push(`### ${breachCategoryLabel[bv]}`);
        breachSections.push('');
        breaches.forEach((entry) => {
            const parsed = parseSummary(entry.summary);
            allBreachEntries.push({ verdict: bv, entry, parsed });
            const dateStr = new Date(entry.timestamp).toLocaleString();

            breachSections.push(`---`);
            breachSections.push('');
            breachSections.push(`#### ${parsed.title}`);
            breachSections.push('');
            breachSections.push(`🕐 ${dateStr}`);
            breachSections.push('');
            if (parsed.body) {
                breachSections.push(parsed.body);
                breachSections.push('');
            }
            if (parsed.impact) {
                breachSections.push(`**Impact:** ${parsed.impact}`);
                breachSections.push('');
            }
            if (parsed.rootCause) {
                breachSections.push(`**Root cause:** ${parsed.rootCause}`);
                breachSections.push('');
            }
        });
    }

    // ── Key Takeaways: identify patterns across breaches ──
    const takeaways: string[] = [];
    if (allBreachEntries.length > 0) {
        // Count recurring title patterns (first 60 chars)
        const titleFreq: Record<string, number> = {};
        for (const b of allBreachEntries) {
            const key = b.parsed.title.substring(0, 60);
            titleFreq[key] = (titleFreq[key] || 0) + 1;
        }
        const repeating = Object.entries(titleFreq).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
        for (const [pattern, count] of repeating) {
            takeaways.push(`- **Recurring (×${count}):** ${pattern}`);
        }

        // Verdict distribution insight
        const critCount = allBreachEntries.filter(b => b.verdict === 'critical').length;
        const errCount = allBreachEntries.filter(b => b.verdict === 'error').length;
        if (critCount > 0 && critCount === allBreachEntries.length) {
            takeaways.push(`- All ${critCount} issues are **critical severity** — systemic problem likely`);
        } else if (critCount > 0) {
            takeaways.push(`- ${critCount} of ${allBreachEntries.length} issues are critical severity`);
        }
        if (errCount > 0 && critCount === 0) {
            takeaways.push(`- ${errCount} error-level issues detected`);
        }

        // Time clustering: check if breaches cluster in recent runs
        if (sorted.length >= 4) {
            const mid = Math.floor(sorted.length / 2);
            const recentBreaches = allBreachEntries.filter(b => sorted.indexOf(b.entry) >= mid).length;
            if (recentBreaches > allBreachEntries.length / 2) {
                takeaways.push(`- Issues are concentrated in **recent runs** — problem may be getting worse`);
            }
        }
    }

    // ── Healthy / completed runs summary (compact) ──
    const healthyEntries = sorted.filter(e => e.verdict === 'healthy' || e.verdict === 'completed');
    const healthySection: string[] = [];
    if (healthyEntries.length > 0) {
        healthySection.push(`### ✅ Healthy Runs (${healthyEntries.length})`);
        healthySection.push('');
        // Show only timestamps for healthy runs — keep focus on issues
        const healthyDates = healthyEntries.map(e => new Date(e.timestamp).toLocaleString());
        healthySection.push(healthyDates.join(', '));
        healthySection.push('');
    }

    // ── Assemble ──
    const lines: string[] = [
        `# ${schedule.name}`,
        ``,
        statusLine,
        ``,
        ...alertLines,
        ...(alertLines.length > 0 ? [''] : []),
        `## At a Glance`,
        ``,
        `- **Target:** ${schedule.target}`,
        `- **Total Runs:** ${sorted.length}`,
        `- **Period:** ${new Date(firstRunAt).toLocaleString()} → ${new Date(lastRunAt).toLocaleString()}`,
        `- **Last Result:** ${verdictEmoji(lastVerdict)} ${lastVerdict.charAt(0).toUpperCase() + lastVerdict.slice(1)}`,
        trendLine,
        ``,
        `## Findings Breakdown`,
        ``,
        ...verdictBullets,
        ``,
        ...(takeaways.length > 0 ? [
            `## Key Takeaways`,
            ``,
            ...takeaways,
            ``,
        ] : []),
        `## Detailed Findings`,
        ``,
        ...(breachSections.length > 0 ? breachSections : ['_No breaches detected — all runs healthy._', '']),
        ...healthySection,
        `---`,
        `_Report generated at ${new Date().toLocaleString()}_`,
    ];

    return lines.join('\n');
}

// ── AI-Enhanced Executive Report Generator ──────────────────────────────────

const AI_REPORT_SYSTEM_PROMPT = `You are an expert SRE analyst. Given structured data about a scheduled monitoring investigation, produce a clear, readable executive report in Markdown.

Your report MUST include these sections in order:

## Executive Summary
Write 2-4 sentences in plain language summarizing the overall health status, key concerns, and whether the situation is improving or degrading. Be specific about what was monitored and what was found. Do not use jargon unnecessarily.

## Key Insights
Identify the most important cross-run patterns:
- Are the same issues recurring? What's the common theme?
- Is there a clear root cause that connects multiple findings?
- Are issues getting worse, stabilizing, or resolving?
- What time patterns exist (e.g., issues cluster at certain times)?
Write each insight as a concise bullet point with a bold label.

## Detailed Findings
Group findings by severity (Critical first, then Error, Warning, etc.). For each finding:
- Write a clear, human-readable title
- Explain what happened in 1-2 sentences (not a raw data dump)
- Note the impact and root cause if identifiable
- Include the timestamp
Skip healthy/completed runs — focus only on issues. If there are no issues, write "_All runs completed successfully with no issues detected._"

## Recommended Actions
List 2-5 prioritized, actionable next steps based on the findings. Each should be specific and practical (not generic advice like "monitor more").

Rules:
- Do NOT invent data. Only reference information provided in the input.
- Do NOT include raw JSON or data dumps.
- Keep the entire report under 800 words.
- Use emoji sparingly and only for verdict indicators (✅ ⚠️ 🔴 ❌).
- Write for a technical audience that needs to quickly understand the situation.`;

/**
 * Generate an AI-synthesized executive report using an LLM.
 * Falls back to the template-based report on any failure.
 */
export async function generateAIExecutiveReport(
    schedule: Pick<ScheduleDefinition, 'name' | 'target' | 'query' | 'intervalMinutes'>,
    entries: ScheduleHistoryEntry[],
    llmProvider: LlmProvider,
    model?: string,
): Promise<string> {
    if (entries.length === 0) {
        return `# Executive Summary: ${schedule.name}\n\n_No completed runs yet._`;
    }

    const sorted = [...entries].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // ── Compute stats for prompt context ──
    const verdictBreakdown: Record<string, number> = {};
    for (const e of sorted) {
        verdictBreakdown[e.verdict] = (verdictBreakdown[e.verdict] || 0) + 1;
    }
    const successCount = (verdictBreakdown['healthy'] || 0) + (verdictBreakdown['completed'] || 0);
    const successRate = Math.round((successCount / sorted.length) * 1000) / 10;

    const severityScore = (v: string) => {
        if (v === 'critical') return 4;
        if (v === 'error') return 3;
        if (v === 'warning') return 2;
        if (v === 'paused') return 1;
        return 0;
    };
    let trend: 'Improving' | 'Degrading' | 'Stable' = 'Stable';
    if (sorted.length >= 4) {
        const mid = Math.floor(sorted.length / 2);
        const avgOlder = sorted.slice(0, mid).reduce((s, e) => s + severityScore(e.verdict), 0) / Math.floor(sorted.length / 2);
        const avgNewer = sorted.slice(mid).reduce((s, e) => s + severityScore(e.verdict), 0) / (sorted.length - mid);
        if (avgNewer < avgOlder - 0.3) trend = 'Improving';
        else if (avgNewer > avgOlder + 0.3) trend = 'Degrading';
    }

    // ── Build run summaries for prompt: full for recent, condensed for older ──
    const RECENT_FULL_COUNT = 5;
    const MAX_RUNS_IN_PROMPT = 20;
    const runsForPrompt = sorted.slice(-MAX_RUNS_IN_PROMPT);
    const recentCutoff = runsForPrompt.length - RECENT_FULL_COUNT;

    const runDescriptions = runsForPrompt.map((entry, idx) => {
        const isRecent = idx >= recentCutoff;
        const summary = entry.summary
            ? (isRecent ? entry.summary : entry.summary.substring(0, 300) + (entry.summary.length > 300 ? '...' : ''))
            : 'No summary available';
        return `### Run ${idx + 1} — ${new Date(entry.timestamp).toLocaleString()}
- **Verdict:** ${entry.verdict}
- **Summary:** ${summary}`;
    }).join('\n\n');

    const olderRunCount = sorted.length - runsForPrompt.length;
    const olderNote = olderRunCount > 0
        ? `\n\n_Note: ${olderRunCount} older run(s) omitted. Their verdicts are included in the breakdown above._`
        : '';

    // ── Assemble user message ──
    const userMessage = `# Schedule: ${schedule.name}

## Metadata
- **Target:** ${schedule.target}
- **Query:** ${schedule.query}
- **Interval:** Every ${schedule.intervalMinutes} minutes
- **Total Runs:** ${sorted.length}
- **Period:** ${new Date(sorted[0].timestamp).toLocaleString()} → ${new Date(sorted[sorted.length - 1].timestamp).toLocaleString()}

## Verdict Breakdown
${Object.entries(verdictBreakdown).map(([v, c]) => `- ${v}: ${c} (${Math.round((c / sorted.length) * 100)}%)`).join('\n')}

## Computed Stats
- **Success Rate:** ${successRate}%
- **Trend:** ${trend}

## Investigation Run Details
${runDescriptions}${olderNote}`;

    // ── Call LLM ──
    const openai = await llmProvider.getClient(30_000);
    const effectiveModel = model || 'gpt-4o-mini'; // ultimate fallback if no config provided

    const completion = await openai.chat.completions.create({
        model: effectiveModel,
        messages: [
            { role: 'system', content: AI_REPORT_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
        throw new Error('LLM returned empty response');
    }

    // Prepend schedule name as H1 if the LLM didn't include it
    const report = content.startsWith('# ')
        ? content
        : `# ${schedule.name}\n\n${content}`;

    return report + `\n\n---\n_AI-generated report at ${new Date().toLocaleString()}_`;
}
