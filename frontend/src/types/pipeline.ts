// ── Multi-Agent Pipeline Types ─────────────────────────────────────

export interface AgentDefinition {
    id: string;
    name: string;
    source: 'builtin' | 'file' | 'inline';
    builtinType?: string;
    promptPath?: string;
    promptContent?: string;
    description?: string;
    model?: string;
    maxSteps?: number;
    tools?: ToolAccess;
    mcpServers?: McpServerConfig[];
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
