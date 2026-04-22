import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { AgentDefinition, ConversationEntry } from './AgentDefinition';
import {
    PipelineDefinition,
    PipelineStage,
    resolveStageAgent,
    resolveRejectTarget,
    getEffectiveMaxRetries,
    validatePipeline,
} from './PipelineDefinition';
import { getBuiltinAgent, getPaletteEntry } from './builtinAgents';
import { AgentRunner, AgentConfig, InvestigationState, PipelineState, PipelineStageState, StageContext } from '../Runner';
import { LlmProvider } from '../llm/LlmProvider';

/**
 * Orchestrates a multi-agent investigation pipeline.
 *
 * Sequences agents through an ordered pipeline, maintaining a shared conversation
 * log that each agent can read. Handles rejection loops, stage timeouts, and
 * event forwarding to WebSocket clients.
 *
 * Usage:
 *   const orchestrator = new PipelineOrchestrator(pipeline, llmProvider, baseConfig);
 *   orchestrator.on('thought', ...);
 *   orchestrator.on('stage-start', ...);
 *   const state = await orchestrator.run(query, metadata);
 */
export class PipelineOrchestrator extends EventEmitter {
    private pipeline: PipelineDefinition;
    private llmProvider: LlmProvider;
    private baseConfig: AgentConfig;
    private conversationLog: ConversationEntry[] = [];
    private pipelineState: PipelineState;
    private aborted: boolean = false;
    private currentRunner: AgentRunner | null = null;
    private pendingInterventions: string[] = [];

    constructor(
        pipeline: PipelineDefinition,
        llmProvider: LlmProvider,
        baseConfig: AgentConfig
    ) {
        super();
        validatePipeline(pipeline);

        this.pipeline = pipeline;
        this.llmProvider = llmProvider;
        this.baseConfig = baseConfig;

        // Initialize pipeline state
        this.pipelineState = {
            stages: pipeline.stages.map((stage, index) => {
                const agent = this.resolveAgent(stage, index);
                return {
                    agentId: agent.id,
                    agentName: agent.name,
                    description: agent.description,
                    color: agent.color!,
                    icon: agent.icon!,
                    status: 'pending' as const,
                    retryCount: 0,
                    canReject: stage.canReject,
                    onReject: stage.onReject,
                    rejectTarget: stage.rejectTarget,
                    maxRetries: stage.maxRetries,
                };
            }),
            currentStageIndex: 0,
            definition: pipeline,
            conversationLog: this.conversationLog,
        };
    }

