import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotProvider } from '../../../agent/llm/providers/CopilotProvider';

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation((opts: any) => ({ _opts: opts })),
}));

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

describe('CopilotProvider', () => {
    let provider: CopilotProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as any).mockReturnValue(false);
        provider = new CopilotProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('copilot');
        expect(provider.displayName).toBe('GitHub Copilot');
    });

    it('getAuthRequirement returns oauth-device-flow', () => {
        expect(provider.getAuthRequirement()).toEqual({ type: 'oauth-device-flow' });
    });

    it('configure is a no-op', () => {
        provider.configure({ type: 'copilot' });
    });

    describe('loadToken from disk', () => {
        it('loads valid token from file', async () => {
            const tokenData = {
                access_token: 'saved-token',
                expires_at: Date.now() + 1000 * 60 * 60,
            };
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify(tokenData));

            const p = new CopilotProvider();
            // Token loaded: getAuthStatus should try to verify it
            (axios.get as any).mockResolvedValueOnce({
                data: { login: 'user', name: 'User', avatar_url: 'http://avatar' },
            });
            const status = await p.getAuthStatus();
            expect(status.authenticated).toBe(true);
            expect(status.username).toBe('user');
        });

        it('ignores expired token', async () => {
            const tokenData = {
                access_token: 'old-token',
                expires_at: Date.now() - 1000, // expired
            };
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify(tokenData));

            const p = new CopilotProvider();
            const status = await p.getAuthStatus();
            expect(status.authenticated).toBe(false);
            expect(status.requiresInteractiveFlow).toBe(true);
        });

        it('handles corrupt token file', async () => {
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue('not json');

            const p = new CopilotProvider();
            const status = await p.getAuthStatus();
            expect(status.authenticated).toBe(false);
        });

        it('loads token when expires_at is absent from token file', async () => {
            const tokenData = { access_token: 'no-expiry-token' };
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify(tokenData));

            const p = new CopilotProvider();
            (axios.get as any).mockResolvedValueOnce({
                data: { login: 'user', name: 'User', avatar_url: 'http://avatar' },
            });
            const status = await p.getAuthStatus();
            expect(status.authenticated).toBe(true);
        });
    });

    describe('constructor — homeDir fallback', () => {
        it('uses "." when both USERPROFILE and HOME are unset', () => {
            const savedProfile = process.env.USERPROFILE;
            const savedHome = process.env.HOME;
            delete process.env.USERPROFILE;
            delete process.env.HOME;
            try {
                const p = new CopilotProvider();
                expect(p).toBeDefined();
            } finally {
                if (savedProfile !== undefined) process.env.USERPROFILE = savedProfile;
                if (savedHome !== undefined) process.env.HOME = savedHome;
            }
        });
    });

    describe('startAuthFlow', () => {
        it('calls GitHub device code endpoint', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: {
                    device_code: 'dc',
                    user_code: 'UC',
                    verification_uri: 'https://github.com/login/device',
                    interval: 5,
                },
            });
            const result = await provider.startAuthFlow!();
            expect(result.deviceCode).toBe('dc');
            expect(result.userCode).toBe('UC');
            expect(result.verificationUri).toBe('https://github.com/login/device');
        });
    });

    describe('pollAuthFlow', () => {
        it('returns pending when authorization is pending', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'authorization_pending' },
            });
            const result = await provider.pollAuthFlow!('dc');
            expect(result.pending).toBe(true);
        });

        it('saves token and returns not pending on success', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { access_token: 'new-token' },
            });
            const result = await provider.pollAuthFlow!('dc');
            expect(result.pending).toBe(false);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('throws on other errors', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'expired_token', error_description: 'The device code has expired' },
            });
            await expect(provider.pollAuthFlow!('dc')).rejects.toThrow('The device code has expired');
        });

        it('throws error name if no description', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { error: 'access_denied' },
            });
            await expect(provider.pollAuthFlow!('dc')).rejects.toThrow('access_denied');
        });
    });

    describe('getAuthStatus', () => {
        it('returns unauthenticated with requiresInteractiveFlow when no token', async () => {
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(false);
            expect(status.requiresInteractiveFlow).toBe(true);
        });

        it('returns unauthenticated on GitHub API error', async () => {
            // Set up a valid token first
            (fs.existsSync as any).mockReturnValue(true);
            (fs.readFileSync as any).mockReturnValue(JSON.stringify({
                access_token: 'token', expires_at: Date.now() + 3600000,
            }));
            const p = new CopilotProvider();
            (axios.get as any).mockRejectedValueOnce(new Error('401'));
            const status = await p.getAuthStatus();
            expect(status.authenticated).toBe(false);
        });
    });

    describe('getClient', () => {
        it('throws when not authenticated', async () => {
            await expect(provider.getClient()).rejects.toThrow('Not authenticated with GitHub');
        });

        it('caches client when token and timeout match', async () => {
            // Authenticate via pollAuthFlow
            (axios.post as any).mockResolvedValueOnce({
                data: { access_token: 'tok' },
            });
            await provider.pollAuthFlow!('dc');

            // Mock getCopilotToken
            (axios.get as any).mockResolvedValue({
                data: { token: 'copilot-token', expires_at: new Date(Date.now() + 3600000).toISOString() },
            });

            const first = await provider.getClient(5000);
            const second = await provider.getClient(5000);
            expect(first).toBe(second);
        });

        it('creates new client for different timeout', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { access_token: 'tok' },
            });
            await provider.pollAuthFlow!('dc');

            (axios.get as any).mockResolvedValue({
                data: { token: 'copilot-token', expires_at: new Date(Date.now() + 3600000).toISOString() },
            });

            const first = await provider.getClient(5000);
            const second = await provider.getClient(10000);
            // Client is now cached by token only (Fix 15/17) — same token → same client
            expect(first).toBe(second);
        });
    });

    describe('getCopilotToken (via getClient)', () => {
        it('caches copilot API token', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any).mockResolvedValueOnce({
                data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() },
            });

            await provider.getClient();
            // Second call should use cached token, not call API again
            const getCallCount = (axios.get as any).mock.calls.length;
            await provider.getClient();
            expect((axios.get as any).mock.calls.length).toBe(getCallCount);
        });

        it('uses default expiry when expires_at is missing', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any).mockResolvedValueOnce({ data: { token: 'ct' } });
            const client = await provider.getClient();
            expect(client).toBeDefined();
        });

        it('clears token on 401 error', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any).mockRejectedValueOnce({ response: { status: 401 } });
            await expect(provider.getClient()).rejects.toThrow('Failed to get Copilot token');
            expect(fs.unlinkSync).toHaveBeenCalled();
        });

        it('swallows errors when unlinkSync throws during 401 cleanup', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any).mockRejectedValueOnce({ response: { status: 401 } });
            (fs.unlinkSync as any).mockImplementationOnce(() => { throw new Error('permission denied'); });
            await expect(provider.getClient()).rejects.toThrow('Failed to get Copilot token');
        });

        it('parses expires_at from Copilot API token response', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            const futureDate = new Date(Date.now() + 3600000).toISOString();
            (axios.get as any).mockResolvedValueOnce({
                data: { token: 'ct-with-expiry', expires_at: futureDate },
            });

            const client = await provider.getClient();
            expect(client).toBeDefined();
        });
    });

    describe('listModels', () => {
        it('returns defaults when no token', async () => {
            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
        });

        it('fetches models from Copilot API', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any)
                .mockResolvedValueOnce({ data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() } })
                .mockResolvedValueOnce({ data: { data: [{ id: 'model-a' }, { id: 'model-b' }] } });

            const models = await provider.listModels();
            expect(models).toEqual(['model-a', 'model-b']);
        });

        it('falls back to defaults on API error', async () => {
            (axios.post as any).mockResolvedValueOnce({ data: { access_token: 'tok' } });
            await provider.pollAuthFlow!('dc');

            (axios.get as any)
                .mockResolvedValueOnce({ data: { token: 'ct', expires_at: new Date(Date.now() + 3600000).toISOString() } })
                .mockRejectedValueOnce(new Error('fail'));

            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
        });
    });
});
