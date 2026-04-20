import { AgentDefinition } from './AgentDefinition';
import { PipelineDefinition, PipelineStage } from './PipelineDefinition';

/**
 * Auto-assigned colors and icons for pipeline agents.
 * Used when the agent definition doesn't specify its own.
 */
export const AGENT_PALETTE = [
    { color: '#10b981', icon: '🤖' },
    { color: '#f59e0b', icon: '🛡️' },
    { color: '#8b5cf6', icon: '✨' },
    { color: '#0ea5e9', icon: '🔍' },
    { color: '#f43f5e', icon: '💓' },
    { color: '#6366f1', icon: '🧠' },
    { color: '#06b6d4', icon: '🔬' },
    { color: '#f97316', icon: '🔥' },
    { color: '#ef4444', icon: '😈' },
    { color: '#14b8a6', icon: '📊' },
    { color: '#a855f7', icon: '⏱️' },
    { color: '#3b82f6', icon: '🔎' },
    { color: '#84cc16', icon: '📜' },
] as const;

/**
 * Get a color/icon from the palette by index (wraps around).
 */
export function getPaletteEntry(index: number): { color: string; icon: string } {
    return AGENT_PALETTE[index % AGENT_PALETTE.length];
}

/**
 * Built-in: Investigator agent.
 * Runs the main investigation loop — full MCP tool access, investigation system prompt.
 */
export function createInvestigatorAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-investigator',
        name: 'Investigator',
        description: 'Runs the main investigation loop with full tool access. Queries data sources, analyzes results, and produces a findings report.',
        source: 'builtin',
        builtinType: 'investigator',
        color: '#10b981',
        icon: '🤖',
        ...overrides,
    };
}

/**
 * Built-in: Retrospect agent.
 * Analyzes a completed investigation against the knowledge base and proposes improvements.
 */
export function createRetrospectAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-retrospect',
        name: 'Retrospect',
        description: 'Analyzes the completed investigation against the knowledge base and proposes file changes to improve future investigations.',
        source: 'builtin',
        builtinType: 'retrospect',
        color: '#8b5cf6',
        icon: '✨',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir', 'propose_change'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Proposer agent.
 * Reads investigation findings and proposes code changes. Does not apply changes directly.
 */
export function createImplementationAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-proposer',
        name: 'Proposer',
        description: 'Reads investigation findings and proposes code changes for recommendations. Does not apply changes — only creates proposals for review.',
        source: 'builtin',
        builtinType: 'implementation',
        color: '#6366f1',
        icon: '🔧',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir', 'propose_change', 'search_code', 'get_summary'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Validator agent.
 * Reviews the previous agent's findings and validates accuracy, completeness, and evidence quality.
 * Can reject work back for re-investigation.
 */
export function createValidatorAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-validator',
        name: 'Validator',
        description: 'Reviews investigation findings for accuracy, completeness, and evidence. Can approve, reject, or flag results.',
        source: 'builtin',
        builtinType: 'validator',
        promptPath: 'prompts/examples/ValidatorPrompt.md',
        color: '#f59e0b',
        icon: '🛡️',
        ...overrides,
    };
}

/**
 * Built-in: Planner agent.
 * Analyzes the investigation query, reviews the knowledge base, and produces a structured
 * investigation plan with hypotheses, data sources to query, and expected patterns.
 */
export function createPlannerAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-planner',
        name: 'Planner',
        description: 'Analyzes the query and knowledge base to produce a structured investigation plan with hypotheses, data sources, and expected patterns.',
        source: 'builtin',
        builtinType: 'planner',
        promptPath: 'prompts/examples/PlannerPrompt.md',
        color: '#0ea5e9',
        icon: '📋',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Triage agent.
 * Quick initial assessment that classifies severity, scope, and affected components.
 * Can short-circuit the pipeline if the issue is trivial.
 */
export function createTriageAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-triage',
        name: 'Triage',
        description: 'Quick initial severity assessment. Classifies scope, affected components, and priority. Can short-circuit the pipeline for trivial issues.',
        source: 'builtin',
        builtinType: 'triage',
        promptPath: 'prompts/examples/TriagePrompt.md',
        color: '#f43f5e',
        icon: '🚦',
        ...overrides,
    };
}

/**
 * Built-in: Correlator agent.
 * Cross-references investigation findings with past investigations to find recurring patterns,
 * similar root causes, and previously identified solutions.
 */
export function createCorrelatorAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-correlator',
        name: 'Correlator',
        description: 'Cross-references findings with past investigations to find recurring patterns, similar root causes, and previously identified solutions.',
        source: 'builtin',
        builtinType: 'correlator',
        promptPath: 'prompts/examples/CorrelatorPrompt.md',
        color: '#06b6d4',
        icon: '🔗',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir', 'search_code'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Devil's Advocate agent.
 * Actively challenges investigation conclusions, looks for alternative explanations,
 * identifies blind spots, and runs counter-queries to disprove findings.
 */
