import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export interface McpServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

interface McpConnection {
    config: McpServerConfig;
    client: Client;
    transport: StdioClientTransport;
    tools: any[];
    connected: boolean;
}

/**
 * Generic MCP Tool Bridge — connects to any number of MCP servers,
 * discovers their tools, and routes callTool requests to the correct server.
 */
export class McpToolBridge {
    private connections: Map<string, McpConnection> = new Map();
    private toolToServer: Map<string, string> = new Map(); // tool name → server name

    /**
     * Connect to an MCP server and discover its tools.
     */
    async connect(config: McpServerConfig, logger?: (msg: string) => void): Promise<void> {
        const log = logger || console.log;
        log(`[MCP] Connecting to "${config.name}" (${config.command} ${(config.args || []).join(' ')})...`);

        // Resolve environment variables in args (e.g. $DATABASE_URL → process.env.DATABASE_URL)
        const resolvedArgs = (config.args || []).map(arg => {
            if (arg.startsWith('$') && arg.length > 1) {
                const envName = arg.substring(1);
                return process.env[envName] || arg;
            }
            return arg;
        });

        // Inherit ALL parent env vars merged with config overrides.
        // The MCP SDK's default env only passes a limited whitelist (PATH, APPDATA, etc.)
        // which can break MCP servers that need additional vars (COMSPEC, azure credentials, etc.)
        const mergedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) mergedEnv[key] = value;
        }
        if (config.env) {
            Object.assign(mergedEnv, config.env);
        }

        const transport = new StdioClientTransport({
            command: config.command,
            args: resolvedArgs,
            env: mergedEnv,
            cwd: config.cwd,
            stderr: 'pipe'
        } as any);

        // Capture stderr from the MCP server process for diagnostics
        const stderrStream = transport.stderr;
        if (stderrStream) {
            let stderrBuf = '';
            stderrStream.on('data', (chunk: Buffer) => {
                const text = chunk.toString().trim();
                if (text) {
                    stderrBuf += text + '\n';
                    log(`[MCP/${config.name}] ${text}`);
                }
            });
        }

        const client = new Client(
            { name: 'AI-Investigator', version: '1.0.0' },
            { capabilities: {} }
        );

        try {
            await client.connect(transport, { timeout: 180000 });
            log(`[MCP] Connected to "${config.name}". Discovering tools...`);

            // Discover tools with retry
            let tools: any[] = [];
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    const result = await client.request(
                        { method: 'tools/list' },
                        ListToolsResultSchema,
                        { timeout: 30000 }
                    );
                    tools = result.tools || [];
                    break;
                } catch (e: any) {
                    if (attempt === 5) throw e;
                    log(`[MCP] Waiting for "${config.name}" to be ready (attempt ${attempt}/5)...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            // Register tools — prefix with server name if there are conflicts
            for (const tool of tools) {
                if (this.toolToServer.has(tool.name)) {
                    // Conflict — prefix both
                    const existingServer = this.toolToServer.get(tool.name)!;
                    const prefixedExisting = `${existingServer}__${tool.name}`;
                    const prefixedNew = `${config.name}__${tool.name}`;
                    this.toolToServer.set(prefixedExisting, existingServer);
                    this.toolToServer.set(prefixedNew, config.name);
                    this.toolToServer.delete(tool.name);
                    log(`[MCP] Tool name conflict for "${tool.name}" — available as "${prefixedExisting}" and "${prefixedNew}"`);
                } else {
                    this.toolToServer.set(tool.name, config.name);
                }
            }

            this.connections.set(config.name, {
                config,
                client,
                transport,
                tools,
                connected: true
            });

            log(`[MCP] "${config.name}" ready with ${tools.length} tool(s): ${tools.map((t: any) => t.name).join(', ')}`);
        } catch (e: any) {
            log(`[MCP] Failed to connect to "${config.name}": ${e.message}`);
            try { transport.close(); } catch { /* ignore */ }
            throw e;
        }
    }

    /**
     * Disconnect a specific MCP server.
     */
    async disconnect(name: string): Promise<void> {
        const conn = this.connections.get(name);
        if (!conn) return;

        // Remove tool mappings
        for (const [tool, server] of this.toolToServer.entries()) {
            if (server === name) this.toolToServer.delete(tool);
        }

        try { conn.transport.close(); } catch { /* ignore */ }
        conn.connected = false;
        this.connections.delete(name);
    }

    /**
     * Disconnect all MCP servers.
     */
    async disconnectAll(): Promise<void> {
        for (const name of Array.from(this.connections.keys())) {
            await this.disconnect(name);
        }
    }

    /**
     * List all discovered tools across all connected servers.
     */
    listTools(): any[] {
        const tools: any[] = [];
        for (const conn of this.connections.values()) {
            if (!conn.connected) continue;
            for (const tool of conn.tools) {
                // Use the mapped name (may be prefixed on conflict)
                tools.push(tool);
            }
        }
        return tools;
    }

    /**
     * Call a tool on the MCP server that provides it.
     */
    async callTool(name: string, args: any): Promise<any> {
        const serverName = this.toolToServer.get(name);
        if (!serverName) {
            throw new Error(`MCP tool "${name}" not found. Available tools: ${Array.from(this.toolToServer.keys()).join(', ')}`);
        }

        const conn = this.connections.get(serverName);
        if (!conn || !conn.connected) {
            throw new Error(`MCP server "${serverName}" is not connected.`);
        }

        // Strip prefix if the tool was prefixed due to conflict
        const actualToolName = name.includes('__') ? name.split('__').slice(1).join('__') : name;

        const result = await conn.client.request({
            method: 'tools/call',
            params: { name: actualToolName, arguments: args }
        }, CallToolResultSchema);

        return result;
    }

    /**
     * Check if any MCP servers are connected.
     */
    hasConnections(): boolean {
        for (const conn of this.connections.values()) {
            if (conn.connected) return true;
        }
        return false;
    }

    /**
     * Get status of all MCP server connections.
     */
    getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
        const status: Array<{ name: string; connected: boolean; toolCount: number }> = [];
        for (const conn of this.connections.values()) {
            status.push({
                name: conn.config.name,
                connected: conn.connected,
                toolCount: conn.tools.length
            });
        }
        return status;
    }

    /**
     * Reconnect a specific server.
     */
    async reconnect(name: string, logger?: (msg: string) => void): Promise<void> {
        const conn = this.connections.get(name);
        if (!conn) throw new Error(`No MCP server "${name}" found to reconnect.`);
        const config = conn.config;
        await this.disconnect(name);
        await this.connect(config, logger);
    }
}
