import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { ToolManager } from './tools/ToolManager';
import { McpServerConfig } from './tools/McpToolBridge';
import { LlmProvider } from './llm/LlmProvider';
import { ConversationEntry, OpenItem, AgentRole } from './pipeline/AgentDefinition';
import { PipelineDefinition } from './pipeline/PipelineDefinition';
import OpenAI from 'openai';

export interface AgentConfig {
    systemPromptPath: string;
    retrospectPromptPath?: string;
    knowledgeBasePath?: string;
    repoRoot?: string;
    mcpServers: McpServerConfig[];
    maxSteps?: number;
    model?: string;
    workingDirectory?: string;
    investigationsPath?: string;
    retrospectTimeoutMinutes?: number;
}

export interface ProposedChange {
    id: string;
    type: 'edit' | 'create';
    filePath: string;
    description: string;
    content: string;
    originalContent?: string;
    status: 'pending' | 'approved' | 'rejected' | 'applied';
    source?: 'retrospect' | 'implementation';
}

export interface Recommendation {
    id: string;
    priority: string;
    title: string;
    description: string;
    category: 'code' | 'operational';
}

export interface RetrospectMessage {
    role: 'user' | 'assistant' | 'tool-call' | 'tool-result';
    content: string;
    toolName?: string;   // for tool-call and tool-result rows
    isError?: boolean;   // for tool-result rows that returned an error
}

export interface RetrospectState {
    messages: RetrospectMessage[];
    proposals: ProposedChange[];
    analysisComplete: boolean;
    analysisFailed?: boolean;  // true when analysis ended with an error (not user-cancelled)
    completed: boolean;
}

export interface InvestigationState {
    id: string;
    status: 'running' | 'paused' | 'aborted' | 'completed' | 'failed';
    thoughts: any[];
    actions: any[];
    logs: string[];
    // Full uncompacted history — preserved across compactions for retrospect, UI, and reports.
    // `thoughts` may be compacted (summarized) for LLM context window management,
    // but `fullHistory`/`fullActions` always retain every original entry.
    fullHistory?: any[];
    fullActions?: any[];
    // Metadata
    title?: string;
    query?: string;
    target?: string;
    timeRange?: string;
    correlationId?: string;
    category?: string;
    incidentId?: string;
    model?: string;
    productId?: string;
    pausedAt?: number;
    totalPausedTime?: number;
    finalReport?: string;
    recommendations?: Recommendation[];
    retrospect?: RetrospectState;
    contestCount?: number;
    tags?: string[];
    createdBy?: string;
    // Scheduled investigation fields
    source?: 'manual' | 'scheduled';
    scheduleId?: string;
    verdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';
    // Tracks whether the implementation agent is currently running
    implementationRunning?: boolean;
    // Free-form user notes
    userNotes?: string;
    // Multi-agent pipeline state
    pipeline?: PipelineState;
    // Snapshot of pipeline state before contest (used by restoreToLastCheckpoint)
    _priorPipelineSnapshot?: PipelineState;
}

/** Tracks the state of a multi-agent pipeline execution. */
export interface PipelineState {
    /** Per-stage status tracking. */
    stages: PipelineStageState[];
    /** Index of the currently executing stage (0-based). */
    currentStageIndex: number;
    /** Snapshot of the pipeline config used (frozen at investigation start). */
    definition: PipelineDefinition;
    /** Shared multi-agent conversation log — all agents' messages interleaved. */
    conversationLog: ConversationEntry[];
}

/** Tracks the state of a single pipeline stage. */
export interface PipelineStageState {
    agentId: string;
    agentName: string;
    description?: string;
    color?: string;
    icon?: string;
    status: 'pending' | 'running' | 'completed' | 'rejected' | 'skipped' | 'failed' | 'aborted';
    /** Set when the agent produces a verdict (only meaningful when stage has canReject: true). */
    verdict?: 'approved' | 'rejected' | 'flagged';
    /** Rejection/flag explanation from the agent. */
    feedback?: string;
    /** This stage's output report. */
    report?: string;
    /** How many times this stage has been re-run due to rejection loops. */
    retryCount: number;
    /** Whether this stage can reject (copied from pipeline definition for UI). */
    canReject?: boolean;
    /** What to do on rejection: loop, flag, or abort (copied from pipeline definition for UI). */
    onReject?: 'loop' | 'flag' | 'abort';
    /** Target stage index (or 'previous') to loop back to on rejection (copied from pipeline definition for UI). */
    rejectTarget?: number | 'previous';
    /** Maximum rejection retries allowed (copied from pipeline definition for UI). */
    maxRetries?: number;
    startedAt?: number;
    completedAt?: number;
}

/**
 * Context provided by the PipelineOrchestrator when running an agent as a pipeline stage.
 * Contains the shared conversation history and stage metadata.
 */
export interface StageContext {
    /** Full multi-agent conversation log from all prior stages. */
    conversationLog: ConversationEntry[];
    /** This agent's stage index within the pipeline. */
    stageIndex: number;
    /** This agent's ID (used to tag emitted events). */
    agentId: string;
    /** This agent's display name (used to tag emitted events). */
    agentName: string;
    /** This agent's color (for UI). */
    agentColor?: string;
    /** This agent's icon (for UI). */
    agentIcon?: string;
    /** Override system prompt (loaded from agent definition). Overrides config.systemPromptPath. */
    systemPromptOverride?: string;
    /** Override model for this stage. */
    modelOverride?: string;
    /** Override maxSteps for this stage. */
    maxStepsOverride?: number;
    /**
     * Agent role (`'producer' | 'reviewer'`). Drives the `finish` tool schema:
     * producers can only emit a report; reviewers can only emit a verdict +
     * structured `openItems[]`. When undefined, the legacy schema is exposed.
     */
    role?: AgentRole;
    /**
     * Set by the PipelineOrchestrator when this stage is being re-run after a
     * downstream reviewer rejected its prior output. When present, the runner:
     *   1. SUPPRESSES the normal `## Prior Agent Context` (which would re-feed
     *      the reviewer's prose and cause voice-drift / role mimicry).
     *   2. INJECTS a focused retry block: prior report + structured open items
     *      + an explicit instruction to address each blocker with new tool
     *      calls before calling `finish`.
     *   3. ENFORCES a finish-gate: if the producer calls `finish` without
     *      running any new non-finish tool calls during this run, the runner
     *      pushes back a system message and refuses to terminate (one retry
     *      attempt before giving up so we don't infinite-loop on a stuck LLM).
     */
    retryContext?: {
        /** This stage's prior report from the rejected round. */
        priorReport: string;
        /** Structured open items the reviewer raised. Already filtered to actionable items. */
        openItems: OpenItem[];
        /** 1-indexed retry round number. */
        round: number;
        /** Display name of the reviewer that rejected the prior round. */
        reviewerName?: string;
    };
    /**
     * Optional whitelist of tool names this agent is allowed to call. When set,
     * the runner (a) hides all other tools from the LLM's `tools` parameter and
     * (b) refuses to dispatch any tool call whose name is not in the list.
     *
     * Only `finish` is implicitly allowed (it's the agent's structural
     * completion mechanism, not a real tool). `invoke_subagent` is
     * deliberately NOT auto-allowed: a Code Scout restricted to
     * `[read_file, list_dir]` must not be able to side-step that policy by
     * spawning a subagent that runs KQL on its behalf — which is exactly
     * what we observed in production before this restriction landed.
     *
     * Resolved by `PipelineOrchestrator` from the agent definition's `tools`
     * field (`ToolAccess` mode='whitelist'). When undefined, every discovered
     * tool is exposed (legacy behaviour for agents without a tool policy).
     */
    allowedTools?: string[];
    /**
     * The agent's `kind` (e.g. `'code-scout'`). Used by content-drift guards
     * that need to enforce kind-specific output rules at the finish boundary
     * (Code Scout must not author audit reports, etc.). Optional; falls back
     * to `'custom'` when not provided.
     */
    agentKind?: string;
}

/**
 * Extract the most useful error message from an OpenAI SDK error.
 * The SDK's APIError.message often contains the raw HTTP status + JSON body dump
 * (e.g. "400 {...}") which is unreadable. This helper digs into every possible
 * path to find the provider's actual error message.
 */
function extractLlmErrorDetail(error: any): string {
    const parts: string[] = [];

    // Helper: try to extract message/type/code from an object at any nesting level
    const extractFrom = (obj: any, depth: number = 0): boolean => {
        if (!obj || typeof obj !== 'object' || depth > 3) return false;
        if (obj.message && typeof obj.message === 'string' && obj.message.length > 5) {
            parts.push(obj.message);
            if (obj.type) parts.push(`type:${obj.type}`);
            if (obj.code) parts.push(`code:${obj.code}`);
            if (obj.param) parts.push(`param:${obj.param}`);
            return true;
        }
        // Recurse into .error (OpenAI style: body.error.message)
        if (obj.error) return extractFrom(obj.error, depth + 1);
        return false;
    };

    // Path 1: error.error (parsed response body from OpenAI SDK)
    if (error.error) extractFrom(error.error);

    // Path 2: error.body (some SDK versions)
    if (parts.length === 0 && error.body) extractFrom(error.body);

    // Path 3: error itself (might have .type/.code at top level from SDK)
    if (parts.length === 0) {
        if (error.type && error.code) {
            parts.push(`type:${error.type}`, `code:${error.code}`);
        }
    }

    if (parts.length > 0) return parts.join(', ');

    // Path 4: error.message — but parse it if it contains embedded JSON
    // (OpenAI SDK sets .message to "400 {\"error\": ...}" in some cases)
    if (error.message && typeof error.message === 'string') {
        const msg = error.message;
        const jsonStart = msg.indexOf('{');
        if (jsonStart >= 0) {
            try {
                const parsed = JSON.parse(msg.substring(jsonStart));
                const extracted = extractFrom(parsed);
                if (extracted) return parts.join(', ');
            } catch (_e) { /* not JSON, fall through */ }
        }
        if (msg.length > 300) return msg.substring(0, 300) + '...';
        return msg;
    }

    return `HTTP ${error.status || 'unknown'}`;
}

/**
 * Prefix used by contestReport() when injecting the full rejected report into
 * the conversation history as the next LLM prompt. This message is intended
 * solely as model context — UI/report rendering should not echo it as a
 * "latest activity" preview, since doing so duplicates the corresponding
 * Execution Log entry and bloats list views.
 */
export const CONTEST_LLM_CONTEXT_PREFIX = 'CONTESTED REPORT (attempt #';

/** True when a thought string is the verbose contest LLM-context block (see CONTEST_LLM_CONTEXT_PREFIX). */
export function isContestLlmContextMessage(text: unknown): boolean {
    return typeof text === 'string' && text.startsWith(CONTEST_LLM_CONTEXT_PREFIX);
}

export class AgentRunner extends EventEmitter {
    private state: InvestigationState;
    private config: AgentConfig;
    private toolManager: ToolManager;
    private paused: boolean = false;
    private aborted: boolean = false;
    private llmProvider: LlmProvider;
    private openaiClient: OpenAI | null = null;
    /** When running as a pipeline stage, carries context from the orchestrator. */
    private stageContext?: StageContext;
    /** Tracks whether tool_choice:'required' has caused a 400 error, to avoid retrying it repeatedly. */
    private toolChoiceRequiredFailed: boolean = false;
    // Tracks how many entries from `thoughts` have been archived into `fullHistory`.
    // This allows us to sync incrementally without duplicating entries.
    private fullHistorySyncCursor: number = 0;
    /**
     * Per-runner serialization lock for saveArtifacts(). Multiple callers
     * (WS bridge save chain, pipeline `.then()` completion, runner-internal
     * step/pause/finish handlers) can trigger saves concurrently. Without this
     * lock they race on the SAME `state.json.tmp` path: each opens it with
     * O_TRUNC, writes its own JSON serialization, then renames to state.json.
     * Two interleaved writes produce a state.json with extra bytes appended
     * past the valid JSON tail (the tail of an earlier longer write surviving
     * past the truncated end of a later shorter write — or vice versa) which
     * then fails to parse on backend restart and effectively destroys the
     * investigation. The chain coalesces to at most one queued save behind
     * the in-flight one — newer state captures both.
     */
    private saveChain: Promise<void> = Promise.resolve();
    private saveQueued: boolean = false;

    constructor(config: AgentConfig, llmProvider: LlmProvider, initialMetadata: Partial<InvestigationState> = {}) {
        super();
        this.config = config;
        this.llmProvider = llmProvider;
        this.toolManager = new ToolManager();
        if (config.repoRoot) {
            this.toolManager.setRepoRoot(config.repoRoot);
        }
        this.state = {
            id: Date.now().toString(),
            status: 'running',
            thoughts: [],
            actions: [],
            logs: [],
            fullHistory: [],
            fullActions: [],
            totalPausedTime: 0,
            ...initialMetadata
        };
        // Ensure fullHistory/fullActions exist even when rehydrating from older state files
        if (!this.state.fullHistory) this.state.fullHistory = [...this.state.thoughts];
        if (!this.state.fullActions) this.state.fullActions = [...this.state.actions];
        // Initialize sync cursor: if rehydrating, fullHistory is already populated
        this.fullHistorySyncCursor = this.state.thoughts.length;
    }

    /**
     * Configure this runner to execute as a pipeline stage.
     * Called by PipelineOrchestrator before `start()`.
     */
    setStageContext(ctx: StageContext): void {
        this.stageContext = ctx;
        // Push the role hint into ToolManager so `finish` is shaped correctly:
        // producers cannot emit verdicts; reviewers cannot emit free-form reports.
        // This makes role-mimicry impossible at the tool boundary.
        this.toolManager.setFinishRoleHint(ctx.role);
        // Snapshot the current actions count so the finish-gate can detect whether
        // any new tool calls happened during this stage's run (used to enforce
        // "must run new tool calls before finishing on a retry").
        this.stageStartActionsLength = this.state.actions.length;
        // Reset the finish-gate tripwire whenever a new stage context is bound.
        this.finishGateTripped = false;
        // Reset the role-drift tripwire so each stage gets one (and only one)
        // pushback if its finish output drifts into another agent's voice.
        this.roleDriftGateTripped = false;
        // Reset the investigator zero-work tripwire so each stage gets one
        // (and only one) pushback if an investigator-kind agent tries to
        // finish without doing any actual investigation work.
        this.investigatorWorkGateTripped = false;
        // Reset the producer-rescue state too; otherwise a popped finish from
        // a previous stage could leak forward and be mis-restored here.
        this.lastPoppedFinish = null;
        this.silentTurnsSinceFinishPop = 0;
    }

    /**
     * Index into `state.actions` at which this stage's run began. Used by the
     * finish-gate to count this stage's tool calls without scanning prior
     * stages' accumulated actions.
     */
    private stageStartActionsLength: number = 0;
    /**
     * True when the finish-gate has already pushed back once; lets the gate
     * fire at most once per stage so a stuck LLM cannot loop forever.
     */
    private finishGateTripped: boolean = false;
    /**
     * True when the role-drift gate has already pushed back once on this
     * stage; mirrors `finishGateTripped` so a kind-specific output guard
     * (e.g. Code Scout writing audit-style content) cannot infinite-loop on
     * a stuck LLM.
     */
    private roleDriftGateTripped: boolean = false;
    /**
     * True when the investigator zero-work gate has already pushed back once
     * on this stage. Investigator-kind agents are expected to actually
     * investigate (read files, run queries) before finishing — without this
     * gate they happily regurgitate Code Scout's upstream code map as their
     * "report" and skip the work entirely. Mirrors the other gates so the
     * pushback fires at most once per stage.
     */
    private investigatorWorkGateTripped: boolean = false;
    /**
     * The finish action object that the finish-gate popped, kept around so the
     * producer-rescue path can restore it if the model goes silent (text-only
     * loop) instead of producing new evidence. Without this, a producer that
     * has nothing new to add has no way to express "I give up" — the only
     * vehicle for that, `finish`, is what the gate just blocked. Restoring
     * the popped finish (with verdict downgraded to `flagged` + a Limitations
     * note appended to the report) lets the pipeline make forward progress
     * instead of hard-pausing on a permanently stuck LLM.
     */
    private lastPoppedFinish: any = null;
    /**
     * Counts text-only LLM responses observed since the finish-gate trip in
     * the current stage. When this hits {@link RESCUE_AFTER_SILENT_TURNS}
     * (and {@link lastPoppedFinish} is set), the rescue path restores the
     * popped finish instead of escalating to the auto-pause guard.
     */
    private silentTurnsSinceFinishPop: number = 0;

    /**
     * Release resources held by this runner: disconnect MCP tool connections
     * and clean up the ToolManager.  Called by `cleanupRunner()` in server.ts
     * when the runner is removed from the active map.
     */
    dispose(): void {
        this.removeAllListeners();
        this.openaiClient = null;
        this.toolManager.cleanup().catch(() => { /* best-effort */ });
    }

    /**
     * Sync any new entries from `thoughts`/`actions` into `fullHistory`/`fullActions`.
     * This is called before compaction (to archive what's about to be removed)
     * and before saveArtifacts (to ensure the saved state is complete).
     * Entries are only appended once — tracked by `fullHistorySyncCursor`.
     */
    private syncFullHistory(): void {
        const newEntries = this.state.thoughts.slice(this.fullHistorySyncCursor);
        const newActions = this.state.actions.slice(this.fullHistorySyncCursor);
        if (newEntries.length > 0) {
            this.state.fullHistory!.push(...newEntries);
            this.state.fullActions!.push(...newActions);
            this.fullHistorySyncCursor = this.state.thoughts.length;
        }
    }

