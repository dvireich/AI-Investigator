import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';

// A component that throws on render
function ThrowingChild({ error }: { error: Error }) {
    throw error;
}

function GoodChild() {
    return <div data-testid="child">Hello</div>;
}

describe('ErrorBoundary', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it('renders children when no error', () => {
        render(
            <ErrorBoundary>
                <GoodChild />
            </ErrorBoundary>,
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('renders error UI when a child throws', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild error={new Error('Test crash')} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText('Test crash')).toBeInTheDocument();
        expect(screen.getByText('Refresh Page')).toBeInTheDocument();
        expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
    });

    it('logs caught errors via componentDidCatch', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild error={new Error('Logged crash')} />
            </ErrorBoundary>,
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            'ErrorBoundary caught:',
            expect.any(Error),
            expect.any(String),
        );
    });

    it('links Go to Dashboard to /', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild error={new Error('nav test')} />
            </ErrorBoundary>,
        );
        const link = screen.getByText('Go to Dashboard').closest('a');
        expect(link).toHaveAttribute('href', '/');
    });

    it('calls window.location.reload when Refresh Page is clicked', () => {
        const reloadMock = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...window.location, reload: reloadMock },
            writable: true,
            configurable: true,
        });

        render(
            <ErrorBoundary>
                <ThrowingChild error={new Error('reload test')} />
            </ErrorBoundary>,
        );
        screen.getByText('Refresh Page').click();
        expect(reloadMock).toHaveBeenCalled();
    });
});
