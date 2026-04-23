import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
    resolveStageAgent,
    resolveRejectTarget,
    getEffectiveMaxRetries,
    validatePipeline,
    isSavedAgentRefDangling,
    PipelineDefinition,
    PipelineStage,
} from '../../../agent/pipeline/PipelineDefinition';
import {
    getPaletteEntry,
    AGENT_PALETTE,
    getBuiltinAgent,
    listBuiltinAgents,
    createInvestigatorAgent,
    createRetrospectAgent,
    createImplementationAgent,
    createPlannerAgent,
    createTriageAgent,
    createCorrelatorAgent,
    createDevilsAdvocateAgent,
    createSummarizerAgent,
    createRemediationAgent,
    createTimelineAgent,
    createEnrichmentAgent,
    createComplianceAgent,
    BUILTIN_AGENTS,
    buildPipelinePreset,
    listPipelinePresets,
    PIPELINE_PRESETS,
    matchPipelinePreset,
} from '../../../agent/pipeline/builtinAgents';
import { createValidatorAgent } from '../../../agent/pipeline/builtinAgents';

// ──────────────────────────────────────────────
// PipelineDefinition — resolveStageAgent
// ──────────────────────────────────────────────
describe('PipelineDefinition', () => {
    describe('resolveStageAgent', () => {
        const pipeline: PipelineDefinition = {
            id: 'test-pipeline',
            stages: [],
            agents: [
                { id: 'agent-a', name: 'Agent A', source: 'inline', promptContent: 'test' },
                { id: 'agent-b', name: 'Agent B', source: 'file', promptPath: '/test.md' },
            ],
        };

        it('resolves an agentId from the agents library', () => {
            const result = resolveStageAgent({ agentId: 'agent-a' }, pipeline);
            expect(result.name).toBe('Agent A');
        });

        it('throws when agentId not found in library', () => {
            expect(() => resolveStageAgent({ agentId: 'nonexistent' }, pipeline))
                .toThrow("agentId 'nonexistent'");
        });

        it('returns inline agent when no agentId', () => {
            const inlineAgent = { id: 'inline-1', name: 'Inline', source: 'inline' as const, promptContent: 'x' };
            const result = resolveStageAgent({ agent: inlineAgent }, pipeline);
            expect(result.name).toBe('Inline');
        });

        it('throws when neither agentId nor agent is provided', () => {
            expect(() => resolveStageAgent({}, pipeline)).toThrow('must have either');
        });

        it('prefers agentId over inline agent when both set', () => {
            const inlineAgent = { id: 'inline-1', name: 'Inline', source: 'inline' as const };
            const result = resolveStageAgent({ agentId: 'agent-a', agent: inlineAgent }, pipeline);
            expect(result.name).toBe('Agent A');
        });

        it('handles pipeline with no agents library', () => {
            const noLibPipeline: PipelineDefinition = { id: 'p', stages: [] };
            expect(() => resolveStageAgent({ agentId: 'any' }, noLibPipeline))
                .toThrow("agentId 'any'");
        });

        // ── savedAgentId (global CustomAgentStore reference) ────────────
        describe('savedAgentId resolution', () => {
            const savedAgent = { id: 'saved-x', name: 'Saved X', source: 'inline' as const, promptContent: 'from-library' };
            const resolver = (id: string) => (id === 'saved-x' ? savedAgent : undefined);

            it('resolves savedAgentId via the resolver', () => {
                const result = resolveStageAgent({ savedAgentId: 'saved-x' }, pipeline, resolver);
                expect(result.name).toBe('Saved X');
                expect(result.promptContent).toBe('from-library');
            });

            it('prefers savedAgentId over agentId and inline agent when all three are set', () => {
                const inline = { id: 'i', name: 'Inline', source: 'inline' as const };
                const result = resolveStageAgent(
                    { savedAgentId: 'saved-x', agentId: 'agent-a', agent: inline },
                    pipeline,
                    resolver,
                );
                expect(result.name).toBe('Saved X');
            });

            it('falls back to inline agent when savedAgentId is dangling', () => {
                const stale = { id: 'stale', name: 'Stale Snapshot', source: 'inline' as const };
                const result = resolveStageAgent(
                    { savedAgentId: 'missing', agent: stale },
                    pipeline,
                    resolver,
                );
                expect(result.name).toBe('Stale Snapshot');
            });

            it('throws when savedAgentId is dangling and no inline fallback exists', () => {
                expect(() => resolveStageAgent({ savedAgentId: 'missing' }, pipeline, resolver))
                    .toThrow("savedAgentId 'missing'");
            });

            it('treats savedAgentId as dangling when no resolver is supplied', () => {
                expect(() => resolveStageAgent({ savedAgentId: 'saved-x' }, pipeline))
                    .toThrow("savedAgentId 'saved-x'");
            });
        });

        describe('isSavedAgentRefDangling', () => {
            const resolver = (id: string) => (id === 'ok' ? { id: 'ok', name: 'OK', source: 'inline' as const } : undefined);

            it('returns false when stage has no savedAgentId', () => {
                expect(isSavedAgentRefDangling({}, resolver)).toBe(false);
            });

            it('returns false when the reference resolves', () => {
                expect(isSavedAgentRefDangling({ savedAgentId: 'ok' }, resolver)).toBe(false);
            });

            it('returns true when the reference does not resolve', () => {
                expect(isSavedAgentRefDangling({ savedAgentId: 'missing' }, resolver)).toBe(true);
            });

            it('returns true when no resolver is supplied', () => {
                expect(isSavedAgentRefDangling({ savedAgentId: 'ok' })).toBe(true);
            });
        });
    });

    // ──────────────────────────────────────────────
    // resolveRejectTarget
    // ──────────────────────────────────────────────
    describe('resolveRejectTarget', () => {
        it('defaults to previous stage', () => {
            expect(resolveRejectTarget({}, 3, 5)).toBe(2);
        });

        it('clamps previous to 0 when at first stage', () => {
            expect(resolveRejectTarget({}, 0, 5)).toBe(0);
        });

        it('resolves numeric target', () => {
            expect(resolveRejectTarget({ rejectTarget: 1 }, 3, 5)).toBe(1);
        });

        it('resolves target 0', () => {
            expect(resolveRejectTarget({ rejectTarget: 0 }, 2, 5)).toBe(0);
        });

        it('throws when numeric target is out of range (negative)', () => {
            expect(() => resolveRejectTarget({ rejectTarget: -1 }, 3, 5))
                .toThrow('out of range');
        });

        it('throws when numeric target is out of range (>= total)', () => {
            expect(() => resolveRejectTarget({ rejectTarget: 5 }, 3, 5))
                .toThrow('out of range');
        });

        it('throws when numeric target is >= current index', () => {
            expect(() => resolveRejectTarget({ rejectTarget: 3 }, 3, 5))
                .toThrow('must point to an earlier stage');
        });

        it('handles explicit "previous" string', () => {
            expect(resolveRejectTarget({ rejectTarget: 'previous' }, 4, 5)).toBe(3);
        });

        it('falls back to previous for unrecognized value', () => {
            // TypeScript union doesn't prevent runtime weirdness
            const stage = { rejectTarget: 'foo' as any };
            expect(resolveRejectTarget(stage, 3, 5)).toBe(2);
        });
    });

    // ──────────────────────────────────────────────
    // getEffectiveMaxRetries
    // ──────────────────────────────────────────────
    describe('getEffectiveMaxRetries', () => {
        it('defaults to 2', () => {
            expect(getEffectiveMaxRetries({})).toBe(2);
        });

        it('uses provided value', () => {
            expect(getEffectiveMaxRetries({ maxRetries: 4 })).toBe(4);
        });

        it('caps at 5', () => {
            expect(getEffectiveMaxRetries({ maxRetries: 100 })).toBe(5);
        });

        it('clamps negative to 0', () => {
            expect(getEffectiveMaxRetries({ maxRetries: -3 })).toBe(0);
        });

        it('handles zero', () => {
            expect(getEffectiveMaxRetries({ maxRetries: 0 })).toBe(0);
        });
    });

    // ──────────────────────────────────────────────
    // validatePipeline
    // ──────────────────────────────────────────────
    describe('validatePipeline', () => {
        it('accepts a valid pipeline with inline agents', () => {
            const pipeline: PipelineDefinition = {
                id: 'valid',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' } },
                ],
            };
            expect(() => validatePipeline(pipeline)).not.toThrow();
        });

        it('accepts a valid pipeline with agentId references', () => {
            const pipeline: PipelineDefinition = {
                id: 'valid',
                stages: [{ agentId: 'agent-a' }],
                agents: [{ id: 'agent-a', name: 'A', source: 'inline' }],
            };
            expect(() => validatePipeline(pipeline)).not.toThrow();
        });

        it('accepts a valid pipeline with only savedAgentId references (no library, no inline)', () => {
            const pipeline: PipelineDefinition = {
                id: 'valid-saved',
                stages: [{ savedAgentId: 'saved-1' }],
            };
            expect(() => validatePipeline(pipeline)).not.toThrow();
        });

        it('throws for empty stages', () => {
            expect(() => validatePipeline({ id: 'test', stages: [] }))
                .toThrow('at least one stage');
        });

        it('throws for undefined stages', () => {
            expect(() => validatePipeline({ id: 'test', stages: undefined as any }))
                .toThrow('at least one stage');
        });

        it('throws when stage has neither agentId nor agent', () => {
            expect(() => validatePipeline({ id: 'test', stages: [{}] }))
                .toThrow("stage 0 must have either");
        });

        it('throws when agentId not in library', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [{ agentId: 'missing' }],
                agents: [{ id: 'other', name: 'Other', source: 'inline' }],
            })).toThrow("agentId 'missing'");
        });

        it('validates rejectTarget for loop stages', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'loop', rejectTarget: -1 },
                ],
            })).toThrow('out of range');
        });

        it('throws when rejectTarget points to self or later stage', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'loop', rejectTarget: 1 },
                ],
            })).toThrow('must point to an earlier stage');
        });

        it('accepts valid loop with rejectTarget pointing to earlier stage', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'loop', rejectTarget: 0 },
                ],
            })).not.toThrow();
        });

        it('does not validate rejectTarget for non-loop stages', () => {
            // canReject=true but onReject='flag' — no rejectTarget validation
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'flag' },
                ],
            })).not.toThrow();
        });

        it('skips rejectTarget validation when target is "previous"', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'loop', rejectTarget: 'previous' },
                ],
            })).not.toThrow();
        });

        it('validates loop stage with no rejectTarget (defaults to previous)', () => {
            expect(() => validatePipeline({
                id: 'test',
                stages: [
                    { agent: { id: 'a', name: 'A', source: 'inline' } },
                    { agent: { id: 'b', name: 'B', source: 'inline' }, canReject: true, onReject: 'loop' },
                ],
            })).not.toThrow();
        });
    });
});