    /**
     * Execute the full pipeline.
     *
     * Creates an AgentRunner for each stage, feeds it the conversation context,
     * collects results, handles rejection loops, and returns the final state.
     *
     * @param resumeFrom - When resuming a paused pipeline, pass the saved stage
     *   index and conversation log so the orchestrator skips already-completed stages.
     */
    async run(
        initialQuery: string,
        initialMetadata: Partial<InvestigationState> = {},
        resumeFrom?: { stageIndex: number; conversationLog: ConversationEntry[]; stageStates: PipelineStageState[] },
    ): Promise<InvestigationState> {
        let currentState: InvestigationState = {
            id: Date.now().toString(),
            status: 'running',
            thoughts: [],
            actions: [],
            logs: [],
            fullHistory: [],
            fullActions: [],
            totalPausedTime: 0,
            pipeline: this.pipelineState,
            ...initialMetadata,
        };

        // When resuming, restore conversation log and stage statuses from saved state
        let stageIndex = 0;
        if (resumeFrom) {
            stageIndex = resumeFrom.stageIndex;
            this.conversationLog = [...resumeFrom.conversationLog];
            this.pipelineState.conversationLog = this.conversationLog;
            // Restore completed/rejected stage statuses
            for (let i = 0; i < resumeFrom.stageStates.length && i < this.pipelineState.stages.length; i++) {
                const saved = resumeFrom.stageStates[i];
                if (saved.status === 'completed' || saved.status === 'rejected') {
                    Object.assign(this.pipelineState.stages[i], saved);
                }
            }
        }

        while (stageIndex < this.pipeline.stages.length && !this.aborted) {
            const stage = this.pipeline.stages[stageIndex];
            const stageState = this.pipelineState.stages[stageIndex];
            const agent = this.resolveAgent(stage, stageIndex);

            // Update pipeline tracking
            this.pipelineState.currentStageIndex = stageIndex;
            stageState.status = 'running';
            stageState.startedAt = Date.now();
            stageState.completedAt = undefined; // Clear stale completedAt to prevent negative duration on retry

            this.emit('stage-start', {
                stageIndex,
                agentId: agent.id,
                agentName: agent.name,
                agentColor: stageState.color,
                agentIcon: stageState.icon,
                totalStages: this.pipeline.stages.length,
            });

            // Emit handoff card data (skip for the first stage)
            if (stageIndex > 0) {
                const prevAgent = this.pipelineState.stages[stageIndex - 1];
                this.addConversationEntry({
                    agentId: 'pipeline',
                    agentName: 'Pipeline',
                    role: 'handoff',
                    content: `Passing to ${agent.name}...`,
                    timestamp: Date.now(),
                    stageIndex,
                    metadata: {
                        fromAgent: prevAgent.agentName,
                        fromColor: prevAgent.color,
                        toAgent: agent.name,
                        toColor: stageState.color,
                        toIcon: stageState.icon,
                        conversationLength: this.conversationLog.length,
                        inputMode: stage.inputMode || 'conversation',
                    },
                });
            }

            try {
                // Build the system prompt for this agent
                const systemPrompt = this.buildAgentPrompt(agent, stage, stageIndex, currentState);

                // Build config overrides for this stage. Per-agent path fields
                // (repoRoot/knowledgeBasePath/workingDirectory) override the global
                // config when present; otherwise the global values are kept.
                const stageConfig: AgentConfig = {
                    ...this.baseConfig,
                    mcpServers: agent.mcpServers || this.baseConfig.mcpServers,
                    repoRoot: agent.repoRoot ?? this.baseConfig.repoRoot,
                    knowledgeBasePath: agent.knowledgeBasePath ?? this.baseConfig.knowledgeBasePath,
                    workingDirectory: agent.workingDirectory ?? this.baseConfig.workingDirectory,
                };

                // For retrospect stages, keep finalReport so it can analyze
                // prior stages' output. For other stages, reset it.
                const isRetrospectStage = agent.builtinType === 'retrospect';

                // Create a runner for this stage
                const runner = new AgentRunner(stageConfig, this.llmProvider, {
                    ...currentState,
                    // Retrospect needs 'completed' status (it refuses to run on 'running')
                    // and needs the finalReport from prior stages for analysis.
                    status: isRetrospectStage ? 'completed' : 'running',
                    // Reset per-stage state (keep accumulated thoughts for the timeline)
                    // but keep finalReport for retrospect so it can analyze the investigation
                    finalReport: isRetrospectStage ? currentState.finalReport : undefined,
                });

                this.currentRunner = runner;

                // Deliver any interventions that arrived between stages
                for (const msg of this.pendingInterventions) {
                    runner.intervene(msg);
                }
                this.pendingInterventions = [];

                // Set stage context
                const stageContext: StageContext = {
                    conversationLog: stage.inputMode === 'report-only'
                        ? this.getReportOnlyContext()
                        : [...this.conversationLog],
                    stageIndex,
                    agentId: agent.id,
                    agentName: agent.name,
                    agentColor: stageState.color,
                    agentIcon: stageState.icon,
                    systemPromptOverride: systemPrompt,
                    modelOverride: agent.model,
                    maxStepsOverride: agent.maxSteps,
                };
                runner.setStageContext(stageContext);

                // Forward events from the runner (tagged with agent identity)
                this.forwardRunnerEvents(runner, {
                    agentId: agent.id,
                    agentName: agent.name,
                    agentColor: stageState.color,
                    agentIcon: stageState.icon,
                    stageIndex,
                });

                // Execute with timeout
                const timeout = stage.timeout ? stage.timeout * 60_000 : undefined;
                if (isRetrospectStage) {
                    // Retrospect stages use the dedicated retrospect tool loop
                    // which reads KB files and proposes changes, rather than
                    // running as a regular investigation.
                    await this.runRetrospectStage(runner, timeout);
                } else {
                    await this.runWithTimeout(runner, initialQuery, timeout);
                }

                // Collect results
                const result = runner.getStageResult();
                const runnerState = (runner as any).state as InvestigationState;

                // For retrospect stages, build a report from the retrospect state
                // since runRetrospectiveAnalysis() doesn't set finalReport.
                if (isRetrospectStage) {
                    const runnerRetro = runnerState.retrospect;
                    const proposalCount = runnerRetro?.proposals?.length || 0;
                    // Extract the last assistant message as the report text
                    const lastAssistantMsg = runnerRetro?.messages
                        ?.filter((m: any) => m.role === 'assistant')
                        ?.pop()?.content || '';
                    const retroReport = lastAssistantMsg || 
                        `Knowledge base analysis complete. ${proposalCount} change${proposalCount === 1 ? '' : 's'} proposed.`;
                    result.report = retroReport;
                }

                // Append this agent's key outputs to the conversation log
                if (result.report) {
                    this.addConversationEntry({
                        agentId: agent.id,
                        agentName: agent.name,
                        agentColor: stageState.color,
                        agentIcon: stageState.icon,
                        role: 'report',
                        content: result.report,
                        timestamp: Date.now(),
                        stageIndex,
                    });
                }

                // Handle verdict
                if (result.verdict) {
                    stageState.verdict = result.verdict as any;
                    stageState.feedback = result.feedback;

                    this.addConversationEntry({
                        agentId: agent.id,
                        agentName: agent.name,
                        agentColor: stageState.color,
                        agentIcon: stageState.icon,
                        role: 'verdict',
                        content: `Verdict: ${result.verdict}${result.feedback ? `\n\nFeedback: ${result.feedback}` : ''}`,
                        timestamp: Date.now(),
                        stageIndex,
                        metadata: { verdict: result.verdict, feedback: result.feedback },
                    });
                }

                stageState.report = result.report;
                stageState.completedAt = Date.now();

                // Merge runner state back into current state
                //
                // finalReport policy:
                //  - Retrospect stages always preserve (they analyse, not report).
                //  - canReject stages (validators, DA, SGA) are review/gate stages
                //    whose output is feedback, not the investigation report — their
                //    reports are stored in stageState.report for the conversation log
                //    but must NOT overwrite the investigator-produced finalReport.
                //  - All other stages (planner, investigator, summarizer) update it.
                const isReviewStage = !!stage.canReject;
                currentState = {
                    ...currentState,
                    thoughts: runnerState.thoughts,
                    actions: runnerState.actions,
                    fullHistory: runnerState.fullHistory,
                    fullActions: runnerState.fullActions,
                    logs: [...currentState.logs, ...runnerState.logs],
                    finalReport: (isRetrospectStage || isReviewStage) ? currentState.finalReport : (result.report || currentState.finalReport),
                    recommendations: runnerState.recommendations || currentState.recommendations,
                    verdict: (result.verdict as any) || currentState.verdict,
                    pipeline: this.pipelineState,
                };

                // If this was a retrospect-type stage, bridge its results into
                // the investigation's retrospect state so the Retrospect tab
                // shows them directly instead of re-running analysis from scratch.
                if (agent.builtinType === 'retrospect') {
                    const runnerRetro = runnerState.retrospect;
                    if (runnerRetro) {
                        // runRetrospectiveAnalysis() already populated the full
                        // retrospect state (messages, proposals, analysisComplete).
                        // Carry it over directly so the UI shows the real tool
                        // activity, proposals, and completion status.
                        currentState.retrospect = {
                            ...runnerRetro,
                            completed: true,
                        };
                    } else {
                        // Fallback if retrospect state somehow wasn't populated
                        currentState.retrospect = {
                            messages: [
                                { role: 'user', content: '[Auto-Analysis] Pipeline retrospect stage' },
                                { role: 'assistant', content: 'Pipeline retrospect stage completed.\n\n---\n\n**Analysis complete.** No changes were proposed.' },
                            ],
                            proposals: [],
                            analysisComplete: true,
                            completed: true,
                        };
                    }
                }

                // Clean up runner
                runner.dispose();
                this.currentRunner = null;

                // Handle rejection — trigger on 'rejected' or 'flagged' verdict
                // ('flagged' with issues significant enough to flag should still loop
                //  when onReject is 'loop', since LLMs often use 'flagged' for findings
                //  that clearly warrant re-investigation)
                const isRejection = stage.canReject && (result.verdict === 'rejected' || result.verdict === 'flagged');
                if (isRejection) {
                    stageState.status = 'rejected';

                    this.emit('stage-reject', {
                        stageIndex,
                        agentName: agent.name,
                        verdict: result.verdict,
                        feedback: result.feedback,
                    });

                    if (stage.onReject === 'abort') {
                        currentState.status = 'failed';
                        this.emit('status', { status: 'failed' });
                        break;
                    }

                    if (stage.onReject === 'loop') {
                        const maxRetries = getEffectiveMaxRetries(stage);
                        if (stageState.retryCount < maxRetries) {
                            stageState.retryCount++;
                            const targetIndex = resolveRejectTarget(
                                stage,
                                stageIndex,
                                this.pipeline.stages.length
                            );

                            // Reset stages from target to current for re-execution.
                            // Also reset retryCount for intermediate stages so they
                            // get a fresh chance to reject on the new pass (their
                            // maxRetries is "per pass", not "total across all passes").
                            for (let i = targetIndex; i <= stageIndex; i++) {
                                if (i !== stageIndex) {
                                    this.pipelineState.stages[i].status = 'pending';
                                    this.pipelineState.stages[i].startedAt = undefined; // Clear stale timestamps to prevent negative duration on retry
                                    this.pipelineState.stages[i].completedAt = undefined;
                                    this.pipelineState.stages[i].retryCount = 0;
                                }
                            }

                            // Inject rejection feedback into the conversation
                            this.addConversationEntry({
                                agentId: 'pipeline',
                                agentName: 'Pipeline',
                                role: 'handoff',
                                content: `Rejected by ${agent.name} (retry ${stageState.retryCount}/${maxRetries}). Sending feedback to ${this.pipelineState.stages[targetIndex].agentName}.`,
                                timestamp: Date.now(),
                                stageIndex,
                                metadata: {
                                    type: 'rejection-loop',
                                    fromAgent: agent.name,
                                    toAgent: this.pipelineState.stages[targetIndex].agentName,
                                    retryCount: stageState.retryCount,
                                    maxRetries,
                                    feedback: result.feedback,
                                },
                            });

                            // Loop back to target stage
                            stageIndex = targetIndex;
                            continue;
                        }
                        // Max retries exceeded — treat as flag and continue
                        this.log(`Max retries (${maxRetries}) exceeded for stage ${stageIndex}. Continuing as flag.`);
                    }

                    // For 'flag' or exhausted retries: mark and continue
                    stageState.status = 'completed'; // completed with flag
                } else {
                    stageState.status = 'completed';
                }

                this.emit('stage-complete', {
                    stageIndex,
                    agentName: agent.name,
                    status: stageState.status,
                    verdict: stageState.verdict,
                    duration: stageState.completedAt! - stageState.startedAt!,
                });

                stageIndex++;

            } catch (error: any) {
                stageState.status = 'failed';
                stageState.completedAt = Date.now();
                this.log(`Stage ${stageIndex} (${agent.name}) failed: ${error.message}`);

                // Clean up the failed stage runner to avoid resource leaks
                if (this.currentRunner) {
                    this.currentRunner.dispose();
                    this.currentRunner = null;
                }

                currentState.status = 'failed';
                currentState.pipeline = this.pipelineState;
                this.emit('stage-complete', {
                    stageIndex,
                    agentName: agent.name,
                    status: 'failed',
                    error: error.message,
                });
                break;
            }
        }

        // Set final status
        if (!this.aborted && currentState.status !== 'failed') {
            currentState.status = 'completed';
        }
        if (this.aborted) {
            currentState.status = 'aborted';
        }

        currentState.pipeline = this.pipelineState;
        this.pipelineState.conversationLog = this.conversationLog;
        return currentState;
    }

