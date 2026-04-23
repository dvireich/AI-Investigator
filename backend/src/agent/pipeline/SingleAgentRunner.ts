import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { AgentDefinition, ConversationEntry } from './AgentDefinition';
import { PipelineDefinition, PipelineStage } from './PipelineDefinition';
import { PipelineOrchestrator } from './PipelineOrchestrator';
import { AgentConfig, InvestigationState, ProposedChange, RetrospectMessage } from '../Runner';
import { LlmProvider } from '../llm/LlmProvider';
import { extractFirstJson, validateAgainstSchema, ValidationError } from './jsonSchemaValidator';

/**
 * Inputs collected by an agent's context provider, passed to `runSingleAgent`.
 *
 * Every field is optional; the runner substitutes the matching `{{TEMPLATE}}`
 * placeholder in the agent prompt when present (replaces with empty string when
 * absent). Bind new fields here only when a built-in prompt needs them.
 */
export interface SingleAgentContext {
    /** Investigation goal / user query. Bound to `{{GOAL}}`. */
    goal?: string;
    /** Investigation target (cluster, service, etc.). Bound to `{{TARGET}}`. */
    target?: string;
    /** Investigation category. Bound to `{{CATEGORY}}`. */
    category?: string;
    /** Investigation status. Bound to `{{STATUS}}`. */
    status?: string;
    /** Investigation verdict. Bound to `{{VERDICT}}`. */
    verdict?: string;
    /** Final investigation report markdown. Bound to `{{REPORT}}`. */
    report?: string;
    /** Recommendations array serialized as JSON. Bound to `{{RECOMMENDATIONS_JSON}}`. */
    recommendationsJson?: string;
    /** User-supplied notes text. Bound to `{{NOTES_TEXT}}`. */
    notesText?: string;
    /** Schedule display name. Bound to `{{SCHEDULE_NAME}}`. */
    scheduleName?: string;
    /** Schedule target description. Bound to `{{SCHEDULE_TARGET}}`. */
    scheduleTarget?: string;
    /** Pre-computed deterministic stats markdown table. Bound to `{{SCHEDULE_STATS_TABLE}}`. */
    scheduleStatsTable?: string;
    /** Pre-formatted run history digest. Bound to `{{SCHEDULE_HISTORY_DIGEST}}`. */
    scheduleHistoryDigest?: string;
    /** Knowledge base file listing. Bound to `{{KNOWLEDGE_BASE_FILES}}`. */
    knowledgeBaseFiles?: string;
    /** Upstream Planner output. Bound to `{{PLAN}}`. */
    plan?: string;
    /** Free-form additional substitutions: `{{KEY}}` → value. */
    custom?: Record<string, string>;
}

/**
 * Result returned by `runSingleAgent`.
 */
export interface SingleAgentResult {
    /** Raw text returned by the LLM (final text for tool-loop, single response for single-shot). */
    output: string;
    /** Parsed JSON value when `agent.outputFormat === 'json'` and parsing succeeded. */
    parsedJson?: unknown;
    /** JSON parse / schema-validation errors, when applicable. Empty when valid. */
    validationErrors?: ValidationError[];
    /** Code-change proposals collected during a tool-loop run (e.g. kb-improver, code-implementer). */
    proposals?: ProposedChange[];
    /** Conversation messages from a tool-loop run. */
    messages?: RetrospectMessage[];
}

/**
 * Options modifying a single-agent run.
 */
export interface SingleAgentRunOptions {
    /** Optional event emitter — events from a tool-loop run are forwarded onto it. */
    emitter?: EventEmitter;
    /** Optional investigation state for tool-loop agents that need investigation context. */
    investigationState?: Partial<InvestigationState>;
}

/**
 * Substitute `{{TEMPLATE}}` placeholders in `prompt` with values from `ctx`.
 *
 * Missing fields are replaced with the empty string. Custom keys are upper-cased
 * before matching: `{ custom: { fooBar: 'x' } }` matches `{{FOO_BAR}}` only when
 * the user passes the upper-snake form themselves; we do not transform.
 */