    async start(userQuery: string) {
        this.log(`Starting investigation for query: ${userQuery}`);

        // Save state immediately so the investigation exists even if initialization fails
        // This allows users to resume failed investigations instead of starting fresh
        await this.saveArtifacts();

        if (!this.toolManager.isConnected()) {
            this.log("ToolManager not connected. Initializing...");
            this.emit('thought', "System: Initializing tools (connecting to MCP servers)...");

            await this.toolManager.initialize(this.config.mcpServers, this.config.workingDirectory, (msg: string) => this.log(msg));

            if (this.toolManager.isConnected()) {
                const mcpStatus = this.toolManager.getMcpStatus();
                const connectedCount = mcpStatus.filter(s => s.connected).length;
                const toolCount = mcpStatus.reduce((sum, s) => sum + s.toolCount, 0);
                this.emit('thought', `System: Tools ready. ${connectedCount} MCP server(s) connected, ${toolCount} tool(s) available.`);
            } else {
                const errorMsg = `System Warning: Tool initialization failed. Error: ${this.toolManager.initError || 'Unknown error'}.`;
                this.log(errorMsg);
                this.state.thoughts.push(errorMsg);
                this.emit('thought', errorMsg);
                
                // Pause and wait — when user clicks Resume we retry initialization
                this.state.thoughts.push("System: Investigation paused due to tool initialization failure. Please check MCP server configuration in Settings and click Resume to retry.");
                this.pause();
                await this.saveArtifacts();

                // Block here until resume + successful connect (or abort)
                while (!this.aborted) {
                    while (this.paused && !this.aborted) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    if (this.aborted) return;

                    this.log("Retrying tool initialization after resume...");
                    this.emit('thought', "System: Retrying tool initialization...");
                    await this.toolManager.initialize(this.config.mcpServers, this.config.workingDirectory, (msg: string) => this.log(msg));

                    if (this.toolManager.isConnected()) {
                        this.emit('thought', `System: Tools connected successfully.`);
                        break;
                    } else {
                        const retryErr = `System Warning: Tools still unavailable. Error: ${this.toolManager.initError || 'Unknown error'}.`;
                        this.log(retryErr);
                        this.state.thoughts.push(retryErr);
                        this.emit('thought', retryErr);
                        this.state.thoughts.push("System: Investigation paused. Click Resume to retry.");
                        this.emit('thought', "System: Investigation paused. Click Resume to retry.");
                        this.pause();
                        await this.saveArtifacts();
                    }
                }
                if (this.aborted) return;
            }
        } else {
            this.log("ToolManager already connected.");
        }

        // Load System Prompt & Inject Metadata
        let systemPrompt = this.loadSystemPrompt();

        // Pipeline stage: inject prior agents' context into the prompt.
        // Only inject meaningful entries (reports, verdicts, handoffs) — not every
        // operational thought/action ("Calling LLM...", "Deciding to use tool...")
        // which are noise that inflates the system prompt and causes 400 errors.
        //
        // RETRY EXCEPTION: when this is a retry of a producer stage rejected by a
        // downstream reviewer, we deliberately SKIP this block and inject a
        // tightly-scoped retry context instead. Re-feeding the conversation log
        // (which by now contains the reviewer's prose rejection report) is the
        // root cause of the role-mimicry failure where the producer starts
        // paraphrasing the reviewer's voice on round 2+.
        if (this.stageContext?.retryContext) {
            systemPrompt += this.buildRetryContextBlock(this.stageContext.retryContext);
        } else if (this.stageContext && this.stageContext.conversationLog.length > 0) {
            const meaningfulRoles = new Set(['report', 'verdict', 'handoff']);
            const meaningfulEntries = this.stageContext.conversationLog
                .filter(e => meaningfulRoles.has(e.role));

            if (meaningfulEntries.length > 0) {
                const MAX_CONVERSATION_CHARS = 30_000;
                let conversationText = meaningfulEntries
                    .map(e => `[${e.agentName}] (${e.role}): ${e.content}`)
                    .join('\n\n');

                if (conversationText.length > MAX_CONVERSATION_CHARS) {
                    conversationText = conversationText.substring(0, MAX_CONVERSATION_CHARS) +
                        '\n\n... [Prior agent context truncated for token management]';
                }

                systemPrompt += `\n\n## Prior Agent Context\nThe following are reports and decisions from previous agents in this pipeline:\n\n${conversationText}`;
            }
        }

        // Context Injection
        const contextParts = [];
        if (this.state.timeRange) contextParts.push(`Target Time Range: ${this.state.timeRange}`);
        if (this.state.target) contextParts.push(`Target: ${this.state.target}`);
        if (this.state.correlationId) contextParts.push(`Correlation ID: ${this.state.correlationId}`);
        if (this.state.category) contextParts.push(`Category: ${this.state.category}`);
        if (this.state.incidentId) contextParts.push(`Incident ID: ${this.state.incidentId}`);

        if (contextParts.length > 0) {
            systemPrompt += `\n\n## Investigation Context\nYou are investigating an issue with the following constraints:\n${contextParts.map(p => `- ${p}`).join('\n')}\n\nUse this context to filter your queries (e.g. strict time filtering).`;
        }

        // Incident Directive: if this investigation was started from an incident, instruct the agent
        if (this.state.incidentId) {
            // Dynamically discover incident investigation guide from the knowledge base
            let incidentGuideHint = '';
            const kbDir = this.config.knowledgeBasePath;
            if (kbDir) {
                try {
                    const kbAbsPath = path.isAbsolute(kbDir) ? kbDir : path.join(this.config.repoRoot || '', kbDir);
                    if (fs.existsSync(kbAbsPath)) {
                        const files = fs.readdirSync(kbAbsPath);
                        const incidentGuide = files.find(f => /incident.*investigation/i.test(f) && f.endsWith('.md'));
                        if (incidentGuide) {
                            incidentGuideHint = ` Follow the incident investigation guide (${incidentGuide}).`;
                        }
                    }
                } catch { /* ignore KB scan errors */ }
            }
            systemPrompt += `\n\n## Incident Investigation\nThis investigation was initiated from Incident ${this.state.incidentId}.${incidentGuideHint}\n1. The incident context has already been extracted and is included in the user query below.\n2. Use the extracted target, time range, and symptom keywords to route to the correct specialized investigation guide.\n3. If target or time range is missing, attempt to extract them from the incident details in the query.\n4. Carry the incident ID forward in all investigation state tracking.`;
        }

        // Main Loop
        let stepCount = 0;
        // Stage context can override maxSteps
        const configMaxSteps = this.stageContext?.maxStepsOverride ?? this.config.maxSteps;
        // Treat 0 as no limit (Infinity), undefined defaults to 50
        const maxSteps = (configMaxSteps !== undefined && configMaxSteps === 0)
            ? Infinity
            : (configMaxSteps || 50);
        let consecutiveThoughts = 0;
        let consecutiveLLMErrors = 0;
        const maxConsecutiveErrors = 3;
        const maxConsecutiveThoughts = 6;

        while (!this.aborted && this.state.status !== 'completed' && stepCount < maxSteps) {
            stepCount++;

            // Check Tool Connection Integrity
            if (!this.toolManager.isConnected()) {
                if (!this.paused) {
                    this.log("Tools disconnected. Pausing investigation.");
                    const sysMsg = "System: Tools disconnected. Investigation paused. Click Resume to reconnect and continue.";
                    this.state.thoughts.push(sysMsg);
                    this.state.actions.push(null as any);
                    this.emit('thought', sysMsg);
                    this.pause();
                }
            }

            if (this.paused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            try {
                const step = await this.callLLM(systemPrompt, userQuery, this.state.thoughts, consecutiveThoughts >= 2);

                if (step.thought) {
                    // Tag the persisted thought with the current pipeline stage's agent
                    // identity (icon/color/name) so the frontend can render per-agent
                    // avatars in the live session. tagEvent is a no-op when not in
                    // pipeline mode (returns the input unchanged). Extra fields on
                    // {role, content} objects are ignored by the LLM call layer
                    // (callLLM extracts only role/content during reconstruction).
                    const taggedThought = this.tagEvent(step.thought);
                    this.state.thoughts.push(taggedThought);
                    this.emit('thought', taggedThought);
                    console.log(`[Agent] Thought: ${JSON.stringify(step.thought)}`); // Log without pushing to thoughts again
                }

                // Check for fatal LLM errors that should stop the loop
                // Only count actual system errors, not investigation content that happens to mention "error"
                if (step.isFinal && !step.action) {
                    const thoughtStr = typeof step.thought === 'string' ? step.thought : step.thought?.content || '';
                    // Only detect actual LLM/system errors by checking for specific error prefixes
                    const isActualError = thoughtStr.startsWith('Critical LLM Error:') || 
                                          thoughtStr.startsWith('System Alert:') ||
                                          thoughtStr.startsWith('Error: Not authenticated');

                    // Auth errors are deterministic — retrying without re-authenticating
                    // is pointless (every retry returns the same "Not authenticated"
                    // string), and compacting history doesn't help an expired token.
                    // Pause IMMEDIATELY on the first occurrence with an actionable
                    // message that tells the user exactly how to recover. Without
                    // this, long-running investigations whose Copilot token expires
                    // mid-run waste 3 retries + a compaction pass before pausing,
                    // and the generic pause message ("Resume — payload is smaller")
                    // misleads the user into resuming without re-authenticating.
                    const isAuthError = thoughtStr.startsWith('Error: Not authenticated');
                    if (isAuthError) {
                        const pauseMsg = `System: Investigation auto-paused — LLM provider is not authenticated ` +
                            `(token likely expired during this long-running investigation). ` +
                            `To recover: (1) re-login via the dashboard (Settings → Authentication), ` +
                            `then (2) Resume. Compaction was skipped because it cannot fix an expired token. ` +
                            `Original error: ${thoughtStr.substring(0, 200)}`;
                        this.log(pauseMsg);
                        this.state.thoughts.push(pauseMsg);
                        this.state.actions.push(null as any);
                        this.emit('thought', pauseMsg);
                        this.pause();
                        consecutiveLLMErrors = 0;
                        continue;
                    }

                    if (isActualError) {
                        consecutiveLLMErrors++;
                        consecutiveThoughts = 0; // Reset so retry doesn't force tool_choice:'required'
                        this.log(`LLM error detected (${consecutiveLLMErrors}/${maxConsecutiveErrors}): ${thoughtStr.substring(0, 100)}`);

                        // On timeout errors, attempt auto-compaction before retrying
                        const isTimeout = thoughtStr.includes('timed out') || thoughtStr.includes('timeout');
                        if (isTimeout && consecutiveLLMErrors < maxConsecutiveErrors) {
                            // Exponential backoff: 5s, 15s, 45s
                            const backoffMs = 5000 * Math.pow(3, consecutiveLLMErrors - 1);
                            const backoffSec = Math.round(backoffMs / 1000);
                            this.log(`Timeout detected. Waiting ${backoffSec}s before retry...`);
                            const retryMsg = `System: LLM request timed out (attempt ${consecutiveLLMErrors}/${maxConsecutiveErrors}). Waiting ${backoffSec}s then attempting auto-compaction before retry...`;
                            this.state.thoughts.push(retryMsg);
                            this.state.actions.push(null as any);
                            this.emit('thought', retryMsg);

                            await new Promise(resolve => setTimeout(resolve, backoffMs));

                            // Try compacting history to reduce context size
                            const compacted = await this.compactHistory(systemPrompt, userQuery, this.state.thoughts);
                            if (compacted) {
                                const compactMsg = `System: History compacted successfully. Retrying LLM call with reduced context.`;
                                this.state.thoughts.push(compactMsg);
                                this.state.actions.push(null as any);
                                this.emit('thought', compactMsg);
                            } else {
                                this.log(`Auto-compaction was not possible (not enough history or already compact).`);
                            }
                            continue;
                        }
                        
                        if (consecutiveLLMErrors >= maxConsecutiveErrors) {
                            // Proactively compact before pausing so resume starts with
                            // a smaller payload instead of hitting the same error again
                            this.log(`Max consecutive LLM errors reached. Compacting before auto-pause...`);
                            await this.compactHistory(systemPrompt, userQuery, this.state.thoughts);

                            const pauseMsg = `System: Investigation auto-paused after ${maxConsecutiveErrors} consecutive LLM errors. ` +
                                `Last error: ${thoughtStr.substring(0, 150)}. ` +
                                `History was auto-compacted. You can try: (1) Resume (payload is now smaller), or ` +
                                `(2) Switch to a different model, then Resume.`;
                            this.state.thoughts.push(pauseMsg);
                            this.state.actions.push(null as any);
                            this.emit('thought', pauseMsg);
                            this.pause();
                            consecutiveLLMErrors = 0; // Reset so resume gets fresh attempts
                            continue;
                        }
                        // Continue to let it retry
                        continue;
                    }
                } else if (step.action) {
                    // Reset error counter on successful tool call
                    consecutiveLLMErrors = 0;
                }

                if (step.action) {
                    // Reset consecutive thoughts on action
                    consecutiveThoughts = 0;
                    // The model emitted *some* action this turn — even if the
                    // gate later pops a fresh `finish`, the producer is no
                    // longer silent. Clear the rescue's silent-turn counter so
                    // it only reflects the streak SINCE the most recent gate
                    // trip (or stage start).
                    this.silentTurnsSinceFinishPop = 0;

                    this.state.actions.push(step.action);
                    this.emit('action', this.tagEvent(step.action));

                    // Check for finish tool
                    if (step.action.tool === 'finish') {
                        // ── Finish-gate: when this stage is a producer being re-run after
                        // rejection, refuse to terminate if the producer didn't run any new
                        // (non-finish) tool calls during this run. Without this gate the LLM
                        // happily emits a "corrected" report based purely on the reviewer's
                        // prose feedback — the no-progress loop documented in production.
                        // The gate fires at most once per stage so a stuck LLM cannot loop
                        // forever; on the second finish attempt we let it through and the
                        // orchestrator's no-progress detection downgrades reject -> flag.
                        const isProducerRetry =
                            this.stageContext?.role === 'producer' &&
                            this.stageContext?.retryContext !== undefined;

                        if (isProducerRetry && !this.finishGateTripped) {
                            const newToolCalls = this.state.actions
                                .slice(this.stageStartActionsLength)
                                .filter(a => a && a.tool && a.tool !== 'finish');

                            if (newToolCalls.length === 0) {
                                this.finishGateTripped = true;
                                // Save the popped finish so the producer-rescue
                                // path can restore it if the model goes silent
                                // (text-only loop) instead of producing new
                                // evidence on the next attempt. Deep-clone the
                                // args so later in-place mutation (verdict
                                // downgrade, Limitations note append) cannot
                                // pollute the original action object that we
                                // reference elsewhere.
                                this.lastPoppedFinish = {
                                    tool: step.action.tool,
                                    args: JSON.parse(JSON.stringify(step.action.args || {})),
                                };
                                this.silentTurnsSinceFinishPop = 0;
                                // Pop the finish action so the loop can continue cleanly.
                                this.state.actions.pop();
                                // Also pop the assistant thought added in this same
                                // iteration (step.thought handling above always pushes a
                                // string thought before the gate runs). Without this, the
                                // model's own "I'll finish now" reasoning stays in history
                                // and contradicts the gate's user pushback, causing the
                                // model to rationalize the contradiction as "my finish call
                                // failed silently" and spiral into a text-only loop. Keep
                                // thoughts and actions arrays index-aligned.
                                if (this.state.thoughts.length > 0) {
                                    this.state.thoughts.pop();
                                }
                                const blockerCount = this.stageContext!.retryContext!.openItems
                                    .filter(i => i.severity === 'blocker' || i.severity === 'major')
                                    .length;
                                // Two-path pushback: the model MUST either gather
                                // new evidence OR concede gracefully. Without an
                                // explicit concession path, models that have
                                // genuinely exhausted the available evidence go
                                // silent (the only way to "give up" — `finish`
                                // — is what the gate just blocked), which trips
                                // the consecutive-thoughts auto-pause and grinds
                                // the pipeline to a halt. The concession path
                                // also lets the producer-rescue logic accept
                                // their second `finish` cleanly with a verdict
                                // of `flagged`.
                                const gateMsg = `System: You called \`finish\` without running any new tool calls. ` +
                                    `On a retry you MUST gather new evidence (at least one tool call) before finishing — ` +
                                    `there are ${blockerCount} blocker/major open item(s) above that require concrete data, not paraphrasing. ` +
                                    `Pick the most important open item and run a query/file read that addresses it, then call \`finish\` with a substantively new report. ` +
                                    `\n\nIf — after attempting to gather evidence — you genuinely cannot resolve any of the open items ` +
                                    `(e.g. the data does not exist, the queries time out, or the items are out of scope for your tools), ` +
                                    `call \`finish\` again with verdict \`flagged\` and append a \`## Limitations\` section to the report ` +
                                    `that lists each unresolved item and explains why it could not be addressed. That is an acceptable second-attempt response — ` +
                                    `do NOT respond with prose only.`;
                                this.state.thoughts.push({ role: 'user', content: gateMsg });
                                this.state.actions.push(null as any);
                                this.emit('thought', gateMsg);
                                this.log(`[finish-gate] Producer retry tried to finish with zero new tool calls; pushing back.`);
                                continue;
                            }
                        }

                        // ── Role-drift gate: enforce kind-specific output rules.
                        // Code Scout's job is to produce a code map (file paths +
                        // why_relevant), NOT to author an investigation report or
                        // run KQL. In production we observed Code Scout drifting
                        // into "Devil's Advocate Audit" / "Streaming Fallback Root
                        // Causes" reports filled with KQL — because the
                        // conversation log injected the prior reviewer's voice.
                        // Detect that pattern and push back exactly once.
                        if (!this.roleDriftGateTripped && this.stageContext?.agentKind === 'code-scout') {
                            const reportText: string = step.action.args.report || step.action.args.summary || '';
                            const driftSignals: string[] = [];
                            if (/```\s*kusto/i.test(reportText) || /\|\s*where\b/i.test(reportText)) {
                                driftSignals.push('contains KQL queries (Code Scout must not run or author KQL)');
                            }
                            if (/^\s*verdict\s*:/im.test(reportText) || /devil['’]s advocate/i.test(reportText)) {
                                driftSignals.push('uses reviewer voice ("Verdict:", "Devil\'s Advocate")');
                            }
                            if (/^\s*##?\s*(audit|root[- ]cause|customer[- ]impact)/im.test(reportText)) {
                                driftSignals.push('uses investigation-report headings ("Audit", "Root Cause", "Customer Impact")');
                            }
                            if (driftSignals.length > 0) {
                                this.roleDriftGateTripped = true;
                                this.lastPoppedFinish = {
                                    tool: step.action.tool,
                                    args: JSON.parse(JSON.stringify(step.action.args || {})),
                                };
                                this.silentTurnsSinceFinishPop = 0;
                                this.state.actions.pop();
                                if (this.state.thoughts.length > 0) {
                                    this.state.thoughts.pop();
                                }
                                const driftMsg = `System: Your report drifted out of the Code Scout role. Detected: ${driftSignals.join('; ')}. ` +
                                    `Code Scout's ONLY job is to produce a structured code map: a ranked list of \`{ path, symbol, why_relevant, confidence }\` entries pointing at source files / docs the Investigator should read. ` +
                                    `You must NOT author an investigation report, run or include KQL, or evaluate other agents' work. ` +
                                    `Re-call \`finish\` with a code-map report only — file paths and one-sentence justifications, nothing else.`;
                                this.state.thoughts.push({ role: 'user', content: driftMsg });
                                this.state.actions.push(null as any);
                                this.emit('thought', driftMsg);
                                this.log(`[role-drift-gate] Code Scout output drifted out of role; pushing back. Signals: ${driftSignals.join(' | ')}`);
                                continue;
                            }
                        }

                        // ── Investigator zero-work gate: investigator-kind
                        // agents must actually investigate before finishing.
                        // In production we observed the Teleduct Investigator
                        // stage taking the upstream Code Scout's code-map
                        // report from the conversation log and submitting it
                        // verbatim as its own "report" — zero KQL queries,
                        // zero file reads, zero new evidence. The result was
                        // a pipeline that "passed through" Code Scout instead
                        // of running an investigation. Detect that pattern
                        // (kind === 'investigator', no non-finish tool calls
                        // since stage start) and push back exactly once.
                        if (
                            !this.investigatorWorkGateTripped &&
                            (this.stageContext?.agentKind === 'investigator' ||
                                this.stageContext?.agentKind === 'attainment-investigator')
                        ) {
                            const stageActions = this.state.actions
                                .slice(this.stageStartActionsLength)
                                .filter(a => a && a.tool && a.tool !== 'finish');

                            if (stageActions.length === 0) {
                                this.investigatorWorkGateTripped = true;
                                this.lastPoppedFinish = {
                                    tool: step.action.tool,
                                    args: JSON.parse(JSON.stringify(step.action.args || {})),
                                };
                                this.silentTurnsSinceFinishPop = 0;
                                this.state.actions.pop();
                                if (this.state.thoughts.length > 0) {
                                    this.state.thoughts.pop();
                                }
                                const workMsg = `System: You called \`finish\` without making a single tool call. ` +
                                    `Investigator-kind agents MUST gather their own evidence (KQL queries, file reads, telemetry lookups) — ` +
                                    `you cannot ship the upstream Code Scout's code map as your investigation report. ` +
                                    `That code map is a set of POINTERS for you to chase, not a finished product. ` +
                                    `\n\nRun at least one query/read that produces concrete evidence (event counts, traces, file contents), ` +
                                    `then call \`finish\` with a report that cites that evidence. ` +
                                    `If — after attempting at least one tool call — you genuinely have nothing to investigate ` +
                                    `(e.g. the symptom is fully explained by static code already in scope), ` +
                                    `call \`finish\` again with verdict \`flagged\` and a \`## Limitations\` section that explains why no telemetry was queried. ` +
                                    `Do NOT respond with prose only.`;
                                this.state.thoughts.push({ role: 'user', content: workMsg });
                                this.state.actions.push(null as any);
                                this.emit('thought', workMsg);
                                this.log(`[investigator-work-gate] Investigator tried to finish with zero tool calls; pushing back.`);
                                continue;
                            }
                        }

                        this.state.status = 'completed';
                        this.log(`[DEBUG] Finish tool called with args: ${JSON.stringify(step.action.args)}`);
                        // Extract report from args.
                        //
                        // Reviewer-style stages in a pipeline (Devil's Advocate, Validator,
                        // Signal Grounding, etc.) legitimately call `finish` with only a
                        // verdict + feedback/openItems and no `report`/`summary`. Falling
                        // back to a placeholder string in that case caused the stage
                        // detail panel in the UI to render a bogus "Report" section
                        // ("Investigation Completed via finish tool."). When running
                        // inside a pipeline (stageContext is set), leave finalReport
                        // empty so the UI hides the Report section and the orchestrator
                        // preserves the upstream producer's real finalReport.
                        //
                        // Legacy single-agent runs (no stageContext) keep the placeholder
                        // for backwards compatibility with the original UX.
                        const isPipelineStage = !!this.stageContext;
                        const fallbackReport = isPipelineStage ? undefined : "Investigation Completed via finish tool.";
                        const report = step.action.args.report || step.action.args.summary || fallbackReport;

                        // Extract verdict if provided (used by scheduled health checks)
                        if (step.action.args.verdict) {
                            this.state.verdict = step.action.args.verdict;
                        }

                        if (report) {
                            this.state.finalReport = report;
                        }
                        this.state.thoughts.push(`Observation: Report Generated.`);

                        // Extract and classify recommendations from the report using LLM.
                        // Skip when there is no report text (verdict-only reviewer finish).
                        if (report) {
                            try {
                                this.state.recommendations = await this.extractRecommendations(report);
                                this.log(`Extracted ${this.state.recommendations.length} recommendations.`);
                            } catch (err: any) {
                                this.log(`Warning: recommendation extraction failed: ${err.message}`);
                                this.state.recommendations = [];
                            }
                        }

                        // Update last action result (the finish action, before pushing null alignment entry)
                        const finishAction = this.state.actions[this.state.actions.length - 1];
                        finishAction.result = "Report generated and saved to finalReport field.";
                        this.state.actions.push(null as any);

                        this.log("Investigation completed by agent.");
                        await this.saveArtifacts();
                        break;
                    }

                    // 3. Execute Action
                    const result = await this.executeAction(step.action);

                    // Update the last action with result
                    const lastAction = this.state.actions[this.state.actions.length - 1];
                    lastAction.result = result;

                    // Truncate oversized tool results to prevent token overflow.
                    // A single tool result can be 300K+ chars (~75K tokens), which alone
                    // exceeds the 128K token limit. Cap at ~80K chars (~20K tokens).
                    const MAX_OBSERVATION_CHARS = 80_000;
                    let resultStr = JSON.stringify(result);
                    if (resultStr.length > MAX_OBSERVATION_CHARS) {
                        const originalLen = resultStr.length;
                        // Keep head and tail so the agent sees the query + beginning/end of data
                        const headSize = Math.floor(MAX_OBSERVATION_CHARS * 0.6);
                        const tailSize = Math.floor(MAX_OBSERVATION_CHARS * 0.3);
                        resultStr = resultStr.substring(0, headSize) +
                            `\n\n... [OUTPUT TRUNCATED: ${originalLen.toLocaleString()} chars total, showing first ${headSize.toLocaleString()} + last ${tailSize.toLocaleString()} chars. ` +
                            `Re-run the query with filters or | take N to reduce output size.] ...\n\n` +
                            resultStr.substring(originalLen - tailSize);
                        this.log(`Tool result truncated: ${originalLen.toLocaleString()} → ${resultStr.length.toLocaleString()} chars`);
                    }

                    this.state.thoughts.push({ role: 'user', content: `Observation: ${resultStr}` });
                    this.state.actions.push(null as any);

                } else {
                    // No action implies just thinking/speaking. 
                    consecutiveThoughts++;
                    this.state.actions.push(null as any);

                    // Producer-rescue: if the finish-gate popped a finish call
                    // earlier in this stage and the model has now gone silent
                    // (text-only) for RESCUE_AFTER_SILENT_TURNS in a row, it
                    // is the producer's way of conceding "I have nothing more
                    // to add". Restore the popped finish (with verdict
                    // downgraded to `flagged` and a `## Limitations` note
                    // appended explaining the gate trip + rescue) so the
                    // pipeline makes forward progress instead of grinding to
                    // an auto-pause halt. Without this, the only way to
                    // recover from this state was a manual Resume / model
                    // switch, which is what production was hitting.
                    const RESCUE_AFTER_SILENT_TURNS = 2;
                    if (this.lastPoppedFinish) {
                        this.silentTurnsSinceFinishPop++;
                        if (this.silentTurnsSinceFinishPop >= RESCUE_AFTER_SILENT_TURNS) {
                            this.acceptRescuedFinish();
                            break;
                        }
                    }

                    if (consecutiveThoughts >= maxConsecutiveThoughts) {
                        // Auto-pause: the model is stuck in a text-only loop and tool forcing isn't working
                        const pauseMsg = `System: Investigation auto-paused after ${consecutiveThoughts} consecutive text-only responses without tool calls. ` +
                            `The model appears stuck. You can try: (1) Resume to retry, (2) Switch to a different model, then Resume, or (3) Abort.`;
                        this.log(pauseMsg);
                        this.state.thoughts.push(pauseMsg);
                        this.state.actions.push(null as any);
                        this.emit('thought', pauseMsg);
                        this.pause();
                        consecutiveThoughts = 0; // Reset so resume gets fresh attempts
                        continue;
                    } else if (consecutiveThoughts >= 3) {
                        this.log("Forcing tool usage due to consecutive thoughts.");
                        this.state.thoughts.push({ role: 'system', content: "You are looping with thoughts. You MUST call a tool now or finish." });
                        this.state.actions.push(null as any);
                    }
                }

                // Emit progress
                this.emit('progress', this.state);

                // Save state after every step to ensure persistence
                await this.saveArtifacts();

            } catch (error: any) {
                const errMsg = `System Error: Investigation failed due to an unexpected error: ${error.message || error}`;
                this.log(errMsg);
                // this.state.thoughts.push(errMsg); // Handled by log()
                // this.emit('thought', errMsg);     // Handled by log()

                this.state.status = 'failed';
                this.emit('status', { status: 'failed' });
                await this.saveArtifacts(); // Save even on failure
                break;
            }
        }

        if (this.state.status === 'running' && !this.aborted) {
            const msg = `System: Safety Limit - Max steps (${maxSteps}) reached. Investigation paused to prevent infinite loops. Click Resume to continue for another ${maxSteps} steps.`;
            this.log(msg);
            // this.state.thoughts.push(msg); // Handled by log()
            // this.emit('thought', msg);     // Handled by log()

            this.state.status = 'paused';
            this.emit('status', { status: 'paused' });
            await this.saveArtifacts();
        }
    }


    private initRetrospect(): RetrospectState {
        if (!this.state.retrospect) {
            this.state.retrospect = { messages: [], proposals: [], analysisComplete: false, completed: false };
        }
        // Migrate legacy retrospect objects that don't have proposals/analysisComplete/completed
        if (!this.state.retrospect.proposals) this.state.retrospect.proposals = [];
        if (this.state.retrospect.analysisComplete === undefined) this.state.retrospect.analysisComplete = false;
        if (this.state.retrospect.completed === undefined) this.state.retrospect.completed = false;
        return this.state.retrospect;
    }

    /** Cap retrospect.messages at MAX_RETRO_MESSAGES to prevent unbounded growth (Fix 7). */
    private capRetroMessages(): void {
        const MAX_RETRO_MESSAGES = 100;
        if (this.state.retrospect && this.state.retrospect.messages.length > MAX_RETRO_MESSAGES) {
            this.state.retrospect.messages.splice(0, this.state.retrospect.messages.length - MAX_RETRO_MESSAGES);
        }
    }

    setRetrospectCompleted(completed: boolean): RetrospectState {
        const retro = this.initRetrospect();
        retro.completed = completed;
        this.emit('retrospect', this.state.retrospect);
        return retro;
    }

    /** Reset retrospective analysis state so it starts completely fresh */
    resetRetrospectiveAnalysis(): void {
        const retro = this.initRetrospect();
        retro.analysisComplete = false;
        retro.analysisFailed = false;
        retro.messages = [];
        retro.proposals = [];
        this.emit('retrospect', this.state.retrospect);
        this.log('[Retrospect] Analysis fully reset — messages, proposals cleared.');
    }

    /** Rough token estimate: ~4 chars per token for English text */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    private buildRetrospectHistory(): string {
        // Use fullHistory (uncompacted) for retrospect so it has the complete investigation record.
        // Falls back to thoughts for backward compatibility with older state files.
        this.syncFullHistory(); // Ensure any recent entries are captured
        const thoughts = (this.state.fullHistory && this.state.fullHistory.length > 0)
            ? this.state.fullHistory
            : this.state.thoughts;
        const actions = (this.state.fullActions && this.state.fullActions.length > 0)
            ? this.state.fullActions
            : this.state.actions;

        // Budget: ~12.5k tokens for history => ~50k chars max
        const MAX_HISTORY_CHARS = 50_000;
        const HEAD_TAIL_CHARS = 20_000; // 20k head + 20k tail = 40k when truncated

        const history = thoughts.map((t: any, i: number) => {
            const action = actions[i];
            let thoughtText = typeof t === 'string' ? t : t.content;
            // Truncate overly long thoughts (e.g., embedded large outputs)
            if (thoughtText.length > 500) {
                thoughtText = thoughtText.substring(0, 500) + '...[Truncated]';
            }
            let entry = `Step ${i + 1}: Thought: ${thoughtText}`;

            if (action) {
                entry += `\nAction: ${action.tool}`;
                const argsStr = JSON.stringify(action.args);
                entry += `\nArgs: ${argsStr.length > 300 ? argsStr.substring(0, 300) + '...[Truncated]' : argsStr}`;
                if (action.result) {
                    let resStr = typeof action.result === 'string' ? action.result : JSON.stringify(action.result);
                    if (resStr.length > 500) {
                        resStr = resStr.substring(0, 500) + `\n... [Output Truncated. Original length: ${resStr.length} chars]`;
                    }
                    entry += `\nResult: ${resStr}`;
                }
            }
            return entry;
        }).join('\n\n');

        if (history.length > MAX_HISTORY_CHARS) {
            const part1 = history.substring(0, HEAD_TAIL_CHARS);
            const part2 = history.substring(history.length - HEAD_TAIL_CHARS);
            return part1 + `\n\n... [Middle ${Math.round((history.length - HEAD_TAIL_CHARS * 2) / 1000)}k chars removed to fit context] ...\n\n` + part2;
        }
        return history;
    }

    /**
     * Resolve the repo root path.
     * Priority: config.repoRoot > env REPO_ROOT > heuristic (../../.. from cwd).
     */
    private getRepoRoot(): string {
        return this.config.repoRoot
            || process.env.REPO_ROOT
            || path.resolve(process.cwd(), '../../..');
    }

    /**
     * Recursively scan a directory and return a formatted file listing.
     * Result is a markdown-style tree indented by depth, paths relative to repoRoot.
     */
    private discoverKnowledgeBase(): string {
        const repoRoot = this.getRepoRoot();
        const kbRelPath = this.config.knowledgeBasePath || '';

        const lines: string[] = [];

        const MAX_SCAN_DEPTH = 5;
        const MAX_FILES = 200;
        let fileCount = 0;
        const scanDir = (dir: string, indent: number, depth: number = 0) => {
            if (depth > MAX_SCAN_DEPTH || fileCount >= MAX_FILES) return;
            let entries: string[];
            try {
                entries = fs.readdirSync(dir);
            } catch {
                return;
            }
            entries.sort();
            for (const entry of entries) {
                if (fileCount >= MAX_FILES) break;
                const fullPath = path.join(dir, entry);
                const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
                let stat: any;
                try {
                    stat = fs.statSync(fullPath);
                } catch {
                    continue;
                }
                const prefix = '  '.repeat(indent) + '- ';
                if (stat.isDirectory()) {
                    lines.push(`${prefix}${relPath}/`);
                    scanDir(fullPath, indent + 1, depth + 1);
                } else {
                    fileCount++;
                    lines.push(`${prefix}\`${relPath}\``);
                }
            }
        };
        // Scan the knowledge base path
        if (kbRelPath) {
            const kbAbsPath = path.isAbsolute(kbRelPath) ? kbRelPath : path.join(repoRoot, kbRelPath);
            if (fs.existsSync(kbAbsPath)) {
                lines.push(`### Knowledge Base (${kbRelPath}/)`);
                scanDir(kbAbsPath, 0);
            }
        }

        // Also scan the directory containing the system prompt (often has related prompts)
        const sysPromptPath = this.config.systemPromptPath;
        if (sysPromptPath) {
            const resolvedSys = path.isAbsolute(sysPromptPath) ? sysPromptPath : path.join(repoRoot, sysPromptPath);
            const sysDir = path.dirname(resolvedSys);
            // Avoid duplicating the KB directory
            const kbAbsNorm = kbRelPath ? path.resolve(path.isAbsolute(kbRelPath) ? kbRelPath : path.join(repoRoot, kbRelPath)) : '';
            if (fs.existsSync(sysDir) && path.resolve(sysDir) !== kbAbsNorm) {
                const relDir = path.relative(repoRoot, sysDir).replace(/\\/g, '/');
                lines.push('');
                lines.push(`### Agent Prompts (${relDir}/)`);
                scanDir(sysDir, 0);
            }
        }

        // Scan .github/prompts/ if it exists and hasn't been covered
        const promptsDir = path.join(repoRoot, '.github', 'prompts');
        if (fs.existsSync(promptsDir)) {
            const coveredDirs = new Set<string>();
            if (kbRelPath) coveredDirs.add(path.resolve(path.isAbsolute(kbRelPath) ? kbRelPath : path.join(repoRoot, kbRelPath)));
            if (sysPromptPath) {
                const resolvedSys = path.isAbsolute(sysPromptPath) ? sysPromptPath : path.join(repoRoot, sysPromptPath);
                coveredDirs.add(path.resolve(path.dirname(resolvedSys)));
            }
            if (!coveredDirs.has(path.resolve(promptsDir))) {
                lines.push('');
                lines.push(`### Prompt Files (.github/prompts/)`);
                scanDir(promptsDir, 0);
            }
        }

        if (lines.length === 0) {
            return '_No knowledge base files discovered. Use `list_dir` on the repo root to explore._';
        }

        return lines.join('\n');
    }

    private buildRetrospectSystemPrompt(): string {

        // Discover KB files to inject into templates
        const kbFileListing = this.discoverKnowledgeBase();

        // Try to load from the external retrospect prompt file
        const promptPath = this.config.retrospectPromptPath;
        if (promptPath) {
            // Resolve absolute or relative-to-repoRoot
            const resolvedPath = path.isAbsolute(promptPath) ? promptPath : path.join(this.getRepoRoot(), promptPath);
            if (fs.existsSync(resolvedPath)) {
                let template = fs.readFileSync(resolvedPath, 'utf-8');
                template = template.replace(/\{\{GOAL\}\}/g, this.state.query || 'N/A');
                template = template.replace(/\{\{STATUS\}\}/g, this.state.status || 'N/A');
                template = template.replace(/\{\{STAMP\}\}/g, this.state.target || 'N/A');
                template = template.replace(/\{\{ISSUE_TYPE\}\}/g, this.state.category || 'N/A');
                template = template.replace(/\{\{KNOWLEDGE_BASE_FILES\}\}/g, kbFileListing);
                return template;
            }
            this.log(`[Retrospect] Warning: retrospectPromptPath not found at ${resolvedPath}, using generic fallback prompt.`);
        }

        // Generic fallback — no domain-specific knowledge assumed.
        // Uses the dynamically discovered KB listing.
        const kbPath = this.config.knowledgeBasePath || '';
        const kbSection = kbFileListing !== '_No knowledge base files discovered. Use `list_dir` on the repo root to explore._'
            ? `## Knowledge Base Structure\n${kbFileListing}`
            : `## Knowledge Base Discovery\n${kbPath
                ? `The knowledge base is located at \`${kbPath}\` (relative to repo root). Start by calling \`list_dir\` on that path to discover available guides.`
                : `Use \`list_dir\` on the repo root to discover the knowledge base structure.`}`;

        return `You are a **Knowledge Base Improvement Specialist** reviewing a completed investigation.

## Your Mission
Analyze the investigation transcript (provided in a separate message), identify where the knowledge base (investigation guides, agent prompts) failed the agent, and propose specific file changes that would make future investigations succeed on the first attempt.

## Investigation Context
- **Goal**: ${this.state.query}
- **Final Status**: ${this.state.status}
- **Target**: ${this.state.target || 'N/A'}
- **Category**: ${this.state.category || 'N/A'}

${kbSection}

## Your Tools
1. **read_file** — Read any file in the repo to inspect current content
2. **list_dir** — List directory contents to discover available files
3. **propose_change** — Propose a file modification or creation (shown as a diff for user approval)

## CRITICAL: Tool Usage Rules
- **ALWAYS call tools directly** — NEVER describe what you plan to read. Just call read_file/list_dir immediately.
- Your FIRST action must be a tool call. Do NOT start with text like "Let me read..." — instead, directly invoke the tool.
- You can call multiple tools in a single response.
- Only output text (without tool calls) when you have finished reading files and are ready to present your analysis or propose changes.

## Instructions
1. **Discover and read the relevant investigation guides** by calling \`list_dir\` then \`read_file\` immediately.
2. **Cross-reference** guide content with the investigation transcript to identify failures.
3. **Propose specific changes** using \`propose_change\` for each improvement.
4. **Explain your reasoning** in the chat.

## Change Categories
Tag each proposal: **[Fix Wrong Info]**, **[Add Missing Info]**, **[Improve Routing]**, **[New Guide]**, **[Prompt Refinement]**, **[New Query]**

Be thorough but focused. Only propose changes that would directly improve the outcome of this specific investigation type.`;
    }

