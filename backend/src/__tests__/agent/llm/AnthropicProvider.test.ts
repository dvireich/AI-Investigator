import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from '../../../agent/llm/providers/AnthropicProvider';

vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation((opts: any) => ({
            _opts: opts,
        })),
    };
});

describe('AnthropicProvider', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ANTHROPIC_API_KEY;
        provider = new AnthropicProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('anthropic');
        expect(provider.displayName).toBe('Anthropic (Claude)');
    });

    it('getAuthRequirement returns api-key with envVar', () => {
        expect(provider.getAuthRequirement()).toEqual({ type: 'api-key', envVar: 'ANTHROPIC_API_KEY' });
    });

    it('auto-loads API key from environment', async () => {
        process.env.ANTHROPIC_API_KEY = 'test-key';
        const p = new AnthropicProvider();
        const status = await p.getAuthStatus();
        expect(status.authenticated).toBe(true);
        delete process.env.ANTHROPIC_API_KEY;
    });

    describe('configure', () => {
        it('sets apiKey', async () => {
            provider.configure({ type: 'anthropic', apiKey: 'key' });
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(true);
        });

        it('sets baseUrl', async () => {
            provider.configure({ type: 'anthropic', apiKey: 'key', baseUrl: 'https://custom' });
            const client = await provider.getClient();
            expect((client as any)._opts.baseURL).toBe('https://custom');
        });

        it('invalidates cached client', async () => {
            provider.configure({ type: 'anthropic', apiKey: 'k1' });
            const first = await provider.getClient();
            provider.configure({ type: 'anthropic', apiKey: 'k2' });
            const second = await provider.getClient();
            expect(first).not.toBe(second);
        });
    });

    describe('getAuthStatus', () => {
        it('returns not authenticated when no key', async () => {
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(false);
        });
    });

    describe('getClient', () => {
        it('throws when no API key', async () => {
            await expect(provider.getClient()).rejects.toThrow('Anthropic API key not configured');
        });

        it('caches client for same timeout', async () => {
            provider.configure({ type: 'anthropic', apiKey: 'k' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(5000);
            expect(first).toBe(second);
        });

        it('creates new client for different timeout', async () => {
            provider.configure({ type: 'anthropic', apiKey: 'k' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(10000);
            expect(first).not.toBe(second);
        });
    });

    describe('listModels', () => {
        it('returns static list of Claude models', async () => {
            const models = await provider.listModels();
            expect(models.length).toBeGreaterThanOrEqual(4);
            expect(models.some(m => m.includes('claude'))).toBe(true);
        });
    });
});
