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
 * Closed enum of agent roles ("kinds"). Every agent — built-in or custom — declares its kind
 * so the UI and orchestrator can route output (e.g. the Retrospect tab shows agents with
 * `kind: 'retrospect'`). Custom user-defined agents that don't fit any standard role
 * use `'custom'`.
 */
export type AgentKind =
    | 'investigator'
    | 'retrospect'
    | 'implementation'
    | 'kb-improver'
    | 'code-implementer'
    | 'recommendation-extractor'
    | 'executive-report'
    | 'notes-rephraser'
    | 'validator'
    | 'planner'
    | 'triage'
    | 'correlator'
    | 'devils-advocate'
    | 'summarizer'
    | 'remediation'
    | 'timeline'
    | 'enrichment'
    | 'compliance'
    | 'signal-grounding'
    | 'code-scout'
    | 'custom';

/** All known agent kinds (useful for UI dropdowns and validation). */
export const AGENT_KINDS: readonly AgentKind[] = [
    'investigator',
    'retrospect',
    'implementation',
    'kb-improver',
    'code-implementer',
    'recommendation-extractor',
    'executive-report',
    'notes-rephraser',
    'validator',
    'planner',
    'triage',
    'correlator',
    'devils-advocate',
    'summarizer',
    'remediation',
    'timeline',
    'enrichment',
    'compliance',
    'signal-grounding',
    'code-scout',
    'custom',
] as const;

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

    /**
     * The role this agent plays in a pipeline. Drives UI routing — e.g. the Retrospect tab
     * surfaces output from any agent with `kind: 'retrospect'`. Custom user agents that
     * don't fit a standard role use `'custom'`.
     *
     * Optional for backwards compatibility with legacy agent definitions that predate this
     * field; consumers should use `getAgentKind(agent)` which defaults to `'custom'`.
     */
    kind?: AgentKind;

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
     * Per-agent repository root. Overrides global `config.repoRoot` for the duration of this stage.
     * Only meaningful for agents that touch the filesystem (typically `kind: 'investigator'`,
     * `'retrospect'`, or `'implementation'`). Pure reasoning agents (validator, planner,
     * devil's advocate, summarizer, …) can leave this unset.
     */
    repoRoot?: string;

    /**
     * Per-agent knowledge base directory (absolute, or relative to this agent's `repoRoot`).
     * Overrides global `config.knowledgeBasePath` for the duration of this stage. Used by the
     * agent prompt loader and by retrospect-class agents to discover guides.
     */
    knowledgeBasePath?: string;

    /**
     * Per-agent working directory passed as the `cwd` to spawned MCP-server child processes.
     * Overrides global `config.workingDirectory` for the duration of this stage. Most useful
     * when an agent declares its own `mcpServers` and they expect a specific cwd.
     */
    workingDirectory?: string;

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

    /**
     * How the agent's LLM call is executed.
     *
     * - `'tool-loop'` (default) — multi-turn loop with MCP tools, terminated by the `finish` tool.
     *   Used by investigator-class agents that need to gather evidence iteratively.
     * - `'single-shot'` — one LLM call, no tool loop, response returned directly. Used by
     *   stateless reasoning agents like recommendation extractors, summarizers, and rephrasers.
     *
     * Built-in agent factories declare this explicitly. Custom agents default to `'tool-loop'`
     * for backwards compatibility.
     */
    executionMode?: 'tool-loop' | 'single-shot';

    /**
     * Expected format of the agent's final output.
     *
     * - `'markdown'` (default) — free-form markdown text returned as-is.
     * - `'json'` — the response is expected to contain a JSON value (object or array). The
     *   runner extracts the first JSON block via regex and validates it against `outputSchema`
     *   if provided. On parse/validation failure the runner returns an empty result with a
     *   warning logged — callers decide how to surface this.
     */
    outputFormat?: 'markdown' | 'json';

    /**
     * Optional JSON Schema describing the expected shape of a `outputFormat: 'json'` response.
     * The runner runs a minimal validator (type, items, required, enum) against the parsed
     * output. Ignored when `outputFormat !== 'json'`.
     */
    outputSchema?: object;
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

/**
 * Resolve an agent's kind, defaulting to `'custom'` when not set.
 * Use this everywhere instead of reading `agent.kind` directly so legacy agent
 * definitions without a `kind` field behave predictably.
 */
export function getAgentKind(agent: AgentDefinition): AgentKind {
    return agent.kind ?? 'custom';
}

/**
 * Find every agent in a pipeline that matches the given kind.
 * Considers both the pipeline's named agent library and inline stage agents.
 * Each returned entry includes the resolved AgentDefinition and the stage index it appears at
 * (or -1 if the agent is only in the library and not used by any stage).
 */
export function findAgentsByKind(
    pipeline: { stages: { agentId?: string; agent?: AgentDefinition }[]; agents?: AgentDefinition[] },
    kind: AgentKind
): { agent: AgentDefinition; stageIndex: number }[] {
    const results: { agent: AgentDefinition; stageIndex: number }[] = [];
    const seenIds = new Set<string>();

    pipeline.stages.forEach((stage, stageIndex) => {
        let resolved: AgentDefinition | undefined;
        if (stage.agentId && pipeline.agents) {
            resolved = pipeline.agents.find(a => a.id === stage.agentId);
        }
        if (!resolved && stage.agent) {
            resolved = stage.agent;
        }
        if (resolved && getAgentKind(resolved) === kind) {
            results.push({ agent: resolved, stageIndex });
            seenIds.add(resolved.id);
        }
    });

    if (pipeline.agents) {
        for (const agent of pipeline.agents) {
            if (getAgentKind(agent) === kind && !seenIds.has(agent.id)) {
                results.push({ agent, stageIndex: -1 });
            }
        }
    }

    return results;
}
