import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ScrollToTop } from '../../components/ScrollToTop';

describe('ScrollToTop', () => {
    let scrollY: number;

    beforeEach(() => {
        scrollY = 0;
        Object.defineProperty(window, 'scrollY', {
            get: () => scrollY,
            configurable: true,
        });
        window.scrollTo = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render when scrollY < 400', () => {
        const { container } = render(<ScrollToTop />);
        expect(container.querySelector('button')).toBeNull();
    });

    it('renders button when scrollY > 400', () => {
        render(<ScrollToTop />);
        scrollY = 500;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        expect(screen.getByLabelText('Scroll to top')).toBeInTheDocument();
    });

    it('calls window.scrollTo when clicked', () => {
        render(<ScrollToTop />);
        scrollY = 500;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        fireEvent.click(screen.getByLabelText('Scroll to top'));
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('hides button when scrolling back to top', () => {
        render(<ScrollToTop />);
        scrollY = 500;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        expect(screen.getByLabelText('Scroll to top')).toBeInTheDocument();

        scrollY = 100;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });
        expect(screen.queryByLabelText('Scroll to top')).toBeNull();
    });

    it('cleans up scroll listener on unmount', () => {
        const removeEventListener = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<ScrollToTop />);
        unmount();
        expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
});
