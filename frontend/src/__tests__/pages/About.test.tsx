import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { About } from '../../pages/About';

describe('About', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders heading', () => {
        render(<About />);
        expect(screen.getByText(/AI Investigator/)).toBeInTheDocument();
    });

    it('renders what it does section', () => {
        render(<About />);
        expect(screen.getByText('What it does')).toBeInTheDocument();
    });

    it('renders how it works section', () => {
        render(<About />);
        expect(screen.getByText('How it works')).toBeInTheDocument();
    });

    it('renders tech stack section', () => {
        render(<About />);
        expect(screen.getByText('Tech stack')).toBeInTheDocument();
    });

    it('renders version section when version data loads', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.2.3',
                commit: 'abc1234',
                buildDate: '2026-01-15T10:00:00Z',
                latest: null,
                updateAvailable: false,
                downloadUrl: null,
                releaseNotesUrl: null,
            }),
        });
        render(<About />);
        await waitFor(() => {
            expect(screen.getByText('1.2.3')).toBeInTheDocument();
            expect(screen.getByText('abc1234')).toBeInTheDocument();
        });
        expect(screen.getByText('Check for updates')).toBeInTheDocument();
    });

    it('shows update available in version section', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                commit: 'abc1234',
                buildDate: '2026-01-15T10:00:00Z',
                latest: '2.0.0',
                updateAvailable: true,
                downloadUrl: 'https://example.com/download',
                releaseNotesUrl: null,
            }),
        });
        render(<About />);
        await waitFor(() => {
            expect(screen.getByText('2.0.0')).toBeInTheDocument();
        });
        expect(screen.getByText('Download')).toBeInTheDocument();
    });

    it('check for updates button triggers fetch', async () => {
        const user = userEvent.setup();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                commit: 'abc',
                buildDate: '2026-01-15T10:00:00Z',
                latest: null,
                updateAvailable: false,
                downloadUrl: null,
                releaseNotesUrl: null,
            }),
        });
        render(<About />);
        await waitFor(() => {
            expect(screen.getByText('Check for updates')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Check for updates'));
        // Should have called fetch twice: initial load + check
        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
        // Second call should include ?check=true
        expect(mockFetch).toHaveBeenCalledWith('/api/version?check=true');
    });

    it('handles check for updates fetch failure', async () => {
        const user = userEvent.setup();
        // Initial load succeeds
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                current: '1.0.0',
                commit: 'abc',
                buildDate: '2026-01-15T10:00:00Z',
                latest: null,
                updateAvailable: false,
                downloadUrl: null,
                releaseNotesUrl: null,
            }),
        });
        render(<About />);
        await waitFor(() => {
            expect(screen.getByText('Check for updates')).toBeInTheDocument();
        });
        // Make the check call fail
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        await user.click(screen.getByText('Check for updates'));
        // Should not crash — button should return to normal state
        await waitFor(() => {
            expect(screen.getByText('Check for updates')).toBeInTheDocument();
        });
    });

    it('does not render version section when fetch fails', async () => {
        mockFetch.mockRejectedValue(new Error('fail'));
        render(<About />);
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        expect(screen.queryByText('Check for updates')).not.toBeInTheDocument();
    });
});