    /**
     * Pause the pipeline (and current runner if active).
     */
    pause(): void {
        if (this.currentRunner) {
            this.currentRunner.pause();
        }
    }

    /**
     * Resume the pipeline (and current runner if active).
     */
    resume(): void {
        if (this.currentRunner) {
            this.currentRunner.resume();
        }
    }

    /**
     * Queue a user intervention for the currently-executing stage runner.
     */
    intervene(message: string): void {
        if (this.currentRunner) {
            this.currentRunner.intervene(message);
        } else {
            this.pendingInterventions.push(message);
        }
    }

    /**
     * Abort the pipeline (and current runner if active).
     */
    abort(): void {
        this.aborted = true;
        if (this.currentRunner) {
            (this.currentRunner as any).aborted = true;
        }
    }

    /**
     * Get current pipeline state (for API polling).
     */
    getPipelineState(): PipelineState {
        return { ...this.pipelineState, stages: this.pipelineState.stages.map(s => ({ ...s })) };
    }

    // ─── Private helpers ───

    private resolveAgent(stage: PipelineStage, index: number): AgentDefinition {
        const agentDef = resolveStageAgent(stage, this.pipeline);

        // For builtin agents, resolve the full definition
        if (agentDef.source === 'builtin' && agentDef.builtinType) {
            const builtin = getBuiltinAgent(agentDef.builtinType, agentDef);
            if (builtin) return builtin;
        }

        // Assign palette defaults if not set
        if (!agentDef.color || !agentDef.icon) {
            const palette = getPaletteEntry(index);
            return {
                ...agentDef,
                color: agentDef.color || palette.color,
                icon: agentDef.icon || palette.icon,
            };
        }

        return agentDef;
    }

