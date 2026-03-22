import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotClient } from '../../agent/CopilotClient';

vi.mock('axios', () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
    },
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

import axios from 'axios';
import * as fs from 'fs';

describe('CopilotClient', () => {
    let client: CopilotClient;

    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as any).mockReturnValue(false);
        client = new CopilotClient();
    });

    it('isAuthenticated returns false initially', async () => {
        expect(await client.isAuthenticated()).toBe(false);
    });

    describe('loadToken', () => {
        it('loads valid token from file', async () => {
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify({
                access_token: 'tok',
                expires_at: Date.now() + 3600000,
            }));
            const c = new CopilotClient();
            expect(await c.isAuthenticated()).toBe(true);
        });

        it('ignores expired token', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify({
                access_token: 'old',
                expires_at: Date.now() - 1000,
            }));
            const c = new CopilotClient();
            expect(await c.isAuthenticated()).toBe(false);
            consoleSpy.mockRestore();
        });

        it('handles corrupt token file', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue('bad json');
            const c = new CopilotClient();
            expect(await c.isAuthenticated()).toBe(false);
            consoleSpy.mockRestore();
        });
    });

    describe('homeDir fallback', () => {
        it('falls back to "." when USERPROFILE and HOME are both unset', () => {
            const origUSERPROFILE = process.env.USERPROFILE;
            const origHOME = process.env.HOME;
            delete process.env.USERPROFILE;
            delete process.env.HOME;
            try {
                const c = new CopilotClient();
                expect(c).toBeDefined();
            } finally {
                process.env.USERPROFILE = origUSERPROFILE;
                process.env.HOME = origHOME;
            }
        });
    });

    describe('startAuth', () => {
        it('initiates device flow', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { device_code: 'dc', user_code: 'UC', verification_uri: 'https://github.com/login/device' },
            });
            const result = await client.startAuth();
            expect(result.device_code).toBe('dc');
        });
    });

    describe('checkToken', () => {
        it('returns pending for authorization_pending', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'authorization_pending' },
            });
            const result = await client.checkToken('dc');
            expect(result.pending).toBe(true);
        });

        it('saves token on success', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { access_token: 'new-tok' },
            });
            const result = await client.checkToken('dc');
            expect(result.pending).toBe(false);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('throws on other errors', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'expired_token', error_description: 'Device code expired' },
            });
            await expect(client.checkToken('dc')).rejects.toThrow('Device code expired');
        });

        it('falls back to error field when error_description is absent', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'access_denied' },
            });
            await expect(client.checkToken('dc')).rejects.toThrow('access_denied');
        });
    });

    describe('getCopilotToken', () => {
        it('throws when not authenticated', async () => {
            await expect(client.getCopilotToken()).rejects.toThrow('Not authenticated');
        });

        it('gets and caches copilot token', async () => {
            // Authenticate first
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockResolvedValueOnce({
                data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() },
            });

            const token = await client.getCopilotToken();
            expect(token).toBe('ct');

            // Second call should use cache
            const token2 = await client.getCopilotToken();
            expect(token2).toBe('ct');
            expect((axios.get as any).mock.calls.length).toBe(1);
        });

        it('clears stored token on 401', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockRejectedValueOnce({ response: { status: 401 } });
            await expect(client.getCopilotToken()).rejects.toThrow('Failed to get Copilot token');
            expect(fs.unlinkSync).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('swallows errors when unlinkSync throws during 401 cleanup', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockRejectedValueOnce({ response: { status: 401 } });
            (fs.unlinkSync as any).mockImplementationOnce(() => { throw new Error('permission denied'); });
            // Should still throw the outer "Failed to get Copilot token" error, not the unlinkSync error
            await expect(client.getCopilotToken()).rejects.toThrow('Failed to get Copilot token');
            consoleSpy.mockRestore();
        });
    });

    describe('listModels', () => {
        it('returns defaults when not authenticated', async () => {
            const models = await client.listModels();
            expect(models).toContain('gpt-4');
        });

        it('fetches models from API', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any)
                .mockResolvedValueOnce({ data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() } })
                .mockResolvedValueOnce({ data: { data: [{ id: 'model-a' }] } });

            const models = await client.listModels();
            expect(models).toEqual(['model-a']);
        });

        it('falls back when API returns non-array data', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any)
                .mockResolvedValueOnce({ data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() } })
                .mockResolvedValueOnce({ data: { models: 'not-an-array' } });

            const models = await client.listModels();
            expect(models).toContain('gpt-4o');
        });

        it('caches copilot token with default expiry when expires_at missing', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockResolvedValueOnce({ data: { token: 'ct' } });
            const token = await client.getCopilotToken();
            expect(token).toBe('ct');
        });

        it('falls back to defaults on API error', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any)
                .mockResolvedValueOnce({ data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() } })
                .mockRejectedValueOnce(new Error('fail'));

            const models = await client.listModels();
            expect(models).toContain('gpt-4o');
            consoleSpy.mockRestore();
        });
    });

    describe('getGitHubUser', () => {
        it('returns null when not authenticated', async () => {
            expect(await client.getGitHubUser()).toBeNull();
        });

        it('fetches user info from GitHub API', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockResolvedValueOnce({
                data: { login: 'user1', name: 'User One', avatar_url: 'https://avatar.url' },
            });

            const user = await client.getGitHubUser();
            expect(user).toEqual({
                login: 'user1',
                name: 'User One',
                avatar_url: 'https://avatar.url',
            });
        });

        it('returns null on API error', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            (axios.get as any).mockRejectedValueOnce(new Error('network error'));
            expect(await client.getGitHubUser()).toBeNull();
            consoleSpy.mockRestore();
        });

        it('logs response.data when axios error includes response', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await client.checkToken('dc');

            const axiosError: any = new Error('request failed');
            axiosError.response = { data: { message: 'Bad credentials' } };
            (axios.get as any).mockRejectedValueOnce(axiosError);
            expect(await client.getGitHubUser()).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to fetch GitHub user:',
                { message: 'Bad credentials' },
            );
            consoleSpy.mockRestore();
        });
    });
});