    /**
     * Build the messages array for the retrospect LLM call.
     * Keeps the system prompt lean (no transcript) and puts the transcript + report
     * in a separate user message. Caps the conversation history to avoid token overflow.
     */
    private buildRetrospectMessages(retroMessages: Array<{role: string; content: string}>): any[] {
        const systemPrompt = this.buildRetrospectSystemPrompt();
        const effectiveHistory = this.buildRetrospectHistory();

        // Investigation transcript as a separate message (~25k tokens max)
        const transcriptMsg = `## Investigation Transcript\n${effectiveHistory}\n\n## Final Report\n${(this.state.finalReport || 'N/A').substring(0, 5000)}`;

        // Only include the last N retro messages to avoid accumulation blowup.
        // Filter out display-only tool-call/tool-result entries — they are persisted for the UI
        // but are not valid OpenAI message roles and must never be sent to the API.
        const MAX_RETRO_MESSAGES = 10;
        const apiMessages = retroMessages.filter(m => m.role === 'user' || m.role === 'assistant');
        let recentMessages = apiMessages.length > MAX_RETRO_MESSAGES
            ? apiMessages.slice(-MAX_RETRO_MESSAGES)
            : [...apiMessages];

        // Sanitize broken message patterns: remove "Let me read..." assistant messages
        // that represent failed tool-calling attempts (model described plan but didn't act).
        // Also remove error messages from previous token overflow crashes.
        recentMessages = recentMessages.filter((msg, idx) => {
            if (msg.role !== 'assistant') return true;
            const content = msg.content || '';
            // Remove "planning" messages where model just described what it would do
            const isPlanningOnly = /^\s*\n*\s*(let me|i'll|i will)\s+(start by\s+)?(read|look|examine|inspect|check)/i.test(content) && content.length < 200;
            // Remove token overflow error messages
            const isTokenError = /error.*token\s+count.*exceeds/i.test(content) || /error\s+generating\s+response.*\d+k?\s+exceeds/i.test(content);
            // Remove auto-analysis error messages
            const isAutoAnalysisError = /^error\s+during\s+auto-analysis/i.test(content);
            if (isPlanningOnly || isTokenError || isAutoAnalysisError) {
                this.log(`[Retrospect] Filtered broken message: "${content.substring(0, 80)}..."`);
                return false;
            }
            return true;
        });

        // Also remove orphaned user "ok" messages that were responses to filtered assistant messages
        // (if a user message is just "ok"/"yes"/"proceed" and comes right after a gap, remove it)
        const cleanedMessages: typeof recentMessages = [];
        for (let i = 0; i < recentMessages.length; i++) {
            const msg = recentMessages[i];
            if (msg.role === 'user' && /^(ok|yes|proceed|continue|go ahead)\s*[.!]?\s*$/i.test(msg.content || '')) {
                // Only keep if previous message in cleaned array is an assistant message (normal flow)
                const prev = cleanedMessages[cleanedMessages.length - 1];
                if (!prev || prev.role !== 'assistant') {
                    this.log(`[Retrospect] Filtered orphaned user ack: "${msg.content}"`);
                    continue;
                }
            }
            cleanedMessages.push(msg);
        }

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: transcriptMsg },
            ...cleanedMessages
        ];
    }

    private getRetrospectTools(): any[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read a file from the repository. For large files, use startLine/endLine to read specific sections.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path relative to repo root (e.g., docs/investigations/README.md)' },
                            startLine: { type: 'number', description: 'Optional 1-based start line. Use with endLine to read a section of a large file.' },
                            endLine: { type: 'number', description: 'Optional 1-based end line (inclusive). Use with startLine to read a section of a large file.' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_dir',
                    description: 'List contents of a directory in the repository.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'Directory path relative to repo root' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'propose_change',
                    description: 'Propose a file modification or creation. The user will review and approve/reject before it is applied.',
                    parameters: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['edit', 'create'], description: "'edit' to modify existing file, 'create' to make a new file" },
                            filePath: { type: 'string', description: 'File path relative to repo root (e.g., docs/investigations/my-guide.md)' },
                            description: { type: 'string', description: 'What this change does and why, prefixed with category tag like [Fix Wrong Info]' },
                            content: { type: 'string', description: 'The complete new file content. For edits, provide the FULL file with changes applied.' }
                        },
                        required: ['type', 'filePath', 'description', 'content']
                    }
                }
            }
        ];
    }

    private async runRetrospectToolLoop(messages: any[], tools: any[]): Promise<string> {
        const authStatus = await this.llmProvider.getAuthStatus();
        if (!authStatus.authenticated) throw new Error(`Not authenticated with ${this.llmProvider.displayName}`);

        // Create an AbortController so the retrospective can be cancelled
        this.retrospectAbortController = new AbortController();
        const abortSignal = this.retrospectAbortController.signal;

        // Per-call timeout equals the configured overall budget so a single slow API call
        // never times out before the user-configured limit fires.
        const perCallTimeoutMs = (this.config.retrospectTimeoutMinutes || 10) * 60 * 1000;

        // Get OpenAI-compatible client from provider
        this.openaiClient = await this.llmProvider.getClient(perCallTimeoutMs);
        const openai = this.openaiClient;

        const model = this.state.model || 'gpt-4o';
        const maxToolIterations = 30; // Safety cap (increased from 20 — nudge cycles burn iterations)
        const MAX_PROMPT_TOKENS = 110_000; // Leave headroom below 128k limit
        const MAX_READ_FILE_CHARS = 12_000; // ~3k tokens per file read
        let consecutiveNoToolCalls = 0; // Track when model refuses to use tools
        const MAX_NO_TOOL_RETRIES = 2; // Max times to re-prompt short planning text before accepting
        let noProposalRetries = 0; // Track retries when model outputs text but no proposals exist
        const MAX_NO_PROPOSAL_RETRIES = 6; // Generous: keep pushing model to call propose_change
        let postToolProposalNudgeSent = false; // One-time nudge after 6+ file reads in tool-processing section
        const filesRead = new Set<string>(); // Track already-read files to prevent re-reads
        let totalReadCalls = 0; // Track total read_file calls to know when to pivot to proposals
        // Baseline proposal count — so we only count proposals added during THIS run, not leftovers from previous runs
        const baselineProposalCount = this.state.retrospect?.proposals?.length || 0;

        for (let i = 0; i < maxToolIterations; i++) {
            // Check if aborted
            if (abortSignal.aborted) {
                this.log('[Retrospect] Aborted during tool loop.');
                const abortErr = new Error('Retrospective analysis was cancelled.');
                abortErr.name = 'AbortError';
                throw abortErr;
            }

            // Estimate token usage and trim old tool results if approaching limit
            const totalChars = messages.reduce((sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
            const estimatedTokens = this.estimateTokens(JSON.stringify(messages));
            this.log(`[Retrospect] Loop iteration ${i + 1}, model=${model}, est. tokens: ~${estimatedTokens}, chars: ${totalChars}`);

            if (estimatedTokens > MAX_PROMPT_TOKENS) {
                // Trim: replace older tool results (indices 2..N-4) with summaries
                let trimmed = 0;
                for (let j = 2; j < messages.length - 4; j++) {
                    if (messages[j].role === 'tool' && messages[j].content && messages[j].content.length > 200) {
                        messages[j].content = messages[j].content.substring(0, 150) + '\n...[Content trimmed to fit context window]';
                        trimmed++;
                    }
                }
                this.log(`[Retrospect] Trimmed ${trimmed} tool results to fit context window`);

                // If still over limit after trimming, bail with what we have
                const newEstimate = this.estimateTokens(JSON.stringify(messages));
                if (newEstimate > MAX_PROMPT_TOKENS) {
                    this.log(`[Retrospect] Still over token limit (~${newEstimate}), ending loop`);
                    return messages.filter((m: any) => m.role === 'assistant' && m.content).pop()?.content || 'Analysis complete (context limit reached).';
                }
            }

            // Force tool use strategy:
            // Phase 1 (no tool results yet): Use 'required' to force tool calls.
            //   If model keeps failing to call tools, escalate to naming a specific function.
            // Phase 2 (has tool results): Use 'auto' to let model decide.
            const hasToolResults = messages.some((m: any) => m.role === 'tool');
            let effectiveToolChoice: any;
            if (!hasToolResults) {
                if (consecutiveNoToolCalls >= 3) {
                    // Model repeatedly refuses to call tools — force a specific function
                    effectiveToolChoice = { type: 'function', function: { name: 'read_file' } };
                } else {
                    effectiveToolChoice = 'required';
                }
            } else {
                effectiveToolChoice = 'auto';
            }
            this.log(`[Retrospect] tool_choice=${JSON.stringify(effectiveToolChoice)}, hasToolResults=${hasToolResults}, consecutiveNoTool=${consecutiveNoToolCalls}`);

            // Retry up to 2x on transient *network* errors only.
            // Timeouts propagate immediately — they mean the user-configured limit was hit.
            let completion: any;
            {
                const MAX_CALL_RETRIES = 2;
                let callAttempt = 0;
                while (true) {
                    try {
                        completion = await openai.chat.completions.create({
                            model: model,
                            messages: messages as any[],
                            tools: tools,
                            tool_choice: effectiveToolChoice,
                            temperature: hasToolResults ? 0.7 : 0.3
                        }, {
                            signal: abortSignal,
                            timeout: perCallTimeoutMs
                        });
                        break; // success
                    } catch (callErr: any) {
                        callAttempt++;
                        const isTimeout = callErr.message?.toLowerCase().includes('timed out')
                            || callErr.message?.toLowerCase().includes('timeout')
                            || callErr.code === 'ETIMEDOUT';
                        const isNetworkError = !isTimeout && (
                            callErr.code === 'ECONNRESET' || callErr.code === 'ECONNREFUSED'
                            || callErr.message?.toLowerCase().includes('fetch failed')
                        );
                        if (isNetworkError && callAttempt <= MAX_CALL_RETRIES && !abortSignal.aborted) {
                            this.log(`[Retrospect] Network error (attempt ${callAttempt}/${MAX_CALL_RETRIES + 1}), retrying in 3s...`);
                            await new Promise(r => setTimeout(r, 3000));
                        } else {
                            throw callErr;
                        }
                    }
                }
            }

            const message = completion.choices[0].message;
            this.log(`[Retrospect] Response: hasContent=${!!message.content}, toolCalls=${message.tool_calls?.length || 0}`);

            // If no tool calls, handle based on whether we've read ANY files yet
            if (!message.tool_calls || message.tool_calls.length === 0) {
                const responseText = message.content || '';
                consecutiveNoToolCalls++;

                // CASE 1: Model has never made ANY tool calls — keep retrying harder
                if (totalReadCalls === 0 && !messages.some((m: any) => m.role === 'tool')) {
                    if (consecutiveNoToolCalls <= 5) {
                        this.log(`[Retrospect] Model returned text with ZERO tool calls ever (attempt ${consecutiveNoToolCalls}/5, len=${responseText.length}). Re-prompting harder...`);

                        messages.push({
                            role: 'assistant',
                            content: responseText
                        });
                        const kbPath = this.config.knowledgeBasePath || '';
                        const readTarget = kbPath ? `${kbPath}/README.md` : '.';
                        messages.push({
                            role: 'user',
                            content: consecutiveNoToolCalls <= 2
                                ? `STOP. Do NOT describe what you plan to do. Call the ${kbPath ? 'read_file' : 'list_dir'} tool RIGHT NOW with path "${readTarget}". Just call the tool.`
                                : `You MUST call the ${kbPath ? 'read_file' : 'list_dir'} function with {"path": "${readTarget}"}. Do not output any text. Only call the tool.`
                        });
                        continue;
                    }
                    // After 5 failed attempts with zero tool calls, give up with clear error
                    this.log(`[Retrospect] Model completely unable to use tools after ${consecutiveNoToolCalls} attempts. Giving up.`);
                    return `Error: The model (${model}) was unable to call any tools after ${consecutiveNoToolCalls} attempts. This model may not support tool calling well. Try switching to a more capable model (e.g., gpt-4o or claude-sonnet-4) in Settings.`;
                }

                // CASE 2: Model HAS read files but there are ZERO proposals.
                // This is the critical invariant: the analysis is incomplete without proposals.
                // Keep re-prompting until we get proposals or exhaust retries.
                // Uses a dedicated counter (noProposalRetries) separate from the post-tool nudge.
                const retro = this.state.retrospect;
                const newProposalCount = (retro?.proposals?.length || 0) - baselineProposalCount;
                const hasNewProposals = newProposalCount > 0;

                if (!hasNewProposals && totalReadCalls >= 1 && noProposalRetries < MAX_NO_PROPOSAL_RETRIES) {
                    noProposalRetries++;
                    consecutiveNoToolCalls = 0;

                    // Escalate the forcefulness of the prompt
                    let nudgePrompt: string;
                    if (noProposalRetries <= 2) {
                        nudgePrompt = `Your analysis identified issues but you did NOT call the propose_change tool. You MUST call propose_change NOW for each file you want to modify. Each call needs: filePath, description, and content. Do not describe changes in text — call the tool.`;
                    } else if (noProposalRetries <= 4) {
                        const examplePath = this.config.knowledgeBasePath ? `${this.config.knowledgeBasePath}/README.md` : 'path/to/file.md';
                        nudgePrompt = `CRITICAL: You have written analysis text ${noProposalRetries} times without calling propose_change. STOP writing text. Call the propose_change function with these parameters: {"filePath": "${examplePath}", "description": "your change description", "content": "the complete new file content"}. Call it NOW.`;
                    } else {
                        nudgePrompt = `FINAL ATTEMPT: Call propose_change or say "No changes needed". Nothing else.`;
                    }

                    this.log(`[Retrospect] No proposals after ${totalReadCalls} file reads (no-proposal retry ${noProposalRetries}/${MAX_NO_PROPOSAL_RETRIES}, len=${responseText.length}). Re-prompting...`);

                    messages.push({
                        role: 'assistant',
                        content: responseText
                    });
                    messages.push({
                        role: 'user',
                        content: nudgePrompt
                    });
                    continue;
                }

                // CASE 2b: Model HAS proposed some changes but response indicates more work to do.
                // Don't stop after the first proposal — the agent may need to continue
                // with remaining recommendations or additional files.
                if (hasNewProposals && consecutiveNoToolCalls <= 2) {
                    const indicatesContinuation = /\b(next|also|additionally|remaining|another|second|third|now (let|I)|continue|moving on|the other)\b/i.test(responseText);
                    const isShortIntermediate = responseText.length < 1000;

                    if (indicatesContinuation || isShortIntermediate) {
                        this.log(`[Retrospect] ${newProposalCount} proposal(s) so far, but response suggests more work (attempt ${consecutiveNoToolCalls}, len=${responseText.length}). Continuing...`);

                        messages.push({
                            role: 'assistant',
                            content: responseText
                        });
                        messages.push({
                            role: 'user',
                            content: `You have proposed ${newProposalCount} change(s) so far. If there are remaining recommendations or files to modify, continue by searching for the relevant code and calling propose_change. If all recommendations are fully addressed, summarize what was done.`
                        });
                        continue;
                    }
                }

                // CASE 3: Model returned short planning text (< 500 chars) about reading files
                const isPlanningText = responseText.length < 500 &&
                    /\b(let me|i'll|i will|going to|start by|i need to|i should|i want to)\b.*\b(read|look|examine|inspect|check|open|list)\b/i.test(responseText);

                if (isPlanningText && consecutiveNoToolCalls <= MAX_NO_TOOL_RETRIES) {
                    this.log(`[Retrospect] Model returned short planning text (attempt ${consecutiveNoToolCalls}/${MAX_NO_TOOL_RETRIES}, len=${responseText.length}). Re-prompting...`);

                    messages.push({
                        role: 'assistant',
                        content: responseText
                    });
                    messages.push({
                        role: 'user',
                        content: 'Do not describe what you plan to do. You MUST use the read_file or propose_change tools NOW. Call the tools directly in your response.'
                    });
                    continue;
                }
                return responseText || "Analysis complete.";
            }

            // Reset counter since model did use tools
            consecutiveNoToolCalls = 0;

            // If the LLM returned text alongside tool calls, emit it for real-time display
            // but do NOT persist it to retro.messages (the final response will be persisted)
            if (message.content && message.tool_calls.length > 0) {
                this.emit('retrospect-tool-activity', { 
                    tool: 'thinking', 
                    description: message.content.substring(0, 200),
                    iteration: i + 1 
                });
            }

            // Process tool calls
            // Add assistant message with tool_calls to conversation
            messages.push({
                role: 'assistant',
                content: message.content || null,
                tool_calls: message.tool_calls
            });

            for (const toolCall of message.tool_calls) {
                const fnName = (toolCall as any).function.name;
                let args: any;
                try {
                    args = JSON.parse((toolCall as any).function.arguments);
                } catch (parseErr: any) {
                    this.log(`[Retrospect] Failed to parse tool args for ${fnName}: ${parseErr.message}`);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: Invalid JSON arguments: ${parseErr.message}`
                    });
                    continue;
                }
                let result: string;

                // Emit tool activity event so the UI shows what's happening
                const activityDesc = fnName === 'read_file' ? `Reading ${args.path}`
                    : fnName === 'list_dir' ? `Listing ${args.path}`
                    : fnName === 'propose_change' ? `Proposing change: ${(args.description || '').substring(0, 60)}`
                    : fnName === 'search_code' ? `Searching for: ${(args.pattern || '').substring(0, 60)}`
                    : fnName;
                this.emit('retrospect-tool-activity', { tool: fnName, description: activityDesc, iteration: i + 1 });

                try {
                    if (fnName === 'read_file') {
                        // Dedup: if we already read this file in full, return a short notice instead of re-reading
                        const normalizedPath = (args.path || '').replace(/\\/g, '/').toLowerCase();
                        const isRangeRead = args.startLine != null && args.startLine > 0;
                        if (filesRead.has(normalizedPath) && !isRangeRead) {
                            result = `[Already read] You have already read "${args.path}" earlier in this session. Use the content from before. Do not re-read files — focus on proposing changes with propose_change.`;
                            this.log(`[Retrospect] read_file DEDUP: ${args.path} (already read)`);
                        } else {
                            result = this.toolManager.isConnected()
                                ? await this.toolManager.callTool('read_file', args)
                                : this.localReadFile(args.path, args.startLine, args.endLine);
                            // Cap file content to avoid blowing up context
                            if (result.length > MAX_READ_FILE_CHARS) {
                                result = result.substring(0, MAX_READ_FILE_CHARS) + `\n... [File truncated. Original: ${result.length} chars. Showing first ${MAX_READ_FILE_CHARS} chars. Use startLine/endLine to read specific sections.]`;
                            }
                            if (!isRangeRead) filesRead.add(normalizedPath);
                            totalReadCalls++;
                            this.log(`[Retrospect] read_file: ${args.path}${isRangeRead ? ` [${args.startLine}-${args.endLine || 'end'}]` : ''} (${result.length} chars, total reads: ${totalReadCalls})`);
                        }
                    } else if (fnName === 'list_dir') {
                        result = this.toolManager.isConnected()
                            ? await this.toolManager.callTool('list_dir', args)
                            : this.localListDir(args.path);
                        this.log(`[Retrospect] list_dir: ${args.path}`);
                    } else if (fnName === 'search_code') {
                        result = this.localSearchCode(args.pattern, args.path, args.maxResults || 50);
                        this.log(`[Retrospect] search_code: pattern='${args.pattern}', path='${args.path || '.'}' (${result.split('\n').length} results)`);
                    } else if (fnName === 'propose_change') {
                        result = this.handleProposeChange(args);
                    } else {
                        result = `Unknown tool: ${fnName}`;
                    }
                } catch (toolErr: any) {
                    this.log(`[Retrospect] Tool ${fnName} failed: ${toolErr.message}`);
                    result = `Error executing ${fnName}: ${toolErr.message}`;
                }

                // Add tool response to LLM context
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: typeof result === 'string' ? result : JSON.stringify(result)
                });

                // Persist tool activity to retro.messages for live streaming + navigation resume
                {
                    const retroLive = this.state.retrospect;
                    if (retroLive) {
                        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                        const isResultError = resultStr.startsWith('Error') || resultStr.startsWith('[Already read]')
                            || resultStr.startsWith('File not found') || resultStr.startsWith('Unknown tool');
                        retroLive.messages.push({ role: 'tool-call', content: activityDesc, toolName: fnName });
                        retroLive.messages.push({
                            role: 'tool-result',
                            content: resultStr.length > 600
                                ? resultStr.substring(0, 600) + `\n...[${resultStr.length} chars total]`
                                : resultStr,
                            toolName: fnName,
                            isError: isResultError
                        });
                        this.emit('retrospect', this.state.retrospect);
                        // Throttled save: always on propose_change, otherwise at most every 8s
                        const now = Date.now();
                        if (fnName === 'propose_change' || now - this._lastRetroSave > 8_000) {
                            this._lastRetroSave = now;
                            await this.saveArtifacts();
                        }
                    }
                }

                // After enough reads with no proposals, append a strong hint to pivot
                const retroCheck = this.state.retrospect;
                const hasNewProposalsCheck = ((retroCheck?.proposals?.length || 0) - baselineProposalCount) > 0;
                if (totalReadCalls >= 6 && !hasNewProposalsCheck && fnName === 'read_file') {
                    this.log(`[Retrospect] ${totalReadCalls} files read with no proposals. Injecting pivot hint.`);
                }
            }

            // After processing all tool calls in this iteration, check if we should force proposal mode
            const hasAnyNewProposals = ((this.state.retrospect?.proposals?.length || 0) - baselineProposalCount) > 0;
            if (totalReadCalls >= 6 && !hasAnyNewProposals && !postToolProposalNudgeSent) {
                postToolProposalNudgeSent = true;
                this.log(`[Retrospect] Forcing proposal phase after ${totalReadCalls} file reads.`);
                messages.push({
                    role: 'user',
                    content: `IMPORTANT: You have now read ${totalReadCalls} files. That is enough context. STOP reading more files. You MUST now call the propose_change tool to create file change proposals. If you have no improvements to suggest, respond with text explaining why.`
                });
            }
        }

        return "Analysis complete (tool iteration limit reached).";
    }

    private localReadFile(filePath: string, startLine?: number, endLine?: number): string {
        const repoRoot = path.resolve(this.getRepoRoot());
        
        const candidates = [
            path.resolve(repoRoot, filePath),
            path.resolve(filePath)
        ];

        for (const p of candidates) {
            // Security: only allow reading files within the repo root
            if (!p.startsWith(repoRoot)) continue;
            if (fs.existsSync(p)) {
                const content = fs.readFileSync(p, 'utf-8');
                if (startLine != null && startLine > 0) {
                    const lines = content.split('\n');
                    const start = startLine - 1; // Convert to 0-based
                    const end = endLine != null ? Math.min(endLine, lines.length) : lines.length;
                    const totalLines = lines.length;
                    const slice = lines.slice(start, end);
                    return `[Lines ${startLine}-${Math.min(end, totalLines)} of ${totalLines}]\n` + slice.join('\n');
                }
                return content;
            }
        }
        return `File not found: ${filePath}`;
    }

    private localListDir(dirPath: string): string {
        const repoRoot = path.resolve(this.getRepoRoot());

        const candidates = [
            path.resolve(repoRoot, dirPath),
            path.resolve(dirPath)
        ];

        for (const p of candidates) {
            // Security: only allow listing directories within the repo root
            if (!p.startsWith(repoRoot)) continue;
            if (fs.existsSync(p) && fs.lstatSync(p).isDirectory()) {
                return JSON.stringify(fs.readdirSync(p));
            }
        }
        return `Directory not found: ${dirPath}`;
    }

    private handleProposeChange(args: { type: string; filePath: string; description: string; content: string }): string {
        // Validate filePath: block path traversal
        const repoRoot = path.resolve(this.getRepoRoot());
        const resolved = path.resolve(repoRoot, args.filePath);
        if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
            return `Error: filePath '${args.filePath}' resolves outside the repository root.`;
        }

        const retro = this.initRetrospect();
        const proposalId = `proposal_${Date.now()}_${retro.proposals.length}`;

        // For edits, read the original file content so UI can show a diff
        let originalContent: string | undefined;
        if (args.type === 'edit') {
            const existing = this.localReadFile(args.filePath);
            if (!existing.startsWith('File not found:')) {
                originalContent = existing;
            }
        }

        const proposal: ProposedChange = {
            id: proposalId,
            type: args.type as 'edit' | 'create',
            filePath: args.filePath,
            description: args.description,
            content: args.content,
            originalContent,
            status: 'pending',
            source: this.isImplementationRunning ? 'implementation' : 'retrospect'
        };

        retro.proposals.push(proposal);
        this.emit('retrospect-proposal', proposal);
        this.emit('retrospect', this.state.retrospect);

        this.log(`[Retrospect] Proposed ${args.type}: ${args.filePath} — ${args.description.substring(0, 80)}`);
        return `Change proposed successfully (id: ${proposalId}). The user will review this in the UI.`;
    }

    async runRetrospective(userMessage: string) {
        if (['running', 'paused'].includes(this.state.status)) {
            throw new Error("Retrospective is only available for completed, failed, or aborted investigations.");
        }

        const retro = this.initRetrospect();

        // Add User Message
        retro.messages.push({ role: 'user', content: userMessage });
        this.emit('retrospect', this.state.retrospect);

        const tools = this.getRetrospectTools();
        const messages = this.buildRetrospectMessages(retro.messages);

        // Configurable timeout for manual retrospective chat (default: 10 minutes)
        const timeoutMinutes = this.config.retrospectTimeoutMinutes || 10;
        const RETRO_TIMEOUT_MS = timeoutMinutes * 60 * 1000;
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Retrospective response timed out after ${timeoutMinutes} minutes`)), RETRO_TIMEOUT_MS);
        });

        try {
            const responseText = await Promise.race([
                this.runRetrospectToolLoop(messages, tools),
                timeoutPromise
            ]);
            retro.messages.push({ role: 'assistant', content: responseText });
            this.capRetroMessages();
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } catch (error: any) {
            const errMsg = error.name === 'AbortError'
                ? 'Retrospective was cancelled.'
                : `Error generating response: ${error.message}`;
            this.log(`[Retrospect] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            this.capRetroMessages();
            this.emit('retrospect', this.state.retrospect);
        } finally {
            clearTimeout(timeoutId!);
            this.retrospectAbortController = null;
        }
    }

    private retrospectAbortController: AbortController | null = null;
    private isRetrospectRunning = false;
    private isImplementationRunning = false;
    private _lastRetroSave: number = 0;

    abortRetrospective() {
        if (this.retrospectAbortController) {
            this.retrospectAbortController.abort();
            this.retrospectAbortController = null;
            this.log('[Retrospect] Aborted by user.');
        }
    }

    async runRetrospectiveAnalysis() {
        if (['running', 'paused'].includes(this.state.status)) {
            throw new Error("Retrospective analysis is only available for completed, failed, or aborted investigations.");
        }

        // Guard against concurrent analysis (e.g. duplicate requests from StrictMode or multiple tabs)
        if (this.isRetrospectRunning) {
            this.log('[Retrospect] Analysis already in progress, skipping duplicate request.');
            return;
        }

        const retro = this.initRetrospect();

        if (retro.analysisComplete) {
            return; // Already analyzed
        }

        this.isRetrospectRunning = true;

        const tools = this.getRetrospectTools();

        const kbPath = this.config.knowledgeBasePath;
        const kbInstruction = kbPath
            ? `Start by reading the investigation guides that were relevant (use read_file on the guides from ${kbPath}/ that match the category "${this.state.category || 'unknown'}").`
            : `Start by using list_dir to discover the knowledge base structure, then read_file on the guides that match the category "${this.state.category || 'unknown'}".`;
        const analysisRequest = `Analyze this investigation now. ${kbInstruction} Cross-reference the guide content with the investigation transcript above. Then propose specific changes using propose_change for each improvement you identify. Focus on changes that would make this investigation succeed perfectly on the first attempt next time.`;

        const messages = this.buildRetrospectMessages([{ role: 'user', content: analysisRequest }]);

        // Configurable timeout for the entire analysis (default: 10 minutes)
        // Budget: ~15 iterations × 40s avg per API call = 10min.
        // With 30 max iterations and 90s per-call timeouts, this is a reasonable upper bound.
        const timeoutMinutes = this.config.retrospectTimeoutMinutes || 10;
        const ANALYSIS_TIMEOUT_MS = timeoutMinutes * 60 * 1000;
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Retrospective analysis timed out after ${timeoutMinutes} minutes`)), ANALYSIS_TIMEOUT_MS);
        });

        // Push the trigger message BEFORE analysis starts so the user sees it immediately
        retro.messages.push({ role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' });
        this.emit('retrospect', this.state.retrospect);

        try {
            const responseText = await Promise.race([
                this.runRetrospectToolLoop(messages, tools),
                timeoutPromise
            ]);

            // Build a proper completion message with the model's analysis + a clear summary footer
            const proposalCount = retro.proposals?.length || 0;
            const summaryParts: string[] = [];
            if (responseText && responseText !== 'Analysis complete.' && responseText !== 'Analysis complete (tool iteration limit reached).' && responseText !== 'Analysis complete (context limit reached).') {
                summaryParts.push(responseText);
            }
            summaryParts.push('---');
            if (proposalCount > 0) {
                summaryParts.push(`**Analysis complete.** ${proposalCount} proposed change${proposalCount === 1 ? '' : 's'} generated. Review them in the Proposed Changes panel and approve or reject each one.`);
            } else {
                summaryParts.push('**Analysis complete.** No changes were proposed. You can ask follow-up questions below to explore specific improvements.');
            }
            retro.messages.push({ role: 'assistant', content: summaryParts.join('\n\n') });
            retro.analysisComplete = true;
            retro.analysisFailed = false;
            this.capRetroMessages();
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } catch (error: any) {
            const isCancelled = error.name === 'AbortError';
            const errMsg = isCancelled
                ? 'Retrospective analysis was cancelled.'
                : `Error during auto-analysis: ${error.message}`;
            this.log(`[Retrospect] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            // Mark as complete to prevent infinite auto-retries.
            // Set analysisFailed so the UI shows a Retry button instead of the success badge.
            retro.analysisComplete = true;
            retro.analysisFailed = !isCancelled;
            this.capRetroMessages();
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } finally {
            clearTimeout(timeoutId!);
            this.retrospectAbortController = null;
            this.isRetrospectRunning = false;
        }
    }

    updateProposalStatus(proposalId: string, status: 'approved' | 'rejected'): ProposedChange | null {
        const retro = this.initRetrospect();
        const proposal = retro.proposals.find(p => p.id === proposalId);
        if (!proposal) return null;
        proposal.status = status;
        this.emit('retrospect', this.state.retrospect);
        return proposal;
    }

    async applyApprovedProposals(): Promise<{ applied: string[]; errors: string[] }> {
        const repoRoot = this.getRepoRoot();
        const retro = this.initRetrospect();

        const applied: string[] = [];
        const errors: string[] = [];

        for (const proposal of retro.proposals) {
            if (proposal.status !== 'approved') continue;

            try {
                const fullPath = path.isAbsolute(proposal.filePath) 
                    ? proposal.filePath 
                    : path.join(repoRoot, proposal.filePath);

                // Security: only allow writing files within the repo root
                const resolvedFull = path.resolve(fullPath);
                const resolvedRoot = path.resolve(repoRoot);
                if (!resolvedFull.startsWith(resolvedRoot)) {
                    errors.push(`${proposal.filePath}: Path is outside the repository root`);
                    this.log(`[Retrospect] Rejected ${proposal.filePath}: outside repo root`);
                    continue;
                }

                // Ensure directory exists
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(fullPath, proposal.content, 'utf-8');
                proposal.status = 'applied';
                applied.push(proposal.filePath);
                this.log(`[Retrospect] Applied: ${proposal.filePath}`);
            } catch (e: any) {
                proposal.status = 'approved'; // Keep as approved so user can retry
                errors.push(`${proposal.filePath}: ${e.message}`);
                this.log(`[Retrospect] Failed to apply ${proposal.filePath}: ${e.message}`);
            }
        }

        this.emit('retrospect', this.state.retrospect);
        await this.saveArtifacts();
        return { applied, errors };
    }

    // ─── Implementation Agent (Code Changes from Report Recommendations) ────

    /**
     * Parse recommendations from a markdown investigation report.
     * Looks for a ## Recommendations section and extracts structured items.
     */
    /**
     * Use the LLM to extract and classify recommendations from the final report
     * in a single pass. Falls back to an empty array on LLM failure.
     */
    async extractRecommendations(markdown?: string): Promise<Recommendation[]> {
        const text = markdown || this.state.finalReport || '';
        if (!text) return [];

        try {
            const openai = await this.llmProvider.getClient(30_000);
            const model = (this.config as any).recommendationModel || 'gpt-4o-mini';

            const completion = await openai.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You extract actionable recommendations from investigation reports.

Given a markdown investigation report, find ALL recommendations, suggested actions, or proposed changes and return them as a structured JSON array.

For each recommendation determine:
- **priority**: "P0" (immediate/critical), "P1" (short-term/high), "P2" (medium-term), or "P3" (long-term/low). Infer from context, headings, urgency language, or explicit priority labels.
- **title**: A concise title for the recommendation (strip numbering like "ACTION 1:", "1.", etc.)
- **description**: The full description including rationale and impact.
- **category**: "code" if it can be implemented by modifying source code (adding logic, fixing bugs, refactoring, adding metrics/logging, changing config constants in code, implementing patterns, etc.). "operational" if it requires human action outside the codebase (contacting teams, monitoring dashboards, scaling infra, running perf tests, filing tickets, manual purges, etc.)

Respond with ONLY a JSON array. Example:
[
  {"priority":"P0","title":"Add retry backoff","description":"Implement exponential backoff...","category":"code"},
  {"priority":"P1","title":"Contact platform team","description":"Engage SRE to investigate...","category":"operational"}
]

If the report contains no recommendations, return an empty array: []`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
            });

            const raw = completion.choices[0].message.content?.trim() || '';
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed: Array<{ priority?: string; title?: string; description?: string; category?: string }> = JSON.parse(jsonMatch[0]);
                return parsed
                    .filter(r => r.title)
                    .map((r, i) => ({
                        id: `rec_${r.priority || 'P2'}_${i}`,
                        priority: r.priority || 'P2',
                        title: r.title!,
                        description: r.description || '',
                        category: (r.category === 'operational' ? 'operational' : 'code') as 'code' | 'operational',
                    }));
            }
            this.log('Warning: LLM extraction response did not contain a valid JSON array');
        } catch (err: any) {
            this.log(`Warning: LLM recommendation extraction failed (${err.message})`);
        }

        return [];
    }

    async classifyRecommendations(recs: Recommendation[]): Promise<Recommendation[]> {
        if (recs.length === 0) return recs;

        const numbered = recs.map((r, i) => `${i + 1}. "${r.title}": ${r.description}`).join('\n');

        try {
            const openai = await this.llmProvider.getClient(30_000);
            const model = (this.config as any).recommendationModel || 'gpt-4o-mini';

            const completion = await openai.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You classify investigation recommendations as either "code" or "operational".

A recommendation is "code" if it can be implemented by modifying source code in the repository — adding logic, fixing bugs, refactoring classes, adding metrics/logging code, changing configuration constants in code, adding validation, implementing patterns, etc.

A recommendation is "operational" if it requires human action outside the codebase — contacting teams, engaging SREs, monitoring dashboards, scaling infrastructure, investigating external services, running performance tests, filing tickets, etc.

When a recommendation says "investigate" a specific class or service that exists in the repo's source code, that is "code" (investigating code to find a bug). When it says "investigate" an external cluster or infrastructure, that is "operational".

Respond with ONLY a JSON array of category strings, one per recommendation, in the same order. Example: ["code","operational","code"]`
                    },
                    {
                        role: 'user',
                        content: numbered
                    }
                ]
            });

            const raw = completion.choices[0].message.content?.trim() || '';
            // Extract JSON array from response (handle markdown code blocks)
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const categories: string[] = JSON.parse(jsonMatch[0]);
                if (categories.length === recs.length) {
                    return recs.map((r, i) => ({
                        ...r,
                        category: categories[i] === 'operational' ? 'operational' : 'code'
                    }));
                }
            }
            this.log('Warning: LLM classification response did not match expected format, using defaults');
        } catch (err: any) {
            this.log(`Warning: LLM classification failed (${err.message}), using defaults`);
        }

        return recs;
    }

    /**
     * Search for code patterns in the repository.
     * Cross-platform recursive search using Node.js.
     */
    /**
     * Recursively walk a directory tree collecting matching lines per file
     * into a bounded ranked buffer. Traverses the ENTIRE repo — never stops
     * early — but keeps memory bounded by evicting the least-relevant file
     * batch whenever the buffer exceeds maxLines.
     */
    private walkDir(
        fs: any, path: any,
        dir: string, repoRoot: string, regex: RegExp,
        skipDirs: Set<string>, codeExts: Set<string>,
        buffer: Map<string, { score: number; lines: string[] }>,
        maxLines: number,
        skipPaths?: Set<string>
    ): void {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (_e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            let stat: any = null;
            try {
                stat = fs.lstatSync(fullPath);
            } catch (_e) {
                stat = null;
            }
            if (!stat) continue;
            if (stat.isDirectory()) {
                if (skipDirs.has(entry)) continue;
                if (skipPaths && skipPaths.has(path.resolve(fullPath))) continue;
                this.walkDir(fs, path, fullPath, repoRoot, regex, skipDirs, codeExts, buffer, maxLines, skipPaths);
            } else {
                const ext = path.extname(entry).toLowerCase();
                if (!codeExts.has(ext)) continue;
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const lines = content.split('\n');
                    const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
                    const hits: string[] = [];
                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i])) {
                            hits.push(`${relPath}:${i + 1}: ${lines[i].trimStart().substring(0, 200)}`);
                        }
                    }
                    if (hits.length === 0) continue;

                    const score = this.scoreFilePath(relPath);

                    // Count current total lines in the buffer
                    let totalLines = 0;
                    for (const batch of buffer.values()) totalLines += batch.lines.length;

                    // If adding this batch would exceed the budget, try to evict
                    // the worst-scoring (highest number) file to make room.
                    while (totalLines + hits.length > maxLines && buffer.size > 0) {
                        let worstKey = '';
                        let worstScore = -1;
                        for (const [key, batch] of buffer) {
                            if (batch.score > worstScore) {
                                worstScore = batch.score;
                                worstKey = key;
                            }
                        }
                        // Only evict if the new batch is more relevant (lower score)
                        if (score >= worstScore) break;
                        totalLines -= buffer.get(worstKey)!.lines.length;
                        buffer.delete(worstKey);
                    }

                    // Add if there's room, or if the buffer isn't at capacity yet
                    if (totalLines + hits.length <= maxLines || buffer.size === 0) {
                        buffer.set(relPath, { score, lines: hits });
                    }
                } catch (_e) { /* skip binary/unreadable files */ }
            }
        }
    }

    /**
     * Score a file path for relevance based on location only.
     * Lower = more relevant. File extension is NOT a signal because
     * relevance depends on the task (config vs code changes).
     */
    private scoreFilePath(relPath: string): number {
        const lower = relPath.toLowerCase();
        // Dot-prefixed directories (pipelines, github, prompts, vscode, etc.)
        if (/^\.[^/]+\//i.test(lower)) return 80;
        // Docs, examples, samples
        if (/^(docs?|documentation|examples?|samples?)\//i.test(lower)) return 70;
        // Test directories
        if (/\/(tests?|__tests__|spec)\//i.test(lower)) return 50;
        if (/\.(test|spec)\.[^.]+$/i.test(lower)) return 50;
        // Everything else (source, config, etc.) — equally relevant
        return 0;
    }

    private localSearchCode(pattern: string, searchPath?: string, maxResults: number = 50): string {
        const repoRoot = path.resolve(this.getRepoRoot());
        const startDir = searchPath
            ? path.resolve(repoRoot, searchPath)
            : repoRoot;

        // Security: only allow searching within repo root
        if (!startDir.startsWith(repoRoot)) {
            return `Error: Search path '${searchPath}' resolves outside the repository root.`;
        }

        if (!fs.existsSync(startDir)) {
            return `Error: Path '${searchPath || '.'}' does not exist.`;
        }

        let regex: RegExp;
        try {
            regex = new RegExp(pattern, 'i');
        } catch {
            // Fall back to literal match if regex is invalid
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'packages', 'TestResults', 'CoverageReport', 'coverage', '.vs', 'Stage']);
        const codeExts = new Set(['.cs', '.ts', '.tsx', '.js', '.jsx', '.json', '.xml', '.csproj', '.sln', '.yaml', '.yml', '.md', '.config', '.props', '.targets', '.py']);

        // Skip investigation output directory to avoid matching on own artifacts
        const skipPaths = new Set<string>();
        if (this.config.investigationsPath) {
            skipPaths.add(path.resolve(this.config.investigationsPath));
        }

        // Traverse the entire repo with a ranked eviction buffer.
        // Less relevant file batches get evicted as better ones are found.
        const buffer = new Map<string, { score: number; lines: string[] }>();
        this.walkDir(fs, path, startDir, repoRoot, regex, skipDirs, codeExts, buffer, maxResults, skipPaths);

        if (buffer.size === 0) {
            return `No matches found for pattern '${pattern}'${searchPath ? ` in '${searchPath}'` : ''}.`;
        }

        // Output ranked: best-scoring files first
        const ranked = [...buffer.entries()].sort((a, b) => a[1].score - b[1].score);
        const results: string[] = [];
        for (const [, batch] of ranked) {
            for (const line of batch.lines) {
                if (results.length >= maxResults) break;
                results.push(line);
            }
            if (results.length >= maxResults) break;
        }

        return results.join('\n');
    }

    private getImplementationTools(): any[] {
        return [
            ...this.getRetrospectTools(), // Includes read_file, list_dir, propose_change
            {
                type: 'function',
                function: {
                    name: 'search_code',
                    description: 'Search for code patterns (string or regex) in the repository. Returns matching file paths and line content.',
                    parameters: {
                        type: 'object',
                        properties: {
                            pattern: { type: 'string', description: 'Search pattern (string or regex). Example: "ParquetIngestionNotificationMessageProcessor" or "class.*Processor"' },
                            path: { type: 'string', description: 'Optional subdirectory to search within (relative to repo root). Example: "src/Teleduct"' },
                            maxResults: { type: 'number', description: 'Maximum number of matching lines to return (default: 50)' }
                        },
                        required: ['pattern']
                    }
                }
            }
        ];
    }

    private buildImplementationSystemPrompt(selectedRecs: Recommendation[]): string {
        const recsText = selectedRecs.map((r, i) =>
            `${i + 1}. **[${r.priority}] ${r.title}**: ${r.description}`
        ).join('\n');

        return `You are a **Senior Software Engineer** implementing code changes based on investigation recommendations.

## Your Mission
Implement the selected recommendations from an investigation report by proposing specific code changes to the repository.

## Investigation Context
- **Goal**: ${this.state.query || 'N/A'}
- **Target**: ${this.state.target || 'N/A'}
- **Category**: ${this.state.category || 'N/A'}
- **Verdict**: ${this.state.verdict || 'N/A'}

## Selected Recommendations to Implement
${recsText}

## Your Tools
1. **search_code** — Search for code patterns in the repository (supports string and regex)
2. **read_file** — Read a file from the repository
3. **list_dir** — List directory contents
4. **propose_change** — Propose a file modification or creation (shown for user approval)

## CRITICAL: Tool Usage Rules
- **ALWAYS call tools directly** — NEVER describe what you plan to do. Just call search_code/read_file immediately.
- Your FIRST action must be a tool call (typically search_code to find relevant code).
- You can call multiple tools in a single response.
- Only output text when presenting your analysis or after proposing all changes.

## Implementation Guidelines
1. **Start by searching** — Use search_code to find the classes, methods, and files mentioned in the recommendations.
2. **Read the relevant files** — Use read_file to understand the full context of the code you need to modify.
3. **Propose minimal, focused changes** — Each propose_change should be a complete file with the change applied. For edits, provide the FULL file content.
4. **Preserve existing behavior** — Don't break existing functionality. Add new code paths, not replace existing ones.
5. **Follow the codebase conventions** — Match the existing code style, naming conventions, and patterns.
6. **One recommendation per proposal** — Make each proposal implement exactly one recommendation for easy review.
7. **Tag descriptions** — Prefix descriptions with the recommendation priority: [P0], [P1], [P2], [P3].

## Important Constraints
- This is a .NET codebase using Service Fabric
- Unit tests use Telerik JustMock for mocking
- Only propose changes you are confident about. If a recommendation is too vague or risky, explain why instead of guessing.
- NEVER modify test files unless explicitly asked. Focus on production code.`;
    }

    async runImplementationAnalysis(selectedRecommendationIds: string[]): Promise<void> {
        if (['running', 'paused'].includes(this.state.status)) {
            throw new Error('Implementation is only available for completed investigations.');
        }

        if (this.isImplementationRunning) {
            this.log('[Implementation] Already in progress, skipping duplicate request.');
            return;
        }

        if (this.isRetrospectRunning) {
            throw new Error('Cannot run implementation while retrospect analysis is in progress.');
        }

        const allRecs = this.state.recommendations || [];
        const selectedRecs = allRecs.filter(r => selectedRecommendationIds.includes(r.id));

        if (selectedRecs.length === 0) {
            throw new Error('No valid recommendations selected.');
        }

        this.isImplementationRunning = true;
        this.state.implementationRunning = true;

        const retro = this.initRetrospect();
        const tools = this.getImplementationTools();

        const systemPrompt = this.buildImplementationSystemPrompt(selectedRecs);
        const reportContext = (this.state.finalReport || '').substring(0, 8000);
        const userMessage = `## Investigation Report (Context)\n${reportContext}\n\n---\n\nImplement the ${selectedRecs.length} selected recommendation(s) now. Start by using search_code to find the relevant code, then read_file to understand it, and finally propose_change to suggest modifications.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];

        // Push trigger message for UI
        retro.messages.push({ role: 'user', content: `[Implementation] Implementing ${selectedRecs.length} recommendation(s): ${selectedRecs.map(r => `[${r.priority}] ${r.title}`).join(', ')}` });
        this.emit('retrospect', this.state.retrospect);

        const timeoutMinutes = this.config.retrospectTimeoutMinutes || 10;
        const TIMEOUT_MS = timeoutMinutes * 60 * 1000;
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Implementation timed out after ${timeoutMinutes} minutes`)), TIMEOUT_MS);
        });

        try {
            const responseText = await Promise.race([
                this.runRetrospectToolLoop(messages, tools),
                timeoutPromise
            ]);

            // Count only implementation proposals (tagged with source: 'implementation')
            const implProposals = retro.proposals.filter(p => p.source === 'implementation');
            const proposalCount = implProposals.length;
            const summaryParts: string[] = [];
            if (responseText && !responseText.startsWith('Analysis complete')) {
                summaryParts.push(responseText);
            }
            summaryParts.push('---');
            if (proposalCount > 0) {
                summaryParts.push(`**Implementation complete.** ${proposalCount} code change${proposalCount === 1 ? '' : 's'} proposed. Review them in the Proposed Code Changes panel and approve or reject each one.`);
            } else {
                summaryParts.push('**Implementation complete.** No code changes were proposed. The recommendations may require manual implementation or further clarification.');
            }
            retro.messages.push({ role: 'assistant', content: summaryParts.join('\n\n') });
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } catch (error: any) {
            const isCancelled = error.name === 'AbortError';
            const errMsg = isCancelled
                ? 'Implementation was cancelled.'
                : `Error during implementation: ${error.message}`;
            this.log(`[Implementation] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } finally {
            clearTimeout(timeoutId!);
            this.retrospectAbortController = null;
            this.isImplementationRunning = false;
            this.state.implementationRunning = false;
        }
    }

    /**
     * Compute the desired folder name for the current investigation state. Format:
     * `<YYYY-MM-DD>_<safeTarget>[_<safeTitle>]_<safeId>`. The safeId suffix is
     * the durable lookup key (see `findInvestigationDirById`).
     */
    private computeInvestigationFolderName(): string {
        const startDate = !isNaN(Number(this.state.id)) ? new Date(Number(this.state.id)) : new Date();
        const timestamp = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const safeStamp = (this.state.target || 'UnknownTarget').replace(/[^a-zA-Z0-9-]/g, '');
        const safeTitle = this.state.title
            ? this.state.title.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 50)
            : '';
        const safeId = this.state.id.replace(/[^a-zA-Z0-9]/g, '');
        const nameParts = [timestamp, safeStamp, ...(safeTitle ? [safeTitle] : []), safeId];
        return nameParts.join('_');
    }

    /**
     * Find this investigation's existing folder under baseDir by matching the
     * `_<safeId>` suffix. Returns undefined if no folder for this id exists yet.
     */
    private async findInvestigationDirById(baseDir: string): Promise<string | undefined> {
        if (!fs.existsSync(baseDir)) return undefined;
        let entries: fs.Dirent[];
        try {
            entries = await fsp.readdir(baseDir, { withFileTypes: true });
        } catch {
            return undefined;
        }
        const safeId = this.state.id.replace(/[^a-zA-Z0-9]/g, '');
        const suffix = `_${safeId}`;
        const match = entries.find(e => e.isDirectory() && e.name.endsWith(suffix));
        return match ? path.join(baseDir, match.name) : undefined;
    }

    /**
     * Resolve where to write this investigation's artifacts. If a folder for this
     * investigation already exists under a different name (e.g. because target/title
     * changed since the last save), rename it to the desired name so we keep one
     * directory per investigation id instead of orphaning the old one.
     */
    private async resolveInvestigationDir(baseDir: string): Promise<string> {
        const desiredName = this.computeInvestigationFolderName();
        const desiredDir = path.join(baseDir, desiredName);
        const existingDir = await this.findInvestigationDirById(baseDir);

        if (!existingDir || existingDir === desiredDir) {
            return desiredDir;
        }

        try {
            await fsp.rename(existingDir, desiredDir);
            this.log(`Renamed investigation folder: ${path.basename(existingDir)} -> ${desiredName}`);
            return desiredDir;
        } catch (err: any) {
            // Rename failed (e.g. desired path already exists). Fall back to the existing
            // folder so we don't silently create a duplicate.
            this.log(`Could not rename folder ${path.basename(existingDir)} -> ${desiredName}: ${err.message}. Keeping existing.`);
            return existingDir;
        }
    }

    /**
     * Public entry point for persisting investigation artifacts. Serializes
     * concurrent calls through a per-runner promise chain so two callers
     * cannot race on the same `state.json.tmp` path. At most one save is in
     * flight; at most one additional save is queued (subsequent calls fold
     * into the queued one — they all observe the same up-to-date `this.state`
     * when the queued save eventually runs, so coalescing loses no data).
     */
    private async saveArtifacts(): Promise<void> {
        // Skip saving when this runner is a pipeline stage — the orchestrator
        // controls artifact saving via the anchor runner. Done OUTSIDE the
        // chain so a stage runner never blocks anything.
        if (this.stageContext) return;

        if (this.saveQueued) return this.saveChain;
        this.saveQueued = true;
        this.saveChain = this.saveChain.then(async () => {
            // Reset BEFORE running so calls arriving during this save queue
            // a follow-up that captures their newer state.
            this.saveQueued = false;
            await this.saveArtifactsInternal();
        });
        return this.saveChain;
    }

    private async saveArtifactsInternal() {
        // Sync fullHistory before persisting so the saved state has the complete record
        this.syncFullHistory();

        const baseDir = this.config.investigationsPath || path.join(this.getRepoRoot(), 'investigations');

        await fsp.mkdir(baseDir, { recursive: true });

        const investigationDir = await this.resolveInvestigationDir(baseDir);
        await fsp.mkdir(investigationDir, { recursive: true });

        // Save JSON atomically (write to .tmp, then rename).
        // state.fullHistory is the cumulative in-memory record (kept across saves —
        // see comment at the bottom of this method). Persisting it directly is correct;
        // no merge with the previous on-disk file is needed and would risk duplicating
        // entries after rehydration (where in-memory was just loaded from disk).
        const jsonPath = path.join(investigationDir, `state.json`);
        const tmpPath = jsonPath + '.tmp';
        this.log(`Saving JSON artifact to: ${jsonPath}`);
        await fsp.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
        await fsp.rename(tmpPath, jsonPath);

        // Generate Markdown Report — use fullHistory for complete record
        const extractThoughtText = (t: any): string => {
            if (typeof t === 'string') return t;
            if (t && typeof t === 'object' && t.content) return String(t.content);
            return JSON.stringify(t);
        };

        // Use fullHistory for report if available, falling back to thoughts
        const reportThoughts = (this.state.fullHistory && this.state.fullHistory.length > 0)
            ? this.state.fullHistory
            : this.state.thoughts;
        const reportActions = (this.state.fullActions && this.state.fullActions.length > 0)
            ? this.state.fullActions
            : this.state.actions;

        // Find the most recent thought suitable for a human-facing preview, skipping
        // the verbose "CONTESTED REPORT ..." LLM-context block injected by contestReport().
        // Without this filter the Summary/preview would echo the entire rejected report
        // and duplicate the corresponding Execution Log step.
        const findLatestPreviewThought = (): string | undefined => {
            for (let i = reportThoughts.length - 1; i >= 0; i--) {
                const text = extractThoughtText(reportThoughts[i]);
                if (!isContestLlmContextMessage(text)) return text;
            }
            return undefined;
        };

        const inFlight = this.state.status === 'running' || this.state.status === 'paused';
        let summaryText: string;
        if (this.state.finalReport) {
            summaryText = this.state.finalReport;
        } else if (inFlight && (this.state.contestCount ?? 0) > 0) {
            summaryText = `_Investigation in progress (re-running after contest #${this.state.contestCount}). The previous final report was rejected; a revised report has not been produced yet._`;
        } else if (inFlight) {
            summaryText = '_Investigation in progress. Final report not yet available._';
        } else {
            summaryText = findLatestPreviewThought() ?? 'No summary available.';
        }

        const thoughtPreview = findLatestPreviewThought();
        const summaryState = {
            id: this.state.id,
            status: this.state.status,
            thoughts: thoughtPreview ? [thoughtPreview] : [],
            actions: [],
            logs: [],
            title: this.state.title,
            query: this.state.query,
            target: this.state.target,
            timeRange: this.state.timeRange,
            correlationId: this.state.correlationId,
            category: this.state.category,
            incidentId: this.state.incidentId,
            model: this.state.model,
            productId: this.state.productId,
            pausedAt: this.state.pausedAt,
            totalPausedTime: this.state.totalPausedTime,
            finalReport: this.state.finalReport,
            recommendations: this.state.recommendations,
            retrospect: this.state.retrospect ? {
                messages: [],
                proposals: (this.state.retrospect.proposals || []).map(proposal => ({ id: proposal.id, status: proposal.status })),
                analysisComplete: this.state.retrospect.analysisComplete,
                analysisFailed: this.state.retrospect.analysisFailed,
                completed: this.state.retrospect.completed,
            } : undefined,
            contestCount: this.state.contestCount,
            tags: this.state.tags || [],
            createdBy: this.state.createdBy,
            source: this.state.source,
            scheduleId: this.state.scheduleId,
            verdict: this.state.verdict,
            _summaryOnly: true,
            _thoughtCount: reportThoughts.length,
        };

        // Cap thought text in report to prevent multi-MB reports when fullHistory has
        // hundreds of entries (many with 72K+ char observations). Full data is in state.json.
        const MAX_REPORT_THOUGHT_CHARS = 2_000;
        const capForReport = (text: string): string => {
            if (text.length <= MAX_REPORT_THOUGHT_CHARS) return text;
            return text.substring(0, MAX_REPORT_THOUGHT_CHARS) + `\n... [truncated ${text.length.toLocaleString()} chars]`;
        };

        const report = `# Investigation Report: ${this.state.id}\n\n` +
            `**Status**: ${this.state.status}\n` +
            `**Target**: ${this.state.target || 'N/A'}\n` +
            `**Model**: ${this.state.model}\n` +
            `**Date**: ${new Date().toLocaleString()}\n\n` +
            `## Summary\n` +
            summaryText + `\n\n` +
            `## Execution Log\n\n` +
            reportThoughts.map((t: any, i: number) => {
                const action = reportActions[i];
                let entry = `### Step ${i + 1}\n**Thought**: ${capForReport(extractThoughtText(t))}\n`;
                if (action) {
                    entry += `**Action**: \`${action.tool}\`\n\`\`\`json\n${JSON.stringify(action.args, null, 2)}\n\`\`\`\n`;
                    if (action.result) {
                        const res = typeof action.result === 'string' ? action.result : JSON.stringify(action.result, null, 2);
                        entry += `**Result**: \n\`\`\`\n${res.substring(0, 1000)}${res.length > 1000 ? '...' : ''}\n\`\`\`\n`;
                    }
                }
                return entry;
            }).join('\n');

        await fsp.writeFile(path.join(investigationDir, `report.md`), report);
        const summaryPath = path.join(investigationDir, 'summary.json');
        const summaryTmpPath = summaryPath + '.tmp';
        await fsp.writeFile(summaryTmpPath, JSON.stringify(summaryState, null, 2));
        await fsp.rename(summaryTmpPath, summaryPath);

        // Note: state.fullHistory / state.fullActions are kept in memory across saves.
        // They form the cumulative uncompacted record consumed by contestReport(),
        // restoreToLastCheckpoint(), buildRetrospectHistory(), and the Live tab's
        // GET /api/investigations/:id selector. Releasing them here (a previously-
        // attempted optimization) caused data loss because subsequent saves would
        // overwrite the on-disk record with only the post-release delta.

        this.log(`Artifacts saved.`);
    }

    pause() {
        this.paused = true;
        this.state.status = 'paused';
        this.state.pausedAt = Date.now();
        this.emit('status', { status: 'paused' });
        this.log("Investigation paused.");
    }
    intervene(message: string) {
        // Persist immediately into state.thoughts/state.actions so the user's
        // message is captured in the investigation record and survives a crash
        // or auto-pause before the next LLM call. Previously this was queued
        // in an in-memory pendingInterventions array that was never written to
        // state.json — messages sent between LLM calls were silently lost when
        // the server restarted.
        const formatted = `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)`;
        const entry = { role: 'user' as const, content: formatted };
        this.state.thoughts.push(entry);
        this.state.actions.push(null as any);
        this.emit('thought', this.tagEvent(entry));
        this.log(`User intervention recorded: ${message}`);
        // Best-effort save — a no-op when this runner is a pipeline stage
        // (the anchor runner saves on the next stage event), but ensures the
        // intervention is on disk for non-pipeline investigations even if the
        // process crashes before the next runner-loop iteration.
        this.saveArtifacts().catch(err => {
            console.error(`[Runner] Failed to persist intervention: ${err?.message || err}`);
        });
    }

    resume() {
        this.paused = false;
        this.state.status = 'running';
        if (this.state.pausedAt) {
            const pausedDuration = Date.now() - this.state.pausedAt;
            this.state.totalPausedTime = (this.state.totalPausedTime || 0) + pausedDuration;
            this.state.pausedAt = undefined;
        }
        this.emit('status', { status: 'running' });
        this.log("Investigation resumed.");
    }
    abort() { this.aborted = true; this.state.status = 'aborted'; this.emit('status', { status: 'aborted' }); }

    contestReport(feedback: string) {
        if (this.state.status !== 'completed') {
            throw new Error('Can only contest a completed investigation.');
        }

        const contestNum = (this.state.contestCount || 0) + 1;
        this.state.contestCount = contestNum;

        // 1. Push a user-visible contest message (rendered as a special bubble in the UI)
        const userVisibleMessage = `Report Contested: ${feedback}`;
        this.state.thoughts.push({ role: 'user', content: userVisibleMessage });
        this.state.actions.push(null as any);
        this.emit('thought', { role: 'user', content: userVisibleMessage });

        // 2. Push a system notification (rendered as a centered pill in the UI)
        const systemNotice = `System: Report contested (attempt #${contestNum}). Investigation resumed with user feedback.`;
        this.state.thoughts.push(systemNotice);
        this.state.actions.push(null as any);
        this.emit('thought', systemNotice);

        // 3. Inject the full context for the LLM (rejected report + feedback + instructions)
        const rejectedReport = this.state.finalReport || '(no report content)';
        const contestMessage = [
            `${CONTEST_LLM_CONTEXT_PREFIX}${contestNum})`,
            `The user has rejected the following final report:`,
            `--- REJECTED REPORT START ---`,
            rejectedReport,
            `--- REJECTED REPORT END ---`,
            ``,
            `User feedback: ${feedback}`,
            ``,
            `(SYSTEM NOTE: You MUST acknowledge this feedback, understand what was wrong or missing, and continue investigating. Do NOT repeat the same conclusions. Address the user's concerns and call the finish tool again only when you have a substantially improved report.)`
        ].join('\n');

        this.state.thoughts.push({ role: 'user', content: contestMessage });
        this.state.actions.push(null as any);

        // Clear the final report
        this.state.finalReport = undefined;
        this.state.recommendations = undefined;

        // Reset retrospective (it analyzed a now-rejected report)
        this.state.retrospect = { messages: [], proposals: [], analysisComplete: false, completed: false };

        // Snapshot pipeline state before resetting so restoreToLastCheckpoint can recover it
        if (this.state.pipeline) {
            this.state._priorPipelineSnapshot = JSON.parse(JSON.stringify(this.state.pipeline));
        }

        // Reset pipeline stage states so the stepper shows fresh progress
        if (this.state.pipeline?.stages) {
            for (const stage of this.state.pipeline.stages) {
                stage.status = 'pending';
                stage.verdict = undefined;
                stage.feedback = undefined;
                stage.report = undefined;
                stage.retryCount = 0;
                stage.startedAt = undefined;
                stage.completedAt = undefined;
            }
            this.state.pipeline.currentStageIndex = 0;
            this.state.pipeline.conversationLog = [];
        }

        // Transition back to running
        this.paused = false;
        this.aborted = false;
        this.state.status = 'running';
        if (this.state.pausedAt) {
            const pausedDuration = Date.now() - this.state.pausedAt;
            this.state.totalPausedTime = (this.state.totalPausedTime || 0) + pausedDuration;
            this.state.pausedAt = undefined;
        }

        this.emit('status', { status: 'running' });
        this.log(`Investigation report contested (attempt #${contestNum}). User feedback: ${feedback}`);
    }

    async restoreToLastCheckpoint() {
        if (this.state.status !== 'completed') {
            throw new Error('Can only restore a completed investigation.');
        }
        if (!this.state.contestCount || this.state.contestCount < 1) {
            throw new Error('No previous checkpoint to restore to. The investigation has not been contested.');
        }

        // Ensure fullHistory is populated — it may have been cleared from RAM after saveArtifacts
        if (!this.state.fullHistory || this.state.fullHistory.length === 0) {
            const baseDir = this.config.investigationsPath || path.join(this.getRepoRoot(), 'investigations');
            // Look up the investigation folder by id-suffix so we still find it even
            // if target/title changed since the last save.
            const existingDir = await this.findInvestigationDirById(baseDir);
            const statePath = existingDir
                ? path.join(existingDir, 'state.json')
                : path.join(baseDir, this.computeInvestigationFolderName(), 'state.json');

            if (fs.existsSync(statePath)) {
                const savedState = JSON.parse(await fsp.readFile(statePath, 'utf8'));
                this.state.fullHistory = savedState.fullHistory || [];
                this.state.fullActions = savedState.fullActions || [];
            }
        }

        if (!this.state.fullHistory || this.state.fullHistory.length === 0) {
            throw new Error('Cannot restore: no history available.');
        }

        // Find the last "Report Contested:" entry in fullHistory (scanning backward)
        let contestIndex = -1;
        for (let i = this.state.fullHistory.length - 1; i >= 0; i--) {
            const entry = this.state.fullHistory[i];
            const content = typeof entry === 'string' ? entry : entry?.content;
            if (typeof content === 'string' && content.startsWith('Report Contested:')) {
                contestIndex = i;
                break;
            }
        }

        if (contestIndex < 0) {
            throw new Error('Cannot restore: no contest boundary found in history.');
        }

        // Extract the rejected report from the CONTESTED REPORT message (contestIndex + 2)
        let restoredReport: string | undefined;
        const contestedEntry = this.state.fullHistory[contestIndex + 2];
        if (contestedEntry) {
            const contestedContent = typeof contestedEntry === 'string' ? contestedEntry : contestedEntry?.content;
            if (typeof contestedContent === 'string') {
                const startMarker = '--- REJECTED REPORT START ---';
                const endMarker = '--- REJECTED REPORT END ---';
                const startIdx = contestedContent.indexOf(startMarker);
                const endIdx = contestedContent.indexOf(endMarker);
                if (startIdx !== -1 && endIdx !== -1) {
                    restoredReport = contestedContent.substring(startIdx + startMarker.length, endIdx).trim();
                }
            }
        }

        if (!restoredReport) {
            throw new Error('Cannot restore: unable to extract the previous report from history.');
        }

        // Truncate history to just before the contest
        this.state.fullHistory = this.state.fullHistory.slice(0, contestIndex);
        this.state.fullActions = (this.state.fullActions || []).slice(0, contestIndex);

        // Set thoughts/actions to the truncated fullHistory
        this.state.thoughts = [...this.state.fullHistory];
        this.state.actions = [...this.state.fullActions];
        this.fullHistorySyncCursor = this.state.thoughts.length;

        // Restore the previous report
        this.state.finalReport = restoredReport;
        this.state.contestCount = this.state.contestCount! - 1;

        // Re-extract recommendations from the restored report
        try {
            this.state.recommendations = await this.extractRecommendations(restoredReport);
            this.log(`Restored report: extracted ${this.state.recommendations.length} recommendations.`);
        } catch (err: any) {
            this.log(`Warning: recommendation extraction failed during restore: ${err.message}`);
            this.state.recommendations = [];
        }

        // Restore pipeline state from the pre-contest snapshot
        if (this.state._priorPipelineSnapshot) {
            this.state.pipeline = this.state._priorPipelineSnapshot;
            this.state._priorPipelineSnapshot = undefined;
        }

        // Reset retrospect (it analyzed the now-deleted post-contest report)
        this.state.retrospect = { messages: [], proposals: [], analysisComplete: false, completed: false };

        // Ensure status is completed
        this.state.status = 'completed';

        // Push a system notification visible in the UI
        const systemNotice = `System: Investigation restored to previous report checkpoint.`;
        this.state.thoughts.push(systemNotice);
        this.state.actions.push(null as any);
        this.emit('thought', systemNotice);

        // Re-sync fullHistory cursor after push
        this.fullHistorySyncCursor = this.state.thoughts.length;

        this.emit('status', { status: 'completed' });
        await this.saveArtifacts();
        this.log(`Investigation restored to checkpoint before contest #${(this.state.contestCount || 0) + 1}.`);
    }

    private loadSystemPrompt(): string {
        // Pipeline stage override takes priority
        if (this.stageContext?.systemPromptOverride) {
            return this.stageContext.systemPromptOverride;
        }
        if (fs.existsSync(this.config.systemPromptPath)) {
            return fs.readFileSync(this.config.systemPromptPath, 'utf8');
        }
        return "You are a helpful assistant.";
    }

    /**
     * Build the focused retry-context block injected into the system prompt
     * when a producer stage is being re-run after rejection. Deliberately
     * EXCLUDES the reviewer's prose report — only the structured open items
     * are surfaced — to prevent the producer from drifting into mimicking the
     * reviewer's voice (the failure mode that triggered repeated rejection
     * loops in production investigations).
     */
    private buildRetryContextBlock(retry: NonNullable<StageContext['retryContext']>): string {
        const MAX_PRIOR_REPORT_CHARS = 12_000;
        let priorReport = retry.priorReport || '(prior report unavailable)';
        if (priorReport.length > MAX_PRIOR_REPORT_CHARS) {
            priorReport = priorReport.substring(0, MAX_PRIOR_REPORT_CHARS) +
                `\n\n... [prior report truncated; ${priorReport.length.toLocaleString()} chars total]`;
        }
        const reviewer = retry.reviewerName ? ` by ${retry.reviewerName}` : '';
        const blockerCount = retry.openItems.filter(i => i.severity === 'blocker').length;
        const majorCount = retry.openItems.filter(i => i.severity === 'major').length;
        const itemsList = retry.openItems.length > 0
            ? retry.openItems
                .map((it, i) => {
                    const ev = it.evidenceRequired ? `\n   Evidence required: ${it.evidenceRequired}` : '';
                    return `${i + 1}. [${it.severity.toUpperCase()}] ${it.claim}${ev}`;
                })
                .join('\n')
            : '(no structured items provided)';

        return `\n\n## Retry Context (round ${retry.round})

Your prior report was rejected${reviewer}. You are being re-run to address the open items below — and ONLY those items. Other agents' prose feedback is not included; do not infer additional changes.

### Your Prior Report

\`\`\`
${priorReport}
\`\`\`

### Open Items To Address (${blockerCount} blocker, ${majorCount} major, ${retry.openItems.length - blockerCount - majorCount} minor)

${itemsList}

### Mandatory Behavior For This Re-Run

- You MUST run at least one new tool call to gather evidence before calling \`finish\`. Repeating your prior report verbatim is not permitted.
- For each blocker and major item above, your new report must show concrete evidence (tool output) addressing it.
- Do NOT mimic the format, tone, or wording of any reviewer agent. You are a producer; your job is to investigate, not to evaluate.
- Do NOT include phrases like "REJECTING", "Devil's Advocate", "Validator review", or other reviewer language in your report.
- When you call \`finish\`, the \`report\` field must be your own analysis, not a paraphrase of the reviewer's prose.
`;
    }


    /**
     * Tag an emitted event with pipeline agent identity (if running as a stage).
     * Returns the original data augmented with agentId/agentName/agentColor/agentIcon.
     * When not in pipeline mode, returns the data unchanged.
     */
    private tagEvent(data: any): any {
        if (!this.stageContext) return data;
        const tag = {
            agentId: this.stageContext.agentId,
            agentName: this.stageContext.agentName,
            agentColor: this.stageContext.agentColor,
            agentIcon: this.stageContext.agentIcon,
            stageIndex: this.stageContext.stageIndex,
        };
        if (typeof data === 'string') {
            return { content: data, ...tag };
        }
        if (typeof data === 'object' && data !== null) {
            return { ...data, ...tag };
        }
        return data;
    }

    /**
     * Producer-rescue: restore the finish action that the finish-gate popped
     * earlier in this stage and complete the stage as if the model had emitted
     * it. Called when the model has gone silent (text-only) for a configurable
     * number of turns after the gate trip — strong evidence that it has
     * nothing more to investigate but cannot express that because the only
     * vehicle for "I give up" (`finish`) is exactly what the gate just blocked.
     *
     * Side effects (all required to mirror the normal finish path):
     *   - Mutates `lastPoppedFinish.args.verdict` to `flagged` if it was
     *     stronger (`approved`/`completed`). The producer literally could not
     *     gather more evidence after a rejection, so the report is at best
     *     provisional and the convergence-detection downgrade in the
     *     orchestrator already treats this as `flagged → continue`.
     *   - Appends a `## Limitations` section to the report explaining what
     *     happened, so downstream consumers (next stage, retrospect, UI) see
     *     the rescue as an explicit fact, not a silent verdict downgrade.
     *   - Pushes the restored action onto `state.actions` and the
     *     "Report Generated" marker into `state.thoughts` (parallel arrays).
     *   - Sets `state.status = 'completed'` and `state.finalReport` so
     *     `getStageResult()` returns the rescued verdict + report.
     *   - Calls `extractRecommendations()` and `saveArtifacts()` exactly like
     *     the normal finish path, so the on-disk artifact is identical to a
     *     real model-emitted finish.
     *
     * The caller (the consecutive-thoughts branch in `start()`) breaks out of
     * the main loop after this returns; we do not need to advance any counters
     * because the stage is over.
     */
    private async acceptRescuedFinish(): Promise<void> {
        if (!this.lastPoppedFinish) return; // defensive — caller should have checked

        const restored = this.lastPoppedFinish;
        this.lastPoppedFinish = null;
        this.silentTurnsSinceFinishPop = 0;

        // Verdict downgrade: if the model said 'approved' before the gate
        // popped its finish, the rescue cannot honor that — the rescue only
        // fires when the producer FAILED to gather new evidence after a
        // critic rejection, so the report is by definition provisional.
        // Honor any existing 'flagged' or 'rejected' (the model self-flagged).
        const PIPELINE_VERDICTS = new Set(['flagged', 'rejected']);
        if (!restored.args) restored.args = {};
        if (!PIPELINE_VERDICTS.has(restored.args.verdict)) {
            restored.args.verdict = 'flagged';
        }

        // Append a Limitations section so downstream stages see the rescue.
        // Use a stable marker (`<!-- producer-rescue-limitations -->`) so
        // tests and tooling can detect rescues without parsing prose.
        const rescueNote = `\n\n<!-- producer-rescue-limitations -->\n## Limitations\n\n` +
            `The reviewer flagged open items on the prior round, but on this retry attempt the producer ` +
            `could not gather additional evidence to address them (it called \`finish\` without new tool calls, ` +
            `then went silent when the finish-gate asked for either new evidence or an explicit concession). ` +
            `The pipeline accepted this report as-is — with verdict downgraded to \`flagged\` — to make forward progress. ` +
            `Treat the conclusions as provisional and re-investigate the open items manually if they matter.\n`;
        const reportField = restored.args.report || restored.args.summary;
        if (typeof reportField === 'string' && !reportField.includes('<!-- producer-rescue-limitations -->')) {
            // Always write back to `report` so downstream consumers find the rescue note
            // in a predictable field, regardless of which key the model originally used.
            restored.args.report = reportField + rescueNote;
            // Avoid keeping a stale `summary` that lacks the note.
            if (restored.args.summary && restored.args.summary !== restored.args.report) {
                delete restored.args.summary;
            }
        } else if (!reportField) {
            restored.args.report = `(Producer did not provide a report on the rescued attempt.)${rescueNote}`;
        }

        // Now mirror the normal finish-handling path from start()'s main loop.
        const noticeMsg = `System: Producer-rescue activated — accepting prior \`finish\` (verdict downgraded to \`flagged\`, ` +
            `Limitations section appended) so the pipeline can make forward progress.`;
        this.state.thoughts.push({ role: 'system', content: noticeMsg });
        this.state.actions.push(null as any);
        this.emit('thought', noticeMsg);
        this.log(`[finish-gate] ${noticeMsg}`);

        this.state.actions.push(restored);
        this.emit('action', this.tagEvent(restored));

        this.state.status = 'completed';
        // The if/else block above guarantees `restored.args.report || restored.args.summary`
        // is non-empty here:
        //   - if reportField was a string without the marker, we assigned `reportField + rescueNote` to .report;
        //   - if reportField was falsy, we assigned the synthesized "(Producer did not provide…)" placeholder to .report;
        //   - if reportField was a non-string truthy (e.g. number/object), .report or .summary already held that value.
        // So no extra fallback string is needed.
        const report = restored.args.report || restored.args.summary;
        this.state.verdict = restored.args.verdict;
        this.state.finalReport = report;
        this.state.thoughts.push(`Observation: Report Generated.`);

        // Extract recommendations the same way the regular finish path does.
        try {
            this.state.recommendations = await this.extractRecommendations(report);
            this.log(`Extracted ${this.state.recommendations.length} recommendations.`);
        } catch (err: any) {
            this.log(`Warning: recommendation extraction failed: ${err.message}`);
            this.state.recommendations = [];
        }

        // Mark the restored action with a result string and add the alignment
        // null entry so action-thought parallelism is preserved.
        restored.result = 'Report generated and saved to finalReport field (rescued by producer-rescue).';
        this.state.actions.push(null as any);

        await this.saveArtifacts();
    }

    /**
     * Get the pipeline-relevant result from this agent's execution.
     * Used by PipelineOrchestrator to extract verdict/feedback/report after the agent finishes.
     */
    getStageResult(): { report?: string; verdict?: string; feedback?: string; openItems?: OpenItem[]; toolCallSignature?: string[] } {
        // The finish tool may have set verdict on state (health check style)
        // or the args may include pipeline-style verdict/feedback.
        // Use reverse search so we pick THIS stage's finish action, not an
        // earlier stage's — the actions array is accumulated across pipeline stages.
        let lastFinishAction: any;
        for (let i = this.state.actions.length - 1; i >= 0; i--) {
            const a = this.state.actions[i];
            if (a && a.tool === 'finish') { lastFinishAction = a; break; }
        }

        // Map health-check verdicts to pipeline equivalents so agents that
        // accidentally use 'critical' / 'warning' / 'healthy' still trigger
        // the correct pipeline rejection logic.
        const HEALTH_TO_PIPELINE: Record<string, string> = {
            healthy: 'approved',
            warning: 'flagged',
            critical: 'rejected',
        };
        const PIPELINE_VERDICTS = new Set(['approved', 'rejected', 'flagged']);
        const rawVerdict = lastFinishAction?.args?.verdict;
        const mappedVerdict = rawVerdict
            ? (PIPELINE_VERDICTS.has(rawVerdict) ? rawVerdict : HEALTH_TO_PIPELINE[rawVerdict] || rawVerdict)
            : undefined;

        const fallbackVerdict = PIPELINE_VERDICTS.has(this.state.verdict as string)
            ? this.state.verdict
            : (this.state.verdict ? HEALTH_TO_PIPELINE[this.state.verdict] : undefined);

        // Sanitize structured open items from the reviewer's finish call.
        // Backwards compatible: when only legacy `feedback` prose is provided,
        // the orchestrator synthesizes a single blocker item from it.
        const rawItems = lastFinishAction?.args?.openItems;
        const openItems: OpenItem[] | undefined = Array.isArray(rawItems)
            ? rawItems
                .filter((it: any) => it && typeof it.claim === 'string' && it.claim.trim().length > 0)
                .map((it: any) => ({
                    severity: ['blocker', 'major', 'minor'].includes(it.severity) ? it.severity : 'major',
                    claim: String(it.claim).trim(),
                    evidenceRequired: typeof it.evidenceRequired === 'string' ? it.evidenceRequired : undefined,
                }))
            : undefined;

        // Compute a tool-call signature for THIS stage's run only (not the whole
        // accumulated actions array). The orchestrator uses this to detect
        // no-progress retries: when round N+1 produces the same signature as
        // round N, the producer is just paraphrasing without gathering new
        // evidence and the loop should stop.
        const stageActions = this.state.actions.slice(this.stageStartActionsLength);
        const toolCallSignature = stageActions
            .filter(a => a && a.tool && a.tool !== 'finish')
            .map(a => `${a.tool}:${this.stableStringify(a.args)}`);

        return {
            report: this.state.finalReport,
            verdict: mappedVerdict || fallbackVerdict,
            feedback: lastFinishAction?.args?.feedback,
            openItems,
            toolCallSignature,
        };
    }

    /**
     * Deterministic JSON stringify used for tool-call signatures. Sorts object
     * keys so semantically-identical args produce identical signatures.
     */
    private stableStringify(value: any): string {
        if (value === null || value === undefined) return 'null';
        if (typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(v => this.stableStringify(v)).join(',') + ']';
        const keys = Object.keys(value).sort();
        return '{' + keys.map(k => JSON.stringify(k) + ':' + this.stableStringify(value[k])).join(',') + '}';
    }

    public log(msg: string) {
        console.log(`[Agent] ${msg}`);
        this.state.logs.push(msg);

        // Cap logs to prevent unbounded growth (Fix 7/8)
        const MAX_LOGS = 500;
        if (this.state.logs.length > MAX_LOGS) {
            this.state.logs.splice(0, this.state.logs.length - MAX_LOGS);
        }

        // Emit log for UI visibility, but DON'T push to thoughts array
        // This prevents log messages from inflating the LLM payload
        const logThought = {
            role: 'system',
            type: 'log',
            content: msg
        };
        // Note: Only emit for UI, don't add to this.state.thoughts to avoid payload bloat
        this.emit('thought', logThought);
    }

    private async callLLM(system: string, userQuery: string, history: any[], forceTool: boolean = false): Promise<any> {
        let currentHistory = history;
        let currentSystem = system;
        const maxAttempts = 3;
        let lastPayloadChars = 0;
        let lastEstimatedTokens = 0;
        let forceToolDowngraded = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const authStatus = await this.llmProvider.getAuthStatus();
                if (!authStatus.authenticated) {
                    return {
                        thought: `Error: Not authenticated with ${this.llmProvider.displayName}. Please login via the dashboard.`,
                        isFinal: true
                    };
                }

                // Get or reuse OpenAI-compatible client from provider
                this.openaiClient = await this.llmProvider.getClient(180_000);
                const openai = this.openaiClient;
                const model = this.state.model || this.config.model || 'gpt-4o';

                this.log(`Calling LLM (${model}) [Attempt ${attempt + 1}]...`);

                let tools: any[] = [];
                try {
                    tools = await this.toolManager.listTools();
                } catch (e) {
                    this.log(`Warning: Failed to list tools: ${e}`);
                }

                // Per-agent tool whitelist enforcement. When the orchestrator
                // passed `allowedTools`, hide everything outside that list from
                // the LLM so it cannot call (e.g.) `execute_kql_query` from a
                // Code Scout stage that is supposed to be read-only. Only the
                // structural `finish` tool is auto-allowed (without it the
                // agent has no way to complete). `invoke_subagent` is NOT
                // auto-allowed — otherwise a restricted agent could escape
                // its sandbox by spawning a subagent to run the disallowed
                // tools on its behalf, which is exactly what Code Scout did
                // in production (it invoked the Teleduct Investigator
                // subagent to run KQL despite a [read_file, list_dir] only
                // whitelist). Agents that legitimately need delegation must
                // include 'invoke_subagent' explicitly in their whitelist.
                const allowedTools = this.stageContext?.allowedTools;
                if (allowedTools && allowedTools.length > 0) {
                    const allowedSet = new Set([...allowedTools, 'finish']);
                    const beforeCount = tools.length;
                    tools = tools.filter(t => allowedSet.has(t.name));
                    if (tools.length !== beforeCount) {
                        this.log(`[tool-whitelist] Filtered ${beforeCount - tools.length} tool(s) outside agent allowlist [${[...allowedSet].join(', ')}]; ${tools.length} remain.`);
                    }
                }

                // Per-message size guard: even after compaction, individual messages
                // can be oversized (e.g., a single large observation). Cap each message
                // to prevent a single entry from blowing the token budget.
                // NOTE: With keepRecent=12 entries surviving compaction, this cap must be
                // low enough that 12 × MAX_MSG_CHARS stays well under maxPayloadChars (600K).
                const MAX_MSG_CHARS = 30_000; // ~7.5K tokens per message, 12 × 30K = 360K < 600K
                const capContent = (content: string): string => {
                    if (content.length <= MAX_MSG_CHARS) return content;
                    const headSize = Math.floor(MAX_MSG_CHARS * 0.6);
                    const tailSize = Math.floor(MAX_MSG_CHARS * 0.3);
                    return content.substring(0, headSize) +
                        `\n\n... [MESSAGE TRUNCATED: ${content.length.toLocaleString()} chars → ${MAX_MSG_CHARS.toLocaleString()} chars] ...\n\n` +
                        content.substring(content.length - tailSize);
                };

                // Reconstruct the conversation following the OpenAI tool-call protocol
                // by walking thoughts paired with state.actions. When actions[i] is a tool
                // call, thoughts[i] is the assistant's pre-tool reasoning and MUST be sent
                // with `tool_calls`; the next observation MUST be sent as
                // {role:'tool', tool_call_id} matching that call.
                //
                // The previous implementation flattened everything to plain text, which
                // worked in the happy path but broke on finish-gate trips: the model saw
                // its own reasoning text with no record of having called a tool, then a
                // user message complaining about that tool — an unexplainable contradiction
                // it would rationalize as "my tool call failed silently" and then loop.
                // Defensive alignment guard: state.thoughts and state.actions are
                // expected to be index-aligned (a `null` action is pushed for every
                // observation / user / system thought). If any caller mutates only
                // one array — e.g. an older normalizeHistoricalState that pushed a
                // "server restart" thought without a matching null action — the
                // reconstruction below would mis-pair every subsequent turn and the
                // model would see corrupted history (its own observation strings
                // appearing as assistant content, real tool calls vanishing). Pad
                // actions with nulls so we always reconstruct against a consistent
                // view, and log loudly so the underlying drift gets fixed.
                if (this.state.actions.length < currentHistory.length) {
                    const drift = currentHistory.length - this.state.actions.length;
                    this.log(`[WARN] thoughts/actions misalignment detected: thoughts=${currentHistory.length}, actions=${this.state.actions.length}. Padding actions with ${drift} null(s) to recover.`);
                    for (let p = 0; p < drift; p++) {
                        this.state.actions.push(null as any);
                    }
                }
                const actionsArr = this.state.actions;
                const reconstructed: any[] = [];
                let pendingToolCallId: string | null = null;
                const closePending = () => {
                    if (pendingToolCallId) {
                        reconstructed.push({
                            role: 'tool',
                            tool_call_id: pendingToolCallId,
                            content: '(no result recorded)',
                        });
                        pendingToolCallId = null;
                    }
                };

                // History-pollution filter: long-running investigations
                // accumulate dozens of system-injected scaffolding strings in
                // state.thoughts (UI placeholders, prior auto-pause notices,
                // server-restart markers, finish-handler synthetic
                // observations). These have ZERO semantic value to the LLM —
                // they only reinforce the failure pattern they came from.
                // Investigation 1778490842776 had 245 of 312 thoughts (78%)
                // be pure noise by the time it auto-paused for the 4th time;
                // the model genuinely could not see the actual investigation
                // signal through the noise. Strip them from the LLM's view
                // (they STAY in state.thoughts for the UI/timeline).
                //
                // Conservatively skip ONLY deterministic system scaffolding;
                // never drop real tool calls, observations, gate pushbacks
                // (model needs to respond to those), or "looping with
                // thoughts" nudges (current-loop pressure).
                const isPlainNoise = (h: any): boolean => {
                    if (typeof h !== 'string') return false;
                    if (h === 'Observation: Report Generated.') return true;
                    if (h === 'Deciding to use a tool...') return true;
                    if (h.startsWith('System: Investigation auto-paused')) return true;
                    if (h.startsWith('System: Investigation automatically paused')) return true;
                    if (h.startsWith('Error: Not authenticated')) return true;
                    return false;
                };

                for (let i = 0; i < currentHistory.length; i++) {
                    const h = currentHistory[i];
                    if (h && typeof h === 'object' && (h as any).type === 'log') continue;
                    const action = actionsArr[i];

                    // Drop pure-noise placeholders UNLESS this slot has a real
                    // tool action — in which case the action-bearing branch
                    // below handles it and uses content:null for the assistant
                    // message (per the existing "empty thought + tool turn"
                    // behavior, validated by test
                    // "callLLM emits assistant content as null when prior
                    // thought is empty for a tool turn").
                    if (isPlainNoise(h) && !(action && action.tool && action.tool !== 'finish')) {
                        continue;
                    }

                    const isObj = h && typeof h === 'object';
                    const rawRole: string | undefined = isObj ? (h as any).role : undefined;
                    const rawContent: string = typeof h === 'string'
                        ? h
                        : (isObj && (h as any).content !== undefined ? String((h as any).content) : '');

                    // Action-bearing assistant turn -> assistant message + tool_calls.
                    // Skip 'finish' (it terminates the loop on success; on gate trip the
                    // action is popped before history is sent).
                    if (action && action.tool && action.tool !== 'finish'
                        && rawRole !== 'user' && rawRole !== 'system') {
                        closePending();
                        const toolCallId = `call_${i}`;
                        // action.args is always an object (parsed from JSON above), so a
                        // plain JSON.stringify is sufficient. Any pathological input
                        // (e.g. circular ref) will throw and be caught by callLLM's outer
                        // try/catch as a Critical LLM Error.
                        const argsStr = JSON.stringify(action.args);
                        // For tool turns whose recorded "thought" is just the
                        // "Deciding to use a tool..." placeholder, send
                        // content:null — the placeholder carries no signal.
                        const assistantContent = (rawContent && rawContent !== 'Deciding to use a tool...')
                            ? capContent(rawContent)
                            : null;
                        reconstructed.push({
                            role: 'assistant',
                            content: assistantContent,
                            tool_calls: [{
                                id: toolCallId,
                                type: 'function',
                                function: { name: action.tool, arguments: argsStr },
                            }],
                        });
                        pendingToolCallId = toolCallId;
                        continue;
                    }

                    // Observation following an action -> tool result message.
                    if (pendingToolCallId && rawContent.startsWith('Observation:')) {
                        reconstructed.push({
                            role: 'tool',
                            tool_call_id: pendingToolCallId,
                            content: capContent(rawContent.replace(/^Observation:\s*/, '')),
                        });
                        pendingToolCallId = null;
                        continue;
                    }

                    // Anything else: close any dangling tool call (e.g., gate popped the
                    // action) with a synthetic result, then emit a normal message.
                    closePending();

                    if (rawRole === 'user' || rawRole === 'system') {
                        reconstructed.push({ role: 'user', content: capContent(rawContent) });
                    } else if (typeof h === 'string') {
                        reconstructed.push({ role: 'assistant', content: capContent(h) });
                    } else if (rawContent) {
                        reconstructed.push({ role: 'assistant', content: capContent(rawContent) });
                    } else {
                        reconstructed.push({ role: 'assistant', content: capContent(JSON.stringify(h)) });
                    }
                }
                closePending();
                const historyMessages = reconstructed;

                const messages: any[] = [
                    { role: 'system', content: currentSystem },
                    { role: 'user', content: userQuery },
                    ...historyMessages
                ];

                // FIX: If the last message is from the assistant, append a user message to satisfy API requirements
                if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    messages.push({ role: 'user', content: "Proceed with the next step." });
                }

                let openAiTools: any[] | undefined = tools.map(t => {
                    // Sanitize inputSchema for strict OpenAI compatibility
                    const schema = JSON.parse(JSON.stringify(t.inputSchema)); // Deep copy

                    // Helper to remove null types from anyOf
                    const sanitizeSchema = (s: any) => {
                        if (s.properties) {
                            for (const key in s.properties) {
                                sanitizeSchema(s.properties[key]);
                            }
                        }

                        // Fix 1: Remove default: null (invalid for non-null types like string)
                        // Many schemas auto-generated from Python/Pydantic include default: null for Optional fields,
                        // but strict OpenAPI validation fails if type is not ["string", "null"].
                        if (s.default === null) {
                            delete s.default;
                        }

                        if (s.anyOf) {
                            // Filter out null types if present to avoid 400s with some providers
                            s.anyOf = s.anyOf.filter((sub: any) => sub.type !== 'null');
                            if (s.anyOf.length === 1) {
                                // Collapse single-item anyOf
                                Object.assign(s, s.anyOf[0]);
                                delete s.anyOf;
                            } else if (s.anyOf.length === 0) {
                                // If array became empty (was just null?), default to string to avoid empty anyOf
                                delete s.anyOf;
                                s.type = "string";
                            }
                        }
                    };
                    sanitizeSchema(schema);

                    return {
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description,
                            parameters: schema
                        }
                    };
                });

                if (openAiTools.length === 0) {
                    openAiTools = undefined;
                }

                // Force tool usage if looping AND we have tools
                let toolChoice: any = openAiTools ? 'auto' : undefined;

                if (forceTool && !forceToolDowngraded && !this.toolChoiceRequiredFailed) {
                    if (openAiTools) {
                        this.log("Forcing tool_choice: 'required' due to consecutive thoughts.");
                        toolChoice = 'required';
                    } else {
                        this.log("Warning: Cannot force tool choice because no tools are available.");
                    }
                }

                // Estimate payload size and proactively compact if too large
                const payloadStr = JSON.stringify({ model, messages, tools: openAiTools, tool_choice: toolChoice });
                const estimatedTokens = Math.ceil(payloadStr.length / 4); // Rough estimate: ~4 chars per token
                lastPayloadChars = payloadStr.length;
                lastEstimatedTokens = estimatedTokens;
                const maxPayloadChars = 600000; // ~150K tokens safety threshold (raised from 400K to reduce premature compaction)
                
                if (payloadStr.length > maxPayloadChars) {
                    this.log(`Payload too large (${payloadStr.length} chars, ~${estimatedTokens} tokens). Attempting proactive compaction...`);
                    const compacted = await this.compactHistory(system, userQuery, this.state.thoughts);
                    if (compacted) {
                        currentHistory = this.state.thoughts;
                        continue; // Retry with compacted history
                    } else {
                        this.log(`Proactive compaction failed. Payload may exceed limits.`);
                    }
                }

                // DEBUG: Log payload size/stats and message structure
                const roleCounts: Record<string, number> = {};
                for (const m of messages) { roleCounts[m.role] = (roleCounts[m.role] || 0) + 1; }
                console.log(`[Agent] LLM Request: Model=${model}, Tools=${openAiTools?.length || 0}, ToolChoice=${toolChoice}, PayloadSize=${payloadStr.length} chars (~${estimatedTokens} tokens), Roles=${JSON.stringify(roleCounts)}, MsgCount=${messages.length}`);
                // Dump first 3 and last 3 messages for structure debugging
                const debugMsgs = messages.length <= 6 ? messages : [...messages.slice(0, 3), '...', ...messages.slice(-3)];
                for (let di = 0; di < debugMsgs.length; di++) {
                    const dm = debugMsgs[di];
                    if (typeof dm === 'string') {
                        console.log(`[Agent]   ${dm}`);
                    } else {
                        const c = dm.content;
                        const cLen = typeof c === 'string' ? c.length : 0;
                        const cPreview = typeof c === 'string' ? c.substring(0, 100) : '<non-string>';
                        console.log(`[Agent]   role=${dm.role}, len=${cLen}, content=${cPreview}`);
                    }
                }

                const completion = await openai.chat.completions.create({
                    model: model,
                    messages: messages,
                    tools: openAiTools, // undefined if empty
                    tool_choice: toolChoice // undefined if no tools
                });

                const message = completion.choices[0].message;

                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0] as any;
                    // A successful tool call proves the model can still emit tools, so
                    // re-arm `tool_choice:'required'` for future loop-recovery attempts.
                    // Without this reset, one transient 400 permanently disables the only
                    // safety net against text-only thought spirals for the entire run.
                    if (this.toolChoiceRequiredFailed) {
                        this.log('Re-arming tool_choice:\'required\' after successful tool call.');
                        this.toolChoiceRequiredFailed = false;
                    }
                    let parsedArgs: any;
                    try {
                        parsedArgs = JSON.parse(toolCall.function.arguments);
                    } catch (parseErr: any) {
                        // Malformed JSON args (common when the model emits a giant `report`
                        // string with unescaped quotes). Surface a tool-style error back
                        // to the model instead of crashing the loop with a generic
                        // "Critical LLM Error".
                        const errMsg = `tool call '${toolCall.function.name}' had malformed JSON arguments: ${parseErr.message}. Retry with valid JSON.`;
                        this.log(`Malformed tool args: ${errMsg}`);
                        return { thought: `System: ${errMsg}`, isFinal: false };
                    }
                    return {
                        thought: message.content || "Deciding to use a tool...",
                        action: {
                            tool: toolCall.function.name,
                            args: parsedArgs
                        }
                    };
                }

                return {
                    thought: message.content,
                    isFinal: true
                };

            } catch (error: any) {
                // Dump EVERY property on the error object — stop guessing
                try {
                    const allKeys = new Set<string>();
                    // Own + inherited enumerable
                    for (const k in error) allKeys.add(k);
                    // Own non-enumerable (like 'message', 'stack')
                    if (error && typeof error === 'object') {
                        Object.getOwnPropertyNames(error).forEach(k => allKeys.add(k));
                    }
                    const dump: Record<string, any> = { _constructor: error?.constructor?.name };
                    for (const key of allKeys) {
                        if (key === 'stack') continue; // skip stack trace noise
                        try {
                            const val = error[key];
                            if (typeof val === 'function') continue;
                            if (val === undefined) continue;
                            const isObj = typeof val === 'object' && val !== null;
                            dump[key] = isObj
                                ? JSON.stringify(val).substring(0, 2000)
                                : String(val).substring(0, 2000);
                        } catch (_e) { dump[key] = `<error reading: ${_e}>`; }
                    }
                    console.log(`[Agent] FULL error dump (${allKeys.size} keys):`, JSON.stringify(dump, null, 2));
                } catch (_e) { console.log(`[Agent] Error dump failed:`, _e, String(error)); }

                // Also log a condensed version to the investigation log (visible in UI)
                const rawMsg = error.message ? String(error.message).substring(0, 500) : '(no message)';
                const rawBody = error.error ? JSON.stringify(error.error).substring(0, 500) : error.body ? JSON.stringify(error.body).substring(0, 500) : '(no body)';
                this.log(`RAW ERROR: status=${error.status}, message=${rawMsg}, body=${rawBody}, constructor=${error?.constructor?.name}`);

                // Extract the most useful error detail from the OpenAI SDK error object.
                // The SDK wraps API errors as APIError with: .status, .message (raw HTTP dump),
                // .error (parsed body with .message/.type/.code), .code, .type, .param.
                const errorDetail = extractLlmErrorDetail(error);

                // Check if this is a 400 error (token limit, malformed request, or oversized payload)
                if (error.status === 400) {
                    const payloadInfo = `${lastPayloadChars.toLocaleString()} chars (~${lastEstimatedTokens.toLocaleString()} tokens)`;
                    this.log(`400 Error (Attempt ${attempt + 1}/${maxAttempts}): ${errorDetail}. Payload: ${payloadInfo}`);

                    // Progressive recovery — each retry applies more aggressive reduction:
                    //   Level 0: downgrade tool_choice from 'required' to 'auto' (no compaction — the 400 is likely caused by the tool_choice, not payload size)
                    //   Level 1: compact history + strip prior agent context
                    //   Level 2: aggressive trim (keep only 4 recent thoughts, cap system prompt)
                    if (attempt < maxAttempts - 1) {
                        this.log(`Applying 400 recovery level ${attempt + 1}...`);

                        // Always try downgrading tool_choice first — some APIs
                        // (e.g. Copilot proxy, Anthropic with thinking) reject 'required' with a bare 400
                        let downgradeOnly = false;
                        if (forceTool && !forceToolDowngraded) {
                            this.log(`Downgrading tool_choice from 'required' to 'auto' for retry.`);
                            forceToolDowngraded = true;
                            this.toolChoiceRequiredFailed = true; // Prevent future attempts across callLLM invocations
                            downgradeOnly = true; // Skip compaction — the 400 is likely from tool_choice, not payload size
                        }

                        // Only compact if the 400 wasn't caused by the tool_choice downgrade
                        if (!downgradeOnly) {
                            const compacted = await this.compactHistory(system, userQuery, this.state.thoughts);
                            if (compacted) {
                                currentHistory = this.state.thoughts;
                            }
                        }

                        // Strip prior agent context from system prompt
                        const priorContextMarker = '\n\n## Prior Agent Context\n';
                        if (currentSystem.includes(priorContextMarker)) {
                            const idx = currentSystem.indexOf(priorContextMarker);
                            const stripped = currentSystem.length - idx;
                            currentSystem = currentSystem.substring(0, idx);
                            this.log(`Stripped prior agent context (${stripped} chars) from system prompt.`);
                        }

                        // Level 2+: aggressive reduction — fewer recent thoughts, cap system prompt
                        if (attempt >= 1) {
                            const aggressiveKeep = 4;
                            if (currentHistory.length > aggressiveKeep + 2) {
                                this.log(`Level 2: trimming history from ${currentHistory.length} to ${aggressiveKeep} recent entries.`);
                                currentHistory = currentHistory.slice(-aggressiveKeep);
                                this.state.thoughts = currentHistory;
                                this.state.actions = this.state.actions.slice(-aggressiveKeep);
                            }
                            const MAX_SYSTEM_CHARS = 30_000;
                            if (currentSystem.length > MAX_SYSTEM_CHARS) {
                                const headSize = Math.floor(MAX_SYSTEM_CHARS * 0.8);
                                const tailSize = Math.floor(MAX_SYSTEM_CHARS * 0.15);
                                currentSystem = currentSystem.substring(0, headSize) +
                                    '\n\n... [SYSTEM PROMPT TRUNCATED for context limits] ...\n\n' +
                                    currentSystem.substring(currentSystem.length - tailSize);
                                this.log(`Truncated system prompt to ~${MAX_SYSTEM_CHARS} chars.`);
                            }
                        }

                        continue;
                    }

                    return {
                        thought: `System Alert: LLM returned 400 error — ${errorDetail}. Payload: ${payloadInfo}. Recovery failed after ${maxAttempts} attempts (compaction + context stripping + aggressive trim).`,
                        isFinal: true
                    };
                }

                // For timeout errors, include hint about context size
                const isTimeout = error.message?.includes('timed out') || error.message?.includes('timeout') || error.code === 'ETIMEDOUT';
                const hint = isTimeout ? ' The context may be too large — auto-compaction will be attempted on retry.' : '';
                this.log(`LLM Error: ${errorDetail}${hint}`);
                return {
                    thought: `Critical LLM Error: ${errorDetail}`,
                    isFinal: true
                };
            }
        }
        return { thought: "System Error: Max attempts reached.", isFinal: true };
    }

    public setModel(model: string) {
        // Also validate if model is in allowed list? Assuming server side validation or trust for now.
        this.log(`Simulating model switch from ${this.state.model} to ${model}...`);
        this.state.model = model;
        // Should we add a system thought to record this change?
        // this.state.thoughts.push(`System: Model switched to ${model} by user.`); // Log above covers it
    }

    public async summarize() {
        this.log("User requested history summarization...");
        this.emit('thought', "System: Starting history summarization. Please wait...");

        const systemPrompt = this.loadSystemPrompt();
        const userQuery = this.state.query || "Investigation";

        try {
            const success = await this.compactHistory(systemPrompt, userQuery, this.state.thoughts);
            if (success) {
                this.log("History summarization completed successfully.");
                const msg = "System: History has been summarized to reduce token usage. You may now resume the investigation.";
                this.state.thoughts.push(msg);
                this.emit('thought', msg);
            } else {
                this.log("History summarization failed or was unnecessary.");
                const msg = "System: Summarization was unnecessary (not enough history).";
                this.state.thoughts.push(msg);
                this.emit('thought', msg);
            }
            return success;
        } catch (e: any) {
            this.log(`Error during summarization: ${e.message}`);
            const msg = `System Error: Summarization failed - ${e.message}`;
            this.state.thoughts.push(msg);
            this.emit('thought', msg);
            throw e;
        }
    }

    private async compactHistory(system: string, userQuery: string, history: any[]): Promise<boolean> {
        try {
            // Archive all current entries to fullHistory BEFORE compaction discards them
            this.syncFullHistory();

            const authStatus = await this.llmProvider.getAuthStatus();
            if (!authStatus.authenticated) {
                this.log(`Cannot compact history: ${this.llmProvider.displayName} not authenticated.`);
                return false;
            }

            // Get OpenAI-compatible client from provider
            this.openaiClient = await this.llmProvider.getClient();
            const openai = this.openaiClient;

            // Keep more recent entries to preserve investigation context across contests.
            // During a contest, 3 entries are added (user feedback, system notice, & contested report),
            // so keepRecent=4 was preserving only 1 actual investigation thought.
            // Increase to 12 so we retain meaningful investigation state after contests.
            const keepRecent = 12;
            const olderThoughts = history.slice(0, -keepRecent);
            const recentThoughts = history.slice(-keepRecent);

            if (olderThoughts.length < 2) {
                this.log("Not enough history to compact.");
                return false;
            }

            // Check if the first entry is already a compacted summary (System [Memory]).
            // If so, extract it and feed it to the summarizer as "existing knowledge" to
            // be preserved and expanded — NOT re-summarized into a lossy summary-of-summary.
            let existingMemory = '';
            let thoughtsToSummarize = olderThoughts;
            const firstThought = olderThoughts[0];
            const firstThoughtText = typeof firstThought === 'string'
                ? firstThought
                : (firstThought?.content ? String(firstThought.content) : '');

            if (firstThoughtText.startsWith('System [Memory]:')) {
                existingMemory = firstThoughtText;
                // Skip the memory entry and the compaction notice that follows it
                const skipCount = (olderThoughts.length > 1 &&
                    typeof olderThoughts[1] === 'string' &&
                    olderThoughts[1].startsWith('System: Context was automatically compacted'))
                    ? 2 : 1;
                thoughtsToSummarize = olderThoughts.slice(skipCount);

                if (thoughtsToSummarize.length < 1) {
                    this.log("Not enough new history beyond existing memory to compact.");
                    return false;
                }
            }

            // Build text for newer entries to summarize, with a more generous per-entry limit
            // to preserve key findings from observations and tool results.
            const PER_ENTRY_LIMIT = 4000;
            const olderText = thoughtsToSummarize.map((h: any, i: number) => {
                if (typeof h === 'string') return `[${i}] ${h.substring(0, PER_ENTRY_LIMIT)}`;
                if (h && h.content) return `[${i}] ${String(h.content).substring(0, PER_ENTRY_LIMIT)}`;
                return `[${i}] ${JSON.stringify(h).substring(0, PER_ENTRY_LIMIT)}`;
            }).join('\n');

            const model = this.state.model || 'gpt-4o';

            this.log(`Summarizing ${thoughtsToSummarize.length} older steps (existing memory: ${existingMemory ? 'yes' : 'no'})...`);

            // Build the summarizer prompt — if we have an existing memory section,
            // instruct the summarizer to MERGE rather than replace.
            let summarizerSystem: string;
            let summarizerUser: string;

            if (existingMemory) {
                // Cap the Memory summary to prevent unbounded growth through successive compactions.
                // After many compaction cycles, the Memory can grow to 25K+ chars, which bloats
                // every subsequent LLM call and causes timeouts. When oversized, instruct the
                // summarizer to CONDENSE rather than just merge.
                const MAX_MEMORY_CHARS = 12_000;
                const isMemoryOversized = existingMemory.length > MAX_MEMORY_CHARS;

                if (isMemoryOversized) {
                    this.log(`Memory summary oversized (${existingMemory.length} chars > ${MAX_MEMORY_CHARS}). Requesting condensation.`);
                    summarizerSystem = 'You are a summarizer that must CONDENSE an oversized investigation memory. ' +
                        'The existing memory has grown too large through successive merges. Your job is to produce ' +
                        'a SHORTER, more focused summary that preserves only the MOST CRITICAL findings: ' +
                        'key conclusions, proven root causes, specific metric values that support conclusions, ' +
                        'and outstanding questions. Remove redundant data points, intermediate query results, ' +
                        'and exploratory steps that did not yield actionable findings. ' +
                        'Also integrate any new findings from the RECENT ACTIVITY section. ' +
                        'Target output: ~2000-3000 words maximum. ' +
                        'Output ONLY the condensed summary, no preamble.';
                } else {
                    summarizerSystem = 'You are a summarizer merging prior investigation knowledge with new findings. ' +
                        'You MUST preserve ALL key facts, data points, proven causal chains, timestamps, node names, ' +
                        'tracking IDs, metric values, and outstanding questions from the EXISTING MEMORY section. ' +
                        'Then integrate new findings from the RECENT ACTIVITY section. ' +
                        'If new findings contradict prior knowledge, note the update explicitly. ' +
                        'Output a comprehensive merged summary. Preserve specific numbers, IDs, and timestamps. ' +
                        'Output ONLY the summary, no preamble.';
                }
                summarizerUser = `Original investigation query: ${userQuery}\n\n` +
                    `=== EXISTING MEMORY (${isMemoryOversized ? 'CONDENSE — too large' : 'MUST BE FULLY PRESERVED'}) ===\n${existingMemory}\n\n` +
                    `=== RECENT ACTIVITY (${isMemoryOversized ? 'INTEGRATE KEY FINDINGS ONLY' : 'MERGE INTO MEMORY'}) ===\n${olderText}`;
            } else {
                summarizerSystem = 'You are a summarizer. Condense the following investigation conversation history ' +
                    'into a comprehensive summary. Preserve ALL key findings, tool results, data points, timestamps, ' +
                    'node names, tracking IDs, metric values, proven causal chains, and decisions. ' +
                    'Remove verbose tool outputs but keep their conclusions and specific data points. ' +
                    'Output ONLY the summary, no preamble.';
                summarizerUser = `Original investigation query: ${userQuery}\n\nConversation history to summarize:\n${olderText}`;
            }

            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: summarizerSystem },
                    { role: 'user', content: summarizerUser }
                ]
            });

            const summary = completion.choices[0].message.content;
            if (!summary) throw new Error("Empty summary returned.");

            const sysMsg = `System: Context was automatically compacted to stay within token limits. ${thoughtsToSummarize.length} older messages were summarized.`;

            // Replace thoughts with compacted version — keep actions aligned
            const olderActions = this.state.actions.slice(0, -keepRecent);
            const recentActions = this.state.actions.slice(-keepRecent);

            this.state.thoughts = [
                `System [Memory]: Previous Investigation Summary:\n${summary}`,
                sysMsg,
                ...recentThoughts
            ];

            this.state.actions = [
                null as any, // placeholder aligned with summary thought
                null as any, // placeholder aligned with sysMsg thought
                ...recentActions
            ];

            // Truncate observation entries in the recent section to prevent payload bloat.
            // The full data is preserved in fullHistory (synced above) and summarized in Memory.
            // Without this, 12 recent entries with 72K char tool results would make any subsequent
            // LLM call exceed the payload limit, causing a timeout-compaction death spiral.
            const MAX_POST_COMPACT_OBS_CHARS = 6_000;
            for (let i = 2; i < this.state.thoughts.length; i++) {
                const t = this.state.thoughts[i];
                if (t && typeof t === 'object' && t.role === 'user' &&
                    typeof t.content === 'string' && t.content.startsWith('Observation:')) {
                    if (t.content.length > MAX_POST_COMPACT_OBS_CHARS) {
                        const headSize = Math.floor(MAX_POST_COMPACT_OBS_CHARS * 0.7);
                        const tailSize = Math.floor(MAX_POST_COMPACT_OBS_CHARS * 0.2);
                        this.state.thoughts[i] = {
                            ...t,
                            content: t.content.substring(0, headSize) +
                                `\n\n... [OBSERVATION TRUNCATED: ${t.content.length.toLocaleString()} chars → ${MAX_POST_COMPACT_OBS_CHARS.toLocaleString()} chars for context management. Key data preserved in System Memory above. Full data in investigation history.] ...\n\n` +
                                t.content.substring(t.content.length - tailSize)
                        };
                    }
                }
            }

            this.emit('thought', sysMsg);
            // Reset the sync cursor: the compacted `thoughts` array contains synthetic entries
            // (summary + sysMsg) plus the keepRecent entries which are already in fullHistory.
            // Set cursor to the new thoughts length so we don't re-archive these.
            this.fullHistorySyncCursor = this.state.thoughts.length;
            this.log(`Compaction complete. Summarized ${thoughtsToSummarize.length} entries (${olderActions.length} actions compacted). Existing memory ${existingMemory ? 'merged' : 'not present'}. Full history preserved: ${this.state.fullHistory!.length} entries.`);

            return true;
        } catch (err: any) {
            this.log(`Compaction failed: ${err.message}`);
            return false;
        }
    }

    private async executeAction(action: any): Promise<any> {
        this.log(`Executing tool: ${action.tool}`);
        try {
            // Per-agent tool whitelist: defensively reject any call to a tool
            // that was not exposed to the LLM. This guards against models that
            // hallucinate tool names from prior conversation context (e.g.
            // Code Scout copying an `execute_kql_query` call from the
            // Investigator's history) even after we filter the `tools`
            // parameter at the LLM boundary. `finish` is the only implicit
            // exemption; `invoke_subagent` must be explicitly whitelisted
            // (otherwise it's a trivial sandbox-escape — see comment in
            // callLLM).
            const allowedTools = this.stageContext?.allowedTools;
            if (allowedTools && allowedTools.length > 0 && action.tool !== 'finish') {
                const allowedSet = new Set(allowedTools);
                if (!allowedSet.has(action.tool)) {
                    this.log(`[tool-whitelist] Blocked call to '${action.tool}' (not in allowlist [${allowedTools.join(', ')}]).`);
                    return `Error: Tool '${action.tool}' is not available to this agent. Allowed tools: ${allowedTools.join(', ')}, finish. Re-plan using only allowed tools — this agent's role does not require ${action.tool}.`;
                }
            }
            // Subagent invocation is handled directly by the runner (needs LLM provider + ToolManager access)
            if (action.tool === 'invoke_subagent') {
                return await this.executeSubagent(action.args);
            }
            return await this.toolManager.callTool(action.tool, action.args);
        } catch (e: any) {
            return `Error: ${e.message}${this.getErrorRemediation(e.message)}`;
        }
    }

    /**
     * Execute a subagent as a focused sub-task within the current investigation.
     *
     * Loads the agent prompt from a `.agent.md` file (stripping YAML frontmatter),
     * creates a child AgentRunner that shares the parent's ToolManager (MCP connections),
     * runs it with a step limit, and returns the subagent's final report.
     *
     * Child agent thoughts are forwarded through the parent for timeline visibility.
     */
    private async executeSubagent(args: { agentPath: string; task: string }): Promise<string> {
        const { agentPath, task } = args;

        // Resolve the agent file path
        const repoRoot: string = this.config.repoRoot || '';
        const resolvedPath: string = path.isAbsolute(agentPath)
            ? agentPath
            : path.join(repoRoot, agentPath);

        if (!fs.existsSync(resolvedPath)) {
            return `Error: Agent file not found: ${agentPath} (resolved to ${resolvedPath})`;
        }

        // Load and parse the agent file — strip YAML frontmatter, use markdown body as prompt
        const fileContent: string = fs.readFileSync(resolvedPath, 'utf8');
        const systemPrompt: string = this.stripFrontmatter(fileContent);

        if (!systemPrompt.trim()) {
            return `Error: Agent file ${agentPath} has no prompt content after frontmatter.`;
        }

        // Extract agent name from the first markdown heading or filename
        const headingMatch: RegExpMatchArray | null = systemPrompt.match(/^#\s+(.+)/m);
        const agentName: string = headingMatch
            ? headingMatch[1].trim()
            : path.basename(agentPath, path.extname(agentPath)).replace(/_/g, ' ');

        this.log(`[Subagent] Invoking "${agentName}" from ${agentPath}`);

        // Emit a thought so the parent timeline shows the subagent invocation
        const startMsg: string = `🔀 Invoking subagent "${agentName}" for task: ${task.substring(0, 200)}${task.length > 200 ? '...' : ''}`;
        this.emit('thought', this.tagEvent(startMsg));

        // Create a child runner that shares the parent's ToolManager (MCP connections)
        // Inherit maxSteps from settings (this.config.maxSteps) — same limit as the parent
        const childConfig: AgentConfig = {
            ...this.config,
            systemPromptPath: resolvedPath, // Fallback — overridden by stageContext
        };

        const childRunner: AgentRunner = new AgentRunner(childConfig, this.llmProvider, {
            status: 'running',
            query: task,
            target: this.state.target,
            timeRange: this.state.timeRange,
            category: this.state.category,
            model: this.state.model,
        });

        // Share the parent's initialized ToolManager so MCP connections are reused
        (childRunner as any).toolManager = this.toolManager;

        // Set a stage context with the subagent's system prompt override
        childRunner.setStageContext({
            conversationLog: [],
            stageIndex: 0,
            agentId: `subagent-${path.basename(agentPath, path.extname(agentPath))}`,
            agentName: agentName,
            agentColor: '#6366f1',
            agentIcon: '🔀',
            systemPromptOverride: systemPrompt,
        });

        // Propagate parent abort to the child so user can stop the subagent
        const abortCheck = setInterval(() => {
            if (this.aborted) {
                childRunner.abort();
                clearInterval(abortCheck);
            }
        }, 1000);

        // Forward child thoughts to the parent timeline (tagged as subagent)
        childRunner.on('thought', (data: any) => {
            const content: string = typeof data === 'string' ? data : data?.content || String(data);
            // Skip system/operational messages to reduce noise
            if (content.startsWith('System:') || content.startsWith('[')) return;
            const taggedMsg: string = `[${agentName}] ${content.substring(0, 500)}`;
            this.emit('thought', this.tagEvent(taggedMsg));
        });

        // Run the child agent
        try {
            await childRunner.start(task);
        } catch (err: any) {
            this.log(`[Subagent] "${agentName}" failed: ${err.message}`);
            return `Subagent "${agentName}" failed: ${err.message}`;
        } finally {
            clearInterval(abortCheck);
        }

        const childState: InvestigationState = (childRunner as any).state;

        // Extract the subagent's output
        const report: string = childState.finalReport
            || childState.thoughts
                .filter((t: any) => typeof t === 'string' || (t && t.role === 'assistant'))
                .map((t: any) => typeof t === 'string' ? t : t.content)
                .slice(-5)
                .join('\n')
            || 'Subagent completed but produced no output.';

        const stepsTaken: number = childState.thoughts.length;
        const finalStatus: string = childState.status;

        this.log(`[Subagent] "${agentName}" finished: status=${finalStatus}, steps=${stepsTaken}, report=${report.length} chars`);

        // Emit completion thought
        const endMsg: string = `✅ Subagent "${agentName}" completed (${stepsTaken} steps, status: ${finalStatus})`;
        this.emit('thought', this.tagEvent(endMsg));

        // Build condensed activity log for post-mortem debugging.
        // Extract tool calls and errors so the parent agent (and persisted state) can see
        // what the subagent did, even if it failed mid-run.
        const activityLog: string[] = [];
        for (const action of childState.actions) {
            if (!action) continue;
            const toolName: string = action.tool || 'unknown';
            const resultPreview: string = action.result
                ? String(action.result).substring(0, 100).replace(/\n/g, ' ')
                : '';
            activityLog.push(`- ${toolName}${resultPreview ? `: ${resultPreview}` : ''}`);
        }
        // Extract errors from child thoughts
        const errors: string[] = childState.thoughts
            .filter((t: any) => {
                const text: string = typeof t === 'string' ? t : t?.content || '';
                return text.startsWith('System Error:') || text.startsWith('Critical LLM Error:');
            })
            .map((t: any) => typeof t === 'string' ? t : t.content)
            .map((s: string) => s.substring(0, 200));

        // Clean up child runner (but don't dispose ToolManager — it's shared)
        childRunner.removeAllListeners();

        let result: string = `## Subagent Report: ${agentName}\n\n**Status**: ${finalStatus}\n**Steps**: ${stepsTaken}\n\n${report}`;

        if (errors.length > 0) {
            result += `\n\n### Subagent Errors\n${errors.map(e => `- ${e}`).join('\n')}`;
        }

        if (activityLog.length > 0) {
            // Cap at 30 entries to avoid bloating the observation
            const capped: string[] = activityLog.length > 30
                ? [...activityLog.slice(0, 15), `... (${activityLog.length - 30} more tool calls) ...`, ...activityLog.slice(-15)]
                : activityLog;
            result += `\n\n### Subagent Activity Log (${activityLog.length} tool calls)\n${capped.join('\n')}`;
        }

        return result;
    }

    /**
     * Strip YAML frontmatter (--- delimited) from a markdown file.
     * Returns the markdown body after the closing ---.
     */
    private stripFrontmatter(content: string): string {
        const trimmed: string = content.trimStart();
        if (!trimmed.startsWith('---')) return content;
        const endIndex: number = trimmed.indexOf('---', 3);
        if (endIndex === -1) return content;
        return trimmed.substring(endIndex + 3).trim();
    }

    /**
     * Returns actionable remediation guidance for known error patterns so
     * the agent can relay clear instructions to the end user.
     */
    private getErrorRemediation(errorMessage: string): string {
        const msg = (errorMessage || '').toLowerCase();

        // Authentication / credential errors (Kusto, Azure, etc.)
        if (msg.includes('authentication') || msg.includes('unauthorized') ||
            msg.includes('no_system_webview') || msg.includes('login_required') ||
            msg.includes('credential') || msg.includes('access token') ||
            msg.includes('aadsts')) {
            return '\n\n⚠️ REMEDIATION: This is an authentication error. ' +
                'The user (or the environment running this tool) needs to re-authenticate. ' +
                'Common fixes:\n' +
                '1. Run "az login" in a terminal to refresh Azure credentials.\n' +
                '2. If running headless/remote, use "az login --use-device-code" instead.\n' +
                '3. If using a service principal, ensure AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID environment variables are set correctly.\n' +
                '4. Restart the MCP tool server after re-authenticating.\n' +
                'Please include these steps in your response to help the user resolve the issue.';
        }

        // Connection / network errors
        if (msg.includes('econnrefused') || msg.includes('enotfound') ||
            msg.includes('etimedout') || msg.includes('econnreset') ||
            msg.includes('socket hang up') || msg.includes('not connected') ||
            msg.includes('connect failed')) {
            return '\n\n⚠️ REMEDIATION: This is a connection error. ' +
                'The target service may be unreachable. Common fixes:\n' +
                '1. Check that the service/cluster URL is correct in the configuration.\n' +
                '2. Verify network connectivity (VPN, firewall, DNS).\n' +
                '3. If using an MCP tool server, verify it is running and accessible.\n' +
                'Please include these steps in your response to help the user resolve the issue.';
        }

        return '';
    }
}
