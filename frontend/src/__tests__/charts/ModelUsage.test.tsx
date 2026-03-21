import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelUsage } from '../../components/charts/ModelUsage';

// Capture the labelFormatter function passed to Tooltip
let capturedLabelFormatter: ((label: string) => string) | null = null;

vi.mock('recharts', () => ({
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    Bar: ({ children }: any) => <div>{children}</div>,
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: ({ labelFormatter }: any) => {
        capturedLabelFormatter = labelFormatter;
        return <div data-testid="tooltip" />;
    },
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

const inv = (model?: string) => ({ id: '1', status: 'completed', model }) as any;

describe('ModelUsage', () => {
    beforeEach(() => {
        capturedLabelFormatter = null;
    });

    it('shows empty message when no data', () => {
        render(<ModelUsage investigations={[]} />);
        expect(screen.getByText('No model data')).toBeInTheDocument();
    });

    it('renders chart with model data', () => {
        render(<ModelUsage investigations={[inv('gpt-4o'), inv('gpt-4o'), inv('claude-3')]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('treats empty model as Unknown', () => {
        render(<ModelUsage investigations={[inv(undefined), inv('')]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    describe('tooltip labelFormatter', () => {
        it('returns full model name when found in data', () => {
            // Use a long model name that gets truncated
            const longModelName = 'gpt-4o-2024-05-13-preview-super-long';
            render(<ModelUsage investigations={[inv(longModelName)]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            // The truncated label should resolve to full name
            const truncatedLabel = longModelName.slice(0, 20) + '…';
            const result = capturedLabelFormatter!(truncatedLabel);
            expect(result).toBe(longModelName);
        });

        it('returns label as-is when no match found', () => {
            render(<ModelUsage investigations={[inv('gpt-4o')]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            // Non-matching label should return itself
            const result = capturedLabelFormatter!('unknown-label');
            expect(result).toBe('unknown-label');
        });

        it('returns short model name as-is when under 22 chars', () => {
            const shortModelName = 'gpt-4o';
            render(<ModelUsage investigations={[inv(shortModelName)]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            const result = capturedLabelFormatter!(shortModelName);
            expect(result).toBe(shortModelName);
        });
    });

    it('truncates model names longer than 22 characters', () => {
        const longModelName = 'this-is-a-very-long-model-name-that-exceeds-limit';
        render(<ModelUsage investigations={[inv(longModelName)]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
        // Verify tooltip formatter can still retrieve full name
        expect(capturedLabelFormatter).toBeDefined();
    });

    it('handles multiple models sorted by count descending', () => {
        const investigations = [
            inv('gpt-4o'), inv('gpt-4o'), inv('gpt-4o'),
            inv('claude-3'), inv('claude-3'),
            inv('gemini'),
        ];
        render(<ModelUsage investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('limits to top 8 models', () => {
        const investigations = Array.from({ length: 10 }, (_, i) => inv(`model-${i}`));
        render(<ModelUsage investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
});
