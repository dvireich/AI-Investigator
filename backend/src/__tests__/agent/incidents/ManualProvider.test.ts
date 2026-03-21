import { describe, it, expect } from 'vitest';
import { ManualProvider } from '../../../agent/incidents/providers/ManualProvider';

describe('ManualProvider', () => {
    it('has correct type and displayName', () => {
        const provider = new ManualProvider();
        expect(provider.type).toBe('manual');
        expect(provider.displayName).toBe('Manual (no provider)');
    });

    it('configure is a no-op', () => {
        const provider = new ManualProvider();
        // Should not throw
        provider.configure({ type: 'manual' });
    });

    it('isAvailable returns false', async () => {
        const provider = new ManualProvider();
        expect(await provider.isAvailable()).toBe(false);
    });

    it('fetchIncident returns a manual incident with the given id', async () => {
        const provider = new ManualProvider();
        const result = await provider.fetchIncident('42');
        expect(result).toEqual({
            id: '42',
            title: 'Manual Incident 42',
            summary: 'No incident provider configured. Please fill in investigation details manually.',
        });
    });
});
