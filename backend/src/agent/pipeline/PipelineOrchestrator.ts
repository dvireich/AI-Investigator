import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { AgentDefinition, ConversationEntry, getAgentKind, getAgentRole, stageProducesFinalReport, OpenItem } from './AgentDefinition';
import {
    PipelineDefinition,
    PipelineStage,
    resolveStageAgent,
    resolveRejectTarget,
    getEffectiveMaxRetries,
    validatePipeline,
    SavedAgentResolver,
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
    private savedAgentResolver?: SavedAgentResolver;
    /**
     * Live execution state shared with stage runners.
     *
     * Exposed via the public `currentState` getter so the server's WebSocket
     * bridge can sync the anchor runner's state to the orchestrator's source
     * of truth on every event — instead of separately accumulating events
     * into the anchor (which caused duplicate / wrapped-object thoughts to
     * appear in saved state.json after the first resume).
     */
    private _currentState: InvestigationState | null = null;

    /** Read-only access to the orchestrator's live cumulative state. */
    get currentState(): InvestigationState | null {
        return this._currentState;
    }
    /**
     * Per-stage convergence tracking — keyed by stage index. Carries the open
     * items and tool-call signature from the prior round so we can detect
     * non-convergent retry loops (same complaints, no new evidence) and
     * downgrade them to a flag instead of looping forever.
     */
    private stageConvergence: Map<number, {
        priorOpenItemHashes: string[];
        priorToolCallSignature: string[];
    }> = new Map();
    /**
     * Pending retry context per-stage, populated when a downstream reviewer
     * rejects upstream work. Consumed when that target stage starts its
     * next run.
     */
    private pendingRetryContext: Map<number, NonNullable<StageContext['retryContext']>> = new Map();

    constructor(
        pipeline: PipelineDefinition,
        llmProvider: LlmProvider,
        baseConfig: AgentConfig,
        savedAgentResolver?: SavedAgentResolver
    ) {
        super();
        validatePipeline(pipeline);

        this.pipeline = pipeline;
        this.llmProvider = llmProvider;
        this.baseConfig = baseConfig;
        this.savedAgentResolver = savedAgentResolver;

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
        // Held in a `const` (not `let`) and mutated in place so external observers
        // (the server's WebSocket listener) can keep a stable reference and always
        // see up-to-date thoughts/actions/logs without races.
        const currentState: InvestigationState = {
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
        this._currentState = currentState;

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
                // NOTE: Match by agent.kind (not just builtinType) so that custom/file/inline
                // agents with `kind: 'retrospect'` are also recognized. Otherwise their
                // KB-improvement output would overwrite the investigator's finalReport.
                const isRetrospectStage = getAgentKind(agent) === 'retrospect';

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

                // Note: between-stage interventions are now pushed directly into
                // `currentState.thoughts` by `intervene()`, so the new stage runner
                // (created via `...currentState` spread above) already inherits them
                // through the shared thoughts array — no extra delivery loop needed.

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
                    // Drive the role-shaped finish tool. Reviewers get verdict+openItems;
                    // producers get a report-only schema. This is what makes role
                    // mimicry impossible at the tool boundary.
                    role: getAgentRole(agent),
                    // If a downstream reviewer rejected this stage in a prior round,
                    // pass the structured retry context (prior report + open items).
                    // This SUPPRESSES the conversation log injection on retry, which
                    // is what causes voice-drift / role-mimicry failures.
                    retryContext: this.pendingRetryContext.get(stageIndex),
                };
                runner.setStageContext(stageContext);
                // Consume the pending retry context — it applies to one run only.
                this.pendingRetryContext.delete(stageIndex);

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
                //  - Whether a stage's report should overwrite the investigation's
                //    finalReport is now decided by `stageProducesFinalReport(agent, stage)`,
                //    which honours the explicit `producesFinalReport` flag on either the
                //    stage or the agent definition. The legacy heuristics (retrospect kind
                //    and `canReject`) remain as fallbacks for agents/stages that pre-date
                //    the explicit flag.
                const ownsFinalReport = stageProducesFinalReport(agent, stage);
                // In-place mutation (instead of spread reassignment) so the public
                // `currentState` reference observed by the server stays stable.
                currentState.thoughts = runnerState.thoughts;
                currentState.actions = runnerState.actions;
                currentState.fullHistory = runnerState.fullHistory;
                currentState.fullActions = runnerState.fullActions;
                currentState.logs = [...currentState.logs, ...runnerState.logs];
                if (ownsFinalReport) {
                    currentState.finalReport = result.report || currentState.finalReport;
                }
                currentState.recommendations = runnerState.recommendations || currentState.recommendations;
                currentState.verdict = (result.verdict as any) || currentState.verdict;
                currentState.pipeline = this.pipelineState;

                // If this was a retrospect-type stage, bridge its results into
                // the investigation's retrospect state so the Retrospect tab
                // shows them directly instead of re-running analysis from scratch.
                if (isRetrospectStage) {
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
                        const targetIndex = resolveRejectTarget(
                            stage,
                            stageIndex,
                            this.pipeline.stages.length
                        );

                        // Resolve open items for this rejection. Reviewers should
                        // emit a structured `openItems[]`; legacy reviewers that only
                        // emit free-form `feedback` get a single synthetic blocker
                        // item synthesized from the prose so the retry context still
                        // has something concrete to display.
                        const openItems = this.resolveOpenItems(result);

                        // Convergence detection: if THIS reviewer's previous round
                        // raised substantively the same items AND the producer's
                        // looped run produced the same tool-call signature as last
                        // round, the loop is non-convergent (reviewer keeps asking
                        // for the same thing; producer can't deliver). Downgrade
                        // reject -> flag so the pipeline continues instead of
                        // grinding forever on the same complaints.
                        const convergence = this.stageConvergence.get(stageIndex);
                        const itemHashes = openItems.map(i => this.hashOpenItem(i));
                        const targetState = this.pipelineState.stages[targetIndex];
                        const lastTargetSig: string[] | undefined = (targetState as any).__lastToolCallSignature;
                        const sameItems = convergence && this.signatureSimilarity(convergence.priorOpenItemHashes, itemHashes) >= 0.8;
                        const noNewEvidence = convergence && lastTargetSig !== undefined &&
                            this.signatureSimilarity(convergence.priorToolCallSignature, lastTargetSig) >= 0.95;
                        // Only converge after at least one prior retry — round 1 always loops.
                        const giveUpOnLoop = stageState.retryCount > 0 && (sameItems || noNewEvidence);

                        if (giveUpOnLoop) {
                            this.log(`Stage ${stageIndex} (${agent.name}): non-convergent loop detected (sameItems=${sameItems}, noNewEvidence=${noNewEvidence}). Downgrading reject to flag.`);
                            this.addConversationEntry({
                                agentId: 'pipeline',
                                agentName: 'Pipeline',
                                role: 'handoff',
                                content: `Rejection loop did not converge after retry ${stageState.retryCount}. ${agent.name} keeps raising similar items but ${targetState.agentName} cannot resolve them with new evidence. Continuing pipeline with flag.`,
                                timestamp: Date.now(),
                                stageIndex,
                                metadata: {
                                    type: 'rejection-loop-converged',
                                    fromAgent: agent.name,
                                    toAgent: targetState.agentName,
                                    retryCount: stageState.retryCount,
                                    sameItems,
                                    noNewEvidence,
                                    feedback: result.feedback,
                                },
                            });
                            // Fall through to the "flag and continue" path below.
                        } else if (stageState.retryCount < maxRetries) {
                            stageState.retryCount++;

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

                            // Stash convergence state for next round's comparison.
                            this.stageConvergence.set(stageIndex, {
                                priorOpenItemHashes: itemHashes,
                                priorToolCallSignature: lastTargetSig ?? [],
                            });

                            // Stage retry context for the looped-back target.
                            // The Runner will use this to SUPPRESS the conversation
                            // log injection and replace it with a focused retry
                            // block (prior report + open items only — NO reviewer
                            // prose). This is what stops voice-drift / role-mimicry.
                            this.pendingRetryContext.set(targetIndex, {
                                priorReport: targetState.report || '(prior report unavailable)',
                                openItems,
                                round: stageState.retryCount,
                                reviewerName: agent.name,
                            });

                            // Inject rejection feedback into the conversation (UI/timeline only).
                            this.addConversationEntry({
                                agentId: 'pipeline',
                                agentName: 'Pipeline',
                                role: 'handoff',
                                content: `Rejected by ${agent.name} (retry ${stageState.retryCount}/${maxRetries}). Sending ${openItems.length} open item(s) to ${targetState.agentName}.`,
                                timestamp: Date.now(),
                                stageIndex,
                                metadata: {
                                    type: 'rejection-loop',
                                    fromAgent: agent.name,
                                    toAgent: targetState.agentName,
                                    retryCount: stageState.retryCount,
                                    maxRetries,
                                    feedback: result.feedback,
                                    openItems,
                                },
                            });

                            // Loop back to target stage
                            stageIndex = targetIndex;
                            continue;
                        } else {
                            // Max retries exceeded — treat as flag and continue
                            this.log(`Max retries (${maxRetries}) exceeded for stage ${stageIndex}. Continuing as flag.`);
                        }
                    }

                    // For 'flag', exhausted retries, or converged loop: mark and continue
                    stageState.status = 'completed'; // completed with flag
                } else {
                    stageState.status = 'completed';
                }

                // After every successful (non-rejection) stage completion, stash
                // the producer's tool-call signature so the NEXT reviewer round can
                // compare it to the prior round and detect no-new-evidence loops.
                if (result.toolCallSignature) {
                    (stageState as any).__lastToolCallSignature = result.toolCallSignature;
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
     * Deliver a user intervention immediately into the live cumulative state
     * so it survives crashes (the message is persisted on the next save) and
     * shows up in the timeline as a real chat bubble. When a stage runner is
     * active, the message is routed through it (which mutates the same shared
     * thoughts array). Between stages we push directly to `currentState.thoughts`
     * so the next stage runner inherits the message via the `...currentState`
     * spread when it is created.
     */
    intervene(message: string): void {
        if (this.currentRunner) {
            this.currentRunner.intervene(message);
            return;
        }
        if (this._currentState) {
            const formatted = `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)`;
            const entry = { role: 'user' as const, content: formatted };
            this._currentState.thoughts.push(entry);
            this._currentState.actions.push(null as any);
            this.emit('thought', entry);
            this.log(`User intervention recorded between stages: ${message}`);
            return;
        }
        this.log(`Intervention dropped (orchestrator not running): ${message}`);
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
     * Switch the LLM model used by all subsequent stage runners (and the
     * currently-active stage runner, if any). This propagates a user-initiated
     * model switch from the API endpoint into the pipeline's per-stage runners,
     * which were otherwise pinned to the model from `baseConfig` at construction.
     *
     * Note: per-agent `modelOverride` (set on individual AgentDefinitions) still
     * wins over the pipeline-level model.
     */
    setModel(model: string): void {
        this.baseConfig.model = model;
        if (this.currentRunner) {
            this.currentRunner.setModel(model);
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
        const agentDef = resolveStageAgent(stage, this.pipeline, this.savedAgentResolver);

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
     * Resolve a reviewer's structured `openItems[]` from the stage result.
     * Backwards-compatible: when the reviewer only emits legacy free-form
     * `feedback` prose (no `openItems` array), synthesize a single blocker
     * item from the prose so the producer's retry context still has something
     * concrete to display and the convergence detector still has an item hash
     * to compare across rounds.
     */
    private resolveOpenItems(result: { openItems?: OpenItem[]; feedback?: string }): OpenItem[] {
        if (Array.isArray(result.openItems) && result.openItems.length > 0) {
            // Cap to top-5 by severity so the retry prompt stays focused.
            const order = { blocker: 0, major: 1, minor: 2 } as const;
            return [...result.openItems]
                .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
                .slice(0, 5);
        }
        const prose = (result.feedback || '').trim();
        if (prose.length === 0) {
            return [{
                severity: 'blocker',
                claim: 'Reviewer rejected the report but provided no structured items or prose feedback.',
            }];
        }
        // Cap synthesized claim text so the retry prompt doesn't bloat.
        const claim = prose.length > 800 ? prose.substring(0, 800) + ' ...' : prose;
        return [{
            severity: 'blocker',
            claim,
        }];
    }

    /**
     * Stable hash of an open item used to detect "the reviewer is asking for
     * the same thing again". We hash on the lowercased + word-tokenized claim
     * so minor wording changes ("Error catalog incomplete" vs "Error catalog
     * is incomplete") don't defeat detection. Severity is included so a
     * blocker raised in round 1 doesn't match a minor in round 2.
     */
    private hashOpenItem(item: OpenItem): string {
        const tokens = item.claim
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3)
            .sort()
            .join(' ');
        return `${item.severity}|${tokens}`;
    }

    /**
     * Jaccard similarity of two string-array signatures. Used both for open-item
     * hashes (detecting "same complaints") and tool-call signatures (detecting
     * "same evidence — no new investigation actually happened").
     */
    private signatureSimilarity(a: string[], b: string[]): number {
        // Both empty -> perfectly similar (degenerate case). The early return
        // is also what guarantees `union > 0` below: any non-empty input
        // produces at least one set entry, so the divisor is always positive.
        if (a.length === 0 && b.length === 0) return 1;
        const setA = new Set(a);
        const setB = new Set(b);
        let intersection = 0;
        for (const x of setA) if (setB.has(x)) intersection++;
        const union = setA.size + setB.size - intersection;
        return intersection / union;
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
