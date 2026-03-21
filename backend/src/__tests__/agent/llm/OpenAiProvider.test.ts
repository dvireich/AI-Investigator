import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAiProvider } from '../../../agent/llm/providers/OpenAiProvider';

vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation((opts: any) => ({
            _opts: opts,
            models: {
                list: vi.fn().mockReturnValue({
                    [Symbol.asyncIterator]: async function* () {
                        yield { id: 'gpt-4o' };
                        yield { id: 'gpt-3.5-turbo' };
                        yield { id: 'dall-e-3' }; // should be filtered out
                    }
                }),
            },
        })),
    };
});

describe('OpenAiProvider', () => {
    let provider: OpenAiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.OPENAI_API_KEY;
        provider = new OpenAiProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('openai');
        expect(provider.displayName).toBe('OpenAI');
    });

    it('getAuthRequirement returns api-key', () => {
        expect(provider.getAuthRequirement()).toEqual({ type: 'api-key', envVar: 'OPENAI_API_KEY' });
    });

    it('auto-loads API key from environment', async () => {
        process.env.OPENAI_API_KEY = 'test-key';
        const p = new OpenAiProvider();
        await expect(p.getAuthStatus()).resolves.toEqual({ authenticated: true, displayName: 'OpenAI API Key' });
        delete process.env.OPENAI_API_KEY;
    });

    describe('configure', () => {
        it('sets apiKey', async () => {
            provider.configure({ type: 'openai', apiKey: 'new-key' });
            await expect(provider.getAuthStatus()).resolves.toEqual({ authenticated: true, displayName: 'OpenAI API Key' });
        });

        it('sets baseUrl', async () => {
            provider.configure({ type: 'openai', apiKey: 'key', baseUrl: 'https://custom.api.com' });
            const client = await provider.getClient();
            expect((client as any)._opts.baseURL).toBe('https://custom.api.com');
        });

        it('invalidates cached client', async () => {
            provider.configure({ type: 'openai', apiKey: 'key1' });
            const first = await provider.getClient();
            provider.configure({ type: 'openai', apiKey: 'key2' });
            const second = await provider.getClient();
            expect(first).not.toBe(second);
        });
    });

    describe('getAuthStatus', () => {
        it('returns not authenticated when no key', async () => {
            expect(await provider.getAuthStatus()).toEqual({ authenticated: false, displayName: 'OpenAI API Key' });
        });
    });

    describe('getClient', () => {
        it('throws when no API key configured', async () => {
            await expect(provider.getClient()).rejects.toThrow('OpenAI API key not configured');
        });

        it('returns OpenAI client with configured key', async () => {
            provider.configure({ type: 'openai', apiKey: 'test-key' });
            const client = await provider.getClient();
            expect(client).toBeDefined();
        });

        it('caches client for same timeout', async () => {
            provider.configure({ type: 'openai', apiKey: 'key' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(5000);
            expect(first).toBe(second);
        });

        it('creates new client for different timeout', async () => {
            provider.configure({ type: 'openai', apiKey: 'key' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(10000);
            expect(first).not.toBe(second);
        });
    });

    describe('listModels', () => {
        it('returns default list when no API key', async () => {
            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
        });

        it('fetches and filters models from API', async () => {
            provider.configure({ type: 'openai', apiKey: 'key' });
            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
            expect(models).toContain('gpt-3.5-turbo');
            expect(models).not.toContain('dall-e-3');
        });

        it('falls back to defaults on API error', async () => {
            provider.configure({ type: 'openai', apiKey: 'key' });
            // Override the mock to throw
            const client = await provider.getClient();
            (client.models.list as any).mockReturnValueOnce({
                [Symbol.asyncIterator]: async function* () { throw new Error('API error'); }
            });
            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
        });
    });
});
