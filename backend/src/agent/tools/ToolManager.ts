import fs from 'fs';
import path from 'path';
import { McpToolBridge, McpServerConfig } from './McpToolBridge';

/**
 * High-level role hint that controls how the `finish` tool is shaped at the
 * tool layer. Set by the AgentRunner before listing tools so an agent literally
 * cannot emit fields that aren't appropriate for its role.
 *
 * - `'producer'` — agent authors content. `finish` accepts only `summary`/`report`;
 *   any `verdict` field is omitted from the schema so producers cannot hijack
 *   review semantics.
 * - `'reviewer'` — agent evaluates other agents. `finish` requires `verdict` and
 *   accepts a structured `openItems[]` array; the legacy `feedback` prose field
 *   is preserved for backwards compatibility.
 * - undefined — backwards compatible: full schema (verdict + summary + feedback)
 *   so legacy callers (scheduled health checks, single-agent runs) keep working.
 */
export type FinishRoleHint = 'producer' | 'reviewer';

/**
 * Manages built-in tools (read_file, list_dir, finish) and delegates
 * everything else to connected MCP servers via McpToolBridge.
 */
export class ToolManager {
    private mcpBridge: McpToolBridge;
    private ready: boolean = false;
    public initError: string | null = null;
    private repoRoot: string;
    private workDir: string | undefined;
    private finishRoleHint: FinishRoleHint | undefined;

