import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContestRate } from '../../components/charts/ContestRate';

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => ({
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ data }: any) => <div data-testid="pie" data-items={JSON.stringify(data)} />,
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

const inv = (status: string, contestCount = 0) => ({
    id: String(Date.now()), status, contestCount,
}) as any;

describe('ContestRate', () => {
    it('shows "No data" when no resolved investigations', () => {
        render(<ContestRate investigations={[inv('running')]} />);
        expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('shows "No data" for empty array', () => {
        render(<ContestRate investigations={[]} />);
        expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('calculates contest rate correctly', () => {
        const investigations = [
            inv('completed', 2),
            inv('completed', 0),
            inv('failed', 1),
            inv('failed', 0),
        ];
        render(<ContestRate investigations={investigations} />);
        // 2 out of 4 contested = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Contested')).toBeInTheDocument();
    });

    it('shows 0% when no contestable investigations have contests', () => {
        render(<ContestRate investigations={[inv('completed', 0), inv('failed', 0)]} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('shows 100% when all have contests', () => {
        render(<ContestRate investigations={[inv('completed', 1), inv('failed', 3)]} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('handles investigation with undefined contestCount (covers ?? nullish branch)', () => {
        // contestCount is undefined => (undefined ?? 0) => 0, so not contested
        const withUndefined = [{ id: '1', status: 'completed' } as any, inv('completed', 1)];
        render(<ContestRate investigations={withUndefined} />);
        // 1 out of 2 contested = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