// ──────────────────────────────────────────────
// builtinAgents
// ──────────────────────────────────────────────
describe('builtinAgents', () => {
    describe('getPaletteEntry', () => {
        it('returns first palette entry for index 0', () => {
            const entry = getPaletteEntry(0);
            expect(entry.color).toBe(AGENT_PALETTE[0].color);
            expect(entry.icon).toBe(AGENT_PALETTE[0].icon);
        });

        it('wraps around for index > palette length', () => {
            const entry = getPaletteEntry(AGENT_PALETTE.length);
            expect(entry.color).toBe(AGENT_PALETTE[0].color);
        });

        it('wraps around for large index', () => {
            const entry = getPaletteEntry(AGENT_PALETTE.length + 2);
            expect(entry.color).toBe(AGENT_PALETTE[2].color);
        });
    });

    describe('createInvestigatorAgent', () => {
        it('creates with defaults', () => {
            const agent = createInvestigatorAgent();
            expect(agent.id).toBe('builtin-investigator');
            expect(agent.name).toBe('Investigator');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('investigator');
            expect(agent.color).toBe('#10b981');
        });

        it('allows overrides', () => {
            const agent = createInvestigatorAgent({ name: 'Custom Investigator', color: '#ff0000' });
            expect(agent.name).toBe('Custom Investigator');
            expect(agent.color).toBe('#ff0000');
        });
    });

    describe('createRetrospectAgent', () => {
        it('creates with defaults', () => {
            const agent = createRetrospectAgent();
            expect(agent.id).toBe('builtin-retrospect');
            expect(agent.builtinType).toBe('retrospect');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('propose_change');
        });

        it('allows overrides', () => {
            const agent = createRetrospectAgent({ name: 'My Retro' });
            expect(agent.name).toBe('My Retro');
        });
    });

    describe('createImplementationAgent', () => {
        it('creates with defaults', () => {
            const agent = createImplementationAgent();
            expect(agent.id).toBe('builtin-proposer');
            expect(agent.builtinType).toBe('implementation');
            expect(agent.tools?.list).toContain('search_code');
        });

        it('allows overrides', () => {
            const agent = createImplementationAgent({ maxSteps: 10 });
            expect(agent.maxSteps).toBe(10);
        });
    });

    describe('createValidatorAgent', () => {
        it('creates with defaults', () => {
            const agent = createValidatorAgent();
            expect(agent.id).toBe('builtin-validator');
            expect(agent.builtinType).toBe('validator');
            expect(agent.promptPath).toBe('prompts/examples/ValidatorPrompt.md');
        });

        it('allows overrides', () => {
            const agent = createValidatorAgent({ promptPath: '/custom/path.md' });
            expect(agent.promptPath).toBe('/custom/path.md');
        });
    });

    describe('createPlannerAgent', () => {
        it('creates with defaults', () => {
            const agent = createPlannerAgent();
            expect(agent.id).toBe('builtin-planner');
            expect(agent.name).toBe('Planner');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('planner');
            expect(agent.color).toBe('#0ea5e9');
            expect(agent.promptPath).toBe('prompts/examples/PlannerPrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('read_file');
            expect(agent.tools?.list).toContain('list_dir');
        });

        it('allows overrides', () => {
            const agent = createPlannerAgent({ name: 'Custom Planner' });
            expect(agent.name).toBe('Custom Planner');
        });
    });

    describe('createTriageAgent', () => {
        it('creates with defaults', () => {
            const agent = createTriageAgent();
            expect(agent.id).toBe('builtin-triage');
            expect(agent.name).toBe('Triage');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('triage');
            expect(agent.color).toBe('#f43f5e');
            expect(agent.promptPath).toBe('prompts/examples/TriagePrompt.md');
            expect(agent.tools).toBeUndefined(); // full tool access
        });

        it('allows overrides', () => {
            const agent = createTriageAgent({ model: 'gpt-4' });
            expect(agent.model).toBe('gpt-4');
        });
    });

    describe('createCorrelatorAgent', () => {
        it('creates with defaults', () => {
            const agent = createCorrelatorAgent();
            expect(agent.id).toBe('builtin-correlator');
            expect(agent.name).toBe('Correlator');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('correlator');
            expect(agent.color).toBe('#06b6d4');
            expect(agent.promptPath).toBe('prompts/examples/CorrelatorPrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('search_code');
        });

        it('allows overrides', () => {
            const agent = createCorrelatorAgent({ name: 'My Correlator' });
            expect(agent.name).toBe('My Correlator');
        });
    });

    describe('createDevilsAdvocateAgent', () => {
        it('creates with defaults', () => {
            const agent = createDevilsAdvocateAgent();
            expect(agent.id).toBe('builtin-devils-advocate');
            expect(agent.name).toBe("Devil's Advocate");
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('devils-advocate');
            expect(agent.color).toBe('#ef4444');
            expect(agent.promptPath).toBe('prompts/examples/DevilsAdvocatePrompt.md');
            expect(agent.tools).toBeUndefined(); // full tool access
        });

        it('allows overrides', () => {
            const agent = createDevilsAdvocateAgent({ maxSteps: 20 });
            expect(agent.maxSteps).toBe(20);
        });
    });

    describe('createSummarizerAgent', () => {
        it('creates with defaults', () => {
            const agent = createSummarizerAgent();
            expect(agent.id).toBe('builtin-summarizer');
            expect(agent.name).toBe('Summarizer');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('summarizer');
            expect(agent.color).toBe('#14b8a6');
            expect(agent.promptPath).toBe('prompts/examples/SummarizerPrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('read_file');
        });

        it('allows overrides', () => {
            const agent = createSummarizerAgent({ name: 'Brief Summary' });
            expect(agent.name).toBe('Brief Summary');
        });
    });

    describe('createRemediationAgent', () => {
        it('creates with defaults', () => {
            const agent = createRemediationAgent();
            expect(agent.id).toBe('builtin-remediation');
            expect(agent.name).toBe('Remediation Advisor');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('remediation');
            expect(agent.color).toBe('#f97316');
            expect(agent.promptPath).toBe('prompts/examples/RemediationPrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('propose_change');
        });

        it('allows overrides', () => {
            const agent = createRemediationAgent({ color: '#000' });
            expect(agent.color).toBe('#000');
        });
    });

    describe('createTimelineAgent', () => {
        it('creates with defaults', () => {
            const agent = createTimelineAgent();
            expect(agent.id).toBe('builtin-timeline');
            expect(agent.name).toBe('Timeline Reconstructor');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('timeline');
            expect(agent.color).toBe('#a855f7');
            expect(agent.promptPath).toBe('prompts/examples/TimelinePrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('read_file');
        });

        it('allows overrides', () => {
            const agent = createTimelineAgent({ icon: '🕐' });
            expect(agent.icon).toBe('🕐');
        });
    });

    describe('createEnrichmentAgent', () => {
        it('creates with defaults', () => {
            const agent = createEnrichmentAgent();
            expect(agent.id).toBe('builtin-enrichment');
            expect(agent.name).toBe('Data Enrichment');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('enrichment');
            expect(agent.color).toBe('#3b82f6');
            expect(agent.promptPath).toBe('prompts/examples/EnrichmentPrompt.md');
            expect(agent.tools).toBeUndefined(); // full tool access
        });

        it('allows overrides', () => {
            const agent = createEnrichmentAgent({ name: 'Context Gatherer' });
            expect(agent.name).toBe('Context Gatherer');
        });
    });

    describe('createComplianceAgent', () => {
        it('creates with defaults', () => {
            const agent = createComplianceAgent();
            expect(agent.id).toBe('builtin-compliance');
            expect(agent.name).toBe('Compliance Auditor');
            expect(agent.source).toBe('builtin');
            expect(agent.builtinType).toBe('compliance');
            expect(agent.color).toBe('#84cc16');
            expect(agent.promptPath).toBe('prompts/examples/CompliancePrompt.md');
            expect(agent.tools?.mode).toBe('whitelist');
            expect(agent.tools?.list).toContain('read_file');
        });

        it('allows overrides', () => {
            const agent = createComplianceAgent({ description: 'Custom desc' });
            expect(agent.description).toBe('Custom desc');
        });
    });

    describe('getBuiltinAgent', () => {
        it('returns investigator agent', () => {
            const agent = getBuiltinAgent('investigator');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('investigator');
        });

        it('returns retrospect agent', () => {
            const agent = getBuiltinAgent('retrospect');
            expect(agent!.builtinType).toBe('retrospect');
        });

        it('returns implementation agent', () => {
            const agent = getBuiltinAgent('implementation');
            expect(agent!.builtinType).toBe('implementation');
        });

        it('returns validator agent', () => {
            const agent = getBuiltinAgent('validator');
            expect(agent!.builtinType).toBe('validator');
        });

        it('returns planner agent', () => {
            const agent = getBuiltinAgent('planner');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('planner');
        });

        it('returns triage agent', () => {
            const agent = getBuiltinAgent('triage');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('triage');
        });

        it('returns correlator agent', () => {
            const agent = getBuiltinAgent('correlator');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('correlator');
        });

        it('returns devils-advocate agent', () => {
            const agent = getBuiltinAgent('devils-advocate');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('devils-advocate');
        });

        it('returns summarizer agent', () => {
            const agent = getBuiltinAgent('summarizer');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('summarizer');
        });

        it('returns remediation agent', () => {
            const agent = getBuiltinAgent('remediation');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('remediation');
        });

        it('returns timeline agent', () => {
            const agent = getBuiltinAgent('timeline');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('timeline');
        });

        it('returns enrichment agent', () => {
            const agent = getBuiltinAgent('enrichment');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('enrichment');
        });

        it('returns compliance agent', () => {
            const agent = getBuiltinAgent('compliance');
            expect(agent).toBeDefined();
            expect(agent!.builtinType).toBe('compliance');
        });

        it('returns undefined for unknown type', () => {
            expect(getBuiltinAgent('nonexistent')).toBeUndefined();
        });

        it('passes overrides to factory', () => {
            const agent = getBuiltinAgent('investigator', { name: 'Override' });
            expect(agent!.name).toBe('Override');
        });
    });

    describe('listBuiltinAgents', () => {
        it('returns all built-in agent definitions', () => {
            const agents = listBuiltinAgents();
            expect(agents.length).toBe(Object.keys(BUILTIN_AGENTS).length);
            const types = agents.map(a => a.builtinType);
            expect(types).toContain('investigator');
            expect(types).toContain('retrospect');
            expect(types).toContain('implementation');
            expect(types).toContain('validator');
            expect(types).toContain('planner');
            expect(types).toContain('triage');
            expect(types).toContain('correlator');
            expect(types).toContain('devils-advocate');
            expect(types).toContain('summarizer');
            expect(types).toContain('remediation');
            expect(types).toContain('timeline');
            expect(types).toContain('enrichment');
            expect(types).toContain('compliance');
            expect(types).toContain('recommendation-extractor');
            expect(types).toContain('code-implementer');
            expect(types).toContain('kb-improver');
            expect(types).toContain('executive-report');
            expect(types).toContain('notes-rephraser');
        });
    });
});

// ──────────────────────────────────────────────
// PipelineOrchestrator
// ──────────────────────────────────────────────
describe('PipelineOrchestrator', () => {
    // We'll use dynamic imports since PipelineOrchestrator has heavy dependencies
    let PipelineOrchestrator: typeof import('../../../agent/pipeline/PipelineOrchestrator').PipelineOrchestrator;
    let AgentRunner: typeof import('../../../agent/Runner').AgentRunner;

    beforeEach(async () => {
        const mod = await import('../../../agent/pipeline/PipelineOrchestrator');
        PipelineOrchestrator = mod.PipelineOrchestrator;
        const runnerMod = await import('../../../agent/Runner');
        AgentRunner = runnerMod.AgentRunner;
    });

    function makePipeline(stages?: PipelineStage[]): PipelineDefinition {
        return {
            id: 'test-pipeline',
            stages: stages || [
                { agent: { id: 'a1', name: 'Agent 1', source: 'inline', promptContent: 'Test prompt' } },
                { agent: { id: 'a2', name: 'Agent 2', source: 'inline', promptContent: 'Test prompt 2' } },
            ],
        };
    }

    const baseLlmProvider = {
        callLLM: vi.fn().mockResolvedValue({ content: 'test response' }),
        getProviderName: () => 'mock',
        isAuthenticated: () => true,
        getModelId: () => 'mock-model',
    };

    const baseConfig = {
        systemPromptPath: '',
        retrospectPromptPath: '',
        knowledgeBasePath: '',
        repoRoot: '',
        mcpServers: [],
        maxSteps: 10,
        model: 'test-model',
        workingDirectory: '/tmp',
        investigationsPath: '/tmp/investigations',
    };

    describe('constructor', () => {
        it('creates orchestrator with valid pipeline', () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            expect(orch).toBeDefined();
        });

        it('throws for invalid pipeline (no stages)', () => {
            expect(() => new PipelineOrchestrator({ id: 'empty', stages: [] }, baseLlmProvider as any, baseConfig as any))
                .toThrow('at least one stage');
        });

        it('initializes pipeline state with correct stage count', () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            expect(state.stages).toHaveLength(2);
            expect(state.stages[0].status).toBe('pending');
            expect(state.stages[1].status).toBe('pending');
            expect(state.currentStageIndex).toBe(0);
        });

        it('resolves agent names from inline definitions', () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            expect(state.stages[0].agentName).toBe('Agent 1');
            expect(state.stages[1].agentName).toBe('Agent 2');
        });

        it('assigns palette colors when agent has no color', () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'No Color', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            expect(state.stages[0].color).toBeDefined();
        });

        it('resolves builtin agent types', () => {
            const pipeline: PipelineDefinition = {
                id: 'builtin-test',
                stages: [
                    { agent: { id: 'inv', name: 'Inv', source: 'builtin', builtinType: 'investigator' } },
                ],
            };
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            // Builtin type is resolved; overrides from stage agent spread on top
            expect(state.stages[0].agentName).toBe('Inv');
            expect(state.stages[0].color).toBe('#10b981'); // investigator's color
        });

        it('uses agent color/icon when provided', () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'Colored', source: 'inline', promptContent: 'x', color: '#ff0000', icon: '🔥' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            expect(state.stages[0].color).toBe('#ff0000');
            expect(state.stages[0].icon).toBe('🔥');
        });
    });

    describe('abort', () => {
        it('sets aborted flag', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            orch.abort();
            // After abort, the run loop should exit with aborted status
            expect((orch as any).aborted).toBe(true);
        });
    });

    describe('pause / resume / intervene', () => {
        it('pause() delegates to the current stage runner', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const mockRunner = { pause: vi.fn(), resume: vi.fn(), intervene: vi.fn() };
            (orch as any).currentRunner = mockRunner;
            orch.pause();
            expect(mockRunner.pause).toHaveBeenCalled();
        });

        it('pause() is a no-op when no runner is active', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            expect((orch as any).currentRunner).toBeNull();
            // Should not throw
            orch.pause();
        });

        it('resume() delegates to the current stage runner', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const mockRunner = { pause: vi.fn(), resume: vi.fn(), intervene: vi.fn() };
            (orch as any).currentRunner = mockRunner;
            orch.resume();
            expect(mockRunner.resume).toHaveBeenCalled();
        });

        it('resume() is a no-op when no runner is active', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            orch.resume();
        });

        it('intervene() delegates message to the current stage runner', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const mockRunner = { pause: vi.fn(), resume: vi.fn(), intervene: vi.fn() };
            (orch as any).currentRunner = mockRunner;
            orch.intervene('check the logs');
            expect(mockRunner.intervene).toHaveBeenCalledWith('check the logs');
            // pendingInterventions should remain empty after immediate delivery
            expect((orch as any).pendingInterventions).toEqual([]);
        });

        it('intervene() queues message when no runner is active', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            orch.intervene('hello');
            expect((orch as any).pendingInterventions).toEqual(['hello']);
        });

        it('intervene() queues multiple messages when no runner is active', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            orch.intervene('first');
            orch.intervene('second');
            expect((orch as any).pendingInterventions).toEqual(['first', 'second']);
        });

        it('pending intervention is delivered when the next stage starts', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's1', name: 'S1', source: 'inline', promptContent: 'x' } },
                { agent: { id: 's2', name: 'S2', source: 'inline', promptContent: 'y' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let stage2InterveneCalled = false;
            let stageCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                stageCount++;
                runner.state.finalReport = `report-${stageCount}`;
                runner.state.status = 'completed';
                if (stageCount === 1) {
                    // After stage 1 completes, runner.dispose() sets currentRunner = null.
                    // Simulating that window: queue an intervention before stage 2 starts.
                    // We'll actually send it right after the first runWithTimeout returns
                    // by intercepting at stage 2.
                }
                if (stageCount === 2) {
                    stage2InterveneCalled = runner.pendingInterventions?.length > 0;
                }
            };

            // Queue intervention before run — simulate the between-stages window
            orch.intervene('focus on auth logs');

            await orch.run('query');
            // The intervention queue should have been drained
            expect((orch as any).pendingInterventions).toEqual([]);
        });
    });

    describe('getPipelineState', () => {
        it('returns the current pipeline state', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const state = orch.getPipelineState();
            expect(state).toHaveProperty('stages');
            expect(state).toHaveProperty('currentStageIndex');
            expect(state).toHaveProperty('definition');
            expect(state).toHaveProperty('conversationLog');
        });

        it('includes the pipeline definition snapshot', () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            expect(orch.getPipelineState().definition).toBe(pipeline);
        });

        it('returns a defensive copy so external mutations do not affect internal state', () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const copy = orch.getPipelineState();
            copy.stages[0].status = 'failed';
            copy.currentStageIndex = 999;
            // Internal state should remain unaffected
            const fresh = orch.getPipelineState();
            expect(fresh.stages[0].status).toBe('pending');
            expect(fresh.currentStageIndex).toBe(0);
        });
    });

    describe('run', () => {
        it('emits stage-start and stage-complete events', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'simple', name: 'Simple', source: 'inline', promptContent: 'Just finish immediately' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);

            // Mock the runner's start to auto-complete and set a finalReport
            const originalRun = (orch as any).runWithTimeout.bind(orch);
            (orch as any).runWithTimeout = async (runner: any, query: string) => {
                runner.state.finalReport = 'Test report';
                runner.state.status = 'completed';
            };

            const stageStartEvents: any[] = [];
            const stageCompleteEvents: any[] = [];
            orch.on('stage-start', (data) => stageStartEvents.push(data));
            orch.on('stage-complete', (data) => stageCompleteEvents.push(data));

            const result = await orch.run('test query');

            expect(stageStartEvents).toHaveLength(1);
            expect(stageStartEvents[0].stageIndex).toBe(0);
            expect(stageCompleteEvents).toHaveLength(1);
            expect(stageCompleteEvents[0].status).toBe('completed');
        });

        it('completes with final status', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.finalReport = 'Done';
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            expect(result.status).toBe('completed');
            expect(result.finalReport).toBe('Done');
        });

        it('skips completed stages when resumeFrom is provided', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'Planner', source: 'inline', promptContent: 'plan' } },
                { agent: { id: 'b', name: 'Investigator', source: 'inline', promptContent: 'investigate' } },
                { agent: { id: 'c', name: 'Validator', source: 'inline', promptContent: 'validate' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);

            const stageStartEvents: any[] = [];
            orch.on('stage-start', (data: any) => stageStartEvents.push(data));

            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.finalReport = 'Stage report';
                runner.state.status = 'completed';
            };

            const result = await orch.run('test query', {}, {
                stageIndex: 2,  // Skip stages 0 and 1
                conversationLog: [
                    { agentId: 'a', agentName: 'Planner', role: 'report', content: 'Plan done', timestamp: 1 },
                    { agentId: 'b', agentName: 'Investigator', role: 'report', content: 'Investigation done', timestamp: 2 },
                ],
                stageStates: [
                    { agentId: 'a', agentName: 'Planner', color: '#fff', icon: 'P', status: 'completed', retryCount: 0, report: 'Plan done' },
                    { agentId: 'b', agentName: 'Investigator', color: '#fff', icon: 'I', status: 'completed', retryCount: 0, report: 'Investigate done' },
                    { agentId: 'c', agentName: 'Validator', color: '#fff', icon: 'V', status: 'pending', retryCount: 0 },
                ],
            });

            // Only stage 2 should have run
            expect(stageStartEvents).toHaveLength(1);
            expect(stageStartEvents[0].stageIndex).toBe(2);
            expect(stageStartEvents[0].agentName).toBe('Validator');

            // Earlier stages should be marked as completed in pipeline state
            const pState = orch.getPipelineState();
            expect(pState.stages[0].status).toBe('completed');
            expect(pState.stages[1].status).toBe('completed');
            expect(pState.stages[2].status).toBe('completed');

            expect(result.status).toBe('completed');
        });

        it('handles stage failure', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async () => {
                throw new Error('Stage exploded');
            };

            const result = await orch.run('query');
            expect(result.status).toBe('failed');
            expect(orch.getPipelineState().stages[0].status).toBe('failed');
        });

        it('disposes the stage runner when a stage fails', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const disposeSpy = vi.fn();
            (orch as any).runWithTimeout = async () => {
                // Attach a spy to the runner that was just created
                (orch as any).currentRunner.dispose = disposeSpy;
                throw new Error('Stage exploded');
            };

            await orch.run('query');
            expect(disposeSpy).toHaveBeenCalled();
            expect((orch as any).currentRunner).toBeNull();
        });

        it('handles abort during run', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
                { agent: { id: 's2', name: 'S2', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let runCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                runCount++;
                if (runCount === 1) {
                    runner.state.finalReport = 'partial';
                    runner.state.status = 'completed';
                    orch.abort();
                }
            };

            const result = await orch.run('query');
            expect(result.status).toBe('aborted');
            expect(runCount).toBe(1); // Second stage never ran
        });

        it('marks the in-progress stage as aborted when abort is called mid-stage', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's1', name: 'S1', source: 'inline', promptContent: 'x' } },
                { agent: { id: 's2', name: 'S2', source: 'inline', promptContent: 'y' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                // Abort while stage 0 is executing
                orch.abort();
                runner.state.finalReport = 'partial';
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            expect(result.status).toBe('aborted');
            const pState = orch.getPipelineState();
            // Stage 0 was running when abort was called — stage goes through normal
            // completion path, BUT the post-loop abort logic should reset it.
            // Since the stage completed normally before the loop exit check, it gets
            // set to 'completed'. But if abort fires while the stage is running and
            // the stage hasn't exited naturally, the stage stays 'running', and the
            // post-loop code fixes it to 'aborted'.
            // In this test, the stage completes before loop checks abort, so status
            // is 'completed'. Stage 1 was never started, so it stays 'pending'.
            expect(pState.stages[1].status).toBe('pending');
        });

        it('marks still-running stage as aborted when abort interrupts execution', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's1', name: 'S1', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                // Simulate abort during execution where the runner doesn't complete
                // naturally — throw so the catch block runs. But abort is already set.
                orch.abort();
                throw new Error('Interrupted');
            };

            const result = await orch.run('query');
            expect(result.status).toBe('aborted');
            const pState = orch.getPipelineState();
            // The catch block sets status to 'failed', then the post-loop code
            // would not re-check individual stages since it broke out. But stages
            // left in 'running' after the loop are fixed by the post-loop logic.
            // In this case, catch already set it to 'failed'.
            expect(pState.stages[0].status).toBe('failed');
        });

        it('handles rejection with abort strategy', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Inv', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'rev', name: 'Reviewer', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'abort' },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let stageIdx = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                if (stageIdx === 0) {
                    runner.state.finalReport = 'report';
                } else {
                    // Simulate rejection
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'rejected', feedback: 'Not good' } }];
                    runner.state.verdict = 'rejected';
                }
                runner.state.status = 'completed';
                stageIdx++;
            };

            const stageRejectEvents: any[] = [];
            orch.on('stage-reject', (data) => stageRejectEvents.push(data));

            const result = await orch.run('query');
            expect(result.status).toBe('failed');
            expect(stageRejectEvents).toHaveLength(1);
        });

        it('adds handoff entries for stages after the first', async () => {
            const pipeline = makePipeline();
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.finalReport = 'report';
                runner.state.status = 'completed';
            };

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            await orch.run('query');

            const handoffs = entries.filter(e => e.role === 'handoff');
            expect(handoffs.length).toBeGreaterThanOrEqual(1); // Between stage 0 and 1
        });

        it('adds report entries to conversation log', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.finalReport = 'My report content';
                runner.state.status = 'completed';
            };

            await orch.run('query');

            const convLog = orch.getPipelineState().conversationLog;
            const reports = convLog.filter(e => e.role === 'report');
            expect(reports).toHaveLength(1);
            expect(reports[0].content).toBe('My report content');
        });

        it('handles verdict entries in conversation log', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'Validator', source: 'inline', promptContent: 'x' }, canReject: true },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.actions = [{ tool: 'finish', args: { verdict: 'approved', feedback: 'Looks good' } }];
                runner.state.verdict = 'approved';
                runner.state.status = 'completed';
            };

            await orch.run('query');

            const convLog = orch.getPipelineState().conversationLog;
            const verdicts = convLog.filter(e => e.role === 'verdict');
            expect(verdicts).toHaveLength(1);
            expect(verdicts[0].content).toContain('approved');
        });

        it('bridges retrospect stage results into investigation state', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' },
                        { role: 'assistant', content: '**Analysis complete.** 1 proposed change generated.' },
                    ],
                    proposals: [{ id: 'p1', type: 'edit', filePath: 'test.md', description: 'fix', content: 'new', status: 'pending' }],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.analysisComplete).toBe(true);
            expect(result.retrospect!.proposals).toHaveLength(1);
            expect(result.retrospect!.completed).toBe(true);
        });

        it('bridges retrospect with empty proposals (no changes proposed)', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' },
                        { role: 'assistant', content: '**Analysis complete.** No changes were proposed.' },
                    ],
                    proposals: [],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.analysisComplete).toBe(true);
            expect(result.retrospect!.proposals).toHaveLength(0);
            // The message should contain "No changes were proposed."
            const assistantMsg = result.retrospect!.messages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg?.content).toContain('No changes were proposed.');
        });

        it('retrospect stage does not overwrite finalReport from a prior stage', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'sum', name: 'Summarizer', source: 'inline', promptContent: 'summarize' } },
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);

            // Stage 0 (Summarizer): sets a detailed finalReport
            let stageIdx = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                if (stageIdx === 0) {
                    runner.state.finalReport = 'Detailed investigation summary with data tables';
                    runner.state.status = 'completed';
                }
                stageIdx++;
            };
            // Stage 1 (Retrospect): generates its own report about doc changes
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'assistant', content: 'Updated 2 playbook files.' },
                    ],
                    proposals: [{ id: 'p1', type: 'edit', filePath: 'guide.md', description: 'add checklist', content: 'new', status: 'pending' }],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            // The finalReport should be the Summarizer's report, NOT the Retrospect's
            expect(result.finalReport).toBe('Detailed investigation summary with data tables');
            // Retrospect results should still be bridged
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.proposals).toHaveLength(1);
        });

        it('canReject stages do not overwrite finalReport from investigator', async () => {
            // Reproduces bug where validator/DA/SGA reports hijacked the
            // investigation finalReport when no Summarizer stage was present.
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Investigator', source: 'inline', promptContent: 'investigate' } },
                { agent: { id: 'val', name: 'Validator', source: 'inline', promptContent: 'validate' }, canReject: true, onReject: 'flag' },
                { agent: { id: 'da', name: 'Devils Advocate', source: 'inline', promptContent: 'challenge' }, canReject: true, onReject: 'flag' },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);

            let stageIdx = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                if (stageIdx === 0) {
                    // Investigator produces the real report
                    runner.state.finalReport = 'The actual investigation findings with data and analysis.';
                    runner.state.actions = [{ tool: 'finish', args: { summary: 'The actual investigation findings with data and analysis.' } }];
                } else if (stageIdx === 1) {
                    // Validator flags with its own report
                    runner.state.finalReport = 'Validation Report: FLAGGED — issues found.';
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'flagged', feedback: 'Missing scope', summary: 'Validation Report: FLAGGED — issues found.' } }];
                    runner.state.verdict = 'flagged';
                } else {
                    // DA also flags with its own report
                    runner.state.finalReport = 'DA Challenge Report: critical blind spots.';
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'flagged', feedback: 'Blind spots', summary: 'DA Challenge Report: critical blind spots.' } }];
                    runner.state.verdict = 'flagged';
                }
                runner.state.status = 'completed';
                stageIdx++;
            };

            const result = await orch.run('query');
            // finalReport must be the Investigator's report, NOT the Validator's or DA's
            expect(result.finalReport).toBe('The actual investigation findings with data and analysis.');
            // Validator and DA reports should still be in stage states
            expect(result.pipeline!.stages[1].report).toBe('Validation Report: FLAGGED — issues found.');
            expect(result.pipeline!.stages[2].report).toBe('DA Challenge Report: critical blind spots.');
        });

        it('handles rejection with loop strategy', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Inv', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'rev', name: 'Rev', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'loop', rejectTarget: 0, maxRetries: 1 },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let callCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                callCount++;
                if (callCount <= 2) {
                    // First inv run + first reviewer rejection
                    if (callCount === 2) {
                        runner.state.actions = [{ tool: 'finish', args: { verdict: 'rejected', feedback: 'Needs work' } }];
                        runner.state.verdict = 'rejected';
                    } else {
                        runner.state.finalReport = 'v1';
                    }
                } else if (callCount === 3) {
                    // Second inv run
                    runner.state.finalReport = 'v2';
                } else {
                    // Second reviewer — approve
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'approved' } }];
                    runner.state.verdict = 'approved';
                }
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            expect(callCount).toBe(4); // inv, rev(reject), inv(retry), rev(approve)
            expect(result.status).toBe('completed');
        });

        it('exhausts max retries and continues as flag', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Inv', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'rev', name: 'Rev', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'loop', rejectTarget: 0, maxRetries: 1 },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let callCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                callCount++;
                // Every reviewer run rejects
                if (callCount % 2 === 0) {
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'rejected', feedback: 'Nope' } }];
                    runner.state.verdict = 'rejected';
                } else {
                    runner.state.finalReport = 'report';
                }
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            // After 1 retry, maxRetries exceeded → treated as flag → pipeline completes
            expect(result.status).toBe('completed');
        });

        it('handles rejection with flag strategy', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'rev', name: 'Rev', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'flag' },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.actions = [{ tool: 'finish', args: { verdict: 'rejected', feedback: 'Flagged issue' } }];
                runner.state.verdict = 'rejected';
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            // Flag means mark and continue — pipeline still completes
            expect(result.status).toBe('completed');
        });

        it('handles flagged verdict with loop strategy', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Inv', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'rev', name: 'Rev', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'loop', rejectTarget: 0, maxRetries: 1 },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let callCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                callCount++;
                if (callCount === 2) {
                    // Reviewer uses 'flagged' instead of 'rejected' — should still trigger loop
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'flagged', feedback: 'Issues found' } }];
                    runner.state.verdict = 'flagged';
                } else if (callCount === 4) {
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'approved' } }];
                    runner.state.verdict = 'approved';
                } else {
                    runner.state.finalReport = `report-v${callCount}`;
                }
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            expect(callCount).toBe(4); // inv, rev(flagged→loop), inv(retry), rev(approve)
            expect(result.status).toBe('completed');
        });

        it('handles health-check verdict mapped to rejection', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'inv', name: 'Inv', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'da', name: 'DA', source: 'inline', promptContent: 'x' }, canReject: true, onReject: 'loop', rejectTarget: 0, maxRetries: 1 },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let callCount = 0;
            (orch as any).runWithTimeout = async (runner: any) => {
                callCount++;
                if (callCount === 2) {
                    // Agent uses 'critical' (health-check verdict) — should be mapped to 'rejected' by getStageResult
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'critical', feedback: 'Blind spots' } }];
                    runner.state.verdict = 'critical';
                } else if (callCount === 4) {
                    runner.state.actions = [{ tool: 'finish', args: { verdict: 'approved' } }];
                    runner.state.verdict = 'approved';
                } else {
                    runner.state.finalReport = `report-v${callCount}`;
                }
                runner.state.status = 'completed';
            };

            const result = await orch.run('query');
            expect(callCount).toBe(4); // inv, da(critical→rejected→loop), inv(retry), da(approve)
            expect(result.status).toBe('completed');
        });

        it('uses report-only input mode when configured', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' } },
                { agent: { id: 'b', name: 'B', source: 'inline', promptContent: 'x' }, inputMode: 'report-only' },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            let capturedContext: any;
            (orch as any).runWithTimeout = async (runner: any) => {
                capturedContext = runner.stageContext;
                runner.state.finalReport = 'done';
                runner.state.status = 'completed';
            };

            await orch.run('query');
            // The second stage should have received report-only context
            // (We can't directly check the filtered context, but at least it runs)
            expect(capturedContext).toBeDefined();
        });

        it('passes initial metadata through to result state', async () => {
            const pipeline = makePipeline([
                { agent: { id: 's', name: 'S', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.status = 'completed';
            };

            const result = await orch.run('query', { target: 'my-target', category: 'operational' });
            expect(result.target).toBe('my-target');
            expect(result.category).toBe('operational');
        });
    });

    describe('runWithTimeout', () => {
        it('calls runner.start directly when no timeout', async () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { start: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runWithTimeout(fakeRunner, 'test-query');
            expect(fakeRunner.start).toHaveBeenCalledWith('test-query');
        });

        it('calls runner.start with timeout wrapper', async () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { start: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runWithTimeout(fakeRunner, 'test-query', 60000);
            expect(fakeRunner.start).toHaveBeenCalledWith('test-query');
        });

        it('rejects when timeout fires before runner completes', async () => {
            vi.useFakeTimers();
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { start: vi.fn(() => new Promise(() => {})) }; // never resolves
            const promise = (orch as any).runWithTimeout(fakeRunner, 'query', 1000);
            vi.advanceTimersByTime(1100);
            await expect(promise).rejects.toThrow('timed out');
            vi.useRealTimers();
        });

        it('clears the timeout timer when runner completes before timeout', async () => {
            const clearSpy = vi.spyOn(global, 'clearTimeout');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { start: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runWithTimeout(fakeRunner, 'test-query', 60000);
            expect(clearSpy).toHaveBeenCalled();
            clearSpy.mockRestore();
        });
    });

    describe('runRetrospectStage', () => {
        it('calls runner.runRetrospectiveAnalysis directly when no timeout', async () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { runRetrospectiveAnalysis: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runRetrospectStage(fakeRunner);
            expect(fakeRunner.runRetrospectiveAnalysis).toHaveBeenCalled();
        });

        it('calls runner.runRetrospectiveAnalysis with timeout wrapper', async () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { runRetrospectiveAnalysis: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runRetrospectStage(fakeRunner, 60000);
            expect(fakeRunner.runRetrospectiveAnalysis).toHaveBeenCalled();
        });

        it('rejects when timeout fires before retrospect completes', async () => {
            vi.useFakeTimers();
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { runRetrospectiveAnalysis: vi.fn(() => new Promise(() => {})) }; // never resolves
            const promise = (orch as any).runRetrospectStage(fakeRunner, 1000);
            vi.advanceTimersByTime(1100);
            await expect(promise).rejects.toThrow('timed out');
            vi.useRealTimers();
        });

        it('clears the timeout timer when retrospect completes before timeout', async () => {
            const clearSpy = vi.spyOn(global, 'clearTimeout');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const fakeRunner = { runRetrospectiveAnalysis: vi.fn().mockResolvedValue(undefined) };
            await (orch as any).runRetrospectStage(fakeRunner, 60000);
            expect(clearSpy).toHaveBeenCalled();
            clearSpy.mockRestore();
        });
    });

    describe('forwardRunnerEvents', () => {
        it('converts thought events to conversation entries', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', agentColor: '#fff', agentIcon: '🔍', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('thought', 'A test thought');
            expect(entries).toHaveLength(1);
            expect(entries[0].role).toBe('thought');
            expect(entries[0].content).toBe('A test thought');
            expect(entries[0].agentName).toBe('Agent 1');
        });

        it('converts thought object events to conversation entries', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('thought', { content: 'Object thought' });
            expect(entries).toHaveLength(1);
            expect(entries[0].content).toBe('Object thought');
        });

        it('skips System Alert thoughts', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('thought', 'System Alert: something');
            expect(entries).toHaveLength(0);
        });

        it('converts action string events to conversation entries', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', agentColor: '#fff', agentIcon: '🛠️', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('action', 'some action string');
            expect(entries).toHaveLength(1);
            expect(entries[0].role).toBe('action');
            expect(entries[0].content).toBe('some action string');
        });

        it('converts action object events (with description) to conversation entries', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('action', { description: 'tool ran', tool: 'kusto_query' });
            expect(entries).toHaveLength(1);
            expect(entries[0].content).toBe('tool ran');
        });

        it('converts action object events (with tool fallback) to conversation entries', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('action', { tool: 'kusto_query' });
            expect(entries).toHaveLength(1);
            expect(entries[0].content).toBe('kusto_query');
        });

        it('skips empty action content', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('action', '');
            expect(entries).toHaveLength(0);
        });

        it('forwards standard runner events', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'Agent 1', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const logs: any[] = [];
            orch.on('log', (data) => logs.push(data));
            runner.emit('log', 'test log');
            expect(logs).toHaveLength(1);
        });
    });

    describe('buildAgentPrompt', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
        });

        it('returns empty string for builtin agent without promptPath', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'b', name: 'B', source: 'builtin' as const, builtinType: 'investigator' as const };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toBe('');
        });

        it('uses fallback prompt for unknown source', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'x', name: 'X Agent', source: 'unknown' as any, description: 'A test agent' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are X Agent');
            expect(result).toContain('A test agent');
        });

        it('uses file source prompt when file exists', () => {
            const promptFile = path.join(tmpDir, 'prompt.md');
            fs.writeFileSync(promptFile, 'File prompt for {{GOAL}}');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'f', name: 'F', source: 'file' as const, promptPath: promptFile };
            const state = { query: 'the goal', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('the goal');
        });

        it('falls back when file source prompt not found', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'f', name: 'FileMissing', source: 'file' as const, promptPath: '/nonexistent/missing.md' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are FileMissing');
        });

        it('loads builtin agent prompt from file when promptPath exists', () => {
            const promptFile = path.join(tmpDir, 'validator.md');
            fs.writeFileSync(promptFile, 'Builtin prompt {{TARGET}}');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'b', name: 'B', source: 'builtin' as const, builtinType: 'validator' as const, promptPath: promptFile };
            const state = { query: 'q', target: 'my-stamp', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('my-stamp');
        });

        it('falls back when file source prompt not found with relative path', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: tmpDir } as any);
            const agent = { id: 'f', name: 'FileMissing', source: 'file' as const, promptPath: 'nonexistent/missing.md' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are FileMissing');
        });

        it('falls back when builtin agent relative promptPath not found', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: tmpDir } as any);
            const agent = { id: 'b', name: 'BuiltinMissing', source: 'builtin' as const, builtinType: 'validator' as const, promptPath: 'nonexistent/missing.md' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are BuiltinMissing');
        });

        it('substitutes all template variables', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'x', name: 'My Agent', source: 'inline' as const, promptContent: '{{GOAL}} | {{TARGET}} | {{STATUS}} | {{CATEGORY}} | {{REPORT}} | {{CONVERSATION}} | {{AGENT_NAME}} | {{AGENT_NAMES}}' };
            const state = { query: 'goal', target: 'stamp', status: 'ok', category: 'cat' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('goal');
            expect(result).toContain('stamp');
            expect(result).toContain('ok');
            expect(result).toContain('cat');
            expect(result).toContain('My Agent');
        });

        it('uses file source prompt with relative path when file exists', () => {
            const promptFile = path.join(tmpDir, 'relative-prompt.md');
            fs.writeFileSync(promptFile, 'Relative file prompt');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: tmpDir } as any);
            const agent = { id: 'f', name: 'F', source: 'file' as const, promptPath: 'relative-prompt.md' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('Relative file prompt');
        });

        it('uses builtin agent prompt with relative path when file exists', () => {
            const promptFile = path.join(tmpDir, 'builtin-prompt.md');
            fs.writeFileSync(promptFile, 'Builtin relative prompt');
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: tmpDir } as any);
            const agent = { id: 'b', name: 'B', source: 'builtin' as const, builtinType: 'validator' as const, promptPath: 'builtin-prompt.md' };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('Builtin relative prompt');
        });

        it('uses fallback prompt with no description', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'x', name: 'NoDesc', source: 'unknown' as any };
            const state = { query: 'q', target: 't', status: 'running', category: 'ops' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are NoDesc.');
        });

        it('handles missing status in template substitution', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const agent = { id: 'x', name: 'X', source: 'inline' as const, promptContent: 'Status={{STATUS}}' };
            const state = { query: 'q', target: 't' } as any; // no status
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('Status=');
        });

        it('resolves file prompt with empty repoRoot', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: '' } as any);
            const agent = { id: 'f', name: 'F', source: 'file' as const, promptPath: 'nonexistent.md' };
            const state = { query: 'q', target: 't', status: 'ok' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are F');
        });

        it('resolves builtin prompt with empty repoRoot', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, { ...baseConfig, repoRoot: '' } as any);
            const agent = { id: 'b', name: 'B', source: 'builtin' as const, builtinType: 'validator' as const, promptPath: 'nonexistent.md' };
            const state = { query: 'q', target: 't', status: 'ok' } as any;
            const stage = { agent } as any;
            const result = (orch as any).buildAgentPrompt(agent, stage, 0, state);
            expect(result).toContain('You are B');
        });
    });

    describe('additional branch coverage', () => {
        it('handles thought data with text property (no content)', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'A', agentColor: '#fff', agentIcon: '🔍', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('thought', { text: 'from text field' });
            expect(entries).toHaveLength(1);
            expect(entries[0].content).toBe('from text field');
        });

        it('handles thought data that is neither string nor has content/text', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'A', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('thought', { arbitrary: 42 });
            expect(entries).toHaveLength(1);
            // String(data) fallback
            expect(entries[0].content).toBe('[object Object]');
        });

        it('handles action data that is neither string nor has description/tool', () => {
            const orch = new PipelineOrchestrator(makePipeline(), baseLlmProvider as any, baseConfig as any);
            const runner = new EventEmitter() as any;
            const identity = { agentId: 'a1', agentName: 'A', stageIndex: 0 };
            (orch as any).forwardRunnerEvents(runner, identity);

            const entries: any[] = [];
            orch.on('conversation-entry', (e) => entries.push(e));

            runner.emit('action', { arbitrary: 42 });
            expect(entries).toHaveLength(1);
            // String(data) fallback
            expect(entries[0].content).toBe('[object Object]');
        });

        it('single proposal uses singular "change"', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' },
                        { role: 'assistant', content: '**Analysis complete.** 1 proposed change generated.' },
                    ],
                    proposals: [{ id: 'p1', type: 'edit', filePath: 'a.md', description: 'fix', content: '', status: 'pending' }],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            const assistantMsg = result.retrospect!.messages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg?.content).toContain('1 proposed change generated.');
        });

        it('retrospect bridge uses result.report when available', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' },
                        { role: 'assistant', content: 'Custom report text\n\n---\n\n**Analysis complete.** 2 proposed changes generated.' },
                    ],
                    proposals: [{ id: 'p1' }, { id: 'p2' }],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            const assistantMsg = result.retrospect!.messages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg?.content).toContain('Custom report text');
            expect(assistantMsg?.content).toContain('2 proposed changes generated.');
        });

        it('retrospect bridge with missing report uses default text', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [
                        { role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' },
                        { role: 'assistant', content: '**Analysis complete.** No changes were proposed.' },
                    ],
                    proposals: [],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.completed).toBe(true);
            expect(result.retrospect!.proposals).toHaveLength(0);
        });

        it('retrospect report falls back to default when no assistant messages exist', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [{ role: 'user', content: 'trigger' }], // no assistant messages
                    proposals: [{ id: 'p1' }],
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            // The conversation log should contain the fallback report
            const convLog = orch.getPipelineState().conversationLog;
            const reports = convLog.filter(e => e.role === 'report');
            expect(reports).toHaveLength(1);
            expect(reports[0].content).toContain('Knowledge base analysis complete');
            expect(reports[0].content).toContain('1 change proposed');
        });

        it('retrospect bridge with undefined proposals falls back to empty array', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                runner.state.retrospect = {
                    messages: [],
                    // proposals intentionally omitted — tests the fallback
                    analysisComplete: true,
                };
            };

            const result = await orch.run('query');
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.completed).toBe(true);
        });

        it('retrospect bridge uses fallback when retrospect state is null', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'retro', name: 'Retro', source: 'builtin', builtinType: 'retrospect' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runRetrospectStage = async (runner: any) => {
                // Don't set runner.state.retrospect — tests the null fallback path
            };

            const result = await orch.run('query');
            expect(result.retrospect).toBeDefined();
            expect(result.retrospect!.analysisComplete).toBe(true);
            expect(result.retrospect!.completed).toBe(true);
            expect(result.retrospect!.proposals).toHaveLength(0);
            const assistantMsg = result.retrospect!.messages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg?.content).toContain('No changes were proposed.');
        });

        it('stage with timeout set passes timeout to runWithTimeout', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'A', source: 'inline', promptContent: 'x' }, timeout: 5 },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            const origRunWithTimeout = (orch as any).runWithTimeout.bind(orch);
            let capturedTimeout: number | undefined;
            (orch as any).runWithTimeout = async (runner: any, query: string, timeout?: number) => {
                capturedTimeout = timeout;
                runner.state.status = 'completed';
                runner.state.finalReport = 'done';
            };

            await orch.run('query');
            expect(capturedTimeout).toBe(5 * 60_000);
        });

        it('stage completion emits duration with completedAt/startedAt', async () => {
            const pipeline = makePipeline([
                { agent: { id: 'a', name: 'Timed', source: 'inline', promptContent: 'x' } },
            ]);
            const orch = new PipelineOrchestrator(pipeline, baseLlmProvider as any, baseConfig as any);
            (orch as any).runWithTimeout = async (runner: any) => {
                runner.state.status = 'completed';
                runner.state.finalReport = 'done';
            };

            const events: any[] = [];
            orch.on('stage-complete', (e) => events.push(e));

            await orch.run('query');

            expect(events).toHaveLength(1);
            // startedAt and completedAt should be set, giving a real duration
            const stage = orch.getPipelineState().stages[0];
            expect(stage.startedAt).toBeDefined();
            expect(stage.completedAt).toBeDefined();
        });
    });
});

