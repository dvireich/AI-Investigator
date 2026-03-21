import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OllamaProvider } from '../../../agent/llm/providers/OllamaProvider';

vi.mock('openai', () => {
    return {
        default: vi.fn().mockImplementation((opts: any) => ({
            _opts: opts,
        })),
    };
});

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
    },
}));

import axios from 'axios';

describe('OllamaProvider', () => {
    let provider: OllamaProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.OLLAMA_BASE_URL;
        provider = new OllamaProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('ollama');
        expect(provider.displayName).toBe('Ollama (Local)');
    });

    it('getAuthRequirement returns none', () => {
        expect(provider.getAuthRequirement()).toEqual({ type: 'none' });
    });

    it('auto-loads base URL from environment', () => {
        process.env.OLLAMA_BASE_URL = 'http://custom:11434/v1';
        const p = new OllamaProvider();
        expect(p.type).toBe('ollama');
        delete process.env.OLLAMA_BASE_URL;
    });

    describe('configure', () => {
        it('sets baseUrl', async () => {
            provider.configure({ type: 'ollama', baseUrl: 'http://custom:11434/v1' });
            const client = await provider.getClient();
            expect((client as any)._opts.baseURL).toBe('http://custom:11434/v1');
        });

        it('invalidates cached client', async () => {
            const first = await provider.getClient();
            provider.configure({ type: 'ollama', baseUrl: 'http://other:11434/v1' });
            const second = await provider.getClient();
            expect(first).not.toBe(second);
        });
    });

    describe('getAuthStatus', () => {
        it('returns authenticated when Ollama is running', async () => {
            (axios.get as any).mockResolvedValueOnce({ data: 'Ollama is running' });
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(true);
            expect(status.displayName).toBe('Ollama (running)');
        });

        it('returns not authenticated when Ollama is not running', async () => {
            (axios.get as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));
            const status = await provider.getAuthStatus();
            expect(status.authenticated).toBe(false);
            expect(status.displayName).toBe('Ollama (not running)');
        });
    });

    describe('getClient', () => {
        it('returns client with dummy API key', async () => {
            const client = await provider.getClient();
            expect((client as any)._opts.apiKey).toBe('ollama');
        });

        it('uses longer default timeout for local models', async () => {
            const client = await provider.getClient();
            expect((client as any)._opts.timeout).toBe(300_000);
        });

        it('caches client for same timeout', async () => {
            const first = await provider.getClient(5000);
            const second = await provider.getClient(5000);
            expect(first).toBe(second);
        });

        it('creates new client for different timeout', async () => {
            const first = await provider.getClient(5000);
            const second = await provider.getClient(10000);
            expect(first).not.toBe(second);
        });
    });

    describe('listModels', () => {
        it('fetches models from Ollama API', async () => {
            (axios.get as any).mockResolvedValueOnce({
                data: { models: [{ name: 'llama3' }, { name: 'mistral' }] },
            });
            const models = await provider.listModels();
            expect(models).toEqual(['llama3', 'mistral']);
        });

        it('returns empty array when Ollama is not running', async () => {
            (axios.get as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));
            const models = await provider.listModels();
            expect(models).toEqual([]);
        });

        it('returns empty array when response has no models', async () => {
            (axios.get as any).mockResolvedValueOnce({ data: {} });
            const models = await provider.listModels();
            expect(models).toEqual([]);
        });
    });
});
