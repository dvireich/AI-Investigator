import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateBanner } from '../../components/UpdateBanner';

describe('UpdateBanner', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders nothing when no update available', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ current: '1.0.0', latest: null, updateAvailable: false, downloadUrl: null, releaseNotesUrl: null }),
        });
        const { container } = render(<UpdateBanner />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when fetch fails', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        const { container } = render(<UpdateBanner />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when response is not ok', async () => {
        mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
        const { container } = render(<UpdateBanner />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    it('renders banner when update is available', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: 'https://example.com/download',
                releaseNotesUrl: 'https://example.com/notes',
            }),
        });
        render(<UpdateBanner />);
        await waitFor(() => {
            expect(screen.getByText('2.0.0')).toBeInTheDocument();
        });
        expect(screen.getByText(/you have 1\.0\.0/)).toBeInTheDocument();
    });

    it('shows release notes link', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: null,
                releaseNotesUrl: 'https://example.com/notes',
            }),
        });
        render(<UpdateBanner />);
        await waitFor(() => {
            expect(screen.getByText('Release notes')).toBeInTheDocument();
        });
    });

    it('shows download link', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: 'https://example.com/download',
                releaseNotesUrl: null,
            }),
        });
        render(<UpdateBanner />);
        await waitFor(() => {
            expect(screen.getByText('Download')).toBeInTheDocument();
        });
    });

    it('dismisses banner and saves to localStorage', async () => {
        const user = userEvent.setup();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: null,
                releaseNotesUrl: null,
            }),
        });
        render(<UpdateBanner />);
        await waitFor(() => {
            expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
        });
        await user.click(screen.getByLabelText('Dismiss'));
        expect(localStorage.getItem('update-banner-dismissed-version')).toBe('2.0.0');
        expect(screen.queryByText('2.0.0')).not.toBeInTheDocument();
    });

    it('auto-dismisses when version was previously dismissed', async () => {
        localStorage.setItem('update-banner-dismissed-version', '2.0.0');
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: null,
                releaseNotesUrl: null,
            }),
        });
        const { container } = render(<UpdateBanner />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        // Should be dismissed immediately
        await waitFor(() => {
            expect(container.querySelector('[aria-label="Dismiss"]')).not.toBeInTheDocument();
        });
    });
});
