import { describe, it, expect } from 'vitest';

describe('types modules', () => {
    it('loads the types barrel module', async () => {
        const module = await import('../types');
        expect(module).toBeDefined();
    });

    it('loads product type module', async () => {
        const module = await import('../types/product');
        expect(module).toBeDefined();
    });

    it('loads schedule type module', async () => {
        const module = await import('../types/schedule');
        expect(module).toBeDefined();
    });
});