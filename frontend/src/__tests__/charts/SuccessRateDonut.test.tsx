import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessRateDonut } from '../../components/charts/SuccessRateDonut';

vi.mock('recharts', () => ({
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ data }: any) => <div data-testid="pie" data-items={JSON.stringify(data)} />,
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

describe('SuccessRateDonut', () => {
    it('shows "No data" when all counts are zero', () => {
        render(<SuccessRateDonut completed={0} failed={0} aborted={0} />);
        expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('shows 100% success rate when only completed', () => {
        render(<SuccessRateDonut completed={10} failed={0} aborted={0} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(screen.getByText('Success')).toBeInTheDocument();
    });

    it('calculates rate correctly with mixed statuses', () => {
        render(<SuccessRateDonut completed={3} failed={1} aborted={1} />);
        // 3/5 = 60%
        expect(screen.getByText('60%')).toBeInTheDocument();
    });

    it('shows 0% when none completed', () => {
        render(<SuccessRateDonut completed={0} failed={5} aborted={3} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
    });
});
