/**
 * Integration tests that validate the build pipeline, module system compatibility,
 * and server boot sequence. These catch regressions like CJS/ESM conflicts that
 * unit tests (run via Vitest's own module system) cannot detect.
 *
 * These tests are purposefully lightweight — they spawn real processes to validate
 * the actual runtime environment rather than mocking it.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Vitest resolves __dirname to the source file location (src/__tests__/integration/).
// Walk up to backend/ which is the project root containing package.json and tsconfig.
const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('integration: module system compatibility', () => {

    it('backend package.json must not set "type": "module" (tsc outputs CJS)', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf-8'));
        expect(pkg.type).not.toBe('module');
    });

    it('tsconfig.json must use CommonJS module output', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'tsconfig.json'), 'utf-8'));
        expect(tsconfig.compilerOptions.module.toLowerCase()).toBe('commonjs');
    });

    it('ESLint config files use .mjs extension (ESM-safe without type:module)', () => {
        const files = fs.readdirSync(BACKEND_ROOT).filter(f => f.startsWith('eslint') && f.endsWith('.config.js'));
        expect(files).toEqual([]);

        // At least one .mjs ESLint config must exist
        const mjsFiles = fs.readdirSync(BACKEND_ROOT).filter(f => f.startsWith('eslint') && f.endsWith('.config.mjs'));
        expect(mjsFiles.length).toBeGreaterThan(0);
    });
});

describe('integration: tsc compilation and loading', () => {

    it('tsc compiles without errors', () => {
        // Run tsc in dry-run mode (--noEmit) to verify compilation succeeds
        const result = execSync('npx tsc -p tsconfig.build.json --noEmit', {
            cwd: BACKEND_ROOT,
            encoding: 'utf-8',
            timeout: 60_000,
        });
        // tsc outputs nothing on success
        expect(result.trim()).toBe('');
    }, 60_000);

    it('compiled dist/server.js loads in Node without CJS/ESM errors', () => {
        const distServer = path.join(BACKEND_ROOT, 'dist', 'server.js');
        if (!fs.existsSync(distServer)) {
            // If dist doesn't exist, compile first
            execSync('npx tsc -p tsconfig.build.json', {
                cwd: BACKEND_ROOT,
                encoding: 'utf-8',
                timeout: 60_000,
            });
        }

        // Attempt to require the compiled output in a child process.
        // This catches CJS/ESM mismatches that Vitest wouldn't see.
        // We only test that the module loads (doesn't throw) — not that the server starts.
        const testScript = `
            process.env.VITEST = 'true';
            try {
                require(${JSON.stringify(distServer)});
                process.exit(0);
            } catch (e) {
                console.error('LOAD_ERROR:', e.message);
                process.exit(1);
            }
        `;

        const output = execSync(`node -e "${testScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            cwd: BACKEND_ROOT,
            encoding: 'utf-8',
            timeout: 30_000,
            env: { ...process.env, VITEST: 'true' },
        });

        expect(output).not.toContain('LOAD_ERROR');
    }, 120_000);
});

describe('integration: esbuild bundle', () => {

    it('esbuild produces a valid bundle from compiled output', { timeout: 30_000 }, () => {
        const distServer = path.join(BACKEND_ROOT, 'dist', 'server.js');
        if (!fs.existsSync(distServer)) return; // skip if dist not compiled

        const bundleOut = path.join(BACKEND_ROOT, 'dist', 'server.integration-test-bundle.js');
        try {
            execSync(
                `npx esbuild dist/server.js --bundle --platform=node --target=node20 --outfile=dist/server.integration-test-bundle.js --external:puppeteer`,
                { cwd: BACKEND_ROOT, encoding: 'utf-8', timeout: 60_000 },
            );

            expect(fs.existsSync(bundleOut)).toBe(true);
            const bundleSize = fs.statSync(bundleOut).size;
            expect(bundleSize).toBeGreaterThan(100_000); // bundle should be substantial

            // Verify the bundle can be loaded without module resolution errors
            const testScript = `process.env.VITEST='true'; try { require(${JSON.stringify(bundleOut)}); process.exit(0); } catch(e) { console.error('BUNDLE_LOAD_ERROR:', e.message); process.exit(1); }`;
            const output = execSync(`node -e "${testScript.replace(/"/g, '\\"')}"`, {
                cwd: BACKEND_ROOT,
                encoding: 'utf-8',
                timeout: 30_000,
                env: { ...process.env, VITEST: 'true' },
            });
            expect(output).not.toContain('BUNDLE_LOAD_ERROR');
        } finally {
            // Clean up test bundle
            if (fs.existsSync(bundleOut)) {
                fs.unlinkSync(bundleOut);
            }
        }
    });
});

describe('integration: server boot and API health', () => {

    it('key API endpoints respond with 200 (not 500)', async () => {
        // Use supertest against the in-process app (same pattern as unit tests)
        // This validates the Express route wiring is intact
        const { __testUtils } = await import('../../server');
        const request = (await import('supertest')).default;
        const api = request(__testUtils.app);

        // These are the three endpoints from the frontend Layout.tsx boot sequence
        // that all returned 500 when the CJS/ESM conflict was present
        const versionRes = await api.get('/api/version');
        expect(versionRes.status).toBe(200);
        expect(versionRes.body).toHaveProperty('current');

        const onboardingRes = await api.get('/api/onboarding/status');
        expect(onboardingRes.status).toBe(200);
        expect(onboardingRes.body).toHaveProperty('complete');

        // Auth requires a provider to be configured
        __testUtils.setActiveLlmProvider({
            type: 'fake',
            displayName: 'Fake',
            getAuthRequirement: () => ({ type: 'none' }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: () => null,
            listModels: async () => ['model-a'],
        } as any);

        const authRes = await api.get('/api/auth/status');
        expect(authRes.status).toBe(200);
        expect(authRes.body).toHaveProperty('authenticated');
    });

    it('GET /api/investigations returns paginated response', async () => {
        const { __testUtils } = await import('../../server');
        const request = (await import('supertest')).default;
        const api = request(__testUtils.app);

        const res = await api.get('/api/investigations');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('items');
        expect(res.body).toHaveProperty('totalCount');
        expect(res.body).toHaveProperty('page');
        expect(res.body).toHaveProperty('pageSize');
    });

    it('GET /api/settings returns current config', async () => {
        const { __testUtils } = await import('../../server');
        const request = (await import('supertest')).default;
        const api = request(__testUtils.app);

        const res = await api.get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('model');
    });
});
