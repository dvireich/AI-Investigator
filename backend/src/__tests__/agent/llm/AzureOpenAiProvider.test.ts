import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AzureOpenAiProvider } from '../../../agent/llm/providers/AzureOpenAiProvider';

vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation((opts: any) => ({
            _opts: opts,
        })),
    };
});

describe('AzureOpenAiProvider', () => {
    let provider: AzureOpenAiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_ENDPOINT;
        provider = new AzureOpenAiProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('azure-openai');
        expect(provider.displayName).toBe('Azure OpenAI');
    });

    it('getAuthRequirement returns api-key-and-endpoint', () => {
        expect(provider.getAuthRequirement()).toEqual({ type: 'api-key-and-endpoint' });
    });

    it('auto-loads credentials from environment', async () => {
        process.env.AZURE_OPENAI_API_KEY = 'azure-key';
        process.env.AZURE_OPENAI_ENDPOINT = 'https://my.openai.azure.com';
        const p = new AzureOpenAiProvider();
        const status = await p.getAuthStatus();
        expect(status.authenticated).toBe(true);
        delete process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_ENDPOINT;
    });

    describe('configure', () => {
        it('sets apiKey and baseUrl', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'key', baseUrl: 'https://endpoint' });
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(true);
        });

        it('sets apiVersion', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'k', baseUrl: 'https://e', apiVersion: '2025-01-01' });
            const client = await provider.getClient();
            expect((client as any)._opts.defaultQuery).toEqual({ 'api-version': '2025-01-01' });
        });

        it('invalidates cached client', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'k1', baseUrl: 'https://e' });
            const first = await provider.getClient();
            provider.configure({ type: 'azure-openai', apiKey: 'k2', baseUrl: 'https://e' });
            const second = await provider.getClient();
            expect(first).not.toBe(second);
        });
    });

    describe('getAuthStatus', () => {
        it('returns not authenticated when missing key', async () => {
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(false);
        });

        it('returns not authenticated when missing endpoint', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'key' });
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(false);
        });
    });

    describe('getClient', () => {
        it('throws when no API key', async () => {
            await expect(provider.getClient()).rejects.toThrow('Azure OpenAI API key not configured');
        });

        it('throws when no endpoint', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'key' });
            await expect(provider.getClient()).rejects.toThrow('Azure OpenAI endpoint not configured');
        });

        it('caches client for same timeout', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'k', baseUrl: 'https://e' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(5000);
            expect(first).toBe(second);
        });

        it('creates new client for different timeout', async () => {
            provider.configure({ type: 'azure-openai', apiKey: 'k', baseUrl: 'https://e' });
            const first = await provider.getClient(5000);
            const second = await provider.getClient(10000);
            expect(first).not.toBe(second);
        });
    });

    describe('listModels', () => {
        it('returns static list of common deployment names', async () => {
            const models = await provider.listModels();
            expect(models).toContain('gpt-4o');
            expect(models).toContain('gpt-4');
        });
    });
});
