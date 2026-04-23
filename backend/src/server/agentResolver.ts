import {
    AgentDefinition,
    AgentKind,
    BUILTIN_AGENTS,
    listBuiltinAgents,
} from '../agent/pipeline';
import { CustomAgentStore, SavedAgent } from '../workflows/WorkflowStore';

/**
 * Resolve an agent identifier to an `AgentDefinition` by checking the built-in
 * registry first, then the custom-agent store. Returns `undefined` when no
 * matching agent is found. The lookup is case-sensitive on `id`.
 *
 * Built-in agents have ids like `builtin-investigator`. Custom agents have
 * the id assigned by `CustomAgentStore.create`.
 */
export function resolveAgentById(id: string, customStore: CustomAgentStore | null): AgentDefinition | undefined {
    if (!id) return undefined;
    // Built-in: id convention is `builtin-<builtinType>`.
    if (id.startsWith('builtin-')) {
        /** Strip prefix to recover the builtinType. */
        const builtinType: string = id.substring('builtin-'.length);
        const factory = BUILTIN_AGENTS[builtinType];
        if (factory) return factory();
    }
    // Direct match on builtinType (legacy callers pass the bare type).
    if (BUILTIN_AGENTS[id]) {
        return BUILTIN_AGENTS[id]();
    }
    // Saved custom agent.
    if (customStore) {
        const saved: SavedAgent | undefined = customStore.get(id);
        if (saved) return saved.agent;
    }
    // Search saved agents by inner agent.id (some callers use the agent id directly).
    if (customStore) {
        const all: SavedAgent[] = customStore.getAll();
        const match: SavedAgent | undefined = all.find(s => s.agent.id === id);
        if (match) return match.agent;
    }
    return undefined;
}

/**
 * Resolve the default agent for a given `AgentKind`.
 *
 * Lookup order:
 *  1. `defaultAgentByKind[kind]` — when set and resolves to a known agent
 *  2. First built-in whose `kind` matches (deterministic; iteration order of `BUILTIN_AGENTS`)
 *  3. `undefined` — caller must error loudly
 */
export function getDefaultAgentForKind(
    kind: AgentKind,
    defaultAgentByKind: Partial<Record<string, string>> | undefined,
    customStore: CustomAgentStore | null,
): AgentDefinition | undefined {
    /** Configured override id, when present. */
    const overrideId: string | undefined = defaultAgentByKind?.[kind];
    if (overrideId) {
        const resolved: AgentDefinition | undefined = resolveAgentById(overrideId, customStore);
        if (resolved) return resolved;
    }
    // Built-in fallback by kind.
    const builtins: AgentDefinition[] = listBuiltinAgents();
    return builtins.find(a => a.kind === kind);
}

/**
 * List all agents (built-in + custom) whose `kind` matches the given `kind`.
 * Used by the Settings UI to populate the per-kind default dropdown.
 */
export function listAgentsForKind(kind: AgentKind, customStore: CustomAgentStore | null): AgentDefinition[] {
    /** Built-ins matching the kind. */
    const builtins: AgentDefinition[] = listBuiltinAgents().filter(a => a.kind === kind);
    /** Saved custom agents matching the kind. */
    const custom: AgentDefinition[] = customStore
        ? customStore.getAll().map(s => s.agent).filter(a => a.kind === kind)
        : [];
    return [...builtins, ...custom];
}