    /**
     * Build the system prompt for an agent, loading from file or inline,
     * then substituting template variables.
     */
    private buildAgentPrompt(
        agent: AgentDefinition,
        stage: PipelineStage,
        stageIndex: number,
        currentState: InvestigationState
    ): string {
        let prompt = '';

        // Load prompt based on source
        if (agent.source === 'file' && agent.promptPath) {
            const resolvedPath = path.isAbsolute(agent.promptPath)
                ? agent.promptPath
                : path.join(this.baseConfig.repoRoot || '', agent.promptPath);
            if (fs.existsSync(resolvedPath)) {
                prompt = fs.readFileSync(resolvedPath, 'utf8');
            } else {
                this.log(`Warning: Agent prompt file not found: ${resolvedPath}`);
                prompt = `You are ${agent.name}. ${agent.description || ''}`;
            }
        } else if (agent.source === 'inline' && agent.promptContent) {
            prompt = agent.promptContent;
        } else if (agent.source === 'builtin') {
            // Builtins with a custom prompt file get it loaded and templated
            if (agent.promptPath) {
                const resolvedPath = path.isAbsolute(agent.promptPath)
                    ? agent.promptPath
                    : path.join(this.baseConfig.repoRoot || '', agent.promptPath);
                if (fs.existsSync(resolvedPath)) {
                    prompt = fs.readFileSync(resolvedPath, 'utf8');
                } else {
                    this.log(`Warning: Builtin agent prompt file not found: ${resolvedPath}`);
                    prompt = `You are ${agent.name}. ${agent.description || ''}`;
                }
            } else {
                // Builtins without a prompt file use the Runner's default loadSystemPrompt()
                return '';
            }
        } else {
            prompt = `You are ${agent.name}. ${agent.description || ''}`;
        }

        // Substitute template variables
        const lastReport = this.getLastReport();
        const conversationText = this.conversationLog
            .map(e => `[${e.agentName}] (${e.role}): ${e.content}`)
            .join('\n\n');
        const agentNames = this.pipelineState.stages
            .map((s, i) => `${i + 1}. ${s.agentName}${i === stageIndex ? ' (you)' : ''}`)
            .join('\n');

        prompt = prompt
            .replace(/\{\{GOAL\}\}/g, currentState.query || '')
            .replace(/\{\{TARGET\}\}/g, currentState.target || '')
            .replace(/\{\{STATUS\}\}/g, currentState.status || '')
            .replace(/\{\{CATEGORY\}\}/g, currentState.category || '')
            .replace(/\{\{REPORT\}\}/g, lastReport || '(No report from previous agent)')
            .replace(/\{\{CONVERSATION\}\}/g, conversationText || '(No prior conversation)')
            .replace(/\{\{AGENT_NAME\}\}/g, agent.name)
            .replace(/\{\{AGENT_NAMES\}\}/g, agentNames);

        return prompt;
    }

