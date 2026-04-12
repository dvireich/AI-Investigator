import { AgentDefinition } from './AgentDefinition';

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
