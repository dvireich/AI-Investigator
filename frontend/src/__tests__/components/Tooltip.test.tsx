import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '../../components/Tooltip';

describe('Tooltip', () => {
    it('renders trigger button with help icon', () => {
        render(<Tooltip text="Help text" />);
        expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    });

    it('shows tooltip text on mouse enter', () => {
        render(<Tooltip text="Helpful info" />);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        fireEvent.mouseEnter(screen.getByRole('button', { name: 'Help' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful info');
    });

    it('hides tooltip on mouse leave', () => {
        render(<Tooltip text="Helpful info" />);
        const btn = screen.getByRole('button', { name: 'Help' });

        fireEvent.mouseEnter(btn);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        fireEvent.mouseLeave(btn);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows tooltip on focus and hides on blur', () => {
        render(<Tooltip text="Focus text" />);
        const btn = screen.getByRole('button', { name: 'Help' });

        fireEvent.focus(btn);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Focus text');

        fireEvent.blur(btn);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('renders children alongside trigger', () => {
        render(<Tooltip text="Info"><span data-testid="child">Label</span></Tooltip>);
        expect(screen.getByTestId('child')).toHaveTextContent('Label');
        expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    });

    it('positions above when trigger is far from viewport top', () => {
        // Default: getBoundingClientRect returns top=0, so above will be false
        render(<Tooltip text="Position test" />);
        const btn = screen.getByRole('button', { name: 'Help' });

        // Mock getBoundingClientRect to simulate enough space above
        btn.getBoundingClientRect = () => ({ top: 200, bottom: 220, left: 100, right: 120, width: 20, height: 20, x: 100, y: 200, toJSON: () => ({}) });
        fireEvent.mouseEnter(btn);
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.className).toContain('bottom-full');
    });

    it('positions below when trigger is near viewport top', () => {
        render(<Tooltip text="Position test" />);
        const btn = screen.getByRole('button', { name: 'Help' });

        btn.getBoundingClientRect = () => ({ top: 50, bottom: 70, left: 100, right: 120, width: 20, height: 20, x: 100, y: 50, toJSON: () => ({}) });
        fireEvent.mouseEnter(btn);
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.className).toContain('top-full');
    });
});
