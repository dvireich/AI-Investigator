import { AgentKind } from '../pipeline/AgentDefinition';
import { SingleAgentContext } from '../pipeline/SingleAgentRunner';
import { InvestigationState } from '../Runner';

/**
 * Raw input for an agent invocation, before context-provider transformation.
 * Shape varies by agent kind: a notes-rephraser sees `{ text: '...' }`, an
 * executive-report agent sees `{ stats, history }`, etc. The registry below
 * normalizes each into a `SingleAgentContext` that only contains the fields
 * the prompt template needs.
 */
export type RawAgentInput = Record<string, unknown>;

/**
 * Context provider: maps raw caller input + optional investigation state
 * into a `SingleAgentContext` suitable for the agent's prompt template.
 */
export type ContextProviderFn = (
    rawInput: RawAgentInput,
    investigation?: InvestigationState,
) => SingleAgentContext;

/**
 * Default provider used when no kind-specific provider is registered, or for
 * `'custom'` agents. Pulls common investigation fields and copies anything
 * extra from `rawInput` into `custom`.
 */
function defaultProvider(rawInput: RawAgentInput, investigation?: InvestigationState): SingleAgentContext {
    /** Whitelist of standard fields recognized by the prompt template. */
    const standardKeys: readonly string[] = [
        'goal', 'target', 'category', 'status', 'verdict', 'report',
        'plan', 'notesText', 'recommendationsJson',
        'scheduleName', 'scheduleTarget', 'scheduleStatsTable', 'scheduleHistoryDigest',
        'knowledgeBaseFiles',
    ];
    /** Build context from investigation + standard rawInput fields. */
    const ctx: SingleAgentContext = {
        goal: pickString(rawInput.goal) ?? investigation?.query,
        target: pickString(rawInput.target) ?? investigation?.target,
        category: pickString(rawInput.category) ?? investigation?.category,
        status: pickString(rawInput.status) ?? investigation?.status,
        verdict: pickString(rawInput.verdict) ?? investigation?.verdict,
        report: pickString(rawInput.report) ?? investigation?.finalReport,
        plan: pickString(rawInput.plan),
        notesText: pickString(rawInput.notesText),
        recommendationsJson: pickString(rawInput.recommendationsJson),
        scheduleName: pickString(rawInput.scheduleName),
        scheduleTarget: pickString(rawInput.scheduleTarget),
        scheduleStatsTable: pickString(rawInput.scheduleStatsTable),
        scheduleHistoryDigest: pickString(rawInput.scheduleHistoryDigest),
        knowledgeBaseFiles: pickString(rawInput.knowledgeBaseFiles),
    };
    /** Forward any extra keys verbatim into the custom map. */
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawInput)) {
        if (!standardKeys.includes(k) && typeof v === 'string') custom[k] = v;
    }
    if (Object.keys(custom).length > 0) ctx.custom = custom;
    return ctx;
}

/** Helper: return a string when the value is a string, else undefined. */
function pickString(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined;
}

/**
 * Provider for `recommendation-extractor`. Always provides `report`.
 * Falls back to investigation.finalReport when not in rawInput.
 */
function recommendationExtractorProvider(
    rawInput: RawAgentInput, investigation?: InvestigationState,
): SingleAgentContext {
    return {
        goal: pickString(rawInput.goal) ?? investigation?.query,
        target: pickString(rawInput.target) ?? investigation?.target,
        report: pickString(rawInput.report) ?? investigation?.finalReport ?? '',
    };
}

/**
 * Provider for `code-implementer`. Requires `recommendationsJson` (the selected
 * subset of recommendations). Pulls report + investigation context.
 */
function codeImplementerProvider(
    rawInput: RawAgentInput, investigation?: InvestigationState,
): SingleAgentContext {
    /** Recommendations payload — the caller serializes the selection. */
    let recsJson: string | undefined = pickString(rawInput.recommendationsJson);
    if (!recsJson && Array.isArray(rawInput.recommendations)) {
        recsJson = JSON.stringify(rawInput.recommendations, null, 2);
    }
    if (!recsJson && investigation?.recommendations) {
        recsJson = JSON.stringify(investigation.recommendations, null, 2);
    }
    return {
        goal: pickString(rawInput.goal) ?? investigation?.query,
        target: pickString(rawInput.target) ?? investigation?.target,
        category: pickString(rawInput.category) ?? investigation?.category,
        verdict: pickString(rawInput.verdict) ?? investigation?.verdict,
        report: pickString(rawInput.report) ?? investigation?.finalReport,
        recommendationsJson: recsJson || '[]',
    };
}

/**
 * Provider for `kb-improver`. Pulls a knowledge-base file listing if the caller
 * supplied one, otherwise relies on the agent's tools to discover it.
 */
function kbImproverProvider(
    rawInput: RawAgentInput, investigation?: InvestigationState,
): SingleAgentContext {
    return {
        goal: pickString(rawInput.goal) ?? investigation?.query,
        target: pickString(rawInput.target) ?? investigation?.target,
        category: pickString(rawInput.category) ?? investigation?.category,
        status: pickString(rawInput.status) ?? investigation?.status,
        knowledgeBaseFiles: pickString(rawInput.knowledgeBaseFiles) ?? '',
    };
}

/**
 * Provider for `executive-report`. Receives pre-computed stats and history
 * digest from the caller (typically the Scheduler). Performs no math.
 */
function executiveReportProvider(rawInput: RawAgentInput): SingleAgentContext {
    return {
        scheduleName: pickString(rawInput.scheduleName) ?? '',
        scheduleTarget: pickString(rawInput.scheduleTarget) ?? '',
        scheduleStatsTable: pickString(rawInput.scheduleStatsTable) ?? '',
        scheduleHistoryDigest: pickString(rawInput.scheduleHistoryDigest) ?? '',
    };
}

/** Provider for `notes-rephraser`. Maps `{ text }` or `{ notesText }` into context. */
function notesRephraserProvider(rawInput: RawAgentInput): SingleAgentContext {
    return {
        notesText: pickString(rawInput.notesText) ?? pickString(rawInput.text) ?? '',
    };
}

/**
 * Registry mapping every `AgentKind` to a context provider. Kinds without an
 * entry fall back to `defaultProvider`.
 */
export const CONTEXT_PROVIDERS: Partial<Record<AgentKind, ContextProviderFn>> = {
    'recommendation-extractor': recommendationExtractorProvider,
    'code-implementer': codeImplementerProvider,
    'kb-improver': kbImproverProvider,
    'executive-report': executiveReportProvider,
    'notes-rephraser': notesRephraserProvider,
};

/**
 * Resolve the context provider for an agent's kind, returning the default when
 * no kind-specific provider is registered.
 */
export function getContextProvider(kind: AgentKind | undefined): ContextProviderFn {
    if (kind && CONTEXT_PROVIDERS[kind]) return CONTEXT_PROVIDERS[kind] as ContextProviderFn;
    return defaultProvider;
}
