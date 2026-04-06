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
 * Registry of all built-in agent types.
 * Maps builtinType string → factory function.
 */
export const BUILTIN_AGENTS: Record<string, (overrides?: Partial<AgentDefinition>) => AgentDefinition> = {
    investigator: createInvestigatorAgent,
    validator: createValidatorAgent,
    retrospect: createRetrospectAgent,
    implementation: createImplementationAgent,
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
