/**
 * Shared mock factories for backend tests.
 */
import { vi } from 'vitest';
import type { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement } from '../../agent/llm/LlmProvider';
import type { IncidentProvider, IncidentProviderConfig, IncidentData, IncidentProgressEvent } from '../../agent/incidents/IncidentProvider';

// ── LLM Provider mock ──────────────────────────────────────────────────────

export function createMockLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
        type: 'mock',
        displayName: 'Mock Provider',
        getAuthRequirement: vi.fn<() => AuthRequirement>(() => ({ type: 'none' })),
        configure: vi.fn(),
        getAuthStatus: vi.fn<() => Promise<AuthStatus>>(async () => ({ authenticated: true })),
        getClient: vi.fn(async () => ({} as any)),
        listModels: vi.fn(async () => ['mock-model']),
        ...overrides,
    };
}

// ── Incident Provider mock ─────────────────────────────────────────────────

export function createMockIncidentProvider(overrides: Partial<IncidentProvider> = {}): IncidentProvider {
    return {
        type: 'mock-incident',
        displayName: 'Mock Incident Provider',
        isAvailable: vi.fn(async () => true),
        configure: vi.fn(),
        fetchIncident: vi.fn(async (id: string) => ({
            id,
            title: `Mock Incident ${id}`,
            summary: 'Mock summary',
        })),
        ...overrides,
    };
}

// ── fs mock helpers ────────────────────────────────────────────────────────

/**
 * Creates an in-memory filesystem mock for fs operations.
 * Use with vi.mock('fs', () => createMockFs()).
 */
export function createMockFs(initialFiles: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(initialFiles));
    const dirs = new Set<string>();

    // Pre-populate directory entries from file paths
    for (const filePath of files.keys()) {
        let dir = filePath;
        while (true) {
            const parent = dir.substring(0, dir.lastIndexOf('/'));
            if (!parent || parent === dir) break;
            dirs.add(parent);
            dir = parent;
        }
    }

    return {
        existsSync: vi.fn((p: string) => files.has(p) || dirs.has(p)),
        readFileSync: vi.fn((p: string) => {
            if (!files.has(p)) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
            return files.get(p);
        }),
        writeFileSync: vi.fn((p: string, content: string) => {
            files.set(p, content);
            // Ensure parent dirs exist
            let dir = p;
            while (true) {
                const parent = dir.substring(0, dir.lastIndexOf('/'));
                if (!parent || parent === dir) break;
                dirs.add(parent);
                dir = parent;
            }
        }),
        renameSync: vi.fn((oldPath: string, newPath: string) => {
            const content = files.get(oldPath);
            if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
            files.set(newPath, content);
            files.delete(oldPath);
        }),
        mkdirSync: vi.fn((p: string) => { dirs.add(p); }),
        readdirSync: vi.fn((p: string) => {
            const entries: string[] = [];
            for (const fp of files.keys()) {
                if (fp.startsWith(p + '/') && !fp.substring(p.length + 1).includes('/')) {
                    entries.push(fp.substring(p.length + 1));
                }
            }
            for (const dp of dirs) {
                if (dp.startsWith(p + '/') && !dp.substring(p.length + 1).includes('/')) {
                    entries.push(dp.substring(p.length + 1));
                }
            }
            return entries;
        }),
        lstatSync: vi.fn((p: string) => ({
            isDirectory: () => dirs.has(p) && !files.has(p),
            isFile: () => files.has(p),
        })),
        rmSync: vi.fn((p: string) => {
            files.delete(p);
            // Delete any children if recursive
            for (const key of files.keys()) {
                if (key.startsWith(p + '/')) files.delete(key);
            }
            dirs.delete(p);
            for (const key of dirs) {
                if (key.startsWith(p + '/')) dirs.delete(key);
            }
        }),
        // Expose internal state for assertions
        _files: files,
        _dirs: dirs,
    };
}
