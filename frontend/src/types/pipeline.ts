// ── Multi-Agent Pipeline Types ─────────────────────────────────────

/**
 * Closed enum of agent roles ("kinds"). Drives UI routing — e.g. the Retrospect tab
 * surfaces output from any agent with `kind: 'retrospect'`. Custom user agents that
 * don't fit a standard role use `'custom'`.
 */
export type AgentKind =
    | 'investigator'
    | 'retrospect'
    | 'implementation'
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
    | 'custom';

/** All known agent kinds (useful for UI dropdowns and validation). */
export const AGENT_KINDS: readonly AgentKind[] = [
    'investigator',
    'retrospect',
    'implementation',
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
    'custom',
] as const;

export interface AgentDefinition {
    id: string;
    name: string;
    kind?: AgentKind;
    source: 'builtin' | 'file' | 'inline';
    builtinType?: string;
    promptPath?: string;
    promptContent?: string;
    description?: string;
    model?: string;
    maxSteps?: number;
    tools?: ToolAccess;
    mcpServers?: McpServerConfig[];
    /** Per-agent repo root override (only meaningful for filesystem-touching agents). */
    repoRoot?: string;
    /** Per-agent knowledge base directory override. */
    knowledgeBasePath?: string;
    /** Per-agent working directory passed to spawned MCP servers. */
    workingDirectory?: string;
    color?: string;
    icon?: string;
}

export interface ToolAccess {
    mode: 'all' | 'whitelist' | 'blacklist';
    list?: string[];
}

export interface McpServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface ConversationEntry {
    agentId: string;
    agentName: string;
    agentColor?: string;
    agentIcon?: string;
    role: 'thought' | 'action' | 'observation' | 'report' | 'verdict' | 'handoff';
    content: string;
    timestamp: number;
    stageIndex: number;
    metadata?: Record<string, any>;
}

export interface PipelineStage {
    agentId?: string;
    agent?: AgentDefinition;
    canReject?: boolean;
    onReject?: 'loop' | 'flag' | 'abort';
    rejectTarget?: number | 'previous';
    maxRetries?: number;
    timeout?: number;
    inputMode?: 'conversation' | 'report-only';
}

export interface PipelineDefinition {
    id: string;
    name?: string;
    stages: PipelineStage[];
    agents?: AgentDefinition[];
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
 * Returns each match with its stage index (-1 if only in the pipeline.agents library).
 */
export function findAgentsByKind(
    pipeline: PipelineDefinition,
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

/** A compact stage definition inside a preset — references agents by builtinType. */
export interface PresetStageDefinition {
    builtinType: string;
    canReject?: boolean;
    onReject?: 'loop' | 'flag' | 'abort';
    rejectTarget?: number | 'previous';
    maxRetries?: number;
}

/** A named pipeline preset that can be referenced by ID. */
export interface PipelinePreset {
    id: string;
    name: string;
    description: string;
    icon: string;
    stages: PresetStageDefinition[];
}

export interface PipelineStageState {
    agentId: string;
    agentName: string;
    description?: string;
    color?: string;
    icon?: string;
    status: 'pending' | 'running' | 'completed' | 'rejected' | 'skipped' | 'failed' | 'aborted';
    verdict?: string;
    feedback?: string;
    report?: string;
    retryCount: number;
    canReject?: boolean;
    onReject?: 'loop' | 'flag' | 'abort';
    rejectTarget?: number | 'previous';
    maxRetries?: number;
    startedAt?: number;
    completedAt?: number;
}

export interface PipelineState {
    stages: PipelineStageState[];
    currentStageIndex: number;
    definition: PipelineDefinition;
    conversationLog: ConversationEntry[];
}