    constructor() {
        this.mcpBridge = new McpToolBridge();
        this.repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), '../../..');
    }

    setRepoRoot(repoRoot: string): void {
        this.repoRoot = repoRoot;
    }

    /**
     * Set (or clear) the role hint used when shaping the `finish` tool schema.
     * Called by the AgentRunner from `setStageContext()`. When unset, the full
     * legacy schema is exposed for backwards compatibility with non-pipeline
     * callers (scheduled health checks, single-agent runs).
     */
    setFinishRoleHint(role: FinishRoleHint | undefined): void {
        this.finishRoleHint = role;
    }

    /**
     * Initialize the tool manager by connecting to all configured MCP servers.
     */
    async initialize(mcpServers: McpServerConfig[], cwd?: string, logger?: (msg: string) => void): Promise<void> {
        this.workDir = cwd;
        const log = logger || console.log;
        this.initError = null;
        this.ready = false;

        if (this.workDir) log(`Initializing ToolManager in ${this.workDir}`);

        // Validate working directory exists
        if (this.workDir && !fs.existsSync(this.workDir)) {
            this.initError = `Working directory does not exist: ${this.workDir}. Please check the product configuration in Settings.`;
            log(`Working directory not found: ${this.workDir}`);
            return;
        }

        // Connect to MCP servers
        const errors: string[] = [];
        for (const serverConfig of mcpServers) {
            try {
                // Inject working directory into MCP server config if not already set
                const config = { ...serverConfig, cwd: serverConfig.cwd || this.workDir };
                await this.mcpBridge.connect(config, log);
            } catch (e: any) {
                errors.push(`${serverConfig.name}: ${e.message}`);
            }
        }

        if (errors.length > 0 && errors.length === mcpServers.length) {
            // All servers failed
            this.initError = `All MCP servers failed to connect:\n${errors.join('\n')}`;
            log(this.initError);
        } else if (errors.length > 0) {
            // Some servers failed
            log(`Warning: Some MCP servers failed to connect:\n${errors.join('\n')}`);
        }

        // Ready if we have built-in tools (always) — MCP servers are optional
        this.ready = true;

        const mcpToolCount = this.mcpBridge.listTools().length;
        if (mcpServers.length === 0) {
            log('No MCP servers configured. Agent has built-in tools only (read_file, list_dir, finish).');
        } else {
            log(`ToolManager ready. ${mcpToolCount} MCP tool(s) available from ${this.mcpBridge.getStatus().filter(s => s.connected).length} server(s).`);
        }
    }

    /**
     * List all available tools (built-in + MCP-discovered).
     */
    async listTools(): Promise<any[]> {
        const builtIn: any[] = [
            {
                name: 'read_file',
                description: 'Read file content from the knowledge base or working directory.',
                inputSchema: {
                    type: 'object',
                    properties: { path: { type: 'string', description: 'File path (relative to repo root or absolute).' } },
                    required: ['path']
                }
            },
            {
                name: 'list_dir',
                description: 'List directory contents.',
                inputSchema: {
                    type: 'object',
                    properties: { path: { type: 'string', description: 'Directory path (relative to repo root or absolute).' } },
                    required: ['path']
                }
            },
            this.buildFinishToolSchema(),
            {
                name: 'invoke_subagent',
                description: 'Invoke another agent as a subagent to perform a focused sub-task. The subagent runs with the same tools and returns its final report. Use this when you need to hand off a specific aspect of the investigation (e.g., root-cause tracing for specific workspaces) to a specialized agent.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        agentPath: { type: 'string', description: 'Path to the agent definition file (.agent.md), relative to the repo root. Example: ".github/agents/Teleduct_Investigation.agent.md"' },
                        task: { type: 'string', description: 'Detailed task description for the subagent. Include all context it needs: specific workspaces, time ranges, parameters, and what output you expect.' }
                    },
                    required: ['agentPath', 'task']
                }
            }
        ];

        const mcpTools = this.mcpBridge.listTools();
        return [...builtIn, ...mcpTools];
    }

    /**
     * Call a tool by name, routing to built-in handler or MCP bridge.
     */
    async callTool(name: string, args: any): Promise<any> {
        // Built-in tools
        if (name === 'read_file') return this.readFile(args.path, args.startLine, args.endLine);
        if (name === 'list_dir') return this.listDir(args.path);
        if (name === 'finish') return 'Investigation marked as finished.';

        // MCP tools
        return this.mcpBridge.callTool(name, args);
    }

    /**
     * Build the role-shaped `finish` tool schema. Producers can only emit a
     * report; reviewers can only emit a verdict + structured `openItems[]`.
     * The legacy schema (verdict + summary + feedback) is preserved when no
     * role hint is set so non-pipeline callers (scheduled health checks,
     * single-agent runs) keep working unchanged.
     */
    private buildFinishToolSchema(): any {
        if (this.finishRoleHint === 'producer') {
            return {
                name: 'finish',
                description:
                    'Complete your investigation. As a producer agent your job is to author a report; you cannot issue verdicts (only reviewer agents can). Provide your full investigation report in `report` (markdown).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        report: {
                            type: 'string',
                            description: 'Final investigation report (markdown). Must be substantively your own analysis grounded in tool calls you ran. Do NOT mimic the format or voice of any reviewer agent in the conversation.',
                        },
                    },
                    required: ['report'],
                },
            };
        }

        if (this.finishRoleHint === 'reviewer') {
            return {
                name: 'finish',
                description:
                    'Complete your review. As a reviewer agent you must emit a structured verdict and (when not approving) a list of concrete `openItems[]` for the producer to address. Do NOT write a long prose report — your job is to evaluate, not author content.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        verdict: {
                            type: 'string',
                            enum: ['approved', 'rejected', 'flagged'],
                            description:
                                'Your review verdict. `rejected` triggers a re-run of the producer with your openItems as the target. `flagged` records concerns but does not loop. `approved` passes the work forward.',
                        },
                        headline: {
                            type: 'string',
                            description: 'One-sentence summary of your review (max ~200 chars). Used in pipeline UI; not appended to the producer report.',
                        },
                        openItems: {
                            type: 'array',
                            description:
                                'Concrete actionable items the producer must address. Required when verdict is `rejected` or `flagged`. Each item must name a specific gap or defect, not a stylistic preference.',
                            items: {
                                type: 'object',
                                required: ['severity', 'claim'],
                                properties: {
                                    severity: {
                                        type: 'string',
                                        enum: ['blocker', 'major', 'minor'],
                                        description:
                                            '`blocker`: must be addressed or report cannot stand. `major`: report has a significant gap. `minor`: nice-to-have.',
                                    },
                                    claim: {
                                        type: 'string',
                                        description: 'One-sentence statement of the gap or defect (e.g. "Error catalog only lists 2 of 6 error families found in DeltaService logs").',
                                    },
                                    evidenceRequired: {
                                        type: 'string',
                                        description: 'Optional: what specific tool call or evidence the producer must gather to close this item.',
                                    },
                                },
                            },
                        },
                        feedback: {
                            type: 'string',
                            description:
                                'Deprecated: free-form prose feedback. Prefer `openItems[]`. When set without `openItems`, the orchestrator synthesizes a single blocker item from this text for backwards compatibility.',
                        },
                    },
                    required: ['verdict'],
                },
            };
        }

        // Legacy (no role hint): full schema for scheduled health checks and
        // single-agent callers. New pipeline runs always set a role hint.
        return {
            name: 'finish',
            description: 'Complete the investigation with a summary. For scheduled health checks, include a verdict. In multi-agent pipelines, agents with review authority can also include a verdict and feedback.',
            inputSchema: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Final summary of the investigation.' },
                    verdict: { type: 'string', enum: ['healthy', 'warning', 'critical', 'approved', 'rejected', 'flagged'], description: 'Health verdict for scheduled checks, or review verdict for pipeline agents.' },
                    feedback: { type: 'string', description: 'When rejecting or flagging, explain what specifically needs to be fixed or re-examined.' },
                },
                required: ['summary'],
            },
        };
    }

    isConnected(): boolean {
        return this.ready;
    }

    /**
     * Get status of all MCP server connections.
     */
    getMcpStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
        return this.mcpBridge.getStatus();
    }

    /**
     * Reconnect a specific MCP server.
     */
    async reconnectMcpServer(name: string, logger?: (msg: string) => void): Promise<void> {
        await this.mcpBridge.reconnect(name, logger);
    }

    async restart(mcpServers: McpServerConfig[], logger?: (msg: string) => void): Promise<void> {
        await this.mcpBridge.disconnectAll();
        this.ready = false;
        await this.initialize(mcpServers, this.workDir, logger);
    }

    async cleanup(): Promise<void> {
        await this.mcpBridge.disconnectAll();
    }

    // ─── Built-in tool implementations ───

    private resolvePath(inputPath: string): string {
        const resolvedRoot = path.resolve(this.repoRoot);

        if (path.isAbsolute(inputPath)) {
            const resolved = path.resolve(inputPath);
            if (!resolved.startsWith(resolvedRoot)) {
                throw new Error(`Access denied: path '${inputPath}' is outside the repository root`);
            }
            return resolved;
        }

        const repoPath = path.resolve(resolvedRoot, inputPath);
        if (repoPath.startsWith(resolvedRoot) && fs.existsSync(repoPath)) return repoPath;

        const cwdPath = path.resolve(inputPath);
        if (cwdPath.startsWith(resolvedRoot) && fs.existsSync(cwdPath)) return cwdPath;

        return repoPath;
    }

    private readFile(filePath: string, startLine?: number, endLine?: number): string {
        try {
            const resolvedPath = this.resolvePath(filePath);
            if (!fs.existsSync(resolvedPath)) return `File not found: ${filePath}`;

            const MAX_FILE_CHARS = 50_000;
            const content = fs.readFileSync(resolvedPath, 'utf-8');

            if (startLine != null && startLine > 0) {
                const lines = content.split('\n');
                const start = startLine - 1;
                const end = endLine != null ? Math.min(endLine, lines.length) : lines.length;
                const totalLines = lines.length;
                const slice = lines.slice(start, end);
                return `[Lines ${startLine}-${Math.min(end, totalLines)} of ${totalLines}]\n` + slice.join('\n');
            }

            if (content.length > MAX_FILE_CHARS) {
                return content.substring(0, MAX_FILE_CHARS) +
                    `\n\n... [truncated \u2014 file is ${content.length.toLocaleString()} chars, limit ${MAX_FILE_CHARS.toLocaleString()}. Use startLine/endLine to read specific sections.]`;
            }
            return content;
        } catch (e: any) {
            return `Error reading file: ${e.message}`;
        }
    }

    private listDir(dirPath: string): string {
        try {
            const resolvedPath = this.resolvePath(dirPath);
            if (!fs.existsSync(resolvedPath)) return `Directory not found: ${dirPath}`;
            if (!fs.lstatSync(resolvedPath).isDirectory()) return 'Path is not a directory.';
            return JSON.stringify(fs.readdirSync(resolvedPath));
        } catch (e: any) {
            return `Error listing directory: ${e.message}`;
        }
    }
}
