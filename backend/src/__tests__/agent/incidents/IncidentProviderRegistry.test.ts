import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IncidentProviderRegistry } from '../../../agent/incidents/IncidentProviderRegistry';
import { createMockIncidentProvider } from '../../helpers/mocks';

describe('IncidentProviderRegistry', () => {
    let registry: IncidentProviderRegistry;

    beforeEach(() => {
        registry = new IncidentProviderRegistry();
    });

    describe('listTypes', () => {
        it('returns all built-in incident provider types sorted', () => {
            const types = registry.listTypes();
            expect(types).toEqual(['icm', 'manual', 'pagerduty']);
        });

        it('includes custom providers after registration', () => {
            registry.register('custom', () => createMockIncidentProvider({ type: 'custom' }));
            expect(registry.listTypes()).toContain('custom');
        });
    });

    describe('get', () => {
        it('returns a provider for known built-in types', () => {
            const provider = registry.get('manual');
            expect(provider.type).toBe('manual');
        });

        it('returns the same instance on repeated calls (singleton)', () => {
            const first = registry.get('manual');
            const second = registry.get('manual');
            expect(first).toBe(second);
        });

        it('throws for unknown provider types', () => {
            expect(() => registry.get('nonexistent')).toThrow('Unknown incident provider type: "nonexistent"');
        });

        it('returns custom providers', () => {
            const mock = createMockIncidentProvider({ type: 'custom' });
            registry.register('custom', () => mock);
            expect(registry.get('custom')).toBe(mock);
        });
    });

    describe('register', () => {
        it('invalidates cached instance when re-registering', () => {
            const first = registry.get('manual');
            const newMock = createMockIncidentProvider({ type: 'manual' });
            registry.register('manual', () => newMock);
            const second = registry.get('manual');
            expect(second).not.toBe(first);
            expect(second).toBe(newMock);
        });
    });

    describe('getConfigured', () => {
        it('gets provider and calls configure', () => {
            const mock = createMockIncidentProvider({ type: 'test' });
            registry.register('test', () => mock);
            const config = { type: 'test', apiKey: 'key' };
            const result = registry.getConfigured(config);
            expect(result).toBe(mock);
            expect(mock.configure).toHaveBeenCalledWith(config);
        });
    });

    describe('listProviders', () => {
        it('returns provider info for all types', () => {
            const providers = registry.listProviders();
            expect(providers.length).toBeGreaterThanOrEqual(3);
            const manual = providers.find(p => p.type === 'manual');
            expect(manual).toBeDefined();
            expect(manual!.displayName).toBe('Manual (no provider)');
        });
    });

    describe('reset', () => {
        it('clears cached instances', () => {
            const first = registry.get('manual');
            registry.reset();
            const second = registry.get('manual');
            expect(second).not.toBe(first);
        });
    });
});
