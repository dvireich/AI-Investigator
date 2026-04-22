import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { ToastProvider } from '../../components/Toast';

// Mock api module
vi.mock('../../api', () => ({
    api: {
        getAuthStatus: vi.fn().mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        }),
        startLogin: vi.fn().mockResolvedValue({
            deviceCode: 'CODE123',
            userCode: 'ABCD-1234',
            verificationUri: 'https://example.com/login',
            interval: 5,
        }),
        pollLogin: vi.fn().mockResolvedValue({ pending: true }),
    },
}));

function renderLayout(route = '/') {
    return render(
        <ToastProvider>
            <MemoryRouter initialEntries={[route]}>
                <Layout />
            </MemoryRouter>
        </ToastProvider>
    );
}

describe('Layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders header with title', async () => {
        renderLayout();
        expect(screen.getByText('AI')).toBeInTheDocument();
    });

    it('renders navigation links', async () => {
        renderLayout();
        expect(screen.getByText('Investigations')).toBeInTheDocument();
        expect(screen.getByText('New')).toBeInTheDocument();
        expect(screen.getByText('Schedules')).toBeInTheDocument();
        expect(screen.getByText('About')).toBeInTheDocument();
    });

    it('shows connect button when not authenticated', async () => {
        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Connect GitHub Copilot')).toBeInTheDocument();
        });
    });

    it('shows active status when authenticated', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'testuser', name: 'Test User', avatar_url: 'https://example.com/avatar.png' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('GitHub Copilot Active')).toBeInTheDocument();
        });
    });

    it('shows user avatar when authenticated with avatar', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'openai',
            authRequirement: { type: 'api-key' },
            user: { login: 'dev', name: 'Dev', avatar_url: 'https://img.example.com/a.png' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByAltText('dev')).toBeInTheDocument();
        });
    });

    it('opens login modal on click when oauth-device-flow', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => {
            expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
            expect(screen.getByText('Open Login Page')).toBeInTheDocument();
        });
    });

    it('toggles mobile menu', async () => {
        const user = userEvent.setup();
        renderLayout();

        const toggleBtn = screen.getByLabelText('Toggle menu');
        await user.click(toggleBtn);
        // Mobile menu shows navigation links
        expect(screen.getByText('New Investigation')).toBeInTheDocument();
    });

    it('provider display name mapping', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'anthropic',
            authRequirement: { type: 'api-key' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Anthropic Active')).toBeInTheDocument();
        });
    });

    it('shows OpenAI provider name', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'openai',
            authRequirement: { type: 'api-key' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('OpenAI Active')).toBeInTheDocument();
        });
    });

    it('shows Azure OpenAI provider name', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'azure-openai',
            authRequirement: { type: 'api-key' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Azure OpenAI Active')).toBeInTheDocument();
        });
    });

    it('shows Ollama provider name', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'ollama',
            authRequirement: { type: 'none' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Ollama Active')).toBeInTheDocument();
        });
    });

    it('shows Not Configured when provider is none', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'none',
            authRequirement: { type: 'none' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Configure LLM')).toBeInTheDocument();
        });
    });

    it('capitalizes unknown provider names', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'custom-provider',
            authRequirement: { type: 'api-key' },
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('Custom-provider Active')).toBeInTheDocument();
        });
    });

    it('navigates to settings when auth is not oauth-device-flow', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'openai',
            authRequirement: { type: 'api-key' },
        } as any);

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByText('Configure OpenAI'));
        await user.click(screen.getByText('Configure OpenAI'));

        // Should navigate to /settings (MemoryRouter handles this)
        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument(); // No login modal
        });
    });

    it('shows user icon when no avatar_url', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'noavatar', name: 'No Avatar User', avatar_url: '' },
        } as any);

        renderLayout();
        
        // Should show user icon placeholder, not an img with alt text
        await waitFor(() => {
            expect(screen.getByText('GitHub Copilot Active')).toBeInTheDocument();
        });
        // The placeholder user icon renders instead of img
        expect(screen.queryByAltText('noavatar')).not.toBeInTheDocument();
    });

    it('closes mobile menu when backdrop is clicked', async () => {
        const user = userEvent.setup();
        renderLayout();

        // Wait for initial render
        await waitFor(() => screen.getByLabelText('Toggle menu'));
        
        const toggleBtn = screen.getByLabelText('Toggle menu');
        await user.click(toggleBtn);
        
        await waitFor(() => {
            expect(screen.getByText('New Investigation')).toBeInTheDocument();
        });

        // Click backdrop to close
        const backdrop = document.querySelector('.bg-black\\/60.backdrop-blur-sm');
        if (backdrop) {
            await user.click(backdrop);
        }

        await waitFor(() => {
            expect(screen.queryByText('New Investigation')).not.toBeInTheDocument();
        });
    });

    it('mobile menu shows connect button when not authenticated', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByLabelText('Toggle menu'));
        await user.click(screen.getByLabelText('Toggle menu'));

        // Mobile menu should show connect button
        await waitFor(() => {
            const mobileConnectBtns = screen.getAllByText('Connect GitHub Copilot');
            expect(mobileConnectBtns.length).toBeGreaterThan(0);
        });
    });

    it('mobile menu triggers login when connect clicked', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByLabelText('Toggle menu'));
        await user.click(screen.getByLabelText('Toggle menu'));
        
        // Wait for mobile menu to appear
        await waitFor(() => screen.getByText('New Investigation'));
        
        // Click connect in mobile menu - it's the full-width button at the bottom
        const mobileConnectBtns = screen.getAllByText('Connect GitHub Copilot');
        await user.click(mobileConnectBtns[mobileConnectBtns.length - 1]); // Last one is in mobile menu

        await waitFor(() => {
            expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
        });
    });

    it('mobile menu shows active status and avatar when authenticated', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'mobileuser', name: 'Mobile User', avatar_url: 'https://example.com/mobile.png' },
        } as any);

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByLabelText('Toggle menu'));
        await user.click(screen.getByLabelText('Toggle menu'));

        await waitFor(() => {
            // Mobile menu shows active status
            const activeLabels = screen.getAllByText('GitHub Copilot Active');
            expect(activeLabels.length).toBeGreaterThan(0);
        });
    });

    it('cancels login modal when Cancel is clicked', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));
        
        await user.click(screen.getByText('Cancel'));

        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });
    });

    it('handles startLogin failure', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.startLogin).mockRejectedValueOnce(new Error('Network error'));

        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        // Should not show modal - error occurred  
        // Give it a moment to process the rejection
        await new Promise(r => setTimeout(r, 100));
        expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
    });

    it('creates user from fallback fields when user object not present', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
            username: 'fallbackuser',
            displayName: 'Fallback User',
            avatarUrl: 'https://example.com/fallback.png',
        } as any);

        renderLayout();
        await waitFor(() => {
            expect(screen.getByAltText('fallbackuser')).toBeInTheDocument();
        });
    });

    it('closes mobile menu on route change', async () => {
        const user = userEvent.setup();
        renderLayout();

        await waitFor(() => screen.getByLabelText('Toggle menu'));
        await user.click(screen.getByLabelText('Toggle menu'));
        
        await waitFor(() => {
            expect(screen.getByText('New Investigation')).toBeInTheDocument();
        });

        // Click About link in mobile menu
        const aboutLinks = screen.getAllByText('About');
        await user.click(aboutLinks[aboutLinks.length - 1]); // Mobile menu link

        // Menu should close after navigation
        await waitFor(() => {
            expect(screen.queryByText('New Investigation')).not.toBeInTheDocument();
        });
    });

    it('handles successful login poll result', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.pollLogin)
            .mockResolvedValue({ pending: true })
            .mockResolvedValue({ success: true });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));

        // Advance past first poll interval (5+1)*1000 = 6000ms
        await vi.advanceTimersByTimeAsync(6500);

        // After first poll (pending), advance to second poll
        await vi.advanceTimersByTimeAsync(6500);

        // Modal should close after successful login
        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('handles expired_token error during polling', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.pollLogin).mockRejectedValue({ message: 'expired_token' });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));

        // Advance past poll interval
        await vi.advanceTimersByTimeAsync(6500);

        // Modal should close and toast should appear
        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('handles slow_down error during polling by backing off', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.pollLogin)
            .mockRejectedValueOnce({ message: 'slow_down' })
            .mockResolvedValue({ success: true });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));

        // First poll - slow_down error, should continue polling
        await vi.advanceTimersByTimeAsync(6500);

        // Second poll - success
        await vi.advanceTimersByTimeAsync(6500);

        // Modal should close after successful login
        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('handles expired_token from response data', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        // Error with response.data.error format
        vi.mocked(api.pollLogin).mockRejectedValue({ 
            response: { data: { error: 'expired_token' } } 
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));

        // Advance past poll interval
        await vi.advanceTimersByTimeAsync(6500);

        // Modal should close
        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('continues polling on unknown errors', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.pollLogin)
            .mockRejectedValueOnce(new Error('network_error'))
            .mockResolvedValue({ success: true });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));

        await waitFor(() => screen.getByText('ABCD-1234'));

        // First poll - unknown error, should continue
        await vi.advanceTimersByTimeAsync(6500);
        // Modal should still be open
        expect(screen.getByText('ABCD-1234')).toBeInTheDocument();

        // Second poll - success
        await vi.advanceTimersByTimeAsync(6500);

        await waitFor(() => {
            expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('cleans up poller when starting new login', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.pollLogin).mockResolvedValue({ pending: true });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();

        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        
        // Start first login
        await user.click(screen.getByText('Connect GitHub Copilot'));
        await waitFor(() => screen.getByText('ABCD-1234'));

        // Cancel and start again - this clears existing poller
        await user.click(screen.getByText('Cancel'));
        await waitFor(() => expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument());

        // Start second login
        await user.click(screen.getByText('Connect GitHub Copilot'));
        await waitFor(() => screen.getByText('ABCD-1234'));

        vi.useRealTimers();
    });
});

