import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBreakdown } from '../../components/charts/VerdictBreakdown';

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

const inv = (verdict?: string, source = 'scheduled') => ({
    id: '1', status: 'completed', source, verdict,
}) as any;

describe('VerdictBreakdown', () => {
    beforeEach(() => {
        capturedTooltipFormatter = null;
    });

    it('shows message when no scheduled verdicts', () => {
        render(<VerdictBreakdown investigations={[]} />);
        expect(screen.getByText('No scheduled verdicts')).toBeInTheDocument();
    });

    it('ignores non-scheduled investigations', () => {
        render(<VerdictBreakdown investigations={[inv('healthy', 'manual')]} />);
        expect(screen.getByText('No scheduled verdicts')).toBeInTheDocument();
    });

    it('shows healthy percentage', () => {
        const investigations = [
            inv('healthy'), inv('healthy'), inv('warning'), inv('critical'),
        ];
        render(<VerdictBreakdown investigations={investigations} />);
        // 2/4 = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    it('shows 0% when no healthy verdicts', () => {
        render(<VerdictBreakdown investigations={[inv('critical'), inv('warning')]} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
    });

    describe('tooltip formatter', () => {
        it('formats value with count and percentage', () => {
            // 4 total scheduled investigations
            const investigations = [
                inv('healthy'), inv('healthy'), inv('warning'), inv('critical'),
            ];
            render(<VerdictBreakdown investigations={investigations} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            // 2 out of 4 = 50%
            const result = capturedTooltipFormatter!(2, 'Healthy');
            expect(result).toEqual(['2 (50%)', 'Healthy']);
        });

        it('formats value with rounding for non-integer percentages', () => {
            // 3 total scheduled investigations
            const investigations = [
                inv('healthy'), inv('healthy'), inv('warning'),
            ];
            render(<VerdictBreakdown investigations={investigations} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            // 1 out of 3 ≈ 33%
            const result = capturedTooltipFormatter!(1, 'Warning');
            expect(result).toEqual(['1 (33%)', 'Warning']);
        });

        it('handles 100% when single verdict type', () => {
            render(<VerdictBreakdown investigations={[inv('critical')]} />);
            
            expect(capturedTooltipFormatter).toBeDefined();
            const result = capturedTooltipFormatter!(1, 'Critical');
            expect(result).toEqual(['1 (100%)', 'Critical']);
        });
    });

    it('handles all verdict types', () => {
        const investigations = [
            inv('healthy'), inv('warning'), inv('critical'), inv('error'), inv('unknown'),
        ];
        render(<VerdictBreakdown investigations={investigations} />);
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('filters out investigations without verdict', () => {
        const investigations = [
            inv('healthy'), inv(undefined), inv('warning'),
        ];
        render(<VerdictBreakdown investigations={investigations} />);
        // 1/2 healthy = 50%
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('sorts verdicts by count descending', () => {
        const investigations = [
            inv('warning'), inv('warning'), inv('warning'),
            inv('healthy'), inv('healthy'),
            inv('critical'),
        ];
        render(<VerdictBreakdown investigations={investigations} />);
        const pieData = screen.getByTestId('pie');
        const items = JSON.parse(pieData.getAttribute('data-items') || '[]');
        // First item should be Warning (3), then Healthy (2), then Critical (1)
        expect(items[0].name).toBe('Warning');
        expect(items[0].value).toBe(3);
    });

    it('handles verdicts not in VERDICT_LABELS/COLORS (covers || name and || unknown-color branches)', () => {
        // 'custom_verdict' is not in VERDICT_LABELS => VERDICT_LABELS['custom_verdict'] || 'custom_verdict' fires
        // Also not in VERDICT_COLORS => VERDICT_COLORS[key] || VERDICT_COLORS.unknown fires
        render(<VerdictBreakdown investigations={[inv('custom_verdict')]} />);
        const pieData = screen.getByTestId('pie');
        const items = JSON.parse(pieData.getAttribute('data-items') || '[]');
        // name falls back to the key itself
        expect(items[0].name).toBe('custom_verdict');
        expect(items[0].key).toBe('custom_verdict');
    });
});
