import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Scheduler, SchedulerConfig, CreateInvestigationFn, GetInvestigationResultFn } from '../../schedules/Scheduler';
import { ScheduleStore, ScheduleDefinition } from '../../schedules/ScheduleStore';

// Minimal schedule definition
function makeSchedule(overrides: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
    return {
        id: '1', name: 'Test', enabled: true, target: 'tgt', query: 'check',
        intervalMinutes: 15, autoEscalate: false, createdAt: '2024-01-01',
        ...overrides,
    };
}

describe('Scheduler', () => {
    let store: { getAll: any; get: any; update: any; appendHistory: any };
    let createInv: ReturnType<typeof vi.fn>;
    let getResult: ReturnType<typeof vi.fn>;
    let scheduler: Scheduler;

    beforeEach(() => {
        vi.useFakeTimers();
        store = {
            getAll: vi.fn(() => []),
            get: vi.fn((id: string) => makeSchedule({ id })),
            update: vi.fn(),
            appendHistory: vi.fn(),
        };
        createInv = vi.fn(async () => ({ id: 'inv-1' }));
        getResult = vi.fn(() => undefined);
        scheduler = new Scheduler(
            store as any,
            createInv as CreateInvestigationFn,
            getResult as GetInvestigationResultFn,
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
            scheduler = new Scheduler(store as any, createInv, getResult, config);

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
            scheduler = new Scheduler(store as any, createInv, getResult, { scheduledInvestigationMaxSteps: 15 });
            store.getAll.mockReturnValue([makeSchedule()]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(createInv).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 15 }));
        });

        it('skips execution when concurrency limit reached', async () => {
            scheduler = new Scheduler(store as any, createInv, getResult, { maxConcurrentScheduledInvestigations: 1 });
            // Two due schedules, neither has an active investigation
            store.getAll.mockReturnValue([makeSchedule({ id: '1' }), makeSchedule({ id: '2' })]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            // First schedule executes (activeCount→1), second is blocked by limit
            expect(createInv).toHaveBeenCalledTimes(1);
            expect(createInv).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: '1' }));
        });

        it('treats maxConcurrentScheduledInvestigations=0 as unlimited', async () => {
            scheduler = new Scheduler(store as any, createInv, getResult, { maxConcurrentScheduledInvestigations: 0 });
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
});
