import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IcmProvider } from '../../../agent/incidents/providers/IcmProvider';
import { EventEmitter } from 'events';

vi.mock('fs', () => ({
    existsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

import * as fs from 'fs';
import { spawn } from 'child_process';

function createMockChild() {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdio = ['ignore', child.stdout, child.stderr];
    return child;
}

describe('IcmProvider', () => {
    let provider: IcmProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new IcmProvider();
    });

    it('has correct type and displayName', () => {
        expect(provider.type).toBe('icm');
        expect(provider.displayName).toBe('Microsoft IcM');
    });

    describe('configure', () => {
        it('sets scriptsPath', () => {
            provider.configure({ type: 'icm', scriptsPath: '/path/to/scripts' });
        });
    });

    describe('isAvailable', () => {
        it('returns false when no scriptsPath configured', async () => {
            expect(await provider.isAvailable()).toBe(false);
        });

        it('returns false when script file does not exist', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(false);
            expect(await provider.isAvailable()).toBe(false);
        });

        it('returns true when script file exists', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);
            expect(await provider.isAvailable()).toBe(true);
        });
    });

    describe('fetchIncident', () => {
        it('throws when no scriptsPath', async () => {
            await expect(provider.fetchIncident('123')).rejects.toThrow('IcM scripts path not configured');
        });

        it('throws for invalid incident ID format (Fix 23)', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            await expect(provider.fetchIncident('../../etc/passwd')).rejects.toThrow('Invalid incident ID format');
            await expect(provider.fetchIncident('id with spaces')).rejects.toThrow('Invalid incident ID format');
        });

        it('throws when script file not found', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(false);
            await expect(provider.fetchIncident('123')).rejects.toThrow('IcM script not found');
        });

        it('parses stdout data events into incident', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const onProgress = vi.fn();
            const promise = provider.fetchIncident('42', onProgress);

            // Emit metadata and content
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"Outage","severity":"Sev2","status":"Active","owner":"alice","owningTeam":"SRE","created":"2024-01-01T00:00:00Z","mitigatedAt":"2024-01-01T01:00:00Z","owningService":"my-service","summary":"Things broke"}}\n'
            ));
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"content","value":"Full incident details..."}\n'
            ));
            child.stdout.emit('data', Buffer.from(
                '[PROGRESS] {"step":"scrape","status":"done"}\n'
            ));

            // Close with success
            child.emit('close', 0);

            const result = await promise;
            expect(result.id).toBe('42');
            expect(result.title).toBe('Outage');
            expect(result.severity).toBe('Sev2');
            expect(result.target).toBe('my-service');
            expect(result.timeRange).toContain('2024-01-01T00:00:00Z');
            expect(result.content).toBe('Full incident details...');
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'data' }));
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress' }));
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }));
        });

        it('handles script exit with error code', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stderr.emit('data', Buffer.from('Script crashed'));
            child.emit('close', 1);

            await expect(promise).rejects.toThrow('IcM script failed (exit 1)');
        });

        it('handles spawn error', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.emit('error', new Error('command not found'));

            await expect(promise).rejects.toThrow('Failed to spawn IcM script');
        });

        it('handles malformed progress/data lines', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from('[PROGRESS] not json\n'));
            child.stdout.emit('data', Buffer.from('[DATA] not json\n'));
            child.stdout.emit('data', Buffer.from('random line\n'));
            child.stdout.emit('data', Buffer.from('[DATA] {"key":"metadata","value":{"title":"Test"}}\n'));
            child.emit('close', 0);

            const result = await promise;
            expect(result.title).toBe('Test');
        });

        it('uses default title when metadata has no title and exit is 0', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.emit('close', 0);

            const result = await promise;
            expect(result.title).toBe('IcM Incident 42');
        });

        it('uses impactingFrom for time range when available', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"T","impactingFrom":"2024-06-01T00:00:00Z","created":"2024-05-31T00:00:00Z"}}\n'
            ));
            child.emit('close', 0);

            const result = await promise;
            expect(result.timeRange).toContain('2024-06-01T00:00:00Z');
        });

        it('uses impactedService when owningService is absent', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"T","impactedService":"svc-b"}}\n'
            ));
            child.emit('close', 0);

            const result = await promise;
            expect(result.target).toBe('svc-b');
        });

        it('times out hung child process after 5 minutes', async () => {
            vi.useFakeTimers();
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            child.kill = vi.fn();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            // Advance past the 5-minute timeout
            vi.advanceTimersByTime(5 * 60 * 1000 + 100);

            await expect(promise).rejects.toThrow('IcM script timed out after 5 minutes for incident 42');
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
            vi.useRealTimers();
        });

        it('truncates content larger than 1 MB', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            const bigContent = 'x'.repeat(1_100_000);
            child.stdout.emit('data', Buffer.from(
                `[DATA] ${JSON.stringify({ key: 'content', value: bigContent })}\n`
            ));
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"Big"}}\n'
            ));
            child.emit('close', 0);

            const result = await promise;
            expect(result.content!.length).toBeLessThan(bigContent.length);
            expect(result.content).toContain('... [content truncated]');
        });

        it('JSON-stringifies non-string content values', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"content","value":{"nested":"data"}}\n'
            ));
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"T"}}\n'
            ));
            child.emit('close', 0);

            const result = await promise;
            expect(result.content).toBe('{"nested":"data"}');
        });

        it('ignores close after timeout (settled guard)', async () => {
            vi.useFakeTimers();
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            child.kill = vi.fn();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            vi.advanceTimersByTime(5 * 60 * 1000 + 100);
            // Now emit close — should be ignored since settled=true
            child.emit('close', 0);

            await expect(promise).rejects.toThrow('timed out');
            vi.useRealTimers();
        });

        it('ignores error after close (settled guard)', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"T"}}\n'
            ));
            child.emit('close', 0);
            // Error fires after close — should be ignored
            child.emit('error', new Error('late error'));

            const result = await promise;
            expect(result.title).toBe('T');
        });

        it('catches kill failure during timeout', async () => {
            vi.useFakeTimers();
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            child.kill = vi.fn(() => { throw new Error('kill failed'); });
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            vi.advanceTimersByTime(5 * 60 * 1000 + 100);

            await expect(promise).rejects.toThrow('timed out');
            vi.useRealTimers();
        });

        it('resolves with title when exit code is non-zero but metadata has title', async () => {
            provider.configure({ type: 'icm', scriptsPath: '/scripts' });
            (fs.existsSync as any).mockReturnValue(true);

            const child = createMockChild();
            (spawn as any).mockReturnValue(child);

            const promise = provider.fetchIncident('42');
            child.stdout.emit('data', Buffer.from(
                '[DATA] {"key":"metadata","value":{"title":"Partial Data"}}\n'
            ));
            child.emit('close', 1); // non-zero exit but has title

            const result = await promise;
            expect(result.title).toBe('Partial Data');
        });
    });
});
