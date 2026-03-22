import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
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

    it('renders NewInvestigation at /new', () => {
        renderApp('/new');
        expect(screen.getByTestId('new-investigation')).toBeInTheDocument();
    });

    it('renders InvestigationDetail at /investigation/:id', () => {
        renderApp('/investigation/123');
        expect(screen.getByTestId('investigation-detail')).toBeInTheDocument();
    });

    it('renders Settings at /settings', () => {
        renderApp('/settings');
        expect(screen.getByTestId('settings')).toBeInTheDocument();
    });

    it('renders Schedules at /schedules', () => {
        renderApp('/schedules');
        expect(screen.getByTestId('schedules')).toBeInTheDocument();
    });

    it('renders About at /about', () => {
        renderApp('/about');
        expect(screen.getByTestId('about')).toBeInTheDocument();
    });
});