export function substituteTemplate(prompt: string, ctx: SingleAgentContext): string {
    /** Map of placeholder name → replacement value. */
    const subs: Record<string, string> = {
        GOAL: ctx.goal || '',
        TARGET: ctx.target || '',
        CATEGORY: ctx.category || '',
        STATUS: ctx.status || '',
        VERDICT: ctx.verdict || '',
        REPORT: ctx.report || '',
        RECOMMENDATIONS_JSON: ctx.recommendationsJson || '',
        NOTES_TEXT: ctx.notesText || '',
        SCHEDULE_NAME: ctx.scheduleName || '',
        SCHEDULE_TARGET: ctx.scheduleTarget || '',
        SCHEDULE_STATS_TABLE: ctx.scheduleStatsTable || '',
        SCHEDULE_HISTORY_DIGEST: ctx.scheduleHistoryDigest || '',
        KNOWLEDGE_BASE_FILES: ctx.knowledgeBaseFiles || '',
        PLAN: ctx.plan || '',
    };
    // Merge user custom overrides (verbatim keys).
    if (ctx.custom) {
        for (const [k, v] of Object.entries(ctx.custom)) {
            subs[k] = v;
        }
    }
    /** Result accumulator. */
    let result: string = prompt;
    // Substitute every known placeholder.
    for (const [key, value] of Object.entries(subs)) {
        // Escape special regex characters in `key` (none expected, but defensive).
        const re: RegExp = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(re, value);
    }
    return result;
}

/**
 * Resolve an agent's `promptPath` to an absolute path and read its contents.
 * Throws loudly when `promptPath` is missing or unreadable — this is a built-in
 * configuration error, not a runtime warning to swallow.
 */
export function loadAgentPrompt(agent: AgentDefinition, baseConfig: AgentConfig): string {
    // Inline source: prompt is provided directly on the agent.
    if (agent.source === 'inline' && agent.promptContent) {
        return agent.promptContent;
    }
    // Every other source requires a promptPath.
    if (!agent.promptPath) {
        throw new Error(
            `Agent '${agent.id}' (${agent.name}) has no promptPath. Built-in and file-source agents must specify a prompt file.`
        );
    }
    /** Resolved absolute path to the prompt file. */
    const resolved: string = path.isAbsolute(agent.promptPath)
        ? agent.promptPath
        : path.join(baseConfig.repoRoot || process.cwd(), agent.promptPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(
            `Agent '${agent.id}' (${agent.name}) prompt file not found: ${resolved}`
        );
    }
    return fs.readFileSync(resolved, 'utf8');
}

/**
 * Execute a single agent — the on-demand counterpart to `PipelineOrchestrator.run()`.
 *
 * Branches on `agent.executionMode`:
 *  - `single-shot` (default for stateless reasoners): one LLM call, optional JSON
 *    extraction + schema validation. No tool loop, no conversation log.
 *  - `tool-loop`: builds a single-stage pipeline and runs it via `PipelineOrchestrator`,
 *    so the agent has full MCP tool access just like a normal pipeline stage.
 *
 * This is the only public surface besides `PipelineOrchestrator.run()` for invoking
 * an LLM-backed agent. The HTTP `POST /api/agents/run` endpoint is a thin wrapper
 * over this function.
 */
export async function runSingleAgent(
    agent: AgentDefinition,
    ctx: SingleAgentContext,
    llmProvider: LlmProvider,
    baseConfig: AgentConfig,
    options: SingleAgentRunOptions = {}
): Promise<SingleAgentResult> {
    /** Resolved execution mode (default 'tool-loop' for legacy custom agents). */
    const mode: 'tool-loop' | 'single-shot' = agent.executionMode || 'tool-loop';
    /** Resolved output format (default 'markdown'). */
    const outputFormat: 'markdown' | 'json' = agent.outputFormat || 'markdown';

    if (mode === 'single-shot') {
        return runSingleShot(agent, ctx, llmProvider, baseConfig, outputFormat);
    }
    return runToolLoop(agent, ctx, llmProvider, baseConfig, options);
}

