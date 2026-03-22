import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingWizard } from '../../pages/OnboardingWizard';
import { ToastProvider } from '../../components/Toast';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../api', () => ({
    api: {
        getAuthProviders: vi.fn().mockResolvedValue([
            { type: 'copilot', displayName: 'GitHub Copilot', authRequirement: { type: 'none' } },
            { type: 'openai', displayName: 'OpenAI', authRequirement: { type: 'api-key' } },
        ]),
        discoverProduct: vi.fn().mockResolvedValue({ source: 'manifest' }),
    },
}));

function renderWizard() {
    return render(
        <ToastProvider>
            <MemoryRouter>
                <OnboardingWizard />
            </MemoryRouter>
        </ToastProvider>
    );
}

describe('OnboardingWizard', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Re-apply mock implementations after clearAllMocks
        const { api } = await import('../../api');
        vi.mocked(api.getAuthProviders).mockResolvedValue([
            { type: 'copilot', displayName: 'GitHub Copilot', authRequirement: { type: 'none' } },
            { type: 'openai', displayName: 'OpenAI', authRequirement: { type: 'api-key' } },
        ] as any);
        vi.mocked(api.discoverProduct).mockResolvedValue({ source: 'manifest' } as any);
        mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Welcome step', () => {
        it('renders welcome heading', () => {
            renderWizard();
            expect(screen.getByText('Welcome to AI Investigator')).toBeInTheDocument();
        });

        it('shows get started button', () => {
            renderWizard();
            expect(screen.getByText('Get started')).toBeInTheDocument();
        });

        it('navigates to LLM step on get started click', async () => {
            const user = userEvent.setup();
            renderWizard();
            await user.click(screen.getByText('Get started'));
            expect(screen.getByText('Choose LLM Provider')).toBeInTheDocument();
        });
    });

    describe('LLM step', () => {
        async function goToLlmStep() {
            const user = userEvent.setup();
            renderWizard();
            await user.click(screen.getByText('Get started'));
            await waitFor(() => {
                expect(screen.getByText('Choose LLM Provider')).toBeInTheDocument();
            });
            return user;
        }

        it('shows provider list', async () => {
            await goToLlmStep();
            await waitFor(() => {
                expect(screen.getByText('GitHub Copilot')).toBeInTheDocument();
                expect(screen.getByText('OpenAI')).toBeInTheDocument();
            });
        });

        it('shows auth requirement info', async () => {
            await goToLlmStep();
            await waitFor(() => {
                expect(screen.getByText('No auth required')).toBeInTheDocument();
                expect(screen.getByText('Requires api-key auth')).toBeInTheDocument();
            });
        });

        it('can select a different provider', async () => {
            const user = await goToLlmStep();
            await waitFor(() => {
                expect(screen.getByText('OpenAI')).toBeInTheDocument();
            });
            await user.click(screen.getByText('OpenAI'));
            // OpenAI button should now be selected (verify via visual check — the Check icon appears)
        });

        it('shows loading when no providers', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.getAuthProviders).mockResolvedValue([]);
            const user = userEvent.setup();
            renderWizard();
            await user.click(screen.getByText('Get started'));
            expect(screen.getByText('Loading providers...')).toBeInTheDocument();
        });

        it('saves provider and goes to product step', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
            const user = await goToLlmStep();
            await waitFor(() => {
                expect(screen.getByText('GitHub Copilot')).toBeInTheDocument();
            });
            await user.click(screen.getByText(/Continue/));
            await waitFor(() => {
                expect(screen.getByText('Add a Product (optional)')).toBeInTheDocument();
            });
        });

        it('shows error when save fails', async () => {
            mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
            const user = await goToLlmStep();
            await waitFor(() => {
                expect(screen.getByText('GitHub Copilot')).toBeInTheDocument();
            });
            await user.click(screen.getByText(/Continue/));
            await waitFor(() => {
                expect(screen.getByText('Failed to save settings')).toBeInTheDocument();
            });
        });

        it('can go back to welcome', async () => {
            const user = await goToLlmStep();
            await user.click(screen.getByText('Back'));
            expect(screen.getByText('Welcome to AI Investigator')).toBeInTheDocument();
        });
    });

    describe('Product step', () => {
        async function goToProductStep() {
            const user = userEvent.setup();
            mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
            renderWizard();
            await user.click(screen.getByText('Get started'));
            await waitFor(() => expect(screen.getByText('Choose LLM Provider')).toBeInTheDocument());
            await waitFor(() => expect(screen.getByText('GitHub Copilot')).toBeInTheDocument());
            await user.click(screen.getByText(/Continue/));
            await waitFor(() => expect(screen.getByText('Add a Product (optional)')).toBeInTheDocument());
            return user;
        }

        it('renders product step', async () => {
            await goToProductStep();
            expect(screen.getByText('Add a Product (optional)')).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/Repos/)).toBeInTheDocument();
        });

        it('shows skip when no path entered', async () => {
            await goToProductStep();
            expect(screen.getByText('Skip')).toBeInTheDocument();
        });

        it('shows continue when path entered', async () => {
            const user = await goToProductStep();
            await user.type(screen.getByPlaceholderText(/Repos/), 'C:\\MyRepo');
            expect(screen.getByText('Continue')).toBeInTheDocument();
        });

        it('discovers product at path', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.discoverProduct).mockResolvedValue({ source: 'manifest' } as any);
            const user = await goToProductStep();
            await user.type(screen.getByPlaceholderText(/Repos/), 'C:\\MyRepo');
            await user.click(screen.getByText('Discover'));
            await waitFor(() => {
                expect(screen.getByText(/Found.*configuration/)).toBeInTheDocument();
            });
        });

        it('shows message when no config found', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.discoverProduct).mockResolvedValue({ source: 'none' } as any);
            const user = await goToProductStep();
            await user.type(screen.getByPlaceholderText(/Repos/), 'C:\\Empty');
            await user.click(screen.getByText('Discover'));
            await waitFor(() => {
                expect(screen.getByText(/No investigation configuration found/)).toBeInTheDocument();
            });
        });

        it('shows error when discovery fails', async () => {
            const { api } = await import('../../api');
            vi.mocked(api.discoverProduct).mockRejectedValue(new Error('Failed'));
            const user = await goToProductStep();
            await user.type(screen.getByPlaceholderText(/Repos/), 'C:\\Bad');
            await user.click(screen.getByText('Discover'));
            await waitFor(() => {
                expect(screen.getByText('Failed')).toBeInTheDocument();
            });
        });

        it('does not discover when path is empty', async () => {
            const { api } = await import('../../api');
            const user = await goToProductStep();
            // Discover button should be disabled when path is empty
            const discoverBtn = screen.getByText('Discover');
            expect(discoverBtn).toBeDisabled();
        });

        it('can go back to LLM step', async () => {
            const user = await goToProductStep();
            await user.click(screen.getByText('Back'));
            expect(screen.getByText('Choose LLM Provider')).toBeInTheDocument();
        });

        it('can skip to done step', async () => {
            const user = await goToProductStep();
            await user.click(screen.getByText('Skip'));
            await waitFor(() => {
                expect(screen.getByText("You're all set!")).toBeInTheDocument();
            });
        });
    });

    describe('Done step', () => {
        async function goToDoneStep() {
            const user = userEvent.setup();
            mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
            renderWizard();
            await user.click(screen.getByText('Get started'));
            await waitFor(() => expect(screen.getByText('Choose LLM Provider')).toBeInTheDocument());
            await waitFor(() => expect(screen.getByText('GitHub Copilot')).toBeInTheDocument());
            await user.click(screen.getByText(/Continue/));
            await waitFor(() => expect(screen.getByText('Add a Product (optional)')).toBeInTheDocument());
            await user.click(screen.getByText('Skip'));
            await waitFor(() => expect(screen.getByText("You're all set!")).toBeInTheDocument());
            return user;
        }

        it('renders done message', async () => {
            await goToDoneStep();
            expect(screen.getByText("You're all set!")).toBeInTheDocument();
        });

        it('navigates to dashboard on finish', async () => {
            const user = await goToDoneStep();
            await user.click(screen.getByText('Open Dashboard'));
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });

    describe('Progress bar', () => {
        it('shows step labels', () => {
            renderWizard();
            expect(screen.getByText('Welcome')).toBeInTheDocument();
            expect(screen.getByText('LLM Provider')).toBeInTheDocument();
            expect(screen.getByText('Product')).toBeInTheDocument();
            expect(screen.getByText('Ready')).toBeInTheDocument();
        });
    });
});