export function createDevilsAdvocateAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-devils-advocate',
        name: "Devil's Advocate",
        description: "Challenges investigation conclusions by looking for alternative explanations, blind spots, and running counter-queries to stress-test findings.",
        source: 'builtin',
        builtinType: 'devils-advocate',
        promptPath: 'prompts/examples/DevilsAdvocatePrompt.md',
        color: '#ef4444',
        icon: '😈',
        ...overrides,
    };
}

/**
 * Built-in: Executive Summarizer agent.
 * Condenses detailed technical investigation findings into a stakeholder-friendly summary
 * with key takeaways, business impact, action items, and timeline.
 */
export function createSummarizerAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-summarizer',
        name: 'Summarizer',
        description: 'Condenses technical investigation findings into a stakeholder-friendly executive summary with key takeaways, business impact, and action items.',
        source: 'builtin',
        builtinType: 'summarizer',
        promptPath: 'prompts/examples/SummarizerPrompt.md',
        color: '#14b8a6',
        icon: '📊',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Remediation Advisor agent.
 * Proposes operational remediation: configuration changes, runbook updates,
 * capacity planning, monitoring improvements, and architectural recommendations.
 */
export function createRemediationAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-remediation',
        name: 'Remediation Advisor',
        description: 'Proposes operational remediation: configuration changes, runbook updates, monitoring improvements, and architectural recommendations.',
        source: 'builtin',
        builtinType: 'remediation',
        promptPath: 'prompts/examples/RemediationPrompt.md',
        color: '#f97316',
        icon: '🩹',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir', 'propose_change'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Timeline Reconstructor agent.
 * Builds a chronological event timeline from investigation data — tool call results,
 * metrics, logs — to reconstruct the sequence of events for post-mortems.
 */
export function createTimelineAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-timeline',
        name: 'Timeline Reconstructor',
        description: 'Reconstructs a chronological event timeline from investigation data for incident post-mortems and root cause analysis.',
        source: 'builtin',
        builtinType: 'timeline',
        promptPath: 'prompts/examples/TimelinePrompt.md',
        color: '#a855f7',
        icon: '⏱️',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Data Enrichment agent.
 * Runs before the main investigation to gather additional context: recent deployments,
 * configuration changes, related alerts, and service dependencies.
 */
export function createEnrichmentAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-enrichment',
        name: 'Data Enrichment',
        description: 'Gathers pre-investigation context: recent deployments, configuration changes, related alerts, and service dependencies.',
        source: 'builtin',
        builtinType: 'enrichment',
        promptPath: 'prompts/examples/EnrichmentPrompt.md',
        color: '#3b82f6',
        icon: '🔎',
        ...overrides,
    };
}

/**
 * Built-in: Compliance Auditor agent.
 * Reviews investigation findings and proposed remediations against security policies,
 * compliance requirements, and best practices. Can reject non-compliant proposals.
 */
export function createComplianceAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-compliance',
        name: 'Compliance Auditor',
        description: 'Reviews findings and remediations against security policies and compliance requirements. Can reject non-compliant proposals.',
        source: 'builtin',
        builtinType: 'compliance',
        promptPath: 'prompts/examples/CompliancePrompt.md',
        color: '#84cc16',
        icon: '📜',
        tools: {
            mode: 'whitelist',
            list: ['read_file', 'list_dir'],
        },
        ...overrides,
    };
}

/**
 * Built-in: Signal Grounding Auditor agent.
 * Audits investigation conclusions to ensure they are grounded in actually observed
 * telemetry — not inferred from missing, absent, or expected-but-not-found data.
 * Rejects conclusions that rely on absence-based reasoning since missing telemetry
 * says nothing in an imperfect world where traces get dropped.
 */
export function createSignalGroundingAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
        id: 'builtin-signal-grounding',
        name: 'Signal Grounding Auditor',
        description: 'Audits conclusions to ensure they are grounded in observed telemetry, not inferred from missing data. Rejects absence-based reasoning — missing telemetry says nothing.',
        source: 'builtin',
        builtinType: 'signal-grounding',
        promptPath: 'prompts/examples/SignalGroundingPrompt.md',
        color: '#d946ef',
        icon: '📡',
        ...overrides,
    };
}

/**
 * Registry of all built-in agent types.
 * Maps builtinType string → factory function.
 */
export const BUILTIN_AGENTS: Record<string, (overrides?: Partial<AgentDefinition>) => AgentDefinition> = {
    investigator: createInvestigatorAgent,
    validator: createValidatorAgent,
    retrospect: createRetrospectAgent,
    implementation: createImplementationAgent,
    planner: createPlannerAgent,
    triage: createTriageAgent,
    correlator: createCorrelatorAgent,
    'devils-advocate': createDevilsAdvocateAgent,
    summarizer: createSummarizerAgent,
    remediation: createRemediationAgent,
    timeline: createTimelineAgent,
    enrichment: createEnrichmentAgent,
    compliance: createComplianceAgent,
    'signal-grounding': createSignalGroundingAgent,
};

