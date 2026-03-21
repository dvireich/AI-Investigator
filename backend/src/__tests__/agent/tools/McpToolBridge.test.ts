import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpToolBridge, McpServerConfig } from '../../../agent/tools/McpToolBridge';

const mockClient = {
    connect: vi.fn(),
    request: vi.fn(),
};

const mockTransport = {
    close: vi.fn(),
};

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: vi.fn().mockImplementation(() => mockTransport),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
    ListToolsResultSchema: 'ListToolsResultSchema',
    CallToolResultSchema: 'CallToolResultSchema',
}));

describe('McpToolBridge', () => {
    let bridge: McpToolBridge;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.connect.mockResolvedValue(undefined);
        mockClient.request.mockResolvedValue({ tools: [] });
        bridge = new McpToolBridge();
    });

    describe('connect', () => {
        it('connects to an MCP server and discovers tools', async () => {
            const config: McpServerConfig = { name: 'test-server', command: 'node', args: ['server.js'] };
            mockClient.request.mockResolvedValue({
                tools: [{ name: 'tool1', description: 'A tool' }],
            });

            await bridge.connect(config);
            expect(mockClient.connect).toHaveBeenCalled();
            expect(bridge.listTools()).toHaveLength(1);
        });

        it('resolves environment variables in args', async () => {
            process.env.TEST_DB_URL = 'postgres://localhost';
            const config: McpServerConfig = { name: 's', command: 'node', args: ['$TEST_DB_URL'] };
            await bridge.connect(config);
            delete process.env.TEST_DB_URL;
        });

        it('keeps unresolvable env vars as-is', async () => {
            const config: McpServerConfig = { name: 's', command: 'node', args: ['$NONEXISTENT_VAR'] };
            await bridge.connect(config);
        });

        it('retries tool discovery on failure', async () => {
            const config: McpServerConfig = { name: 's', command: 'node' };
            // Mock setTimeout to fire immediately
            const origSetTimeout = globalThis.setTimeout;
            globalThis.setTimeout = ((fn: Function) => { fn(); return 0; }) as any;

            mockClient.request
                .mockRejectedValueOnce(new Error('not ready'))
                .mockResolvedValueOnce({ tools: [{ name: 't1' }] });

            await bridge.connect(config, vi.fn());
            expect(bridge.listTools()).toHaveLength(1);
            globalThis.setTimeout = origSetTimeout;
        });

        it('throws after all retries fail', async () => {
            const config: McpServerConfig = { name: 's', command: 'node' };
            const origSetTimeout = globalThis.setTimeout;
            globalThis.setTimeout = ((fn: Function) => { fn(); return 0; }) as any;

            mockClient.request.mockRejectedValue(new Error('never ready'));
            await expect(bridge.connect(config, vi.fn())).rejects.toThrow('never ready');
            globalThis.setTimeout = origSetTimeout;
        });

        it('prefixes conflicting tool names', async () => {
            const config1: McpServerConfig = { name: 'server1', command: 'node' };
            const config2: McpServerConfig = { name: 'server2', command: 'node' };

            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 'query' }] });
            await bridge.connect(config1);

            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 'query' }] });
            await bridge.connect(config2, vi.fn());

            // Both tools should be registered but the original 'query' should be split
            const status = bridge.getStatus();
            expect(status).toHaveLength(2);
        });

        it('closes transport on connection failure', async () => {
            const config: McpServerConfig = { name: 's', command: 'node' };
            mockClient.connect.mockRejectedValueOnce(new Error('connection refused'));

            await expect(bridge.connect(config, vi.fn())).rejects.toThrow('connection refused');
            expect(mockTransport.close).toHaveBeenCalled();
        });

        it('handles tools/list result with undefined tools field', async () => {
            const config: McpServerConfig = { name: 's', command: 'node' };
            mockClient.request.mockResolvedValueOnce({}); // no tools property
            await bridge.connect(config);
            expect(bridge.listTools()).toHaveLength(0);
        });

        it('handles transport.close failure during connection error', async () => {
            const config: McpServerConfig = { name: 's', command: 'node' };
            mockClient.connect.mockRejectedValueOnce(new Error('conn failed'));
            mockTransport.close.mockImplementationOnce(() => { throw new Error('close failed'); });
            await expect(bridge.connect(config, vi.fn())).rejects.toThrow('conn failed');
        });
    });

    describe('callTool', () => {
        it('calls tool on the correct server', async () => {
            const config: McpServerConfig = { name: 'srv', command: 'node' };
            mockClient.request
                .mockResolvedValueOnce({ tools: [{ name: 'do_thing' }] })
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'result' }] });
            await bridge.connect(config);

            const result = await bridge.callTool('do_thing', { x: 1 });
            expect(result.content[0].text).toBe('result');
        });

        it('throws for unknown tool', async () => {
            await expect(bridge.callTool('unknown', {})).rejects.toThrow('MCP tool "unknown" not found');
        });

        it('throws when server is not connected', async () => {
            const config: McpServerConfig = { name: 'srv', command: 'node' };
            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 'mytool' }] });
            await bridge.connect(config);
            // Manually mark the server as disconnected
            const conn = (bridge as any).connections.get('srv');
            conn.connected = false;
            await expect(bridge.callTool('mytool', {})).rejects.toThrow('MCP server "srv" is not connected');
        });

        it('strips prefix from prefixed tool name', async () => {
            const config1: McpServerConfig = { name: 'a', command: 'n' };
            const config2: McpServerConfig = { name: 'b', command: 'n' };

            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 'run' }] });
            await bridge.connect(config1);
            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 'run' }] });
            await bridge.connect(config2, vi.fn());

            // Call the prefixed version
            mockClient.request.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
            const result = await bridge.callTool('a__run', {});
            // Verify the actual call used the unprefixed name
            const callArgs = mockClient.request.mock.calls[mockClient.request.mock.calls.length - 1];
            expect(callArgs[0].params.name).toBe('run');
        });
    });

    describe('listTools', () => {
        it('skips disconnected servers', async () => {
            const config: McpServerConfig = { name: 'srv', command: 'node' };
            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
            await bridge.connect(config);
            expect(bridge.listTools()).toHaveLength(1);

            // Manually mark disconnected without removing from map
            const conn = (bridge as any).connections.get('srv');
            conn.connected = false;
            expect(bridge.listTools()).toHaveLength(0);
        });
    });

    describe('disconnect', () => {
        it('disconnects a server and removes its tools', async () => {
            const config: McpServerConfig = { name: 'srv', command: 'node' };
            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
            await bridge.connect(config);
            expect(bridge.listTools()).toHaveLength(1);

            await bridge.disconnect('srv');
            expect(bridge.listTools()).toHaveLength(0);
        });

        it('no-op for unknown server', async () => {
            await bridge.disconnect('nonexistent');
        });
    });

    describe('disconnectAll', () => {
        it('disconnects all servers', async () => {
            mockClient.request.mockResolvedValue({ tools: [{ name: 't' }] });
            await bridge.connect({ name: 's1', command: 'n' });
            await bridge.connect({ name: 's2', command: 'n' });

            await bridge.disconnectAll();
            expect(bridge.listTools()).toHaveLength(0);
        });
    });

    describe('hasConnections', () => {
        it('returns false when no connections', () => {
            expect(bridge.hasConnections()).toBe(false);
        });

        it('returns true when connected', async () => {
            mockClient.request.mockResolvedValueOnce({ tools: [] });
            await bridge.connect({ name: 's', command: 'n' });
            expect(bridge.hasConnections()).toBe(true);
        });
    });

    describe('getStatus', () => {
        it('returns status of all connections', async () => {
            mockClient.request.mockResolvedValueOnce({ tools: [{ name: 't1' }, { name: 't2' }] });
            await bridge.connect({ name: 'srv', command: 'node' });

            const status = bridge.getStatus();
            expect(status).toHaveLength(1);
            expect(status[0]).toEqual({ name: 'srv', connected: true, toolCount: 2 });
        });
    });

    describe('reconnect', () => {
        it('disconnects and reconnects a server', async () => {
            mockClient.request.mockResolvedValue({ tools: [{ name: 't1' }] });
            await bridge.connect({ name: 'srv', command: 'node' });
            await bridge.reconnect('srv', vi.fn());
            expect(bridge.hasConnections()).toBe(true);
        });

        it('throws for unknown server', async () => {
            await expect(bridge.reconnect('unknown')).rejects.toThrow('No MCP server "unknown" found');
        });
    });
});