    /**
     * Get the most recent report from the conversation log.
     */
    private getLastReport(): string | undefined {
        for (let i = this.conversationLog.length - 1; i >= 0; i--) {
            if (this.conversationLog[i].role === 'report') {
                return this.conversationLog[i].content;
            }
        }
        return undefined;
    }

    /**
     * Get a minimal conversation context (only reports) for 'report-only' input mode.
     */
    private getReportOnlyContext(): ConversationEntry[] {
        return this.conversationLog.filter(e => e.role === 'report' || e.role === 'verdict');
    }

    /**
     * Add an entry to the shared conversation log and emit it.
     */
    private addConversationEntry(entry: ConversationEntry): void {
        this.conversationLog.push(entry);
        this.emit('conversation-entry', entry);
    }

    /**
     * Forward all events from a runner, so pipeline consumers get real-time updates.
     * Also converts key events (thought, action) into conversation-entry events
     * so the Pipeline tab can show live activity.
     */
    private forwardRunnerEvents(
        runner: AgentRunner,
        identity: { agentId: string; agentName: string; agentColor?: string; agentIcon?: string; stageIndex: number },
    ): void {
        const events = ['thought', 'action', 'log', 'status', 'progress',
                        'retrospect', 'retrospect-proposal', 'retrospect-tool-activity'];
        for (const event of events) {
            runner.on(event, (data: any) => {
                this.emit(event, data);
            });
        }

        // Convert thought events → conversation entries for the Pipeline timeline
        runner.on('thought', (data: any) => {
            const content = typeof data === 'string' ? data : (data?.content ?? data?.text ?? String(data));
            if (!content || content.startsWith('System Alert:')) return;
            this.addConversationEntry({
                agentId: identity.agentId,
                agentName: identity.agentName,
                agentColor: identity.agentColor,
                agentIcon: identity.agentIcon,
                role: 'thought',
                content,
                timestamp: Date.now(),
                stageIndex: identity.stageIndex,
            });
        });

        // Convert action events → conversation entries for the Pipeline timeline
        runner.on('action', (data: any) => {
            const content = typeof data === 'string' ? data : (data?.description || data?.tool || String(data));
            if (!content) return;
            this.addConversationEntry({
                agentId: identity.agentId,
                agentName: identity.agentName,
                agentColor: identity.agentColor,
                agentIcon: identity.agentIcon,
                role: 'action',
                content,
                timestamp: Date.now(),
                stageIndex: identity.stageIndex,
            });
        });
    }

