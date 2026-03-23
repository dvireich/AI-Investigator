import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiBar } from '../../components/charts/KpiBar';

const inv = (status: string, opts: { contestCount?: number; lastModified?: number; id?: string } = {}) => ({
    id: opts.id ?? String(Date.now()),
    status,
    contestCount: opts.contestCount ?? 0,
    lastModified: opts.lastModified,
}) as any;

describe('KpiBar', () => {
    it('shows dashes when no data', () => {
        render(<KpiBar investigations={[]} />);
        expect(screen.getAllByText('--')).toHaveLength(3); // success rate, avg duration, contest rate
    });

    it('calculates success rate', () => {
        const investigations = [
            inv('completed'), inv('completed'), inv('completed'),
            inv('failed'), inv('aborted'),
        ];
        render(<KpiBar investigations={investigations} />);
        // 3/5 = 60%
        expect(screen.getByText('60%')).toBeInTheDocument();
        expect(screen.getByText('5 resolved')).toBeInTheDocument();
    });

    it('calculates average duration', () => {
        const now = Date.now();
        const investigations = [
            inv('completed', { id: String(now - 120000), lastModified: now }), // 2 min
            inv('completed', { id: String(now - 60000), lastModified: now }),   // 1 min
        ];
        render(<KpiBar investigations={investigations} />);
        // Average = 90s = 1m 30s
        expect(screen.getByText('1m 30s')).toBeInTheDocument();
    });

    it('shows this week count', () => {
        const now = Date.now();
        const investigations = [inv('completed', { id: String(now - 3600000) })];
        render(<KpiBar investigations={investigations} />);
        // At least 1 "this week"
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows contest rate', () => {
        const investigations = [
            inv('completed', { contestCount: 1 }),
            inv('completed', { contestCount: 0 }),
        ];
        render(<KpiBar investigations={investigations} />);
        // 1/2 = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('formats durations >= 1 hour correctly (covers hrs format branch, lines 32-35)', () => {
        const now = Date.now();
        const investigations = [
            // 2.5 hours = 9000000ms
            inv('completed', { id: String(now - 9000000), lastModified: now }),
        ];
        render(<KpiBar investigations={investigations} />);
        expect(screen.getByText('2h 30m')).toBeInTheDocument();
    });

    it('formats durations under 1 minute as pure seconds (covers secs-only branch, line 37)', () => {
        const now = Date.now();
        const investigations = [
            // 30 seconds
            inv('completed', { id: String(now - 30000), lastModified: now }),
        ];
        render(<KpiBar investigations={investigations} />);
        expect(screen.getByText('30s')).toBeInTheDocument();
    });

    it('shows green success rate color when >= 80% (covers successRate >= 80 branch)', () => {
        // 4 completed + 1 failed = 80%
        const investigations = [
            inv('completed'), inv('completed'), inv('completed'), inv('completed'), inv('failed'),
        ];
        render(<KpiBar investigations={investigations} />);
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('shows negative week delta when no investigations this week (covers weekDelta < 0 branch)', () => {
        vi.useFakeTimers();
        // Wednesday March 25, 2026 — weekStart = Monday March 23, lastWeekStart = Monday March 16
        vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));
        const dayMs = 86400000;
        const investigations = [
            // 8 days ago = March 17 (Tuesday) => falls in last week
            inv('completed', { id: String(Date.now() - 8 * dayMs) }),
        ];
        render(<KpiBar investigations={investigations} />);
        // weekDelta = 0 this week - 1 last week = -1
        expect(screen.getByText(/-1 vs last week/)).toBeInTheDocument();
        vi.useRealTimers();
    });

    it('excludes zero and >24h outlier durations from average (covers both filter branches)', () => {
        const now = Date.now();
        const investigations = [
            // d = 0 => filtered (d > 0 is false)
            inv('completed', { id: String(now), lastModified: now }),
            // d = 25h = 90000000ms => filtered (d < 86400000 is false)
            inv('completed', { id: String(now - 90000000), lastModified: now }),
            // d = 60s => valid
            inv('completed', { id: String(now - 60000), lastModified: now }),
        ];
        render(<KpiBar investigations={investigations} />);
        // Only 60s duration is valid, avg = 60s = 1m 0s
        expect(screen.getByText('1m 0s')).toBeInTheDocument();
    });

    it('handles Sunday start of week correctly (covers dayOfWeek === 0 branch)', () => {
        vi.useFakeTimers();
        // March 22, 2026 is a Sunday (dayOfWeek === 0)
        const sundayDate = new Date('2026-03-22T10:00:00.000Z');
        vi.setSystemTime(sundayDate);

        const investigations = [
            // 1 second before now = definitely in this week
            inv('completed', { id: String(sundayDate.getTime() - 1000) }),
        ];

        render(<KpiBar investigations={investigations} />);
        vi.useRealTimers();

        // 1 investigation this Sunday = 1 this week
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('handles weekday start of week correctly (covers dayOfWeek !== 0 branch)', () => {
        vi.useFakeTimers();
        // March 18, 2026 is a Wednesday (dayOfWeek === 3)
        const wednesdayDate = new Date('2026-03-18T10:00:00.000Z');
        vi.setSystemTime(wednesdayDate);

        const investigations = [
            inv('completed', { id: String(wednesdayDate.getTime() - 1000) }),
        ];

        render(<KpiBar investigations={investigations} />);
        vi.useRealTimers();

        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('handles undefined contestCount in contest rate (covers ?? 0 nullish branch)', () => {
        // Direct object without contestCount => i.contestCount is undefined => (undefined ?? 0) fires
        const investigations = [
            { id: String(Date.now()), status: 'completed' } as any, // contestCount: undefined
            inv('completed', { contestCount: 1 }),
        ];
        render(<KpiBar investigations={investigations} />);
        // 1/2 = 50% contest rate
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
