import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvestigationTrend } from '../../components/charts/InvestigationTrend';

vi.mock('recharts', () => ({
    AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
    Area: () => <div />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

describe('InvestigationTrend', () => {
    it('shows empty message when no data in 14-day window', () => {
        render(<InvestigationTrend investigations={[]} />);
        expect(screen.getByText('No trend data yet')).toBeInTheDocument();
    });

    it('shows empty for investigations with non-numeric IDs', () => {
        render(<InvestigationTrend investigations={[{ id: 'abc', status: 'completed' }]} />);
        expect(screen.getByText('No trend data yet')).toBeInTheDocument();
    });

    it('renders chart when data exists in recent window', () => {
        const now = Date.now();
        const investigations = [
            { id: String(now - 3600000), status: 'completed' },
            { id: String(now - 7200000), status: 'failed' },
        ];
        render(<InvestigationTrend investigations={investigations} />);
        expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('ignores investigations older than 14 days', () => {
        const old = Date.now() - 15 * 86400000;
        render(<InvestigationTrend investigations={[{ id: String(old), status: 'completed' }]} />);
        expect(screen.getByText('No trend data yet')).toBeInTheDocument();
    });
});
