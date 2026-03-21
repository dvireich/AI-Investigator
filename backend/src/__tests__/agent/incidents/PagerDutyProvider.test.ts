import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PagerDutyProvider } from '../../../agent/incidents/providers/PagerDutyProvider';

describe('PagerDutyProvider', () => {
    let provider: PagerDutyProvider;

    beforeEach(() => {
        provider = new PagerDutyProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('pagerduty');
        expect(provider.displayName).toBe('PagerDuty');
    });

    describe('configure', () => {
        it('sets apiKey', async () => {
            provider.configure({ type: 'pagerduty', apiKey: 'test-key' });
            expect(await provider.isAvailable()).toBe(true);
        });

        it('sets baseUrl', () => {
            provider.configure({ type: 'pagerduty', baseUrl: 'https://custom.pagerduty.com' });
        });
    });

    describe('isAvailable', () => {
        it('returns false when no API key', async () => {
            expect(await provider.isAvailable()).toBe(false);
        });

        it('returns true when API key is set', async () => {
            provider.configure({ type: 'pagerduty', apiKey: 'key' });
            expect(await provider.isAvailable()).toBe(true);
        });
    });

    describe('fetchIncident', () => {
        it('throws when no API key', async () => {
            await expect(provider.fetchIncident('123')).rejects.toThrow('PagerDuty API key not configured');
        });

        it('throws not yet implemented', async () => {
            provider.configure({ type: 'pagerduty', apiKey: 'key' });
            const onProgress = vi.fn();
            await expect(provider.fetchIncident('123', onProgress)).rejects.toThrow('not yet implemented');
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress' }));
        });
    });
});
