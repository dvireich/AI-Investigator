import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryDonut } from '../../components/charts/IssueTypeDonut';

// Capture the formatter function passed to Tooltip
let capturedTooltipFormatter: ((value: number, name: string) => any) | null = null;

vi.mock('recharts', () => ({
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ data }: any) => <div data-testid="pie" data-items={JSON.stringify(data)} />,
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Tooltip: ({ formatter }: any) => {
        capturedTooltipFormatter = formatter;
        return <div data-testid="tooltip" />;
    },
}));

const inv = (category?: string) => ({ id: '1', status: 'completed', category }) as any;

describe('CategoryDonut', () => {
    beforeEach(() => {
        capturedTooltipFormatter = null;
    });

    it('shows "No data" for empty array', () => {
        render(<CategoryDonut investigations={[]} />);
        expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('counts distinct categories', () => {
        const investigations = [
            inv('latency'), inv('latency'), inv('throttling'), inv(undefined),
        ];
        render(<CategoryDonut investigations={investigations} />);
        // 3 types: latency, throttling, Unknown
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('Types')).toBeInTheDocument();
    });

    it('shows singular "Type" for 1 category', () => {
        render(<CategoryDonut investigations={[inv('latency')]} />);
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
    });

    it('treats blank category as Unknown', () => {
        render(<CategoryDonut investigations={[inv(''), inv('  ')]} />);
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    describe('tooltip formatter', () => {
        it('formats value with count and percentage', () => {
            // 4 total investigations
            const investigations = [
                inv('latency'), inv('latency'), inv('throttling'), inv('errors'),
            ];
            render(<CategoryDonut investigations={investigations} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            // 2 out of 4 = 50%
            const result = capturedTooltipFormatter!(2, 'latency');
            expect(result).toEqual(['2 (50%)', 'latency']);
        });

        it('formats value with rounding for non-integer percentages', () => {
            // 3 total investigations
            const investigations = [
                inv('latency'), inv('latency'), inv('errors'),
            ];
            render(<CategoryDonut investigations={investigations} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            // 1 out of 3 ≈ 33%
            const result = capturedTooltipFormatter!(1, 'errors');
            expect(result).toEqual(['1 (33%)', 'errors']);
        });

        it('handles 100% when single category', () => {
            render(<CategoryDonut investigations={[inv('latency')]} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            const result = capturedTooltipFormatter!(1, 'latency');
            expect(result).toEqual(['1 (100%)', 'latency']);
        });
    });

    it('puts Unknown last even when it appears first in input (covers b[0] === Unknown sort branch)', () => {
        // Unknown is first in Map iteration order, triggering compare(nonUnknown, Unknown)
        // where b === 'Unknown' => return -1 branch
        const investigations = [inv(undefined), inv('latency'), inv('throttling')];
        render(<CategoryDonut investigations={investigations} />);
        // 3 distinct categories
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('Types')).toBeInTheDocument();
        // Unknown should be last in sorted data
        const pieData = screen.getByTestId('pie');
        const items = JSON.parse(pieData.getAttribute('data-items') || '[]');
        expect(items[items.length - 1].name).toBe('Unknown');
    });
});
