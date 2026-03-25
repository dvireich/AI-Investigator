import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from '../../components/ProgressRing';

describe('ProgressRing', () => {
    it('renders an SVG with two circles', () => {
        const { container } = render(<ProgressRing current={10} max={50} />);
        const svg = container.querySelector('svg');
        expect(svg).toBeInTheDocument();
        const circles = svg!.querySelectorAll('circle');
        expect(circles).toHaveLength(2);
    });

    it('displays percentage text', () => {
        render(<ProgressRing current={25} max={50} />);
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('caps at 100%', () => {
        render(<ProgressRing current={100} max={50} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('handles 0 progress', () => {
        render(<ProgressRing current={0} max={50} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('defaults max to 50 when 0', () => {
        render(<ProgressRing current={10} max={0} />);
        expect(screen.getByText('20%')).toBeInTheDocument();
    });

    it('applies custom size', () => {
        const { container } = render(<ProgressRing current={5} max={10} size={60} />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.style.width).toBe('60px');
        expect(wrapper.style.height).toBe('60px');
    });

    it('applies custom className', () => {
        const { container } = render(<ProgressRing current={5} max={10} className="my-class" />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('my-class');
    });

    it('uses correct strokeDashoffset for progress', () => {
        const { container } = render(<ProgressRing current={25} max={50} size={40} strokeWidth={3} />);
        const circles = container.querySelectorAll('circle');
        const progressCircle = circles[1];
        const radius = (40 - 3) / 2;
        const circumference = 2 * Math.PI * radius;
        const expectedOffset = circumference * (1 - 0.5);
        expect(Number(progressCircle.getAttribute('stroke-dashoffset'))).toBeCloseTo(expectedOffset, 1);
    });

    it('renders with default props', () => {
        const { container } = render(<ProgressRing current={10} max={50} />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.style.width).toBe('40px');
    });
});
