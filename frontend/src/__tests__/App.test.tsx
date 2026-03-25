import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App, { lazyRetry } from '../App';
import { ToastProvider } from '../components/Toast';

// Mock all page components to simplify
vi.mock('../pages/Dashboard', () => ({
    Dashboard: () => <div data-testid="dashboard">Dashboard</div>,
}));
vi.mock('../pages/NewInvestigation', () => ({
    NewInvestigation: () => <div data-testid="new-investigation">New</div>,
}));
vi.mock('../pages/InvestigationDetail', () => ({
    InvestigationDetail: () => <div data-testid="investigation-detail">Detail</div>,
}));
vi.mock('../pages/Settings', () => ({
    Settings: () => <div data-testid="settings">Settings</div>,
}));
vi.mock('../pages/Schedules', () => ({
    Schedules: () => <div data-testid="schedules">Schedules</div>,
}));
vi.mock('../pages/ScheduleForm', () => ({
    ScheduleForm: () => <div data-testid="schedule-form">ScheduleForm</div>,
}));
vi.mock('../pages/About', () => ({
    About: () => <div data-testid="about">About</div>,
}));
vi.mock('../pages/OnboardingWizard', () => ({
    OnboardingWizard: () => <div data-testid="onboarding">Onboarding</div>,
}));
vi.mock('../pages/NotFound', () => ({
    NotFound: () => <div data-testid="not-found">Not Found</div>,
}));

// Mock Layout to render its Outlet
vi.mock('../components/Layout', () => ({
    Layout: () => {
        const { Outlet } = require('react-router-dom');
        return <div data-testid="layout"><Outlet /></div>;
    },
}));

// Replace BrowserRouter with a passthrough so MemoryRouter controls routing
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
});

function renderApp(route: string) {
    return render(
        <ToastProvider>
            <MemoryRouter initialEntries={[route]}>
                <App />
            </MemoryRouter>
        </ToastProvider>
    );
}

describe('App', () => {
    beforeEach(() => {
        // Mock onboarding status as complete so Dashboard renders
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url === '/api/onboarding/status') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ complete: true }) });
            }
            return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }));
    });

    it('renders Dashboard at root', async () => {
        renderApp('/');
        await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    });

    it('renders NewInvestigation at /new', async () => {
        renderApp('/new');
        await waitFor(() => expect(screen.getByTestId('new-investigation')).toBeInTheDocument());
    });

    it('renders InvestigationDetail at /investigation/:id', async () => {
        renderApp('/investigation/123');
        await waitFor(() => expect(screen.getByTestId('investigation-detail')).toBeInTheDocument());
    });

    it('renders Settings at /settings', async () => {
        renderApp('/settings');
        await waitFor(() => expect(screen.getByTestId('settings')).toBeInTheDocument());
    });

    it('renders Schedules at /schedules', async () => {
        renderApp('/schedules');
        await waitFor(() => expect(screen.getByTestId('schedules')).toBeInTheDocument());
    });

    it('renders About at /about', async () => {
        renderApp('/about');
        await waitFor(() => expect(screen.getByTestId('about')).toBeInTheDocument());
    });

    it('renders OnboardingWizard at /onboarding', async () => {
        renderApp('/onboarding');
        await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
    });

    it('redirects to onboarding when onboarding is not complete', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url === '/api/onboarding/status') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ complete: false }) });
            }
            return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }));
        renderApp('/');
        await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
    });

    it('renders NotFound for unknown routes', async () => {
        renderApp('/some/unknown/path');
        await waitFor(() => expect(screen.getByTestId('not-found')).toBeInTheDocument());
    });

    it('shows dashboard when onboarding fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url === '/api/onboarding/status') {
                return Promise.reject(new Error('Network error'));
            }
            return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }));
        renderApp('/');
        await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    });

    it('stays in loading state when onboarding response is not ok', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url === '/api/onboarding/status') {
                return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
            }
            return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }));
        renderApp('/');
        // Wait a tick then verify nothing renders (stuck in loading since data=null → needsOnboarding stays null)
        await new Promise(r => setTimeout(r, 100));
        expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    });
});

describe('lazyRetry', () => {
    it('resolves on first successful call', async () => {
        const factory = vi.fn().mockResolvedValue({ default: 'ok' });
        const result = await lazyRetry(factory);
        expect(result).toEqual({ default: 'ok' });
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds', async () => {
        const factory = vi.fn()
            .mockRejectedValueOnce(new Error('chunk load failed'))
            .mockResolvedValueOnce({ default: 'recovered' });
        const result = await lazyRetry(factory, 2);
        expect(result).toEqual({ default: 'recovered' });
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
        const factory = vi.fn().mockRejectedValue(new Error('always fails'));
        await expect(lazyRetry(factory, 0)).rejects.toThrow('always fails');
        expect(factory).toHaveBeenCalledTimes(1);
    });
});
