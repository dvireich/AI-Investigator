import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { ToolManager } from '../../../agent/tools/ToolManager';

const norm = (p: string) => p.replace(/\\/g, '/');
const files = new Map<string, string>();
const dirs = new Set<string>();

vi.mock('fs', () => {
    const n = (p: string) => p.replace(/\\/g, '/');
    return {
        default: {
            existsSync: vi.fn((p: string) => files.has(n(p)) || dirs.has(n(p))),
            readFileSync: vi.fn((p: string) => {
                if (!files.has(n(p))) throw new Error(`ENOENT: ${p}`);
                return files.get(n(p));
            }),
            readdirSync: vi.fn((p: string) => {
                const entries: string[] = [];
                for (const fp of files.keys()) {
                    if (fp.startsWith(n(p) + '/') && !fp.substring(n(p).length + 1).includes('/')) {
                        entries.push(fp.substring(n(p).length + 1));
                    }
                }
                for (const dp of dirs) {
                    if (dp.startsWith(n(p) + '/') && !dp.substring(n(p).length + 1).includes('/')) {
                        entries.push(dp.substring(n(p).length + 1));
                    }
                }
                return entries;
            }),
            lstatSync: vi.fn((p: string) => ({
                isDirectory: () => dirs.has(n(p)) && !files.has(n(p)),
                isFile: () => files.has(n(p)),
            })),
        },
        existsSync: vi.fn((p: string) => files.has(n(p)) || dirs.has(n(p))),
        readFileSync: vi.fn((p: string) => {
            if (!files.has(n(p))) throw new Error(`ENOENT: ${p}`);
            return files.get(n(p));
        }),
        readdirSync: vi.fn((p: string) => {
            const entries: string[] = [];
            for (const fp of files.keys()) {
                if (fp.startsWith(n(p) + '/') && !fp.substring(n(p).length + 1).includes('/')) {
                    entries.push(fp.substring(n(p).length + 1));
                }
            }
            for (const dp of dirs) {
                if (dp.startsWith(n(p) + '/') && !dp.substring(n(p).length + 1).includes('/')) {
                    entries.push(dp.substring(n(p).length + 1));
                }
            }
            return entries;
        }),
        lstatSync: vi.fn((p: string) => ({
            isDirectory: () => dirs.has(n(p)) && !files.has(n(p)),
            isFile: () => files.has(n(p)),
        })),
    };
});

// Mock McpToolBridge
const mockMcpBridge = {
    connect: vi.fn(),
    listTools: vi.fn(() => []),
    callTool: vi.fn(),
    getStatus: vi.fn(() => []),
    disconnectAll: vi.fn(),
    reconnect: vi.fn(),
};

vi.mock('../../../agent/tools/McpToolBridge', () => ({
    McpToolBridge: vi.fn().mockImplementation(() => mockMcpBridge),
}));

