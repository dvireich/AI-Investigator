import { EventEmitter } from 'events';
import { ScheduleStore, ScheduleDefinition, ScheduleHistoryEntry } from './ScheduleStore';

/**
 * Callback the Scheduler uses to create an investigation.
 * Mirrors the signature extracted from server.ts (createInvestigation).
 * Returns { id: string } on success.
 */
export type CreateInvestigationFn = (params: {
    stamp: string;
    query: string;
    timeRange: string;
    issueType?: string;
    productId?: string;
    maxSteps?: number;
    source?: 'manual' | 'scheduled';
    scheduleId?: string;
}) => Promise<{ id: string }>;

/**
 * Callback to check if an investigation has finished and what verdict it produced.
 * Returns undefined if the investigation is still running.
 */
export type GetInvestigationResultFn = (investigationId: string) => {
    status: string;
    verdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';
    finalReport?: string;
} | undefined;

export interface SchedulerConfig {
    maxConcurrentScheduledInvestigations: number;
    scheduledInvestigationMaxSteps: number;
    defaultTimeRange: string;
}

const DEFAULT_CONFIG: SchedulerConfig = {
    maxConcurrentScheduledInvestigations: 2,
    scheduledInvestigationMaxSteps: 20,
    defaultTimeRange: 'ago(1h)',
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
    private running: boolean = false;

    // Track how many scheduled investigations are currently active
    private activeCount: number = 0;

    constructor(
        store: ScheduleStore,
        createInvestigation: CreateInvestigationFn,
        getInvestigationResult: GetInvestigationResultFn,
        config?: Partial<SchedulerConfig>,
    ) {
        super();
        this.store = store;
        this.createInvestigation = createInvestigation;
        this.getInvestigationResult = getInvestigationResult;
        this.config = { ...DEFAULT_CONFIG, ...config };
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

            // Check concurrency limit
            if (this.activeCount >= this.config.maxConcurrentScheduledInvestigations) {
                continue; // skip until a slot opens
            }

            await this.executeSchedule(schedule);
        }
    }

    // ── Execution ─────────────────────────────────────────────────────────

    private async executeSchedule(schedule: ScheduleDefinition): Promise<void> {
        const timeRange = schedule.timeRange || this.config.defaultTimeRange;
        const maxSteps = schedule.maxSteps || this.config.scheduledInvestigationMaxSteps;

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
            this.log(`[Schedule ${schedule.name}] Starting check for stamp "${schedule.stamp}"...`);

            const result = await this.createInvestigation({
                stamp: schedule.stamp,
                query: fullQuery,
                timeRange,
                issueType: schedule.issueType,
                productId: schedule.productId,
                maxSteps,
                source: 'scheduled',
                scheduleId: schedule.id,
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

        const terminal = ['completed', 'failed', 'aborted'].includes(result.status);
        if (!terminal) return; // still running

        this.activeCount = Math.max(0, this.activeCount - 1);

        // Determine verdict
        let verdict = result.verdict || this.inferVerdictFromReport(result.finalReport);

        if (result.status === 'failed' || result.status === 'aborted') {
            verdict = 'error';
        }

        // Record history
        const historyEntry: ScheduleHistoryEntry = {
            timestamp: new Date().toISOString(),
            verdict,
            investigationId: schedule.activeInvestigationId,
            summary: result.finalReport?.substring(0, 500),
        };
        this.store.appendHistory(schedule.id, historyEntry);

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

        // Auto-escalate on critical
        if (verdict === 'critical' && schedule.autoEscalate && !schedule.activeEscalationId) {
            await this.escalate(schedule);
        }
    }

    private async settleEscalation(schedule: ScheduleDefinition): Promise<void> {
        if (!schedule.activeEscalationId) return;

        const result = this.getInvestigationResult(schedule.activeEscalationId);
        if (!result) return;

        const terminal = ['completed', 'failed', 'aborted'].includes(result.status);
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
            'ESCALATED: A scheduled health check detected a CRITICAL issue on this stamp.',
            'Perform a thorough investigation. Provide detailed findings, root cause analysis, and recommended actions.',
            '',
            '--- User Query ---',
        ].join('\n');

        try {
            this.log(`[Schedule ${schedule.name}] Auto-escalating — launching full investigation...`);

            const result = await this.createInvestigation({
                stamp: schedule.stamp,
                query: `${preamble}\n${escalationQuery}`,
                timeRange,
                issueType: schedule.issueType,
                productId: schedule.productId,
                // No maxSteps override — full investigation
                source: 'scheduled',
                scheduleId: schedule.id,
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

    private emitUpdate(scheduleId: string): void {
        const schedule = this.store.get(scheduleId);
        if (schedule) {
            this.emit('schedule-update', { schedule });
        }
    }

    private log(message: string): void {
        console.log(`[Scheduler] ${message}`);
        this.emit('log', message);
    }
}
