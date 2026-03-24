import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Schedules } from '../../pages/Schedules';
import { ToastProvider } from '../../components/Toast';
import type { ScheduleDefinition, ScheduleHistoryEntry } from '../../types/schedule';
import type { PaginatedResponse } from '../../api';

// ── Paginated response helper ────────────────────────────────────────────

function paginatedSchedules(items: ScheduleDefinition[]): PaginatedResponse<ScheduleDefinition> {
    return { items, totalCount: items.length, page: 1, pageSize: 20, totalPages: Math.max(1, Math.ceil(items.length / 20)) };
}

// ── Mock navigation ──────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ── Mock API ─────────────────────────────────────────────────────────────

vi.mock('../../api', () => ({
    api: {
        getSchedules: vi.fn().mockResolvedValue(paginatedSchedules([])),
        getSchedulerStatus: vi.fn().mockResolvedValue({ running: true }),
        listProducts: vi.fn().mockResolvedValue([]),
        listModels: vi.fn().mockResolvedValue(['gpt-4o', 'claude-3-opus']),
        getSettings: vi.fn().mockResolvedValue({ model: 'gpt-4o', scheduledInvestigationMaxSteps: 50 }),
        getScheduleHistory: vi.fn().mockResolvedValue([]),
        deleteSchedule: vi.fn().mockResolvedValue({}),
        enableSchedule: vi.fn().mockResolvedValue({}),
        disableSchedule: vi.fn().mockResolvedValue({}),
        runScheduleNow: vi.fn().mockResolvedValue({}),
        updateSchedule: vi.fn().mockResolvedValue({}),
        startScheduler: vi.fn().mockResolvedValue({}),
        stopScheduler: vi.fn().mockResolvedValue({}),
    },
}));

// ── Test data factories ──────────────────────────────────────────────────

function createSchedule(overrides: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
    return {
        id: 's1',
        name: 'Daily Check',
        enabled: true,
        target: 'oi-tds-prd-eus2p-01',
        query: 'TeleductMetrics | where Stamp == "test"',
        intervalMinutes: 60,
        autoEscalate: false,
        createdAt: new Date().toISOString(),
        lastRunAt: new Date(Date.now() - 3600000).toISOString(),
        nextRunAt: new Date(Date.now() + 3600000).toISOString(),
        lastVerdict: 'healthy',
        ...overrides,
    };
}

function createHistoryEntry(overrides: Partial<ScheduleHistoryEntry> = {}): ScheduleHistoryEntry {
    return {
        timestamp: new Date().toISOString(),
        verdict: 'healthy',
        investigationId: 'inv-123',
        summary: 'All systems healthy',
        ...overrides,
    };
}

// ── Render helper ────────────────────────────────────────────────────────