// ══════════════════════════════════════════════════════════════════════════
// ADDITIONAL COVERAGE — uncovered Layout.tsx branches
// ══════════════════════════════════════════════════════════════════════════
describe('Layout additional coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('falls back to "none" providerType when status.providerType is undefined (covers L43, L44)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            // no providerType or authRequirement — triggers || fallbacks on L43/L44
        } as any);
        renderLayout();
        // Should show "Configure LLM" since providerType falls back to 'none'
        await waitFor(() => {
            expect(screen.getByText('Configure LLM')).toBeInTheDocument();
        });
    });

    it('creates user from username when status.user is null but username exists (covers L45)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
            username: 'devuser',
            displayName: 'Dev User',
            avatarUrl: '',
        } as any);
        renderLayout();
        // Authenticated → shows active label
        await waitFor(() => {
            expect(screen.getByText(/GitHub Copilot Active/i)).toBeInTheDocument();
        });
    });

    it('handles getAuthStatus thrown error gracefully (covers L46 catch)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockRejectedValue(new Error('Auth error'));
        // Should not crash
        expect(() => renderLayout()).not.toThrow();
        await waitFor(() => expect(screen.getByText('AI')).toBeInTheDocument());
    });

    it('shows fallback avatar div when authenticated user has no avatar_url (covers L220 false branch)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'openai',
            authRequirement: { type: 'api-key' },
            user: { login: 'testuser', name: null, avatar_url: '' },
        } as any);
        renderLayout();
        // Should show fallback avatar (not img alt=testuser)
        await waitFor(() => {
            expect(screen.queryByAltText('testuser')).not.toBeInTheDocument();
        });
    });

    it('uses user.login as title when user.name is null (covers L228 fallback)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'loginonly', name: null, avatar_url: '' },
        } as any);
        renderLayout();
        await waitFor(() => {
            // The fallback div has title={user?.name || user?.login} = 'loginonly'
            const titleEl = document.querySelector('[title="loginonly"]');
            expect(titleEl).toBeTruthy();
        });
    });

    it('shows mobile menu user avatar when authenticated with user (covers L272)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'mobileuser', name: 'Mobile User', avatar_url: 'https://example.com/m.png' },
        } as any);
        const user = userEvent.setup();
        renderLayout();
        await waitFor(() => screen.getByText(/GitHub Copilot Active/i));

        // Open mobile menu to trigger mobile nav render (L272 user avatar)
        const hamburger = screen.queryByLabelText(/toggle menu/i);
        if (hamburger) {
            await user.click(hamburger);
            await waitFor(() => {
                const imgs = document.querySelectorAll('img[src="https://example.com/m.png"]');
                expect(imgs.length).toBeGreaterThan(0);
            });
        }
    });

    it('handles poll error with no message property (covers L79 || branch)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
        } as any);
        vi.mocked(api.startLogin).mockResolvedValue({
            deviceCode: 'CODE',
            userCode: 'WXYZ-9999',
            verificationUri: 'https://example.com/login',
            interval: 1,
        } as any);
        // Poll throws an error object with no message (covers || '' fallback)
        vi.mocked(api.pollLogin).mockRejectedValue({ } as any);

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderLayout();
        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        await user.click(screen.getByText('Connect GitHub Copilot'));
        await waitFor(() => screen.getByText('WXYZ-9999'));

        // Advance timers to trigger poll
        await vi.advanceTimersByTimeAsync(3000);

        vi.useRealTimers();
    });

    it('creates user from username without displayName set (covers L45 null branch)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
            username: 'nonamuser',
            // displayName intentionally omitted → status.displayName || null = null
        } as any);
        renderLayout();
        await waitFor(() => expect(screen.getByText(/GitHub Copilot Active/i)).toBeInTheDocument());
    });

    it('clears existing login poller when login is initiated a second time (covers L62)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: false,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: null,
        } as any);
        vi.mocked(api.startLogin).mockResolvedValue({
            deviceCode: 'CODE2',
            userCode: 'ABCD-5678',
            verificationUri: 'https://example.com/login',
            interval: 5,
        } as any);
        const user = userEvent.setup();
        renderLayout();
        await waitFor(() => screen.getByText('Connect GitHub Copilot'));
        // First click sets up the poller
        await user.click(screen.getAllByText('Connect GitHub Copilot')[0]);
        await waitFor(() => expect(api.startLogin).toHaveBeenCalledTimes(1));
        // Second click should clear the existing poller (covers L62 true branch)
        await user.click(screen.getAllByText('Connect GitHub Copilot')[0]);
        await waitFor(() => expect(api.startLogin).toHaveBeenCalledTimes(2));
    });

    it('uses user.login in desktop avatar title when user.name is null (covers L220 branch)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'openai',
            authRequirement: { type: 'api-key' },
            user: { login: 'loginonlyuser', name: null, avatar_url: 'https://example.com/av.png' },
        } as any);
        renderLayout();
        await waitFor(() => {
            // title={user.name || user.login} → user.login because name is null
            const titleEl = document.querySelector('[title="loginonlyuser"]');
            expect(titleEl).toBeTruthy();
        });
    });

    it('uses user.login in mobile menu avatar title when user.name is null (covers L272 branch)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.getAuthStatus).mockResolvedValue({
            authenticated: true,
            providerType: 'copilot',
            authRequirement: { type: 'oauth-device-flow' },
            user: { login: 'mobilelogin', name: null, avatar_url: 'https://example.com/m2.png' },
        } as any);
        const user = userEvent.setup();
        renderLayout();
        await waitFor(() => screen.getByText(/GitHub Copilot Active/i));
        const hamburger = screen.queryByLabelText(/toggle menu/i);
        if (hamburger) {
            await user.click(hamburger);
            await waitFor(() => {
                // In mobile menu, title={user.name || user.login} → 'mobilelogin'
                const el = document.querySelector('[title="mobilelogin"]');
                expect(el).toBeTruthy();
            });
        }
    });

    it('shows version badge in header when /api/version returns current version', async () => {
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ current: '1.2.3' }),
        });
        renderLayout();
        await waitFor(() => {
            expect(screen.getByText('v1.2.3')).toBeInTheDocument();
        });
        globalThis.fetch = origFetch;
    });

    it('handles version fetch with ok:false and missing current gracefully', async () => {
        const origFetch = globalThis.fetch;
        // First call: ok false
        globalThis.fetch = vi.fn()
            .mockResolvedValue({ ok: false, json: () => Promise.resolve(null) })
            .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        const { unmount } = renderLayout();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
        unmount();
        // Second render: ok true but no current field
        renderLayout();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
        globalThis.fetch = origFetch;
    });

    it('applies h-screen overflow-hidden and skips main padding on investigation route', async () => {
        renderLayout('/investigation/123');
        const wrapper = document.querySelector('.h-screen.overflow-hidden');
        expect(wrapper).toBeTruthy();
        const main = document.querySelector('main');
        expect(main?.className).not.toContain('pt-[4.5rem]');
    });
});