/**
 * Get a built-in agent definition by type name.
 * Returns undefined if the type is not recognized.
 */
export function getBuiltinAgent(builtinType: string, overrides?: Partial<AgentDefinition>): AgentDefinition | undefined {
    const factory = BUILTIN_AGENTS[builtinType];
    return factory ? factory(overrides) : undefined;
}

/**
 * List all available built-in agent types with their descriptions.
 */
export function listBuiltinAgents(): AgentDefinition[] {
    return Object.entries(BUILTIN_AGENTS).map(([_type, factory]) => factory());
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline Presets
// ────────────────────────────────────────────────────────────────────────────

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

/** All built-in pipeline presets. */
export const PIPELINE_PRESETS: PipelinePreset[] = [
    {
        id: 'default',
        name: 'Standard',
        description: 'Balanced pipeline: investigate, validate, propose changes, and improve knowledge base.',
        icon: '⚡',
        stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'deep-investigation',
        name: 'Deep Investigation',
        description: 'Thorough pipeline with planning, adversarial review, grounding audit, and executive summary for complex issues.',
        icon: '🔬',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'incident-response',
        name: 'Incident Response',
        description: 'Fast triage, enrichment, timeline reconstruction, and remediation for active incidents.',
        icon: '🚨',
        stages: [
            { builtinType: 'triage' },
            { builtinType: 'enrichment' },
            { builtinType: 'investigator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'summarizer' },
        ],
    },
    {
        id: 'quick-health-check',
        name: 'Quick Health Check',
        description: 'Lightweight pipeline for scheduled health checks and routine monitoring.',
        icon: '💚',
        stages: [
            { builtinType: 'triage' },
            { builtinType: 'investigator' },
            { builtinType: 'validator' },
        ],
    },
    {
        id: 'compliance-review',
        name: 'Compliance Review',
        description: 'Investigation followed by grounding audit, compliance auditing, and change proposals.',
        icon: '📜',
        stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'compliance', canReject: true, onReject: 'flag' },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'root-cause-analysis',
        name: 'Root Cause Analysis',
        description: 'Correlate with past incidents, reconstruct timeline, verify grounding, and generate remediation plan.',
        icon: '🔍',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'correlator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'grounded-investigation',
        name: 'Grounded Investigation',
        description: 'Rigorous pipeline that ensures all conclusions are grounded in observed telemetry — rejects absence-based reasoning where missing data is treated as evidence.',
        icon: '📡',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 1, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ],
    },
];

/**
 * Build a full PipelineDefinition from a preset ID.
 * Resolves each stage's builtinType to a full AgentDefinition.
 * Throws if the preset ID is unknown or no agents can be resolved.
 */
export function buildPipelinePreset(presetId: string): PipelineDefinition {
    const preset = PIPELINE_PRESETS.find(p => p.id === presetId);
    if (!preset) {
        throw new Error(`Unknown pipeline preset: "${presetId}". Available: ${PIPELINE_PRESETS.map(p => p.id).join(', ')}`);
    }

    const pipelineStages: PipelineStage[] = [];
    for (const stageDef of preset.stages) {
        const agent = getBuiltinAgent(stageDef.builtinType);
        if (!agent) continue; // skip stages for agents not available
        const stage: PipelineStage = {
            agent: { ...agent },
            inputMode: 'conversation',
        };
        if (stageDef.canReject) stage.canReject = true;
        if (stageDef.onReject) stage.onReject = stageDef.onReject;
        if (stageDef.rejectTarget !== undefined) stage.rejectTarget = stageDef.rejectTarget;
        if (stageDef.maxRetries !== undefined) stage.maxRetries = stageDef.maxRetries;
        pipelineStages.push(stage);
    }

    if (pipelineStages.length === 0) {
        throw new Error(`No agents available for preset "${preset.name}"`);
    }

    return {
        id: `preset-${preset.id}`,
        name: preset.name,
        stages: pipelineStages,
    };
}

/**
 * List all available pipeline presets (metadata only, no resolved agents).
 */
export function listPipelinePresets(): PipelinePreset[] {
    return PIPELINE_PRESETS;
}

/**
 * If the given pipeline matches a built-in preset, return the preset ID.
 * Matches by pipeline.id (format "preset-<id>") or by pipeline.name.
 * Returns undefined if no preset matches.
 */
export function matchPipelinePreset(pipeline: PipelineDefinition): string | undefined {
    // Match by id convention (preset-<id>)
    if (pipeline.id?.startsWith('preset-')) {
        const candidateId = pipeline.id.substring('preset-'.length);
        if (PIPELINE_PRESETS.some(p => p.id === candidateId)) {
            return candidateId;
        }
    }
    // Fallback: match by name
    const byName = PIPELINE_PRESETS.find(p => p.name === pipeline.name);
    return byName?.id;
}
