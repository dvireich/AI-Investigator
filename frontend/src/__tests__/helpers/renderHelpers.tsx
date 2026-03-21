import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';

/**
 * Render with all providers (Router + Toast) that the app uses.
 */
function AllProviders({ children }: { children: React.ReactNode }) {
    return (
        <BrowserRouter>
            <ToastProvider>
                {children}
            </ToastProvider>
        </BrowserRouter>
    );
}

export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>,
) {
    return render(ui, { wrapper: AllProviders, ...options });
}

export { render };