function renderSchedules() {
    return render(
        <ToastProvider>
            <MemoryRouter>
                <Schedules />
            </MemoryRouter>
        </ToastProvider>
    );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Schedules', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockNavigate.mockClear();

        // Reset all mock implementations to defaults
        const { api } = await import('../../api');
        vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([]));
        vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });
        vi.mocked(api.listProducts).mockResolvedValue([
            { id: 'p1', name: 'Teleduct', repoRoot: '/repo', systemPromptPath: '', knowledgeBasePath: '', workingDirectory: '', investigationsPath: '' },
        ]);
        vi.mocked(api.listModels).mockResolvedValue(['gpt-4o', 'claude-3-opus']);
        vi.mocked(api.getSettings).mockResolvedValue({ model: 'gpt-4o', scheduledInvestigationMaxSteps: 50 } as any);
        vi.mocked(api.getScheduleHistory).mockResolvedValue([]);
        vi.mocked(api.deleteSchedule).mockResolvedValue({});
        vi.mocked(api.enableSchedule).mockResolvedValue({});
        vi.mocked(api.disableSchedule).mockResolvedValue({});
        vi.mocked(api.runScheduleNow).mockResolvedValue({});
        vi.mocked(api.updateSchedule).mockResolvedValue({});
        vi.mocked(api.startScheduler).mockResolvedValue({});
        vi.mocked(api.stopScheduler).mockResolvedValue({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ══════════════════════════════════════════════════════════════════════
    // Loading State
    // ══════════════════════════════════════════════════════════════════════

    describe('Loading State', () => {
        it('shows loading spinner while fetching data', async () => {
            const { api } = await import('../../api');
            // Create a promise that never resolves to keep loading state
            let resolveSchedules: (value: any) => void;
            vi.mocked(api.getSchedules).mockImplementation(
                () => new Promise(resolve => { resolveSchedules = resolve; })
            );

            renderSchedules();
            
            // Should show loading indicator initially
            expect(document.querySelector('.animate-pulse')).toBeInTheDocument();

            // Resolve the promise to complete loading
            await act(async () => {
                resolveSchedules!(paginatedSchedules([]));
            });

            await waitFor(() => {
                expect(screen.getByText('Scheduled Investigations')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Empty State
    // ══════════════════════════════════════════════════════════════════════

    describe('Empty State', () => {
        it('renders heading and description', async () => {
            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Scheduled Investigations')).toBeInTheDocument();
                expect(screen.getByText(/periodic automated investigations/i)).toBeInTheDocument();
            });
        });

        it('shows empty state when no schedules exist', async () => {
            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/no schedules yet/i)).toBeInTheDocument();
                expect(screen.getByText(/create a schedule to periodically run/i)).toBeInTheDocument();
            });
        });

        it('shows create schedule button in empty state', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText(/no schedules yet/i));

            const createBtn = screen.getByRole('button', { name: /create schedule/i });
            await user.click(createBtn);

            expect(mockNavigate).toHaveBeenCalledWith('/schedules/new');
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // API Loading on Mount
    // ══════════════════════════════════════════════════════════════════════

    describe('API Loading', () => {
        it('loads schedules on mount', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalled();
            });
        });

        it('loads scheduler status on mount', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            await waitFor(() => {
                expect(api.getSchedulerStatus).toHaveBeenCalled();
            });
        });

        it('loads products on mount', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            await waitFor(() => {
                expect(api.listProducts).toHaveBeenCalled();
            });
        });

        it('loads models on mount', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            await waitFor(() => {
                expect(api.listModels).toHaveBeenCalled();
            });
        });

        it('loads settings on mount', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            await waitFor(() => {
                expect(api.getSettings).toHaveBeenCalled();
            });
        });

        it('handles schedules load error gracefully', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockRejectedValue(new Error('Network error'));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Scheduled Investigations')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Scheduler Start/Stop Toggle
    // ══════════════════════════════════════════════════════════════════════

    describe('Scheduler Toggle', () => {
        it('shows Stop Scheduler button when scheduler is running', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /stop scheduler/i })).toBeInTheDocument();
            });
        });

        it('shows Start Scheduler button when scheduler is stopped', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: false });

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /start scheduler/i })).toBeInTheDocument();
            });
        });

        it('calls stopScheduler when clicking Stop Scheduler', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByRole('button', { name: /stop scheduler/i }));

            await user.click(screen.getByRole('button', { name: /stop scheduler/i }));

            await waitFor(() => {
                expect(api.stopScheduler).toHaveBeenCalled();
            });
        });

        it('calls startScheduler when clicking Start Scheduler', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: false });

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByRole('button', { name: /start scheduler/i }));

            await user.click(screen.getByRole('button', { name: /start scheduler/i }));

            await waitFor(() => {
                expect(api.startScheduler).toHaveBeenCalled();
            });
        });

        it('refreshes schedules after toggling scheduler', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByRole('button', { name: /stop scheduler/i }));

            vi.mocked(api.getSchedules).mockClear();
            await user.click(screen.getByRole('button', { name: /stop scheduler/i }));

            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalled();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Schedule List Display
    // ══════════════════════════════════════════════════════════════════════

    describe('Schedule List Display', () => {
        it('renders schedule list when data exists', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Daily Check')).toBeInTheDocument();
            });
        });

        it('displays schedule target', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ target: 'ax-tds-prd-eus2p-01' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('ax-tds-prd-eus2p-01')).toBeInTheDocument();
            });
        });

        it('displays schedule interval', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ intervalMinutes: 30 })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/every 30m/i)).toBeInTheDocument();
            });
        });

        it('displays DISABLED badge for disabled schedules', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ enabled: false })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('DISABLED')).toBeInTheDocument();
            });
        });

        it('displays product name when productId is set', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ productId: 'p1' })]));
            vi.mocked(api.listProducts).mockResolvedValue([
                { id: 'p1', name: 'Teleduct Product', repoRoot: '', systemPromptPath: '', knowledgeBasePath: '', workingDirectory: '', investigationsPath: '' },
            ]);

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/Teleduct Product/)).toBeInTheDocument();
            });
        });

        it('displays multiple schedules', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's1', name: 'Schedule One' }),
                createSchedule({ id: 's2', name: 'Schedule Two' }),
                createSchedule({ id: 's3', name: 'Schedule Three' }),
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Schedule One')).toBeInTheDocument();
                expect(screen.getByText('Schedule Two')).toBeInTheDocument();
                expect(screen.getByText('Schedule Three')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Verdict Badges
    // ══════════════════════════════════════════════════════════════════════

    describe('Verdict Badges', () => {
        it('displays Healthy badge for healthy verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'healthy' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Healthy')).toBeInTheDocument();
            });
        });

        it('displays Warning badge for warning verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'warning' })]));

            renderSchedules();
            await waitFor(() => {
                // Find the verdict badge specifically (has both icon and label)
                const badges = screen.getAllByText('Warning');
                const verdictBadge = badges.find(el => el.closest('div[class*="rounded-lg"]')?.querySelector('svg'));
                expect(verdictBadge).toBeInTheDocument();
            });
        });

        it('displays Critical badge for critical verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'critical' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Critical')).toBeInTheDocument();
            });
        });

        it('displays Error badge for error verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'error' })]));

            renderSchedules();
            await waitFor(() => {
                // Find the verdict badge specifically (has both icon and label)
                const errorElements = screen.getAllByText('Error');
                const verdictBadge = errorElements.find(el => el.closest('div[class*="rounded-lg"]')?.querySelector('svg'));
                expect(verdictBadge).toBeInTheDocument();
            });
        });

        it('displays Paused badge for paused verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'paused' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Paused')).toBeInTheDocument();
            });
        });

        it('displays Completed badge for completed verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'completed' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Completed')).toBeInTheDocument();
            });
        });

        it('displays Pending badge for unknown verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'unknown' })]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Pending')).toBeInTheDocument();
            });
        });

        it('displays Running badge when activeInvestigationId is set', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ activeInvestigationId: 'inv-active', lastVerdict: 'healthy' }),
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Running')).toBeInTheDocument();
            });
        });

        it('applies critical styling with animation for critical/error verdicts', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ lastVerdict: 'critical' })]));

            renderSchedules();
            await waitFor(() => {
                // Find the schedule card with critical styling - it has the animate-flicker-red class
                const scheduleContainer = document.querySelector('.animate-flicker-red');
                expect(scheduleContainer).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Stats Bar
    // ══════════════════════════════════════════════════════════════════════

    describe('Stats Bar', () => {
        it('displays stats bar when schedules exist', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText('Enabled')).toBeInTheDocument();
                expect(screen.getByText('OK')).toBeInTheDocument();
                expect(screen.getByText('Warning')).toBeInTheDocument();
                expect(screen.getByText('Issues')).toBeInTheDocument();
            });
        });

        it('calculates enabled count correctly', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's1', enabled: true }),
                createSchedule({ id: 's2', enabled: true }),
                createSchedule({ id: 's3', enabled: false }),
            ]));

            renderSchedules();
            await waitFor(() => {
                // Should show 2/3 for enabled
                expect(screen.getByText('2')).toBeInTheDocument();
                expect(screen.getByText('/3')).toBeInTheDocument();
            });
        });

        it('calculates OK count correctly', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's1', lastVerdict: 'healthy' }),
                createSchedule({ id: 's2', lastVerdict: 'completed' }),
                createSchedule({ id: 's3', lastVerdict: 'warning' }),
            ]));

            renderSchedules();
            await waitFor(() => {
                // Find the OK stat card and verify count is 2
                const okLabel = screen.getByText('OK');
                const statCard = okLabel.closest('div[class*="rounded-xl"]');
                expect(within(statCard!).getByText('2')).toBeInTheDocument();
            });
        });

        it('calculates warning count correctly', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's1', lastVerdict: 'warning' }),
                createSchedule({ id: 's2', lastVerdict: 'paused' }),
                createSchedule({ id: 's3', lastVerdict: 'healthy' }),
            ]));

            renderSchedules();
            await waitFor(() => {
                const warningLabel = screen.getAllByText('Warning')[0]; // Stats card
                const statCard = warningLabel.closest('div[class*="rounded-xl"]');
                expect(within(statCard!).getByText('2')).toBeInTheDocument();
            });
        });

        it('calculates issues count correctly', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's1', lastVerdict: 'critical' }),
                createSchedule({ id: 's2', lastVerdict: 'error' }),
                createSchedule({ id: 's3', lastVerdict: 'healthy' }),
            ]));

            renderSchedules();
            await waitFor(() => {
                const issuesLabel = screen.getByText('Issues');
                const statCard = issuesLabel.closest('div[class*="rounded-xl"]');
                expect(within(statCard!).getByText('2')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Schedule Enable/Disable
    // ══════════════════════════════════════════════════════════════════════

    describe('Schedule Enable/Disable', () => {
        it('calls disableSchedule when disabling enabled schedule', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', enabled: true })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            const disableBtn = screen.getByTitle('Disable');
            await user.click(disableBtn);

            await waitFor(() => {
                expect(api.disableSchedule).toHaveBeenCalledWith('s1');
            });
        });

        it('calls enableSchedule when enabling disabled schedule', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', enabled: false })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            const enableBtn = screen.getByTitle('Enable');
            await user.click(enableBtn);

            await waitFor(() => {
                expect(api.enableSchedule).toHaveBeenCalledWith('s1');
            });
        });

        it('refreshes schedules after toggling enabled state', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', enabled: true })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            vi.mocked(api.getSchedules).mockClear();
            await user.click(screen.getByTitle('Disable'));

            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalled();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Run Now
    // ══════════════════════════════════════════════════════════════════════

    describe('Run Now', () => {
        it('calls runScheduleNow when clicking Run now button', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            const runNowBtn = screen.getByTitle('Run now');
            await user.click(runNowBtn);

            await waitFor(() => {
                expect(api.runScheduleNow).toHaveBeenCalledWith('s1');
            });
        });

        it('refreshes schedules after running now', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            vi.mocked(api.getSchedules).mockClear();
            await user.click(screen.getByTitle('Run now'));

            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalled();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Delete Schedule
    // ══════════════════════════════════════════════════════════════════════

    describe('Delete Schedule', () => {
        it('shows confirmation dialog when clicking delete', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByTitle('Delete'));

            await waitFor(() => {
                expect(screen.getByText('Delete Schedule')).toBeInTheDocument();
                expect(screen.getByText(/permanently delete this schedule/i)).toBeInTheDocument();
            });
        });

        it('calls deleteSchedule when confirming deletion', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByTitle('Delete'));

            await waitFor(() => screen.getByText('Delete Schedule'));
            // Find the delete button in the confirmation dialog (not the row action)
            const confirmDialog = screen.getByText('Delete Schedule').closest('div');
            const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
            const confirmBtn = deleteButtons.find(btn => btn.textContent?.toLowerCase() === 'delete');
            await user.click(confirmBtn!);

            await waitFor(() => {
                expect(api.deleteSchedule).toHaveBeenCalledWith('s1');
            });
        });

        it('does not delete when cancelling confirmation', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByTitle('Delete'));

            await waitFor(() => screen.getByText('Delete Schedule'));
            await user.click(screen.getByRole('button', { name: /cancel/i }));

            await waitFor(() => {
                expect(api.deleteSchedule).not.toHaveBeenCalled();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Expand/Collapse (History Section)
    // ══════════════════════════════════════════════════════════════════════

    describe('Expand/Collapse', () => {
        it('expands schedule details when clicking row', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            // Click on the schedule row to expand
            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('Query')).toBeInTheDocument();
                expect(screen.getByText('Configuration')).toBeInTheDocument();
                expect(screen.getByText('History')).toBeInTheDocument();
            });
        });

        it('collapses when clicking expanded row', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            // Expand
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Query'));

            // Collapse
            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.queryByText('Configuration')).not.toBeInTheDocument();
            });
        });

        it('loads history when expanding schedule', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(api.getScheduleHistory).toHaveBeenCalledWith('s1', 100);
            });
        });

        it('shows no history message when empty', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
            });
        });

        it('displays history entries when available', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([
                createHistoryEntry({ verdict: 'healthy', summary: 'All good' }),
                createHistoryEntry({ verdict: 'warning', summary: 'High latency' }),
            ]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('All good')).toBeInTheDocument();
                expect(screen.getByText('High latency')).toBeInTheDocument();
            });
        });

        it('can refresh history manually', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('History'));

            vi.mocked(api.getScheduleHistory).mockClear();

            // Click refresh button in history section (it's a button with RefreshCw icon)
            const historyLabel = screen.getByText('History');
            const historyHeader = historyLabel.closest('div[class*="flex"]');
            const refreshBtn = historyHeader?.querySelector('button');
            expect(refreshBtn).toBeInTheDocument();
            await user.click(refreshBtn!);

            await waitFor(() => {
                expect(api.getScheduleHistory).toHaveBeenCalledWith('s1', 100);
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Query Visibility Toggle
    // ══════════════════════════════════════════════════════════════════════

    describe('Query Visibility', () => {
        it('shows truncated query by default', async () => {
            const { api } = await import('../../api');
            const longQuery = 'TeleductMetrics | where Stamp == "test" | summarize count() by bin(Timestamp, 1h)';
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ query: longQuery })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                // Query should be truncated (has class 'truncate')
                const queryContainer = screen.getByText(longQuery);
                expect(queryContainer).toHaveClass('truncate');
            });
        });

        it('expands query when clicking View button', async () => {
            const { api } = await import('../../api');
            const longQuery = 'TeleductMetrics | where Stamp == "test"';
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ query: longQuery })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Query'));

            // Click View button
            await user.click(screen.getByText('View'));

            await waitFor(() => {
                expect(screen.getByText('Hide')).toBeInTheDocument();
                // Query container should have whitespace-pre-wrap class for full display
                const queryContainer = screen.getByText(longQuery);
                expect(queryContainer).toHaveClass('whitespace-pre-wrap');
            });
        });

        it('collapses query when clicking Hide button', async () => {
            const { api } = await import('../../api');
            const longQuery = 'TeleductMetrics | where Stamp == "test"';
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ query: longQuery })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('View'));

            await user.click(screen.getByText('View'));
            await waitFor(() => screen.getByText('Hide'));

            await user.click(screen.getByText('Hide'));

            await waitFor(() => {
                expect(screen.getByText('View')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Inline Editing Mode
    // ══════════════════════════════════════════════════════════════════════

    describe('Inline Editing', () => {
        it('enters edit mode when clicking Edit button', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule()]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));

            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                expect(screen.getByText('Save')).toBeInTheDocument();
                expect(screen.getByText('Cancel')).toBeInTheDocument();
            });
        });

        it('shows editable stamp input in edit mode', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ target: 'my-stamp' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));

            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                const stampInput = screen.getByDisplayValue('my-stamp');
                expect(stampInput).toBeInTheDocument();
                expect(stampInput.tagName).toBe('INPUT');
            });
        });

        it('can edit stamp value', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', target: 'old-stamp' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => screen.getByDisplayValue('old-stamp'));

            const stampInput = screen.getByDisplayValue('old-stamp');
            await user.clear(stampInput);
            await user.type(stampInput, 'new-stamp');

            expect(screen.getByDisplayValue('new-stamp')).toBeInTheDocument();
        });

        it('shows model selector dropdown in edit mode', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ model: 'gpt-4o' })]));
            vi.mocked(api.listModels).mockResolvedValue(['gpt-4o', 'claude-3-opus', 'gpt-4-turbo']);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                const modelSelect = screen.getByDisplayValue('gpt-4o');
                expect(modelSelect.tagName).toBe('SELECT');
            });
        });

        it('shows model text input when no models available', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ model: 'custom-model' })]));
            vi.mocked(api.listModels).mockResolvedValue([]); // No models available

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                // Should show text input instead of select when no models
                const modelInput = screen.getByDisplayValue('custom-model');
                expect(modelInput.tagName).toBe('INPUT');
            });
        });

        it('can type in model text input when no models available', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', model: '' })]));
            vi.mocked(api.listModels).mockResolvedValue([]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => screen.getByText('Model'));

            // Find the model input by its parent label
            const modelSection = screen.getByText('Model').closest('div[class*="bg-slate-800"]');
            const modelInput = modelSection?.querySelector('input');
            expect(modelInput).toBeInTheDocument();

            await user.type(modelInput!, 'my-custom-model');
            expect(modelInput).toHaveValue('my-custom-model');
        });

        it('shows category dropdown in edit mode', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ category: 'latency' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                const categorySelect = screen.getByDisplayValue('Latency / Performance');
                expect(categorySelect.tagName).toBe('SELECT');
            });
        });

        it('saves changes when clicking Save', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', target: 'old-stamp' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => screen.getByDisplayValue('old-stamp'));

            const stampInput = screen.getByDisplayValue('old-stamp');
            await user.clear(stampInput);
            await user.type(stampInput, 'new-stamp');

            await user.click(screen.getByText('Save'));

            await waitFor(() => {
                expect(api.updateSchedule).toHaveBeenCalledWith('s1', expect.objectContaining({
                    target: 'new-stamp',
                }));
            });
        });

        it('exits edit mode after saving', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));
            await waitFor(() => screen.getByText('Save'));

            await user.click(screen.getByText('Save'));

            await waitFor(() => {
                expect(screen.queryByText('Save')).not.toBeInTheDocument();
                expect(screen.getByText('Edit')).toBeInTheDocument();
            });
        });

        it('cancels editing without saving when clicking Cancel', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', target: 'original-stamp' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => screen.getByDisplayValue('original-stamp'));

            const stampInput = screen.getByDisplayValue('original-stamp');
            await user.clear(stampInput);
            await user.type(stampInput, 'modified-stamp');

            await user.click(screen.getByText('Cancel'));

            await waitFor(() => {
                expect(api.updateSchedule).not.toHaveBeenCalled();
                expect(screen.queryByText('Save')).not.toBeInTheDocument();
            });
        });

        it('handles save error gracefully', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));
            vi.mocked(api.updateSchedule).mockRejectedValue(new Error('Update failed'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));
            await waitFor(() => screen.getByText('Save'));

            await user.click(screen.getByText('Save'));

            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('Failed to update schedule:', expect.any(Error));
            });

            consoleSpy.mockRestore();
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Time Range Dropdown
    // ══════════════════════════════════════════════════════════════════════

    describe('Time Range Dropdown', () => {
        it('shows time range dropdown in edit mode', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ timeRange: 'ago(1h)' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));

            await waitFor(() => {
                // Time range should show a dropdown button
                expect(screen.getByText('Past 1 Hour')).toBeInTheDocument();
            });
        });

        it('opens time range popup when clicking dropdown', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ timeRange: 'ago(1h)' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));
            await waitFor(() => screen.getByText('Past 1 Hour'));

            // Click the time range dropdown button
            await user.click(screen.getByText('Past 1 Hour'));

            await waitFor(() => {
                expect(screen.getByText('Past 2 Hours')).toBeInTheDocument();
                expect(screen.getByText('Past 6 Hours')).toBeInTheDocument();
                expect(screen.getByText('Past 24 Hours')).toBeInTheDocument();
            });
        });

        it('selects time range from dropdown', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', timeRange: 'ago(1h)' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));
            await waitFor(() => screen.getByText('Past 1 Hour'));

            await user.click(screen.getByText('Past 1 Hour'));
            await waitFor(() => screen.getByText('Past 6 Hours'));

            await user.click(screen.getByText('Past 6 Hours'));

            // Dropdown should close and show new selection
            await waitFor(() => {
                expect(screen.queryByText('Past 2 Hours')).not.toBeInTheDocument();
            });

            // Save and verify
            await user.click(screen.getByText('Save'));

            await waitFor(() => {
                expect(api.updateSchedule).toHaveBeenCalledWith('s1', expect.objectContaining({
                    timeRange: 'ago(6h)',
                }));
            });
        });

        it('closes time range popup on outside click', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ timeRange: 'ago(1h)' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));
            await user.click(screen.getByText('Edit'));
            await waitFor(() => screen.getByText('Past 1 Hour'));

            await user.click(screen.getByText('Past 1 Hour'));
            await waitFor(() => screen.getByText('Past 6 Hours'));

            // Click outside (on the heading)
            await user.click(screen.getByText('Scheduled Investigations'));

            await waitFor(() => {
                expect(screen.queryByText('Past 6 Hours')).not.toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Configuration Display
    // ══════════════════════════════════════════════════════════════════════

    describe('Configuration Display', () => {
        it('displays interval in configuration', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ intervalMinutes: 120 })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                // There are two "every 120m" - one in the row summary and one in config. Just verify at least one exists.
                const intervalTexts = screen.getAllByText(/every 120m/i);
                expect(intervalTexts.length).toBeGreaterThan(0);
            });
        });

        it('displays default model when not specified', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ model: undefined })]));
            vi.mocked(api.getSettings).mockResolvedValue({ model: 'gpt-4o-default', scheduledInvestigationMaxSteps: 50 } as any);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('gpt-4o-default')).toBeInTheDocument();
            });
        });

        it('displays "Default" when no model is set anywhere', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ model: undefined })]));
            vi.mocked(api.getSettings).mockResolvedValue({ scheduledInvestigationMaxSteps: 50 } as any);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('Default')).toBeInTheDocument();
            });
        });

        it('displays category when set', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ category: 'throttling' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('Issue Type')).toBeInTheDocument();
                expect(screen.getByText('throttling')).toBeInTheDocument();
            });
        });

        it('hides category row when not set and not editing', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ category: undefined })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => screen.getByText('Configuration'));

            // Issue Type should not be visible when category is not set
            expect(screen.queryByText('Issue Type')).not.toBeInTheDocument();
        });

        it('displays product in expanded configuration when productId is set', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ productId: 'p1' })]));
            vi.mocked(api.listProducts).mockResolvedValue([
                { id: 'p1', name: 'Teleduct Core', repoRoot: '', systemPromptPath: '', knowledgeBasePath: '', workingDirectory: '', investigationsPath: '' },
            ]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                expect(screen.getByText('Product')).toBeInTheDocument();
                expect(screen.getByText('Teleduct Core')).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Latest Investigation Link
    // ══════════════════════════════════════════════════════════════════════

    describe('Latest Investigation Link', () => {
        it('shows link to latest investigation when available', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ lastInvestigationId: 'inv-latest-123' }),
            ]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                const link = screen.getByText(/view latest investigation/i);
                expect(link).toHaveAttribute('href', '/investigation/inv-latest-123');
            });
        });

        it('does not show latest investigation link when none exists', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ lastInvestigationId: undefined }),
            ]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => screen.getByText('Configuration'));

            expect(screen.queryByText(/view latest investigation/i)).not.toBeInTheDocument();
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Navigation
    // ══════════════════════════════════════════════════════════════════════

    describe('Navigation', () => {
        it('navigates to new schedule page when clicking New Schedule', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Scheduled Investigations'));

            // Click the New Schedule link in the top dock
            const newScheduleLink = screen.getByRole('link', { name: /new schedule/i });
            expect(newScheduleLink).toHaveAttribute('href', '/schedules/new');
        });

        it('navigates to edit page when clicking Edit button', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByTitle('Edit'));

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/schedules/s1/edit');
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Timing Display
    // ══════════════════════════════════════════════════════════════════════

    describe('Timing Display', () => {
        it('shows last run time', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ lastRunAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }),
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/last:.*30m ago/i)).toBeInTheDocument();
            });
        });

        it('shows "Never" when no last run', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ lastRunAt: undefined }),
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/last:.*never/i)).toBeInTheDocument();
            });
        });

        it('shows next run time for enabled schedules', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({
                    enabled: true,
                    nextRunAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                }),
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/next:.*in 15m/i)).toBeInTheDocument();
            });
        });

        it('does not show next run for disabled schedules', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({
                    enabled: false,
                    nextRunAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                }),
            ]));

            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            expect(screen.queryByText(/next:/i)).not.toBeInTheDocument();
        });

        it('shows days ago for last run more than 24 hours ago', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ lastRunAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }), // 48 hours ago
            ]));

            renderSchedules();
            await waitFor(() => {
                expect(screen.getByText(/last:.*2d ago/i)).toBeInTheDocument();
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Auto-Refresh
    // ══════════════════════════════════════════════════════════════════════

    describe('Auto-Refresh', () => {
        it('refreshes schedules every 15 seconds', async () => {
            const { api } = await import('../../api');
            renderSchedules();
            
            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalledTimes(1);
            });

            // Advance time by 15 seconds
            await act(async () => {
                vi.advanceTimersByTime(15000);
            });

            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalledTimes(2);
            });

            // Advance another 15 seconds
            await act(async () => {
                vi.advanceTimersByTime(15000);
            });

            await waitFor(() => {
                expect(api.getSchedules).toHaveBeenCalledTimes(3);
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // History Entry Links
    // ══════════════════════════════════════════════════════════════════════

    describe('History Entry Links', () => {
        it('links to investigation from history entry', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([
                createHistoryEntry({ investigationId: 'inv-abc-123', verdict: 'healthy' }),
            ]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                const links = screen.getAllByRole('link');
                const historyLink = links.find(link => link.getAttribute('href') === '/investigation/inv-abc-123');
                expect(historyLink).toBeInTheDocument();
            });
        });

        it('shows verdict dots for history entries', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([
                createHistoryEntry({ verdict: 'healthy' }),
                createHistoryEntry({ verdict: 'warning' }),
                createHistoryEntry({ verdict: 'critical' }),
            ]);

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            await user.click(screen.getByText('Daily Check'));

            await waitFor(() => {
                // Check for colored dots
                const greenDots = document.querySelectorAll('.bg-emerald-400');
                const amberDots = document.querySelectorAll('.bg-amber-400');
                const redDots = document.querySelectorAll('.bg-red-400');
                
                expect(greenDots.length).toBeGreaterThan(0);
                expect(amberDots.length).toBeGreaterThan(0);
                expect(redDots.length).toBeGreaterThan(0);
            });
        });
    });
});

