import { describe, it, expect } from 'vitest';

describe('types modules', () => {
    it('loads schedule type module', async () => {
        const module = await import('../types/schedule');
        expect(module).toBeDefined();
    });
});