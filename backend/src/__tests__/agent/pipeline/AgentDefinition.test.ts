/// <summary>
/// Unit tests for AgentDefinition helper functions (getAgentKind, findAgentsByKind).
/// </summary>
import { describe, it, expect } from 'vitest';
import {
    getAgentKind,
    findAgentsByKind,
    type AgentDefinition,
} from '../../../agent/pipeline/AgentDefinition';

/// <summary>
/// Builds a minimal AgentDefinition for tests, with an optional kind override.
/// </summary>
function makeAgent(id: string, kind?: any): AgentDefinition {
    return {
        id,
        name: id,
        source: 'inline',
        ...(kind !== undefined ? { kind } : {}),
    } as AgentDefinition;
}

describe('AgentDefinition helpers', () => {
    describe('getAgentKind', () => {
        it("defaults to 'custom' when kind is missing", () => {
            expect(getAgentKind(makeAgent('a'))).toBe('custom');
        });

        it('returns the explicitly set kind', () => {
            expect(getAgentKind(makeAgent('a', 'investigator'))).toBe('investigator');
            expect(getAgentKind(makeAgent('a', 'retrospect'))).toBe('retrospect');
        });
    });

    describe('findAgentsByKind', () => {
        it('returns inline stage agents matching the kind with their stage index', () => {
            const pipeline = {
                stages: [
                    { agent: makeAgent('s0', 'investigator') },
                    { agent: makeAgent('s1', 'validator') },
                    { agent: makeAgent('s2', 'investigator') },
                ],
            };
            const result = findAgentsByKind(pipeline, 'investigator');
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ agent: pipeline.stages[0].agent, stageIndex: 0 });
            expect(result[1]).toEqual({ agent: pipeline.stages[2].agent, stageIndex: 2 });
        });

        it('resolves stage agentId references against the pipeline.agents library', () => {
            const lib = [makeAgent('libA', 'retrospect'), makeAgent('libB', 'investigator')];
            const pipeline = {
                stages: [
                    { agentId: 'libA' },
                    { agentId: 'libB' },
                ],
                agents: lib,
            };
            const result = findAgentsByKind(pipeline, 'retrospect');
            expect(result).toEqual([{ agent: lib[0], stageIndex: 0 }]);
        });

        it('falls back to inline agent when agentId reference is not found in library', () => {
            const inlineAgent = makeAgent('inline', 'validator');
            const pipeline = {
                stages: [{ agentId: 'missing-id', agent: inlineAgent }],
                agents: [makeAgent('other', 'investigator')],
            };
            const result = findAgentsByKind(pipeline, 'validator');
            expect(result).toEqual([{ agent: inlineAgent, stageIndex: 0 }]);
        });

        it('includes library-only agents (not used by stages) with stageIndex -1', () => {
            const usedAgent = makeAgent('used', 'investigator');
            const unusedAgent = makeAgent('unused', 'investigator');
            const pipeline = {
                stages: [{ agentId: 'used' }],
                agents: [usedAgent, unusedAgent],
            };
            const result = findAgentsByKind(pipeline, 'investigator');
            expect(result).toHaveLength(2);
            expect(result.find(r => r.agent.id === 'used')!.stageIndex).toBe(0);
            expect(result.find(r => r.agent.id === 'unused')!.stageIndex).toBe(-1);
        });

        it('does not double-count an agent that appears in both library and stages', () => {
            const dupAgent = makeAgent('dup', 'retrospect');
            const pipeline = {
                stages: [{ agentId: 'dup' }, { agentId: 'dup' }],
                agents: [dupAgent],
            };
            const result = findAgentsByKind(pipeline, 'retrospect');
            // Both stage occurrences are returned, but the library entry must not be re-added.
            expect(result.filter(r => r.stageIndex === -1)).toEqual([]);
            expect(result.length).toBe(2);
        });

        it("treats agents with no kind as 'custom' for matching", () => {
            const pipeline = {
                stages: [{ agent: makeAgent('no-kind') }],
            };
            expect(findAgentsByKind(pipeline, 'custom')).toHaveLength(1);
            expect(findAgentsByKind(pipeline, 'investigator')).toHaveLength(0);
        });

        it('returns empty array when nothing matches', () => {
            const pipeline = {
                stages: [{ agent: makeAgent('a', 'investigator') }],
                agents: [makeAgent('b', 'validator')],
            };
            expect(findAgentsByKind(pipeline, 'retrospect')).toEqual([]);
        });

        it('handles a pipeline without an agents library', () => {
            const pipeline = { stages: [{ agent: makeAgent('a', 'investigator') }] };
            expect(findAgentsByKind(pipeline, 'investigator')).toHaveLength(1);
        });

        it('handles stages with neither agentId nor agent (skipped silently)', () => {
            const pipeline = {
                stages: [{}, { agent: makeAgent('a', 'investigator') }],
            };
            const result = findAgentsByKind(pipeline, 'investigator');
            expect(result).toHaveLength(1);
            expect(result[0].stageIndex).toBe(1);
        });
    });
});
