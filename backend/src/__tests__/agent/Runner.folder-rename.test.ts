import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Lightweight ToolManager stub - Runner construction touches it but our tests
// never run an investigation, only invoke folder-resolution helpers + saveArtifacts.
vi.mock('../../agent/tools/ToolManager', () => ({
    ToolManager: vi.fn(() => ({
        isConnected: vi.fn(() => true),
        setRepoRoot: vi.fn(),
        initialize: vi.fn(),
        listTools: vi.fn(async () => []),
        callTool: vi.fn(async () => ''),
        getMcpStatus: vi.fn(() => []),
        cleanup: vi.fn(async () => {}),
        initError: null,
    })),
}));

// IMPORTANT: this test file uses REAL fs, unlike Runner.test.ts which mocks fs.
// We test the folder-rename behaviour against a temporary directory on disk so
// fsp.readdir(..., { withFileTypes: true }) returns proper Dirent objects.
import { AgentRunner, AgentConfig } from '../../agent/Runner';

function makeProvider() {
    return {
        id: 'test',
        displayName: 'TestLLM',
        getAuthStatus: vi.fn(async () => ({ authenticated: true })),
        getClient: vi.fn(async () => ({})),
        configure: vi.fn(),
        listModels: vi.fn(async () => ['test-model']),
    } as any;
}

function makeConfig(investigationsPath: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        systemPromptPath: path.join(investigationsPath, '..', 'system.md'),
        mcpServers: [],
        maxSteps: 1,
        model: 'test-model',
        workingDirectory: investigationsPath,
        investigationsPath,
        repoRoot: investigationsPath,
        ...overrides,
    };
}

describe('AgentRunner - investigation folder lifecycle (Fix #1: dedup + Fix #2: target back-fill via rename)', () => {
    let tmpRoot: string;
    let investigationsPath: string;

    beforeEach(async () => {
        tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-inv-runner-folder-'));
        investigationsPath = path.join(tmpRoot, 'investigations');
        await fsp.mkdir(investigationsPath, { recursive: true });
        // The system prompt file is read on first start() but we don't call start() here.
        await fsp.writeFile(path.join(tmpRoot, 'system.md'), 'system prompt');
    });

    afterEach(async () => {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
    });

    it('saveArtifacts creates exactly one folder per investigation id', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
        });
        await (runner as any).saveArtifacts();
        await (runner as any).saveArtifacts();

        const entries = await fsp.readdir(investigationsPath, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory());
        expect(dirs).toHaveLength(1);
        expect(dirs[0].name).toMatch(/_alpha_1700000000000$/);
    });

    it('renames the existing folder when target changes (no duplicate created)', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: '', // simulate incident-driven flow with unknown target
        });
        await (runner as any).saveArtifacts();

        let entries = await fsp.readdir(investigationsPath, { withFileTypes: true });
        let dirs = entries.filter(e => e.isDirectory());
        expect(dirs).toHaveLength(1);
        expect(dirs[0].name).toContain('UnknownTarget');

        // Tenant becomes known later (e.g. via title back-fill or a second call)
        (runner as any).state.target = 'oi-tds-prd-ea-02';
        await (runner as any).saveArtifacts();

        entries = await fsp.readdir(investigationsPath, { withFileTypes: true });
        dirs = entries.filter(e => e.isDirectory());
        expect(dirs).toHaveLength(1);
        expect(dirs[0].name).toContain('oi-tds-prd-ea-02');
        expect(dirs[0].name).not.toContain('UnknownTarget');
        expect(dirs[0].name).toMatch(/_1700000000000$/);
    });

    it('renames the existing folder when title is set later', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
        });
        await (runner as any).saveArtifacts();

        (runner as any).state.title = 'My Investigation Title';
        await (runner as any).saveArtifacts();

        const entries = await fsp.readdir(investigationsPath, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory());
        expect(dirs).toHaveLength(1);
        expect(dirs[0].name).toContain('My-Investigation-Title');
    });

    it('falls back to the existing folder when rename fails (e.g. desired path already exists)', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
        });
        await (runner as any).saveArtifacts();

        // Pre-create a directory at the desired post-rename name so rename fails on Windows.
        (runner as any).state.target = 'beta';
        const desiredName = (runner as any).computeInvestigationFolderName();
        const desiredDir = path.join(investigationsPath, desiredName);
        await fsp.mkdir(desiredDir, { recursive: true });
        await fsp.writeFile(path.join(desiredDir, 'placeholder.txt'), 'unrelated');

        // Should not throw — falls back to writing into the existing _<id> folder.
        await expect((runner as any).saveArtifacts()).resolves.not.toThrow();

        // Both directories still exist (we didn't remove the placeholder), but
        // saveArtifacts wrote into the *original* one rather than corrupting the placeholder.
        const placeholderStillThere = await fsp.readFile(path.join(desiredDir, 'placeholder.txt'), 'utf8');
        expect(placeholderStillThere).toBe('unrelated');
    });

    it('findInvestigationDirById finds folder by _<safeId> suffix', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
        });
        await (runner as any).saveArtifacts();

        const found = await (runner as any).findInvestigationDirById(investigationsPath);
        expect(found).toBeTruthy();
        expect(path.basename(found)).toMatch(/_1700000000000$/);
    });

    it('findInvestigationDirById returns undefined when baseDir is missing', async () => {
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
        });
        const missingDir = path.join(tmpRoot, 'does-not-exist');
        const found = await (runner as any).findInvestigationDirById(missingDir);
        expect(found).toBeUndefined();
    });

    it('restoreToLastCheckpoint reloads fullHistory from disk via findInvestigationDirById', async () => {
        // Seed: write a state.json containing fullHistory (with a contest marker) inside
        // an existing folder under the id-suffix naming scheme.
        // Layout matches the production restore code: contestIndex + 2 must point at the
        // CONTESTED REPORT message that wraps the rejected-report markers.
        const contestMessage = [
            'CONTESTED REPORT (attempt #1)',
            '--- REJECTED REPORT START ---',
            '## Restored Report',
            'body',
            '--- REJECTED REPORT END ---',
            'User feedback: please reconsider',
        ].join('\n');
        const fullHistory = [
            'Initial thought',
            'Observation: Report Generated.',
            'Report Contested: please reconsider',
            'System: Report contested (attempt #1).',
            contestMessage,
            'Post-contest thought',
        ];
        const seedRunner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
            status: 'completed',
            contestCount: 1,
            fullHistory,
            fullActions: fullHistory.map(() => null) as any,
        });
        await (seedRunner as any).saveArtifacts();

        // Now simulate a fresh load: same id but fullHistory cleared from RAM.
        const runner = new AgentRunner(makeConfig(investigationsPath), makeProvider(), {
            id: '1700000000000',
            target: 'alpha',
            status: 'completed',
            contestCount: 1,
            fullHistory: [],
            fullActions: [],
            finalReport: 'replaced report',
        });
        // Stub recommendation extraction (LLM not available in this test).
        vi.spyOn(runner as any, 'extractRecommendations').mockResolvedValue([]);

        await runner.restoreToLastCheckpoint();

        // The reloaded fullHistory + contest scan + report extraction should have produced
        // a finalReport equal to the one inside the REJECTED REPORT markers.
        expect((runner as any).state.finalReport).toBe('## Restored Report\nbody');
        expect((runner as any).state.contestCount).toBe(0);
    });
});