    /**
     * Run a runner with an optional timeout.
     */
    private async runWithTimeout(
        runner: AgentRunner,
        query: string,
        timeoutMs?: number
    ): Promise<void> {
        if (!timeoutMs) {
            await runner.start(query);
            return;
        }

        let timerId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error(`Stage timed out after ${Math.round(timeoutMs / 60_000)} minutes`)), timeoutMs);
        });

        try {
            await Promise.race([
                runner.start(query),
                timeoutPromise,
            ]);
        } finally {
            clearTimeout(timerId!);
        }
    }

    /**
     * Run a retrospect stage using the dedicated retrospect tool loop.
     */
    private async runRetrospectStage(
        runner: AgentRunner,
        timeoutMs?: number
    ): Promise<void> {
        if (!timeoutMs) {
            await runner.runRetrospectiveAnalysis();
            return;
        }

        let timerId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error(`Stage timed out after ${Math.round(timeoutMs / 60_000)} minutes`)), timeoutMs);
        });

        try {
            await Promise.race([
                runner.runRetrospectiveAnalysis(),
                timeoutPromise,
            ]);
        } finally {
            clearTimeout(timerId!);
        }
    }

    private log(msg: string): void {
        console.log(`[Pipeline] ${msg}`);
        this.emit('log', msg);
    }
}
