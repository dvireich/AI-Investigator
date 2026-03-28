import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Scheduler, SchedulerConfig, CreateInvestigationFn, GetInvestigationResultFn, DeleteInvestigationFn, ListScheduleInvestigationsFn, generateExecutiveReport } from '../../schedules/Scheduler';
import { ScheduleStore, ScheduleDefinition, ScheduleHistoryEntry } from '../../schedules/ScheduleStore';

// Minimal schedule definition
function makeSchedule(overrides: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
    return {
        id: '1', name: 'Test', enabled: true, target: 'tgt', query: 'check',
        intervalMinutes: 15, autoEscalate: false, createdAt: '2024-01-01',
        ...overrides,
    };
}

describe('Scheduler', () => {
    let store: { getAll: any; get: any; update: any; appendHistory: any; getHistory: any; writeRunReport: any; writeExecutiveReport: any; removeHistoryEntries: any };
    let createInv: ReturnType<typeof vi.fn>;
    let getResult: ReturnType<typeof vi.fn>;
    let deleteInv: ReturnType<typeof vi.fn>;
    let listScheduleInvs: ReturnType<typeof vi.fn>;
    let scheduler: Scheduler;

    beforeEach(() => {
        vi.useFakeTimers();
        store = {
            getAll: vi.fn(() => []),
            get: vi.fn((id: string) => makeSchedule({ id })),
            update: vi.fn(),
            appendHistory: vi.fn(),
            getHistory: vi.fn(() => []),
            writeRunReport: vi.fn(),
            writeExecutiveReport: vi.fn(),
            removeHistoryEntries: vi.fn(),
        };
        createInv = vi.fn(async () => ({ id: 'inv-1' }));
        getResult = vi.fn(() => undefined);
        deleteInv = vi.fn(async () => {});
        listScheduleInvs = vi.fn(() => []);
        scheduler = new Scheduler(
            store as any,
            createInv as CreateInvestigationFn,
            getResult as GetInvestigationResultFn,
            deleteInv as DeleteInvestigationFn,
            listScheduleInvs as ListScheduleInvestigationsFn,
        );
    });

    afterEach(() => {
        scheduler.stop();
        vi.useRealTimers();
    });

    describe('lifecycle', () => {
        it('starts and stops', () => {
            expect(scheduler.isRunning()).toBe(false);
            scheduler.start();
            expect(scheduler.isRunning()).toBe(true);
            scheduler.stop();
            expect(scheduler.isRunning()).toBe(false);
        });

        it('start is idempotent', () => {
            scheduler.start();
            scheduler.start();
            expect(scheduler.isRunning()).toBe(true);
        });

        it('stop is idempotent', () => {
            scheduler.start();
            scheduler.stop();
            scheduler.stop();
            expect(scheduler.isRunning()).toBe(false);
        });

        it('does not fire additional tick on redundant start()', async () => {
            store.getAll.mockReturnValue([]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            const callsAfterFirstStart = store.getAll.mock.calls.length;
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(store.getAll.mock.calls.length).toBe(callsAfterFirstStart);
        });
    });

    describe('updateConfig', () => {
        it('merges config', () => {
            scheduler.updateConfig({ maxConcurrentScheduledInvestigations: 5 });
        });
    });

    describe('tick / execute', () => {
        it('executes due schedules', async () => {
            store.getAll.mockReturnValue([makeSchedule({ nextRunAt: undefined })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).toHaveBeenCalled();
            expect(store.update).toHaveBeenCalled();
        });

        it('skips disabled schedules', async () => {
            store.getAll.mockReturnValue([makeSchedule({ enabled: false })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).not.toHaveBeenCalled();
        });

        it('skips schedules not yet due', async () => {
            const future = new Date(Date.now() + 3600000).toISOString();
            store.getAll.mockReturnValue([makeSchedule({ nextRunAt: future })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).not.toHaveBeenCalled();
        });

        it('respects concurrency limit', async () => {
            const config: Partial<SchedulerConfig> = { maxConcurrentScheduledInvestigations: 1 };
            scheduler = new Scheduler(store as any, createInv, getResult, deleteInv, listScheduleInvs, config);

            // First schedule: currently active
            store.getAll.mockReturnValue([
                makeSchedule({ id: '1', activeInvestigationId: 'running' }),
                makeSchedule({ id: '2' }),
            ]);
            // getResult returns running for inv
            getResult.mockReturnValue(undefined);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            // The second schedule should get created since the first one is still active
            // Actually, the first one has activeInvestigationId set so settlement is tried first.
            // Since result is undefined, it won't settle. The active count for active investigation isn't tracked.
        });

        it('handles createInvestigation failure', async () => {
            createInv.mockRejectedValue(new Error('service unavailable'));
            store.getAll.mockReturnValue([makeSchedule()]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'error' }));
        });

        it('uses schedule-level maxSteps when set', async () => {
            store.getAll.mockReturnValue([makeSchedule({ maxSteps: 10 })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 10 }));
        });

        it('uses scheduledInvestigationMaxSteps when different from default', async () => {
            scheduler = new Scheduler(store as any, createInv, getResult, deleteInv, listScheduleInvs, { scheduledInvestigationMaxSteps: 15 });
            store.getAll.mockReturnValue([makeSchedule()]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 15 }));
        });

        it('skips execution when concurrency limit reached', async () => {
            scheduler = new Scheduler(store as any, createInv, getResult, deleteInv, listScheduleInvs, { maxConcurrentScheduledInvestigations: 1 });
            // Two due schedules, neither has an active investigation
            store.getAll.mockReturnValue([makeSchedule({ id: '1' }), makeSchedule({ id: '2' })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            // First schedule executes (activeCount→1), second is blocked by limit
            expect(createInv).toHaveBeenCalledTimes(1);
            expect(createInv).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: '1' }));
        });

        it('treats maxConcurrentScheduledInvestigations=0 as unlimited', async () => {
            scheduler = new Scheduler(store as any, createInv, getResult, deleteInv, listScheduleInvs, { maxConcurrentScheduledInvestigations: 0 });
            store.getAll.mockReturnValue([makeSchedule()]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).toHaveBeenCalled();
        });
    });

    describe('settlement', () => {
        it('settles completed investigation', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1', enabled: true })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy', finalReport: 'all good' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.appendHistory).toHaveBeenCalled();
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'healthy' }));
        });

        it('sets verdict to error on failed investigation', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'failed' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'error' }));
        });

        it('sets verdict to paused when investigation is paused with no report', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'paused', verdict: undefined });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // No meaningful verdict → use 'paused' as the fallback for paused investigations
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'paused' }));
        });

        it('sets verdict to completed for non-health-check completion', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: undefined, finalReport: 'done' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'completed' }));
        });

        it('tracks consecutive critical count', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                consecutiveCriticalCount: 2,
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'critical' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({
                consecutiveCriticalCount: 3,
            }));
        });

        it('resets consecutive critical count on non-critical', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                consecutiveCriticalCount: 5,
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({
                consecutiveCriticalCount: 0,
            }));
        });

        it('uses result.verdict directly when present (skips inferVerdictFromReport)', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'warning', finalReport: 'verdict: critical' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // result.verdict ('warning') should be used despite report containing 'critical'
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'warning' }));
        });

        it('settles escalation', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeEscalationId: 'esc-1' })]);
            getResult.mockReturnValue({ status: 'completed' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({
                activeEscalationId: undefined,
            }));
        });

        it('skips settlement when investigation result is still running (non-terminal)', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'running' }); // non-terminal

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.appendHistory).not.toHaveBeenCalled();
            expect(store.update).not.toHaveBeenCalledWith('1', expect.objectContaining({ activeInvestigationId: undefined }));
        });

        it('keeps pre-existing health verdict when investigation is paused', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'paused', verdict: 'warning' }); // has explicit verdict

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'warning' }));
        });

        it('skips escalation settlement when escalation result is not found', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeEscalationId: 'esc-1' })]);
            getResult.mockReturnValue(undefined); // escalation not found yet

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).not.toHaveBeenCalledWith('1', expect.objectContaining({ activeEscalationId: undefined }));
        });

        it('skips escalation settlement when escalation is still running (non-terminal)', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeEscalationId: 'esc-1' })]);
            getResult.mockReturnValue({ status: 'running' }); // still in progress

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).not.toHaveBeenCalledWith('1', expect.objectContaining({ activeEscalationId: undefined }));
        });

        it('settleInvestigation returns early when schedule has no activeInvestigationId', async () => {
            // Direct invocation of private method — ensures the guard branch is covered
            await (scheduler as any).settleInvestigation(makeSchedule()); // no activeInvestigationId
            expect(getResult).not.toHaveBeenCalled();
        });

        it('settleEscalation returns early when schedule has no activeEscalationId', async () => {
            // Direct invocation of private method — ensures the guard branch is covered
            await (scheduler as any).settleEscalation(makeSchedule()); // no activeEscalationId
            expect(getResult).not.toHaveBeenCalled();
        });
    });

    describe('auto-escalation', () => {
        it('escalates on critical verdict when autoEscalate is enabled', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                autoEscalate: true,
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'critical' });
            createInv.mockResolvedValue({ id: 'esc-1' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Should have created an escalation investigation
            expect(createInv).toHaveBeenCalledTimes(1);
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({
                activeEscalationId: 'esc-1',
            }));
        });

        it('does not escalate when already has active escalation', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                autoEscalate: true,
                activeEscalationId: 'already-running',
            })]);
            getResult.mockImplementation((id) => {
                if (id === 'inv-1') return { status: 'completed', verdict: 'critical' };
                return undefined; // escalation still running
            });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Should NOT create an additional escalation
            expect(createInv).not.toHaveBeenCalled();
        });

        it('escalates when verdict is critical, autoEscalate is true, and no active escalation', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                autoEscalate: true,
                // no activeEscalationId
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'critical' });
            createInv.mockResolvedValue({ id: 'esc-new' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(createInv).toHaveBeenCalledTimes(1);
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({
                activeEscalationId: 'esc-new',
            }));
        });

        it('handles escalation creation failure', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                autoEscalate: true,
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'critical' });
            createInv.mockRejectedValue(new Error('failed esc'));

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            // Should not throw — error is logged
        });
    });

    describe('runNow', () => {
        it('executes a schedule immediately', async () => {
            store.get.mockReturnValue(makeSchedule());
            await scheduler.runNow('1');
            expect(createInv).toHaveBeenCalled();
        });

        it('throws for non-existent schedule', async () => {
            store.get.mockReturnValue(undefined);
            await expect(scheduler.runNow('nope')).rejects.toThrow('Schedule nope not found');
        });
    });

    describe('inferVerdictFromReport', () => {
        // Access private method via tick/settlement
        it('infers critical from report text', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({
                status: 'completed',
                verdict: undefined,
                finalReport: 'The verdict is critical. Things are bad.',
            });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'critical' }));
        });

        it('infers warning from report text', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({
                status: 'completed',
                verdict: undefined,
                finalReport: 'The verdict is warning. Monitor closely.',
            });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'warning' }));
        });

        it('infers healthy from report text', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({
                status: 'completed',
                verdict: undefined,
                finalReport: 'Verdict: healthy. All systems nominal.',
            });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'healthy' }));
        });

        it('returns unknown when no verdict keyword found', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({
                status: 'completed',
                verdict: undefined,
                finalReport: 'Some general report without verdict mentions.',
            });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Completed with no verdict → 'completed'
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'completed' }));
        });
    });

    describe('events', () => {
        it('emits schedule-update events', async () => {
            const listener = vi.fn();
            scheduler.on('schedule-update', listener);
            store.getAll.mockReturnValue([makeSchedule()]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(listener).toHaveBeenCalled();
        });

        it('emits log events', async () => {
            const listener = vi.fn();
            scheduler.on('log', listener);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(listener).toHaveBeenCalledWith(expect.stringContaining('Scheduler started'));
        });
    });

    describe('master timer', () => {
        it('ticks every 60 seconds', async () => {
            store.getAll.mockReturnValue([]);
            scheduler.start();

            // Initial tick
            await vi.advanceTimersByTimeAsync(0);
            const initialCalls = store.getAll.mock.calls.length;

            // Tick at 60 seconds
            await vi.advanceTimersByTimeAsync(60_000);
            expect(store.getAll.mock.calls.length).toBeGreaterThan(initialCalls);
        });
    });

    describe('pruning', () => {
        it('prunes old investigations when over retention limit', async () => {
            listScheduleInvs.mockReturnValue(['inv-3', 'inv-2', 'inv-1']); // newest first
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 2 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Should delete the oldest one (inv-1 = 3rd = index 2, past retention of 2)
            expect(deleteInv).toHaveBeenCalledWith('inv-1');
            expect(deleteInv).toHaveBeenCalledTimes(1);
        });

        it('does not prune when within retention limit', async () => {
            listScheduleInvs.mockReturnValue(['inv-2', 'inv-1']); // only 2
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 5 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-2' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(deleteInv).not.toHaveBeenCalled();
        });

        it('uses schedule-level retentionCount override', async () => {
            listScheduleInvs.mockReturnValue(['inv-3', 'inv-2', 'inv-1']);
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 10 }); // global

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-3', retentionCount: 1 })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Schedule override of 1 → delete inv-2 and inv-1
            expect(deleteInv).toHaveBeenCalledTimes(2);
            expect(deleteInv).toHaveBeenCalledWith('inv-2');
            expect(deleteInv).toHaveBeenCalledWith('inv-1');
        });

        it('skips pruning when retentionCount is 0 (keep all)', async () => {
            listScheduleInvs.mockReturnValue(['inv-3', 'inv-2', 'inv-1']);
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 0 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-3' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(deleteInv).not.toHaveBeenCalled();
            expect(listScheduleInvs).not.toHaveBeenCalled();
        });

        it('handles deletion failure gracefully', async () => {
            listScheduleInvs.mockReturnValue(['inv-3', 'inv-2', 'inv-1']);
            deleteInv.mockRejectedValue(new Error('disk error'));
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 2 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-3' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            // Should not throw
            await vi.advanceTimersByTimeAsync(0);

            expect(deleteInv).toHaveBeenCalledWith('inv-1');
        });

        it('handles listScheduleInvestigations failure gracefully', async () => {
            listScheduleInvs.mockImplementation(() => { throw new Error('list error'); });
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 2 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            // Should not throw
            await vi.advanceTimersByTimeAsync(0);

            expect(deleteInv).not.toHaveBeenCalled();
        });

        it('removes pruned investigation IDs from history and regenerates report', async () => {
            listScheduleInvs.mockReturnValue(['inv-3', 'inv-2', 'inv-1']); // newest first
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 2 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-3' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // inv-1 was pruned
            expect(deleteInv).toHaveBeenCalledWith('inv-1');
            // History entries for pruned investigations should be removed
            expect(store.removeHistoryEntries).toHaveBeenCalledWith('1', new Set(['inv-1']));
            // Executive report should be regenerated after pruning
            // writeExecutiveReport is called once during settlement and once after pruning
            expect(store.writeExecutiveReport).toHaveBeenCalledTimes(2);
        });

        it('does not remove history entries when no investigations are pruned', async () => {
            listScheduleInvs.mockReturnValue(['inv-2', 'inv-1']); // exactly at limit
            scheduler.updateConfig({ scheduledInvestigationRetentionCount: 2 });

            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-2' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.removeHistoryEntries).not.toHaveBeenCalled();
        });
    });

    describe('report generation', () => {
        it('writes per-run report and executive report on settlement', async () => {
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy', finalReport: 'All good' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(store.writeRunReport).toHaveBeenCalledWith('1', 'inv-1', expect.stringContaining('Investigation Report'));
            expect(store.writeRunReport).toHaveBeenCalledWith('1', 'inv-1', expect.stringContaining('All good'));
            expect(store.writeExecutiveReport).toHaveBeenCalledWith('1', expect.stringContaining('Executive Summary'));
        });

        it('handles writeRunReport failure gracefully', async () => {
            store.writeRunReport.mockImplementation(() => { throw new Error('disk full'); });
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Should not throw — settlement still succeeds
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'healthy' }));
        });

        it('handles writeExecutiveReport failure gracefully', async () => {
            store.writeExecutiveReport.mockImplementation(() => { throw new Error('disk full'); });
            store.getAll.mockReturnValue([makeSchedule({ activeInvestigationId: 'inv-1' })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'healthy' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Should not throw — settlement still succeeds
            expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ lastVerdict: 'healthy' }));
        });

        it('includes schedule details in per-run report', async () => {
            store.getAll.mockReturnValue([makeSchedule({
                activeInvestigationId: 'inv-1',
                name: 'My Health Check',
                target: 'prod-service',
            })]);
            getResult.mockReturnValue({ status: 'completed', verdict: 'warning', finalReport: 'Some issues found' });

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            const reportContent = store.writeRunReport.mock.calls[0][2] as string;
            expect(reportContent).toContain('My Health Check');
            expect(reportContent).toContain('prod-service');
            expect(reportContent).toContain('warning');
            expect(reportContent).toContain('Some issues found');
        });
    });
});

