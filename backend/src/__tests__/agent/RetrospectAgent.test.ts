import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RetrospectAgent } from '../../agent/RetrospectAgent';

describe('RetrospectAgent', () => {
    let agent: RetrospectAgent;
    let tmpDir: string;

    beforeEach(() => {
        agent = new RetrospectAgent();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws when investigation log not found', async () => {
        // Write an unrelated file
        fs.writeFileSync(path.join(tmpDir, 'other-file.json'), '{}');
        await expect(agent.runRetrospect('inv-123', tmpDir)).rejects.toThrow('Investigation log not found');
    });

    it('generates retrospection from investigation log', async () => {
        const logData = { status: 'completed', thoughts: [1, 2, 3] };
        fs.writeFileSync(path.join(tmpDir, 'inv-123.json'), JSON.stringify(logData));

        const result = await agent.runRetrospect('inv-123', tmpDir);
        expect(result).toContain('Retrospection on Investigation inv-123');
        expect(result).toContain('3 steps');
        expect(result).toContain("'completed'");

        // Verify retrospect file was created
        const retroFile = path.join(tmpDir, 'inv-123-retrospect.md');
        expect(fs.existsSync(retroFile)).toBe(true);
        expect(fs.readFileSync(retroFile, 'utf-8')).toContain('Retrospection');
    });
});