describe('ToolManager', () => {
    let manager: ToolManager;
    const repoRoot = norm(path.resolve('/repo'));

    beforeEach(() => {
        vi.clearAllMocks();
        files.clear();
        dirs.clear();
        mockMcpBridge.listTools.mockReturnValue([]);
        mockMcpBridge.getStatus.mockReturnValue([]);
        mockMcpBridge.connect.mockResolvedValue(undefined);
        mockMcpBridge.disconnectAll.mockResolvedValue(undefined);

        process.env.REPO_ROOT = '/repo';
        manager = new ToolManager();
        dirs.add(repoRoot);
    });

    describe('initialize', () => {
        it('initializes with no MCP servers', async () => {
            const logger = vi.fn();
            await manager.initialize([], undefined, logger);
            expect(manager.isConnected()).toBe(true);
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('No MCP servers configured'));
        });

        it('connects to MCP servers', async () => {
            mockMcpBridge.getStatus.mockReturnValue([{ name: 's', connected: true, toolCount: 2 }]);
            mockMcpBridge.listTools.mockReturnValue([{ name: 't1' }, { name: 't2' }]);

            await manager.initialize([{ name: 's', command: 'node' }], undefined, vi.fn());
            expect(mockMcpBridge.connect).toHaveBeenCalled();
            expect(manager.isConnected()).toBe(true);
        });

        it('handles all MCP servers failing', async () => {
            mockMcpBridge.connect.mockRejectedValue(new Error('fail'));
            const logger = vi.fn();
            await manager.initialize([{ name: 's', command: 'node' }], undefined, logger);
            expect(manager.initError).toContain('All MCP servers failed');
        });

        it('handles some MCP servers failing', async () => {
            mockMcpBridge.connect.mockRejectedValueOnce(new Error('fail'));
            mockMcpBridge.connect.mockResolvedValueOnce(undefined);
            mockMcpBridge.getStatus.mockReturnValue([{ name: 's2', connected: true, toolCount: 1 }]);
            mockMcpBridge.listTools.mockReturnValue([{ name: 't' }]);

            const logger = vi.fn();
            await manager.initialize(
                [{ name: 's1', command: 'bad' }, { name: 's2', command: 'good' }],
                undefined,
                logger,
            );
            expect(manager.isConnected()).toBe(true);
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('Warning'));
        });

        it('validates working directory', async () => {
            const logger = vi.fn();
            await manager.initialize([], '/nonexistent/dir', logger);
            expect(manager.initError).toContain('Working directory does not exist');
        });

        it('uses console.log as log function when no logger is provided', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            await manager.initialize([], undefined);  // no logger argument
            consoleSpy.mockRestore();
            expect(manager.isConnected()).toBe(true);
        });

        it('injects cwd into MCP server config', async () => {
            dirs.add('/workdir');
            const logger = vi.fn();
            await manager.initialize([{ name: 's', command: 'node' }], '/workdir', logger);
            expect(mockMcpBridge.connect).toHaveBeenCalled();
        });
    });

    describe('listTools', () => {
        it('returns built-in tools plus MCP tools', async () => {
            mockMcpBridge.listTools.mockReturnValue([{ name: 'mcp_tool' }]);
            await manager.initialize([], undefined, vi.fn());
            const tools = await manager.listTools();
            const names = tools.map((t: any) => t.name);
            expect(names).toContain('read_file');
            expect(names).toContain('list_dir');
            expect(names).toContain('finish');
            expect(names).toContain('invoke_subagent');
            expect(names).toContain('mcp_tool');
        });
    });

    describe('callTool', () => {
        beforeEach(async () => {
            await manager.initialize([], undefined, vi.fn());
        });

        it('handles read_file for existing file', async () => {
            const filePath = norm(path.join(repoRoot, 'test.txt'));
            files.set(filePath, 'hello world');
            const result = await manager.callTool('read_file', { path: 'test.txt' });
            expect(result).toBe('hello world');
        });

        it('handles read_file for non-existent file', async () => {
            const result = await manager.callTool('read_file', { path: 'missing.txt' });
            expect(result).toContain('File not found');
        });

        it('truncates large files', async () => {
            const filePath = norm(path.join(repoRoot, 'big.txt'));
            files.set(filePath, 'x'.repeat(60_000));
            const result = await manager.callTool('read_file', { path: 'big.txt' });
            expect(result).toContain('truncated');
        });

        it('blocks path traversal outside repo root', async () => {
            const result = await manager.callTool('read_file', { path: '/etc/passwd' });
            expect(result).toContain('Access denied');
        });

        it('reads file range with startLine and endLine', async () => {
            const filePath = norm(path.join(repoRoot, 'ranged.txt'));
            files.set(filePath, 'a\nb\nc\nd\ne');
            const result = await manager.callTool('read_file', { path: 'ranged.txt', startLine: 2, endLine: 4 });
            expect(result).toContain('[Lines 2-4 of 5]');
            expect(result).toContain('b');
            expect(result).toContain('d');
            expect(result).not.toContain('a\n');
        });

        it('reads file range with only startLine (no endLine)', async () => {
            const filePath = norm(path.join(repoRoot, 'ranged2.txt'));
            files.set(filePath, 'a\nb\nc\nd\ne');
            const result = await manager.callTool('read_file', { path: 'ranged2.txt', startLine: 3 });
            expect(result).toContain('[Lines 3-5 of 5]');
            expect(result).toContain('c');
            expect(result).toContain('e');
        });

        it('handles list_dir', async () => {
            const dirPath = norm(path.join(repoRoot, 'src'));
            dirs.add(dirPath);
            files.set(norm(path.join(dirPath, 'a.ts')), '');
            files.set(norm(path.join(dirPath, 'b.ts')), '');
            const result = await manager.callTool('list_dir', { path: 'src' });
            const parsed = JSON.parse(result);
            expect(parsed).toContain('a.ts');
        });

        it('handles list_dir for non-existent dir', async () => {
            const result = await manager.callTool('list_dir', { path: 'nope' });
            expect(result).toContain('Directory not found');
        });

        it('handles list_dir for a file (not directory)', async () => {
            const filePath = norm(path.join(repoRoot, 'file.txt'));
            files.set(filePath, 'content');
            const result = await manager.callTool('list_dir', { path: 'file.txt' });
            expect(result).toContain('not a directory');
        });

        it('handles list_dir error when lstatSync throws', async () => {
            const dirPath = norm(path.join(repoRoot, 'broken'));
            dirs.add(dirPath);
            // Make lstatSync throw for this specific path
            const fs = await import('fs');
            const origLstat = vi.mocked(fs.default.lstatSync);
            origLstat.mockImplementationOnce(() => { throw new Error('permission denied'); });
            const result = await manager.callTool('list_dir', { path: 'broken' });
            expect(result).toContain('Error listing directory');
        });

        it('handles finish tool', async () => {
            const result = await manager.callTool('finish', { summary: 'Done' });
            expect(result).toBe('Investigation marked as finished.');
        });

        it('resolves path via cwd when file not found under repo root', async () => {
            // Set repo root to the filesystem root so any cwd-relative path starts with it
            const fsRoot = norm(path.parse(process.cwd()).root);
            manager.setRepoRoot(fsRoot);
            dirs.add(fsRoot);
            await manager.initialize([], undefined, vi.fn());

            // Add file at cwd-relative location only (not at fsRoot-relative location)
            const cwdFile = norm(path.resolve('cwd-only-file.txt'));
            files.set(cwdFile, 'cwd content');

            const result = await manager.callTool('read_file', { path: 'cwd-only-file.txt' });
            expect(result).toBe('cwd content');
        });

        it('delegates unknown tools to MCP bridge', async () => {
            mockMcpBridge.callTool.mockResolvedValue({ content: [{ text: 'mcp result' }] });
            const result = await manager.callTool('mcp_query', { sql: 'SELECT 1' });
            expect(mockMcpBridge.callTool).toHaveBeenCalledWith('mcp_query', { sql: 'SELECT 1' });
        });
    });

    describe('getMcpStatus', () => {
        it('returns MCP connection status', () => {
            mockMcpBridge.getStatus.mockReturnValue([{ name: 's', connected: true, toolCount: 3 }]);
            expect(manager.getMcpStatus()).toHaveLength(1);
        });
    });

    describe('reconnectMcpServer', () => {
        it('delegates to MCP bridge', async () => {
            await manager.reconnectMcpServer('srv', vi.fn());
            expect(mockMcpBridge.reconnect).toHaveBeenCalledWith('srv', expect.anything());
        });
    });

    describe('restart', () => {
        it('disconnects all and re-initializes', async () => {
            await manager.initialize([], undefined, vi.fn());
            await manager.restart([{ name: 's', command: 'n' }], vi.fn());
            expect(mockMcpBridge.disconnectAll).toHaveBeenCalled();
        });
    });

    describe('cleanup', () => {
        it('disconnects all MCP servers', async () => {
            await manager.cleanup();
            expect(mockMcpBridge.disconnectAll).toHaveBeenCalled();
        });
    });

    describe('constructor without REPO_ROOT', () => {
        it('falls back to path.resolve when REPO_ROOT is not set', () => {
            delete process.env.REPO_ROOT;
            const m = new ToolManager();
            expect(m).toBeDefined();
        });
    });

    describe('setRepoRoot', () => {
        it('changes the repo root for file operations', async () => {
            manager.setRepoRoot('/new-root');
            await manager.initialize([], undefined, vi.fn());
            dirs.add(norm(path.resolve('/new-root')));
            const filePath = norm(path.resolve('/new-root', 'hello.txt'));
            files.set(filePath, 'hi');
            const result = await manager.callTool('read_file', { path: filePath });
            expect(result).toBe('hi');
        });
    });
});