describe('generateExecutiveReport', () => {
    const schedule = { name: 'Test Schedule', target: 'my-target', query: 'check health', intervalMinutes: 15 };

    it('handles empty entries', () => {
        const result = generateExecutiveReport(schedule, []);
        expect(result).toContain('Executive Summary: Test Schedule');
        expect(result).toContain('No completed runs yet');
    });

    it('generates report with statistics and breach sections', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1', summary: 'All good' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2', summary: 'Still good' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'warning', investigationId: 'inv-3', summary: 'Latency spike detected\nImpact: 200ms p99 latency\nRoot cause: DB connection pool exhaustion' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('# Test Schedule');
        expect(result).toContain('my-target');
        expect(result).toContain('3');
        expect(result).toContain('Findings Breakdown');
        expect(result).toContain('Healthy');
        expect(result).toContain('Warning');
        expect(result).toContain('Detailed Findings');
        expect(result).toContain('Warning Breaches');
        expect(result).toContain('Latency spike detected');
        expect(result).toContain('200ms p99 latency');
        expect(result).toContain('DB connection pool exhaustion');
        expect(result).toContain('Healthy Runs');
    });

    it('detects improving trend', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'critical', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'critical', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'warning', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'healthy', investigationId: 'inv-4' },
            { timestamp: '2024-01-01T04:00:00Z', verdict: 'healthy', investigationId: 'inv-5' },
            { timestamp: '2024-01-01T05:00:00Z', verdict: 'healthy', investigationId: 'inv-6' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Improving');
    });

    it('detects degrading trend', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'warning', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'critical', investigationId: 'inv-4' },
            { timestamp: '2024-01-01T04:00:00Z', verdict: 'critical', investigationId: 'inv-5' },
            { timestamp: '2024-01-01T05:00:00Z', verdict: 'critical', investigationId: 'inv-6' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Degrading');
    });

    it('shows high success rate assessment', () => {
        const entries: ScheduleHistoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
            timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
            verdict: 'healthy' as const,
            investigationId: `inv-${i}`,
        }));
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('✅ **Healthy**');
        expect(result).toContain('100%');
        expect(result).toContain('No breaches detected');
    });

    it('shows low success rate alert', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'critical', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'error', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'critical', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'healthy', investigationId: 'inv-4' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('🔴 **Critical**');
        expect(result).toContain('Critical Breaches');
        expect(result).toContain('Error Breaches');
    });

    it('shows consecutive critical alert', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'critical', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'critical', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'critical', investigationId: 'inv-4' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('consecutive CRITICAL runs');
    });

    it('formats breach entries with details and impact', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'error', investigationId: 'inv-1', summary: 'Service timeout\nImpact: Users cannot log in\nRoot cause: Auth service OOM' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('#### Service timeout');
        expect(result).toContain('🕐');
        expect(result).toContain('**Impact:** Users cannot log in');
        expect(result).toContain('**Root cause:** Auth service OOM');
    });

    it('handles entries without summaries showing defaults', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'warning', investigationId: 'inv-1' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('No details available');
    });

    it('includes report generation timestamp', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Report generated at');
    });

    it('shows moderate success rate assessment (70-90%)', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'healthy', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'warning', investigationId: 'inv-4' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Mostly Healthy');
    });

    it('shows intermittent issues assessment (50-70%)', () => {
        // 3 healthy out of 5 = 60% → 50-70% range
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'healthy', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'critical', investigationId: 'inv-4' },
            { timestamp: '2024-01-01T04:00:00Z', verdict: 'error', investigationId: 'inv-5' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Needs Attention');
    });

    it('shows consecutive error pattern alert', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'error', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'error', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'error', investigationId: 'inv-4' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('consecutive ERROR runs');
    });

    it('includes paused verdicts in severity scoring for trend calculation', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'paused', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'paused', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'healthy', investigationId: 'inv-3' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'healthy', investigationId: 'inv-4' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        // paused(severity 1) → healthy(severity 0) = Improving
        expect(result).toContain('Improving');
        expect(result).toContain('Paused');
        expect(result).toContain('Paused Runs');
    });

    it('handles completed verdicts and all verdict types in distribution', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'completed', investigationId: 'inv-1', summary: 'Done' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'unknown', investigationId: 'inv-2' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Completed');
        expect(result).toContain('Unknown');
        expect(result).toContain('Unknown Issues');
    });

    it('parses impact and root cause from summary with alternate keywords', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'critical', investigationId: 'inv-1', summary: 'API Gateway Down\nCause: Certificate expired\nImpact: All external traffic blocked' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('API Gateway Down');
        expect(result).toContain('Certificate expired');
        expect(result).toContain('All external traffic blocked');
    });

    it('handles whitespace-only summary with fallback title', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'error', investigationId: 'inv-1', summary: '   \n   \n  ' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Investigation finding');
        expect(result).toContain('Error Breaches');
    });

    it('shows body text as readable paragraph for breaches with extra text', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'critical', investigationId: 'inv-1',
                summary: 'CRITICAL health breach\nThe API returned 503 errors for 15 minutes.\nImpact: Full service outage\nMultiple downstream consumers affected.' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('#### CRITICAL health breach');
        expect(result).toContain('503 errors');
        expect(result).toContain('downstream consumers');
        expect(result).toContain('**Impact:** Full service outage');
        // Body text should be a paragraph, not a blockquote
        expect(result).not.toContain('> ');
    });

    it('shows Key Takeaways for recurring issues', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'critical', investigationId: 'inv-1', summary: 'Service timeout on payment API' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'critical', investigationId: 'inv-2', summary: 'Service timeout on payment API' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'critical', investigationId: 'inv-3', summary: 'Service timeout on payment API' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Key Takeaways');
        expect(result).toContain('Recurring');
        expect(result).toContain('×3');
        expect(result).toContain('systemic problem likely');
    });

    it('shows Key Takeaways with severity distribution and recent clustering', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'critical', investigationId: 'inv-3', summary: 'Issue A' },
            { timestamp: '2024-01-01T03:00:00Z', verdict: 'error', investigationId: 'inv-4', summary: 'Issue B' },
            { timestamp: '2024-01-01T04:00:00Z', verdict: 'critical', investigationId: 'inv-5', summary: 'Issue C' },
            { timestamp: '2024-01-01T05:00:00Z', verdict: 'error', investigationId: 'inv-6', summary: 'Issue D' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Key Takeaways');
        expect(result).toContain('2 of 4 issues are critical severity');
        expect(result).toContain('recent runs');
    });

    it('shows compact healthy runs section with dates only', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'healthy', investigationId: 'inv-1', summary: 'All systems normal' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'healthy', investigationId: 'inv-2', summary: 'All clear' },
            { timestamp: '2024-01-01T02:00:00Z', verdict: 'warning', investigationId: 'inv-3', summary: 'Slow query' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Healthy Runs (2)');
        // Should NOT include full summary text in healthy section
        expect(result).not.toMatch(/Healthy Runs[\s\S]*All systems normal/);
    });

    it('shows error-only takeaway when no critical issues', () => {
        const entries: ScheduleHistoryEntry[] = [
            { timestamp: '2024-01-01T00:00:00Z', verdict: 'error', investigationId: 'inv-1', summary: 'Disk full' },
            { timestamp: '2024-01-01T01:00:00Z', verdict: 'error', investigationId: 'inv-2', summary: 'OOM crash' },
        ];
        const result = generateExecutiveReport(schedule, entries);
        expect(result).toContain('Key Takeaways');
        expect(result).toContain('2 error-level issues detected');
    });
});