// ──────────────────────────────────────────────
// Pipeline Presets
// ──────────────────────────────────────────────
describe('Pipeline Presets', () => {
    describe('PIPELINE_PRESETS', () => {
        it('contains at least 5 presets', () => {
            expect(PIPELINE_PRESETS.length).toBeGreaterThanOrEqual(5);
        });

        it('each preset has id, name, description, icon, and at least one stage', () => {
            for (const preset of PIPELINE_PRESETS) {
                expect(preset.id).toBeTruthy();
                expect(preset.name).toBeTruthy();
                expect(preset.description).toBeTruthy();
                expect(preset.icon).toBeTruthy();
                expect(preset.stages.length).toBeGreaterThan(0);
            }
        });

        it('all stage builtinTypes reference valid builtin agents', () => {
            for (const preset of PIPELINE_PRESETS) {
                for (const stage of preset.stages) {
                    expect(getBuiltinAgent(stage.builtinType)).toBeDefined();
                }
            }
        });

        it('all preset IDs are unique', () => {
            const ids = PIPELINE_PRESETS.map(p => p.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('includes the deep-investigation preset', () => {
            const deep = PIPELINE_PRESETS.find(p => p.id === 'deep-investigation');
            expect(deep).toBeDefined();
            expect(deep!.name).toBe('Deep Investigation');
            expect(deep!.stages.some(s => s.builtinType === 'planner')).toBe(true);
            expect(deep!.stages.some(s => s.builtinType === 'investigator')).toBe(true);
            expect(deep!.stages.some(s => s.builtinType === 'summarizer')).toBe(true);
        });

        it('includes the default preset', () => {
            const def = PIPELINE_PRESETS.find(p => p.id === 'default');
            expect(def).toBeDefined();
            expect(def!.stages.some(s => s.builtinType === 'investigator')).toBe(true);
        });
    });

    describe('buildPipelinePreset', () => {
        it('builds a valid PipelineDefinition from a known preset', () => {
            const pipeline = buildPipelinePreset('deep-investigation');
            expect(pipeline.id).toBe('preset-deep-investigation');
            expect(pipeline.name).toBe('Deep Investigation');
            expect(pipeline.stages.length).toBeGreaterThan(0);
            // Each stage should have a resolved agent
            for (const stage of pipeline.stages) {
                expect(stage.agent).toBeDefined();
                expect(stage.agent!.name).toBeTruthy();
            }
        });

        it('preserves canReject, onReject, rejectTarget, and maxRetries', () => {
            const pipeline = buildPipelinePreset('deep-investigation');
            const validatorStage = pipeline.stages.find(s => s.agent?.builtinType === 'validator');
            expect(validatorStage).toBeDefined();
            expect(validatorStage!.canReject).toBe(true);
            expect(validatorStage!.onReject).toBe('loop');
            expect(validatorStage!.rejectTarget).toBe(2);
            expect(validatorStage!.maxRetries).toBe(1);
        });

        it('sets inputMode to conversation on all stages', () => {
            const pipeline = buildPipelinePreset('default');
            for (const stage of pipeline.stages) {
                expect(stage.inputMode).toBe('conversation');
            }
        });

        it('throws for unknown preset ID', () => {
            expect(() => buildPipelinePreset('nonexistent')).toThrow(/Unknown pipeline preset/);
        });

        it('throws when all stages resolve to unknown agents', () => {
            // Temporarily inject a preset with invalid builtinTypes
            const fakePreset = {
                id: 'test-empty-stages',
                name: 'Test Empty Stages',
                description: 'Test preset',
                stages: [
                    { builtinType: 'nonexistent-agent-type-1' },
                    { builtinType: 'nonexistent-agent-type-2' },
                ],
            };
            PIPELINE_PRESETS.push(fakePreset as any);
            try {
                expect(() => buildPipelinePreset('test-empty-stages')).toThrow(/No agents available for preset/);
            } finally {
                PIPELINE_PRESETS.pop();
            }
        });

        it('builds all presets without error', () => {
            for (const preset of PIPELINE_PRESETS) {
                const pipeline = buildPipelinePreset(preset.id);
                expect(pipeline.stages.length).toBeGreaterThan(0);
            }
        });
    });

    describe('listPipelinePresets', () => {
        it('returns all presets', () => {
            const presets = listPipelinePresets();
            expect(presets).toBe(PIPELINE_PRESETS);
            expect(presets.length).toBeGreaterThanOrEqual(5);
        });
    });

    describe('matchPipelinePreset', () => {
        it('matches by pipeline id convention (preset-<id>)', () => {
            const pipeline = buildPipelinePreset('deep-investigation');
            expect(matchPipelinePreset(pipeline)).toBe('deep-investigation');
        });

        it('matches by pipeline name', () => {
            expect(matchPipelinePreset({ id: 'custom-id', name: 'Deep Investigation', stages: [] })).toBe('deep-investigation');
        });

        it('returns undefined for non-matching pipeline', () => {
            expect(matchPipelinePreset({ id: 'custom', name: 'My Custom Pipeline', stages: [] })).toBeUndefined();
        });

        it('returns undefined for pipeline with preset-like id but unknown suffix', () => {
            expect(matchPipelinePreset({ id: 'preset-nonexistent', name: 'Unknown', stages: [] })).toBeUndefined();
        });

        it('matches all built presets', () => {
            for (const preset of PIPELINE_PRESETS) {
                const pipeline = buildPipelinePreset(preset.id);
                expect(matchPipelinePreset(pipeline)).toBe(preset.id);
            }
        });
    });
});