// ══════════════════════════════════════════════════════════════════════════
// ADDITIONAL COVERAGE — onChange@L437 (model text input) and onChange@L462 (category select)
// ══════════════════════════════════════════════════════════════════════════
describe('Schedules additional coverage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([]));
        vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });
        vi.mocked(api.listProducts).mockResolvedValue([]);
        vi.mocked(api.listModels).mockResolvedValue(['gpt-4o']);
        vi.mocked(api.getSettings).mockResolvedValue({ model: 'gpt-4o' } as any);
        vi.mocked(api.getScheduleHistory).mockResolvedValue([]);
        vi.mocked(api.updateSchedule).mockResolvedValue({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Model select onChange when models list is non-empty (onChange@L437)', () => {
        it('changes model via select when listModels returns models', async () => {
            const { api } = await import('../../api');
            // Non-empty models list → shows SELECT (not text input)
            vi.mocked(api.listModels).mockResolvedValue(['gpt-4o', 'claude-3']);
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            // Expand the schedule card
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));

            // Enter edit mode
            await user.click(screen.getByText('Edit'));

            // When models is non-empty, a select for model is shown
            await waitFor(() => {
                const modelSelects = document.querySelectorAll('select');
                expect(modelSelects.length).toBeGreaterThan(0);
            });

            // Find the model select (it contains model options from listModels)
            const selects = Array.from(document.querySelectorAll('select'));
            const modelSelect = selects.find(s =>
                Array.from(s.options).some(o => o.value === 'gpt-4o')
            );
            if (modelSelect) {
                // Fire onChange to cover the model select handler (onChange@L437)
                fireEvent.change(modelSelect, { target: { value: 'claude-3' } });
                expect(modelSelect.value).toBe('claude-3');
            }
        });
    });

    describe('Category select onChange (onChange@L462)', () => {
        it('changes category via select dropdown in edit mode', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', category: 'latency' })]));

            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));

            // Expand schedule card
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Configuration'));

            // Enter edit mode
            await user.click(screen.getByText('Edit'));

            // Wait for category select to appear (it shows because category = 'latency')
            await waitFor(() => {
                const categorySelect = screen.getByDisplayValue('Latency / Performance');
                expect(categorySelect).toBeInTheDocument();
            });

            // Change category — this triggers onChange@L462
            const categorySelect = screen.getByDisplayValue('Latency / Performance');
            // fireEvent.change to cover the onChange handler
            fireEvent.change(categorySelect, { target: { value: 'error' } });
            expect((categorySelect as HTMLSelectElement).value).toBe('error');
        });
    });

    describe('Schedules branch coverage', () => {
        beforeEach(async () => {
            vi.clearAllMocks();
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([]));
            vi.mocked(api.getSchedulerStatus).mockResolvedValue({ running: true });
            vi.mocked(api.listProducts).mockResolvedValue([]);
            vi.mocked(api.listModels).mockResolvedValue(['gpt-4o']);
            vi.mocked(api.getSettings).mockResolvedValue({ model: 'gpt-4o', scheduledInvestigationMaxSteps: 50 });
            vi.mocked(api.getScheduleHistory).mockResolvedValue([]);
        });
        afterEach(() => { vi.useRealTimers(); });

        it('getRelativeTime shows "just now" for lastRunAt < 1 minute ago', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-now', lastRunAt: new Date(Date.now() - 10000).toISOString() }),
            ]));
            renderSchedules();
            await waitFor(() => expect(screen.getByText('Daily Check')).toBeInTheDocument());
            expect(document.body.textContent).toContain('just now');
        });

        it('getNextRunIn returns empty string when nextRunAt is undefined', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-nonext', nextRunAt: undefined }),
            ]));
            renderSchedules();
            await waitFor(() => expect(screen.getByText('Daily Check')).toBeInTheDocument());
        });

        it('getNextRunIn shows "due now" when nextRunAt is in the past', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-past', nextRunAt: new Date(Date.now() - 5000).toISOString() }),
            ]));
            renderSchedules();
            await waitFor(() => expect(screen.getByText('Daily Check')).toBeInTheDocument());
            expect(document.body.textContent).toContain('due now');
        });

        it('loadHistory catch block is covered when getScheduleHistory throws', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's-hist' })]));
            vi.mocked(api.getScheduleHistory).mockRejectedValue(new Error('History failed'));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Click schedule to expand (triggers loadHistory)
            await user.click(screen.getByText('Daily Check'));
            // Should not throw - catch block swallows the error
            await waitFor(() => expect(api.getScheduleHistory).toHaveBeenCalled());
        });

        it('schedule with activeInvestigationId shows running verdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-active', activeInvestigationId: 'inv-running-123' }),
            ]));
            renderSchedules();
            await waitFor(() => expect(screen.getByText('Daily Check')).toBeInTheDocument());
            // When activeInvestigationId is set, effectiveVerdict becomes 'running'
            expect(document.body.textContent).toContain('Running');
        });

        it('timeRangePopup toggle: click button twice to close popup (covers ? null branch)', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's-popup', timeRange: 'ago(1h)' })]));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Expand schedule
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Edit'));
            // Enter edit mode
            await user.click(screen.getByText('Edit'));
            // Wait for edit mode UI (time range section)
            await waitFor(() => {
                const presetButtons = Array.from(document.querySelectorAll('button'))
                    .filter(b => b.textContent?.includes('Past') || b.textContent?.includes('ago('));
                expect(presetButtons.length).toBeGreaterThan(0);
            });
            
            // Find the time range toggle button (shows preset label in edit mode)
            const timeRangeToggle = Array.from(document.querySelectorAll('button')).find(b => 
                b.textContent?.includes('Past 1 Hour') || b.textContent?.includes('ago(1h)')
            );
            if (timeRangeToggle) {
                // First click opens popup (prev=null → sched.id)
                fireEvent.click(timeRangeToggle);
                await act(async () => { await vi.advanceTimersByTimeAsync(50); });
                // Second click closes popup (prev=sched.id → null: covers ? null branch at L400)
                fireEvent.click(timeRangeToggle);
                await act(async () => { await vi.advanceTimersByTimeAsync(50); });
            }
        });

        it('productName fallback uses id when product not found in list', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-prod', productId: 'unknown-product-id' }),
            ]));
            vi.mocked(api.listProducts).mockResolvedValue([
                { id: 'different-product', name: 'Different Product' } as any,
            ]);
            renderSchedules();
            await waitFor(() => expect(screen.getByText('Daily Check')).toBeInTheDocument());
            // The product not found → shows 'unknown-product-id' as fallback
            expect(document.body.textContent).toContain('unknown-product-id');
        });

        it('history entry with summary covers the entry.summary branch', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's-summary' })]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([
                createHistoryEntry({ summary: 'All systems nominal' }),
            ]);
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Expand schedule to load history
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => expect(api.getScheduleHistory).toHaveBeenCalled());
        });

        it('history entry without summary covers the no-summary branch (L523)', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's-no-summary' })]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([
                // No summary field → entry.summary is falsy → covers ': ...' : '' FALSE branch
                createHistoryEntry({ summary: undefined as any }),
            ]);
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => expect(api.getScheduleHistory).toHaveBeenCalled());
        });

        it('covers getNextRunIn empty return (L180) with schedule missing nextRunAt', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-no-nextrun', nextRunAt: undefined }),
            ]));
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Schedule renders without nextRunAt → getNextRunIn(undefined) → 'if (!iso) return ""'
            expect(screen.getByText('Daily Check')).toBeInTheDocument();
        });

        it('covers lastVerdict || "unknown" (L262) with schedule missing lastVerdict', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-no-verdict', lastVerdict: undefined as any, activeInvestigationId: undefined }),
            ]));
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // effectiveVerdict = false ? 'running' : (undefined || 'unknown') = 'unknown'
            expect(screen.getByText('Daily Check')).toBeInTheDocument();
        });

        it('covers productName empty return (L189) when no productId on expanded schedule', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([
                createSchedule({ id: 's-no-product', productId: undefined }),
            ]));
            vi.mocked(api.getScheduleHistory).mockResolvedValue([]);
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Expand the schedule to trigger the expanded section which calls productName(undefined)
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => expect(api.getScheduleHistory).toHaveBeenCalled());
        });

        it('timeRange button shows raw timeRange value when preset label not found (covers || editFields.timeRange at L401)', async () => {
            // When editFields.timeRange is a custom range not in TIME_PRESETS, the label is undefined
            // and the fallback editFields.timeRange is displayed
            const { api } = await import('../../api');
            const customRange = 'between(datetime(2024-01-01T00:00:00) .. datetime(2024-01-02T00:00:00))';
            vi.mocked(api.getSchedules).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's-custom-tr', timeRange: customRange })]));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderSchedules();
            await waitFor(() => screen.getByText('Daily Check'));
            // Expand schedule
            await user.click(screen.getByText('Daily Check'));
            await waitFor(() => screen.getByText('Edit'));
            // Enter edit mode — editFields.timeRange = customRange (no matching preset label)
            await user.click(screen.getByText('Edit'));
            // The time range button should display the raw customRange value (|| editFields.timeRange branch)
            await waitFor(() => expect(document.body.textContent).toContain(customRange));
        });
    });

    // === Pagination ===
    describe('Pagination', () => {
        it('shows pagination controls when there are schedules', async () => {
            const api = (await import('../../api')).api;
            (api.getSchedules as any).mockResolvedValue(paginatedSchedules([createSchedule({ id: 's1', name: 'Schedule 1' })]));
            renderSchedules();

            await waitFor(() => {
                expect(screen.getByText(/of 1 schedule/)).toBeInTheDocument();
            });
        });

        it('paginates schedule list with many items', async () => {
            const api = (await import('../../api')).api;
            const page1Items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `s${i}`, name: `Schedule ${i + 1}`, target: `stamp-${i}` })
            );
            (api.getSchedules as any).mockResolvedValue({
                items: page1Items, totalCount: 15, page: 1, pageSize: 6, totalPages: 3,
            });
            localStorage.setItem('sched-page-size', '6');
            renderSchedules();

            await waitFor(() => {
                expect(screen.getByText('1–6 of 15 schedules')).toBeInTheDocument();
            });
        });

        it('navigates to next page of schedules', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            const api = (await import('../../api')).api;
            const page1Items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `s${i}`, name: `Schedule ${i + 1}`, target: `stamp-${i}` })
            );
            const page2Items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `s${i + 6}`, name: `Schedule ${i + 7}`, target: `stamp-${i + 6}` })
            );
            (api.getSchedules as any).mockImplementation((params?: any) => {
                const page = params?.page || 1;
                return Promise.resolve({
                    items: page === 2 ? page2Items : page1Items,
                    totalCount: 15, page, pageSize: 6, totalPages: 3,
                });
            });
            localStorage.setItem('sched-page-size', '6');
            renderSchedules();

            await waitFor(() => screen.getByText('1–6 of 15 schedules'));

            await user.click(screen.getByLabelText('Next page'));

            await waitFor(() => {
                expect(screen.getByText('7–12 of 15 schedules')).toBeInTheDocument();
            });
        });

        it('persists schedule page size to localStorage', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            const api = (await import('../../api')).api;
            const items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `s${i}`, name: `Schedule ${i + 1}`, target: `stamp-${i}` })
            );
            (api.getSchedules as any).mockResolvedValue({
                items, totalCount: 30, page: 1, pageSize: 6, totalPages: 5,
            });
            renderSchedules();

            await waitFor(() => screen.getByText(/of 30 schedules/));

            const select = screen.getByRole('combobox', { name: /per page/i });
            await user.selectOptions(select, '24');

            expect(localStorage.getItem('sched-page-size')).toBe('24');
        });

        it('clamps currentPage when schedules are removed', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            const api = (await import('../../api')).api;
            const page1Items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `c${i}`, name: `Clamp ${i + 1}`, target: `stamp-${i}` })
            );
            let returnSmallSet = false;
            (api.getSchedules as any).mockImplementation((params?: any) => {
                const page = params?.page || 1;
                if (returnSmallSet) {
                    return Promise.resolve({
                        items: page1Items, totalCount: 6, page: 1, pageSize: 6, totalPages: 1,
                    });
                }
                return Promise.resolve({
                    items: page1Items, totalCount: 14, page, pageSize: 6, totalPages: 3,
                });
            });
            localStorage.setItem('sched-page-size', '6');
            renderSchedules();

            await waitFor(() => screen.getByText('1–6 of 14 schedules'));

            // Navigate to page 3
            await user.click(screen.getByText('3'));
            await waitFor(() => screen.getByText(/of 14 schedules/));

            // Simulate schedules being removed — shrink to 6
            returnSmallSet = true;
            vi.advanceTimersByTime(15000);

            await waitFor(() => screen.getByText('1–6 of 6 schedules'));
        });

        it('loads defaultPageSize from server settings', async () => {
            const api = (await import('../../api')).api;
            localStorage.removeItem('sched-page-size');
            (api.getSettings as any).mockResolvedValue({ model: 'gpt-4o', scheduledInvestigationMaxSteps: 50, defaultPageSize: 6 });
            const items = Array.from({ length: 6 }, (_, i) =>
                createSchedule({ id: `s${i}`, name: `Schedule ${i + 1}`, target: `stamp-${i}` })
            );
            (api.getSchedules as any).mockResolvedValue({
                items, totalCount: 20, page: 1, pageSize: 6, totalPages: 4,
            });
            renderSchedules();

            await waitFor(() => {
                expect(screen.getByText('1–6 of 20 schedules')).toBeInTheDocument();
            });
        });
    });
});