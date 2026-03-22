import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

describe('appRoot', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        // Clean up process.pkg if set
        delete (process as any).pkg;
    });

    it('exports isPackaged as false in normal mode', async () => {
        const mod = await import('../../utils/appRoot');
        expect(mod.isPackaged).toBe(false);
    });

    it('exports isPackaged as true when process.pkg is set', async () => {
        (process as any).pkg = { entrypoint: '/snapshot/server.js' };
        const mod = await import('../../utils/appRoot');
        expect(mod.isPackaged).toBe(true);
    });

    it('appRoot is exe directory when packaged', async () => {
        (process as any).pkg = { entrypoint: '/snapshot/server.js' };
        const mod = await import('../../utils/appRoot');
        expect(mod.appRoot).toBe(path.dirname(process.execPath));
    });

    it('nodeExecutable is "node" when packaged', async () => {
        (process as any).pkg = { entrypoint: '/snapshot/server.js' };
        const mod = await import('../../utils/appRoot');
        expect(mod.nodeExecutable).toBe('node');
    });

    it('exports appRoot as two levels up from __dirname', async () => {
        const mod = await import('../../utils/appRoot');
        expect(typeof mod.appRoot).toBe('string');
        expect(path.isAbsolute(mod.appRoot)).toBe(true);
    });

    it('exports distDir as a string', async () => {
        const mod = await import('../../utils/appRoot');
        expect(typeof mod.distDir).toBe('string');
    });

    it('resolveFromRoot returns absolute path unchanged', async () => {
        const mod = await import('../../utils/appRoot');
        const abs = path.resolve('/some/absolute/path');
        expect(mod.resolveFromRoot(abs)).toBe(abs);
    });

    it('resolveFromRoot joins relative segments to appRoot', async () => {
        const mod = await import('../../utils/appRoot');
        const result = mod.resolveFromRoot('prompts', 'RetrospectPrompt.md');
        expect(result).toBe(path.join(mod.appRoot, 'prompts', 'RetrospectPrompt.md'));
    });

    it('nodeExecutable equals process.execPath in normal mode', async () => {
        const mod = await import('../../utils/appRoot');
        expect(mod.nodeExecutable).toBe(process.execPath);
    });
});
