import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DurationDistribution } from '../../components/charts/DurationDistribution';

vi.mock('recharts', () => ({
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    Bar: ({ children }: any) => <div>{children}</div>,
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: () => <div />,
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

describe('DurationDistribution', () => {
    it('shows empty message for no finished investigations', () => {
        render(<DurationDistribution investigations={[]} />);
        expect(screen.getByText('No duration data yet')).toBeInTheDocument();
    });

    it('shows empty message for only running investigations', () => {
        render(<DurationDistribution investigations={[{ id: '123', status: 'running' }]} />);
        expect(screen.getByText('No duration data yet')).toBeInTheDocument();
    });

    it('renders chart when data available', () => {
        const now = Date.now();
        const investigations = [
            { id: String(now - 30000), status: 'completed', lastModified: now }, // 30s = < 1m bucket
        ];
        render(<DurationDistribution investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('uses step-based fallback when no lastModified', () => {
        const investigations = [
            { id: String(Date.now()), status: 'completed', thoughtCount: 4 }, // 4*15s = 60s = 1-5m bucket
        ];
        render(<DurationDistribution investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('filters out non-numeric IDs', () => {
        render(<DurationDistribution investigations={[{ id: 'abc', status: 'completed' }]} />);
        expect(screen.getByText('No duration data yet')).toBeInTheDocument();
    });

    it('uses thoughts array length when thoughtCount is undefined (covers thoughts?.length branch)', () => {
        // thoughtCount not set => inv.thoughtCount ?? inv.thoughts?.length ?? 0 => thoughts.length
        const now = Date.now();
        const inv = { id: String(now), status: 'completed', thoughts: [{}, {}, {}] }; // 3 * 15s = 45s
        render(<DurationDistribution investigations={[inv as any]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('uses zero duration when neither thoughtCount nor thoughts present (covers ?? 0 branch)', () => {
        // thoughtCount=undefined, thoughts=undefined => 0 * 15000 = 0ms => < 1m bucket
        const now = Date.now();
        const inv = { id: String(now), status: 'completed' };
        render(<DurationDistribution investigations={[inv as any]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
});