/** Execute a single-shot agent: one LLM call, optional JSON validation. */
async function runSingleShot(
    agent: AgentDefinition,
    ctx: SingleAgentContext,
    llmProvider: LlmProvider,
    baseConfig: AgentConfig,
    outputFormat: 'markdown' | 'json'
): Promise<SingleAgentResult> {
    /** Loaded prompt template. */
    const rawPrompt: string = loadAgentPrompt(agent, baseConfig);
    /** Prompt with template variables substituted. */
    const systemPrompt: string = substituteTemplate(rawPrompt, ctx);
    /** OpenAI SDK client from the provider (30s default timeout). */
    const client = await llmProvider.getClient(60_000);
    /** Resolved model: per-agent override → base config → fallback. */
    const model: string = agent.model || baseConfig.model || 'gpt-4o-mini';
    /** Single chat-completion call. */
    const completion = await client.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            // Single-shot agents put all dynamic context into the system prompt
            // via template variables; the user message is intentionally minimal.
            { role: 'user', content: 'Proceed.' },
        ],
    });
    /** Raw assistant text. */
    const output: string = completion.choices[0]?.message?.content?.trim() || '';
    /** Result object we'll build up. */
    const result: SingleAgentResult = { output };

    if (outputFormat === 'json') {
        // Attempt to extract JSON from the response text.
        const parsed: unknown = extractFirstJson(output);
        if (parsed === undefined) {
            // Could not parse JSON — record as a single validation error.
            result.validationErrors = [{ path: 'root', message: 'response did not contain parseable JSON' }];
        } else {
            // Validate against the optional schema.
            const validation = validateAgainstSchema(parsed, agent.outputSchema);
            if (validation.valid) {
                result.parsedJson = parsed;
            } else {
                result.parsedJson = parsed;
                result.validationErrors = validation.errors;
            }
        }
    }

    return result;
}

/**
 * Execute a tool-loop agent by wrapping it in a single-stage pipeline.
 *
 * Reuses the existing `PipelineOrchestrator` code path so tool-loop agents
 * behave identically whether invoked on-demand or as part of a pipeline.
 */
async function runToolLoop(
    agent: AgentDefinition,
    ctx: SingleAgentContext,
    llmProvider: LlmProvider,
    baseConfig: AgentConfig,
    options: SingleAgentRunOptions
): Promise<SingleAgentResult> {
    // Load + template the prompt up front so we fail fast on missing files.
    /** Loaded prompt template. */
    const rawPrompt: string = loadAgentPrompt(agent, baseConfig);
    /** Prompt with template variables substituted. */
    const systemPrompt: string = substituteTemplate(rawPrompt, ctx);

    /** Single-stage pipeline definition wrapping the agent. */
    const pipeline: PipelineDefinition = {
        id: `single-agent-${agent.id}`,
        name: agent.name,
        stages: [
            {
                // Override the agent prompt to the already-substituted text by
                // converting it to an inline source for this run only.
                agent: {
                    ...agent,
                    source: 'inline',
                    promptContent: systemPrompt,
                    promptPath: undefined,
                },
                inputMode: 'conversation',
            } as PipelineStage,
        ],
    };

    /** Orchestrator instance for this one-off run. */
    const orchestrator: PipelineOrchestrator = new PipelineOrchestrator(pipeline, llmProvider, baseConfig);
    // Forward events to the caller's emitter when supplied.
    if (options.emitter) {
        const events: string[] = ['thought', 'action', 'log', 'status', 'progress',
            'retrospect', 'retrospect-proposal', 'retrospect-tool-activity',
            'stage-start', 'stage-complete', 'conversation-entry'];
        for (const evt of events) {
            orchestrator.on(evt, (data: unknown) => options.emitter!.emit(evt, data));
        }
    }

    /** Investigation state passed in (or defaulted). */
    const initial: Partial<InvestigationState> = options.investigationState || {};
    /** Final investigation state. */
    const finalState: InvestigationState = await orchestrator.run(ctx.goal || '', initial);

    /** Retrospect carrier (proposals + messages) when the orchestrator surfaced one. */
    const retro = finalState.retrospect;
    return {
        output: extractLastReport(finalState),
        proposals: retro ? retro.proposals : undefined,
        messages: retro ? retro.messages : undefined,
    };
}

/** Find the last report-role entry in the pipeline conversation log. Returns '' when none. Exported for testing. */
export function extractLastReport(state: InvestigationState): string {
    /** Pipeline conversation log (always present after PipelineOrchestrator.run). */
    const log: ConversationEntry[] = state.pipeline?.conversationLog ?? [];
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].role === 'report') return log[i].content;
    }
    return '';
}
