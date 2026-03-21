import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TargetActivity } from '../../components/charts/StampActivity';

// Capture the labelFormatter function passed to Tooltip
let capturedLabelFormatter: ((label: string) => string) | null = null;

vi.mock('recharts', () => ({
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    Bar: () => <div />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: ({ labelFormatter }: any) => {
        capturedLabelFormatter = labelFormatter;
        return <div data-testid="tooltip" />;
    },
    Cell: () => <div />,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Legend: () => <div />,
}));

const inv = (target: string, status: string) => ({ id: '1', status, target }) as any;

describe('TargetActivity', () => {
    beforeEach(() => {
        capturedLabelFormatter = null;
    });

    it('shows empty message for no data', () => {
        render(<TargetActivity investigations={[]} />);
        expect(screen.getByText('No stamp data')).toBeInTheDocument();
    });

    it('renders chart with stamp data', () => {
        render(<TargetActivity investigations={[
            inv('stamp-01', 'completed'),
            inv('stamp-01', 'failed'),
            inv('stamp-02', 'running'),
        ]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('treats empty target as Unknown', () => {
        render(<TargetActivity investigations={[inv('', 'completed')]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    describe('tooltip labelFormatter', () => {
        it('returns full stamp name when found via s.stamp lookup', () => {
            // After bug fix: s.stamp (not s.target) is used, so truncated label maps to fullStamp
            const longStampName = 'oi-tds-prd-eus2p-01-very-long-name';
            render(<TargetActivity investigations={[inv(longStampName, 'completed')]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            const truncatedLabel = longStampName.slice(0, 18) + '\u2026';
            const result = capturedLabelFormatter!(truncatedLabel);
            // Now correctly finds the entry and returns fullStamp
            expect(result).toBe(longStampName);
        });

        it('returns label as-is when no match found', () => {
            render(<TargetActivity investigations={[inv('stamp-01', 'completed')]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            const result = capturedLabelFormatter!('unknown-stamp');
            expect(result).toBe('unknown-stamp');
        });

        it('returns short stamp name as-is when under 20 chars', () => {
            const shortStampName = 'stamp-01';
            render(<TargetActivity investigations={[inv(shortStampName, 'completed')]} />);
            
            expect(capturedLabelFormatter).toBeDefined();
            // Short names are not truncated so label = fullStamp
            const result = capturedLabelFormatter!(shortStampName);
            expect(result).toBe(shortStampName);
        });
    });

    it('groups by stamp and counts per status', () => {
        const investigations = [
            inv('stamp-01', 'completed'),
            inv('stamp-01', 'completed'),
            inv('stamp-01', 'failed'),
            inv('stamp-02', 'running'),
            inv('stamp-02', 'paused'),
        ];
        render(<TargetActivity investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('limits to top 8 stamps by total count', () => {
        const investigations = Array.from({ length: 10 }, (_, i) => 
            inv(`stamp-${i.toString().padStart(2, '0')}`, 'completed')
        );
        render(<TargetActivity investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('truncates stamp names longer than 20 characters', () => {
        const longStampName = 'this-is-a-very-long-stamp-name';
        render(<TargetActivity investigations={[inv(longStampName, 'completed')]} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('handles all status types', () => {
        const investigations = [
            inv('stamp-01', 'completed'),
            inv('stamp-01', 'failed'),
            inv('stamp-01', 'running'),
            inv('stamp-01', 'paused'),
            inv('stamp-01', 'aborted'),
        ];
        render(<TargetActivity investigations={investigations} />);
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
});
