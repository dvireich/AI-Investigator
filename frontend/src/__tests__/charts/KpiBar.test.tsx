import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiBar } from '../../components/charts/KpiBar';
import type { InvestigationStats } from '../../api';

const emptyStats: InvestigationStats = {
    total: 0, running: 0, paused: 0, completed: 0, failed: 0, aborted: 0,
    successRate: 0, resolvedCount: 0, avgDurationMs: 0, durationSamples: 0,
    thisWeekCount: 0, lastWeekCount: 0, contestRate: 0, contestableCount: 0,
};

const makeStats = (overrides: Partial<InvestigationStats> = {}): InvestigationStats => ({
    ...emptyStats,
    ...overrides,
});

describe('KpiBar', () => {
    it('shows dashes when no data', () => {
        render(<KpiBar stats={emptyStats} />);
        expect(screen.getAllByText('--')).toHaveLength(3); // success rate, avg duration, contest rate
    });

    it('calculates success rate', () => {
        render(<KpiBar stats={makeStats({ successRate: 60, resolvedCount: 5 })} />);
        expect(screen.getByText('60%')).toBeInTheDocument();
        expect(screen.getByText('5 resolved')).toBeInTheDocument();
    });

    it('calculates average duration', () => {
        render(<KpiBar stats={makeStats({ avgDurationMs: 90000, durationSamples: 2, resolvedCount: 2, successRate: 100 })} />);
        // 90s = 1m 30s
        expect(screen.getByText('1m 30s')).toBeInTheDocument();
    });

    it('shows this week count', () => {
        render(<KpiBar stats={makeStats({ thisWeekCount: 1 })} />);
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows contest rate', () => {
        render(<KpiBar stats={makeStats({ contestRate: 50, contestableCount: 2 })} />);
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('formats durations >= 1 hour correctly', () => {
        render(<KpiBar stats={makeStats({ avgDurationMs: 9000000, durationSamples: 1, resolvedCount: 1, successRate: 100 })} />);
        expect(screen.getByText('2h 30m')).toBeInTheDocument();
    });

    it('formats durations under 1 minute as pure seconds', () => {
        render(<KpiBar stats={makeStats({ avgDurationMs: 30000, durationSamples: 1, resolvedCount: 1, successRate: 100 })} />);
        expect(screen.getByText('30s')).toBeInTheDocument();
    });

    it('shows green success rate color when >= 80%', () => {
        render(<KpiBar stats={makeStats({ successRate: 80, resolvedCount: 5 })} />);
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('shows negative week delta when no investigations this week', () => {
        render(<KpiBar stats={makeStats({ thisWeekCount: 0, lastWeekCount: 1 })} />);
        expect(screen.getByText(/-1 vs last week/)).toBeInTheDocument();
    });

    it('formats 1m 0s duration correctly', () => {
        render(<KpiBar stats={makeStats({ avgDurationMs: 60000, durationSamples: 1, resolvedCount: 1, successRate: 100 })} />);
        expect(screen.getByText('1m 0s')).toBeInTheDocument();
    });

    it('handles Sunday week boundary', () => {
        render(<KpiBar stats={makeStats({ thisWeekCount: 1 })} />);
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('handles undefined contestCount in contest rate', () => {
        render(<KpiBar stats={makeStats({ contestRate: 50, contestableCount: 2 })} />);
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
