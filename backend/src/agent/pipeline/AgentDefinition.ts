import { McpServerConfig } from '../tools/McpToolBridge';

/**
 * Controls which MCP tools are available to an agent.
 *
 * - `'all'` — agent can use every discovered tool (default)
 * - `'whitelist'` — agent can only use tools named in `list`
 * - `'blacklist'` — agent can use all tools except those named in `list`
 */
export interface ToolAccess {
    mode: 'all' | 'whitelist' | 'blacklist';
    list?: string[];
}

/**
 * Defines a single agent that participates in a pipeline.
 *
 * Agents can be loaded from three sources:
 * - `'builtin'` — one of the built-in agent types (investigator, retrospect, implementation)
 * - `'file'`    — system prompt loaded from a file path (supports template variables)
 * - `'inline'`  — system prompt provided directly in the config
 */
export interface AgentDefinition {
    /** Unique identifier within the pipeline / agent library. */
    id: string;

    /** Display name shown in the timeline UI and stage stepper. */
    name: string;

    /** Optional description shown in the config UI. */
    description?: string;

    /** How the agent's system prompt is provided. */
    source: 'builtin' | 'file' | 'inline';

    /**
     * For `source: 'builtin'` — the built-in agent type.
     * Ships with: 'investigator', 'retrospect', 'implementation'.
     * Extensible — not a fixed enum.
     */
    builtinType?: string;

    /** For `source: 'file'` — path to the system prompt file. Supports template variables. */
    promptPath?: string;

    /** For `source: 'inline'` — the system prompt text. Supports template variables. */
    promptContent?: string;

    /** Override the LLM model for this agent (falls back to the investigation-level model). */
    model?: string;

    /** Override the max step limit for this agent (falls back to the investigation-level limit). */
    maxSteps?: number;

    /** Control which MCP tools this agent can access. Defaults to all tools. */
    tools?: ToolAccess;

    /** Additional or override MCP servers available only to this agent. */
    mcpServers?: McpServerConfig[];

    /**
     * UI color for this agent's messages in the timeline.
     * Named Tailwind color (e.g. 'emerald', 'amber') or hex (e.g. '#ff6b00').
     * Auto-assigned from a palette if not set.
     */
    color?: string;

    /**
     * Lucide icon name for this agent's avatar (e.g. 'shield', 'search', 'brain').
     * Auto-assigned if not set.
     */
    icon?: string;
}

/**
 * A single entry in the shared multi-agent conversation log.
 * Every agent's thoughts, actions, and outputs are appended here,
 * creating a unified timeline that subsequent agents can read.
 */
export interface ConversationEntry {
    /** ID of the agent that produced this entry. */
    agentId: string;

    /** Display name of the agent. */
    agentName: string;

    /** Color assigned to this agent (for UI rendering). */
    agentColor?: string;

    /** Icon assigned to this agent (for UI rendering). */
    agentIcon?: string;

    /** The kind of entry. */
    role: 'thought' | 'action' | 'observation' | 'report' | 'verdict' | 'handoff';

    /** The content (markdown text, JSON-stringified tool args, etc.). */
    content: string;

    /** When this entry was created. */
    timestamp: number;

    /** Which pipeline stage produced this entry (0-based index). */
    stageIndex: number;

    /** Optional structured metadata (e.g. tool name, verdict value, action args). */
    metadata?: Record<string, any>;
}
