import { AgentDefinition } from './AgentDefinition';

/**
 * A single stage in a multi-agent pipeline.
 *
 * Each stage runs one agent. The agent can be referenced by ID from the
 * pipeline's `agents` library, or defined inline.
 */
export interface PipelineStage {
    /**
     * Reference to an agent defined in `PipelineDefinition.agents` by its `id`.
     * Mutually preferred over `agent` (inline) — if both are set, `agentId` wins.
     */
    agentId?: string;

    /** Inline agent definition. Used when `agentId` is not set. */
    agent?: AgentDefinition;

    /**
     * Whether this agent can reject/send the investigation back.
     * Any agent can be a reviewer — not just "validators".
     * Default: false.
     */
    canReject?: boolean;

    /**
     * What happens when this agent rejects.
     * Only applicable when `canReject: true`.
     *
     * - `'loop'`  — re-run the `rejectTarget` stage with feedback injected
     * - `'flag'`  — mark the verdict but continue the pipeline (default)
     * - `'abort'` — stop the entire pipeline with a 'failed' status
     */
    onReject?: 'loop' | 'flag' | 'abort';

    /**
     * Which stage to loop back to when `onReject: 'loop'`.
     * Can be a 0-based stage index or `'previous'` (the stage immediately before this one).
     * Default: `'previous'`.
     */
    rejectTarget?: number | 'previous';

    /**
     * Maximum number of reject → re-run loops before the pipeline gives up
     * and continues (treating the last rejection as a flag).
     * Default: 2. Hard cap: 5.
     */
    maxRetries?: number;

    /** Stage timeout in minutes. If the agent doesn't finish in time, the stage fails. */
    timeout?: number;

    /**
     * What context this agent receives from prior stages.
     *
     * - `'conversation'`  — (default) the full multi-agent conversation log from all prior stages
     * - `'report-only'`   — only the most recent stage's report (lighter context)
     */
    inputMode?: 'conversation' | 'report-only';
}

/**
 * Defines a multi-agent pipeline — an ordered sequence of agent stages
 * that an investigation flows through.
 *
 * Example pipeline: investigator → security-reviewer → compliance-checker → summarizer
 */
export interface PipelineDefinition {
    /** Unique identifier for this pipeline configuration. */
    id: string;

    /** Display name for this pipeline (shown in config UI). */
    name?: string;

    /** Ordered list of stages the investigation passes through. */
    stages: PipelineStage[];

    /**
     * Named agent library — reusable agent definitions that stages can
     * reference by `agentId`. This avoids duplicating agent configs when
     * the same agent appears in multiple pipelines or stages.
     */
    agents?: AgentDefinition[];
}

/**
 * Clamp maxRetries to the hard cap.
 */
const MAX_RETRIES_CAP = 5;

/**
 * Resolve the AgentDefinition for a given pipeline stage.
 * Looks up `agentId` in the pipeline's agent library, or returns the inline `agent`.
 * Throws if neither is provided or the referenced agent is not found.
 */
export function resolveStageAgent(
    stage: PipelineStage,
    pipeline: PipelineDefinition
): AgentDefinition {
    if (stage.agentId) {
        const found = pipeline.agents?.find(a => a.id === stage.agentId);
        if (!found) {
            throw new Error(
                `Pipeline stage references agentId '${stage.agentId}' but no agent with that ID exists in the pipeline's agents library.`
            );
        }
        return found;
    }
    if (stage.agent) {
        return stage.agent;
    }
    throw new Error(
        'Pipeline stage must have either an `agentId` (referencing the agents library) or an inline `agent` definition.'
    );
}

/**
 * Resolve the reject target stage index.
 * Returns a 0-based index, clamped to valid range.
 */
export function resolveRejectTarget(
    stage: PipelineStage,
    currentIndex: number,
    totalStages: number
): number {
    const target = stage.rejectTarget ?? 'previous';
    if (target === 'previous') {
        return Math.max(0, currentIndex - 1);
    }
    if (typeof target === 'number') {
        if (target < 0 || target >= totalStages) {
            throw new Error(
                `rejectTarget ${target} is out of range [0, ${totalStages - 1}].`
            );
        }
        if (target >= currentIndex) {
            throw new Error(
                `rejectTarget ${target} must point to an earlier stage (current: ${currentIndex}).`
            );
        }
        return target;
    }
    return Math.max(0, currentIndex - 1);
}

/**
 * Get the effective maxRetries for a stage, clamped to the hard cap.
 */
export function getEffectiveMaxRetries(stage: PipelineStage): number {
    const raw = stage.maxRetries ?? 2;
    return Math.min(Math.max(0, raw), MAX_RETRIES_CAP);
}

/**
 * Validate a pipeline definition. Throws on invalid configurations.
 */
export function validatePipeline(pipeline: PipelineDefinition): void {
    if (!pipeline.stages || pipeline.stages.length === 0) {
        throw new Error('Pipeline must have at least one stage.');
    }

    const agentIds = new Set(pipeline.agents?.map(a => a.id) ?? []);

    for (let i = 0; i < pipeline.stages.length; i++) {
        const stage = pipeline.stages[i];

        // Must have either agentId or inline agent
        if (!stage.agentId && !stage.agent) {
            throw new Error(
                `Pipeline stage ${i} must have either 'agentId' or 'agent'.`
            );
        }

        // If agentId is set, it must exist in the library
        if (stage.agentId && !agentIds.has(stage.agentId)) {
            throw new Error(
                `Pipeline stage ${i} references agentId '${stage.agentId}' which is not in the agents library.`
            );
        }

        // rejectTarget validation
        if (stage.canReject && stage.onReject === 'loop') {
            const target = stage.rejectTarget ?? 'previous';
            if (typeof target === 'number') {
                if (target < 0 || target >= pipeline.stages.length) {
                    throw new Error(
                        `Pipeline stage ${i}: rejectTarget ${target} is out of range.`
                    );
                }
                if (target >= i) {
                    throw new Error(
                        `Pipeline stage ${i}: rejectTarget ${target} must point to an earlier stage.`
                    );
                }
            }
        }
    }
}
