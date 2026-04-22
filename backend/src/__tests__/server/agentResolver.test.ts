/// <summary>
/// Unit tests for the agent resolver (agentResolver.ts) that backs the generic
/// `/api/agents/run` endpoint and Settings UI agent dropdowns.
/// </summary>
import { describe, it, expect } from 'vitest';
import {
    resolveAgentById,
    getDefaultAgentForKind,
    listAgentsForKind,
} from '../../server/agentResolver';
import { AgentDefinition } from '../../agent/pipeline';

/// <summary>Minimal in-memory CustomAgentStore stub matching the methods agentResolver uses.</summary>
function makeStore(saved: Array<{ id: string; agent: AgentDefinition }>) {
    /// <summary>Return a stub store exposing only `get` and `getAll`.</summary>
    return {
        get: (id: string) => saved.find(s => s.id === id),
        getAll: () => saved,
    } as any;
}

describe('agentResolver.resolveAgentById', () => {
    it('returns undefined for empty id', () => {
        expect(resolveAgentById('', null)).toBeUndefined();
    });

    it('resolves a built-in by `builtin-<type>` prefix', () => {
        const a = resolveAgentById('builtin-investigator', null);
        expect(a?.kind).toBe('investigator');
    });

    it('resolves a built-in by bare type name', () => {
        const a = resolveAgentById('investigator', null);
        expect(a?.kind).toBe('investigator');
    });

    it('returns undefined for unknown id when no store given', () => {
        expect(resolveAgentById('nonexistent-id', null)).toBeUndefined();
    });

    it('resolves a saved custom agent by saved-id', () => {
        const customAgent: AgentDefinition = {
            id: 'inner-agent-id',
            name: 'My Custom',
            kind: 'investigator',
            promptPath: 'prompts/x.md',
        } as any;
        const store = makeStore([{ id: 'saved-1', agent: customAgent }]);
        const found = resolveAgentById('saved-1', store);
        expect(found).toBe(customAgent);
    });

    it('falls back to searching by inner agent.id', () => {
        const customAgent: AgentDefinition = {
            id: 'inner-xyz',
            name: 'X',
            kind: 'investigator',
            promptPath: 'p.md',
        } as any;
        const store = makeStore([{ id: 'saved-1', agent: customAgent }]);
        const found = resolveAgentById('inner-xyz', store);
        expect(found).toBe(customAgent);
    });

    it('returns undefined when id matches nothing in store', () => {
        const store = makeStore([]);
        expect(resolveAgentById('missing', store)).toBeUndefined();
    });
});

describe('agentResolver.getDefaultAgentForKind', () => {
    it('returns the configured override when it resolves', () => {
        const customAgent: AgentDefinition = {
            id: 'inner', name: 'Override', kind: 'investigator', promptPath: 'p.md',
        } as any;
        const store = makeStore([{ id: 'override-1', agent: customAgent }]);
        const a = getDefaultAgentForKind('investigator' as any, { investigator: 'override-1' }, store);
        expect(a).toBe(customAgent);
    });

    it('falls back to first built-in matching the kind when override missing', () => {
        const a = getDefaultAgentForKind('investigator' as any, {}, null);
        expect(a?.kind).toBe('investigator');
    });

    it('falls back to built-in when override id is unknown', () => {
        const a = getDefaultAgentForKind('investigator' as any, { investigator: 'does-not-exist' }, null);
        expect(a?.kind).toBe('investigator');
    });

    it('handles undefined defaultAgentByKind', () => {
        const a = getDefaultAgentForKind('investigator' as any, undefined, null);
        expect(a?.kind).toBe('investigator');
    });

    it('returns undefined when no built-in matches kind and no override', () => {
        const a = getDefaultAgentForKind('does-not-exist' as any, undefined, null);
        expect(a).toBeUndefined();
    });
});

describe('agentResolver.listAgentsForKind', () => {
    it('lists all built-ins matching the kind', () => {
        const list = listAgentsForKind('investigator' as any, null);
        expect(list.length).toBeGreaterThan(0);
        for (const a of list) expect(a.kind).toBe('investigator');
    });

    it('combines built-ins with matching saved custom agents', () => {
        const customAgent: AgentDefinition = {
            id: 'c1', name: 'C', kind: 'investigator', promptPath: 'p.md',
        } as any;
        const otherKind: AgentDefinition = {
            id: 'c2', name: 'D', kind: 'validator', promptPath: 'p.md',
        } as any;
        const store = makeStore([
            { id: 's1', agent: customAgent },
            { id: 's2', agent: otherKind },
        ]);
        const list = listAgentsForKind('investigator' as any, store);
        expect(list).toContain(customAgent);
        expect(list).not.toContain(otherKind);
    });

    it('returns built-ins only when store is null', () => {
        const list = listAgentsForKind('kb-improver' as any, null);
        expect(list.length).toBeGreaterThan(0);
        for (const a of list) expect(a.kind).toBe('kb-improver');
    });
});
