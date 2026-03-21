import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmProviderRegistry } from '../../../agent/llm/LlmProviderRegistry';
import { createMockLlmProvider } from '../../helpers/mocks';

describe('LlmProviderRegistry', () => {
    let registry: LlmProviderRegistry;

    beforeEach(() => {
        registry = new LlmProviderRegistry();
    });

    describe('listTypes', () => {
        it('returns all built-in provider types sorted', () => {
            const types = registry.listTypes();
            expect(types).toEqual(['anthropic', 'azure-openai', 'copilot', 'ollama', 'openai']);
        });

        it('includes custom providers after registration', () => {
            registry.register('custom', () => createMockLlmProvider({ type: 'custom' }));
            const types = registry.listTypes();
            expect(types).toContain('custom');
        });
    });

    describe('get', () => {
        it('returns a provider for known built-in types', () => {
            const provider = registry.get('openai');
            expect(provider.type).toBe('openai');
        });

        it('returns the same instance on repeated calls (singleton)', () => {
            const first = registry.get('openai');
            const second = registry.get('openai');
            expect(first).toBe(second);
        });

        it('throws for unknown provider types', () => {
            expect(() => registry.get('nonexistent')).toThrow('Unknown LLM provider type: "nonexistent"');
        });

        it('returns custom providers', () => {
            const mock = createMockLlmProvider({ type: 'custom', displayName: 'Custom' });
            registry.register('custom', () => mock);
            const result = registry.get('custom');
            expect(result).toBe(mock);
        });
    });

    describe('register', () => {
        it('invalidates cached instance when re-registering', () => {
            const first = registry.get('openai');
            const mockFactory = vi.fn(() => createMockLlmProvider({ type: 'openai' }));
            registry.register('openai', mockFactory);
            const second = registry.get('openai');
            expect(second).not.toBe(first);
            expect(mockFactory).toHaveBeenCalled();
        });
    });

    describe('getConfigured', () => {
        it('gets provider and calls configure', () => {
            const mock = createMockLlmProvider({ type: 'test' });
            registry.register('test', () => mock);
            const config = { type: 'test', apiKey: 'key123' };
            const result = registry.getConfigured(config);
            expect(result).toBe(mock);
            expect(mock.configure).toHaveBeenCalledWith(config);
        });
    });

    describe('listProviders', () => {
        it('returns provider info for all types', () => {
            const providers = registry.listProviders();
            expect(providers.length).toBeGreaterThanOrEqual(5);
            const openai = providers.find(p => p.type === 'openai');
            expect(openai).toBeDefined();
            expect(openai!.displayName).toBe('OpenAI');
            expect(openai!.authRequirement).toEqual({ type: 'api-key', envVar: 'OPENAI_API_KEY' });
        });
    });

    describe('reset', () => {
        it('clears cached instances', () => {
            const first = registry.get('openai');
            registry.reset();
            const second = registry.get('openai');
            expect(second).not.toBe(first);
        });
    });
});
