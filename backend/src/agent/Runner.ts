import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ToolManager } from './Tools';
import { CopilotClient } from './CopilotClient';
import OpenAI from 'openai';

// Placeholder for LLM SDK - we will use a generic interface for now
// and swap with the specific SDK once confirmed.

export interface AgentConfig {
    systemPromptPath: string;
    retrospectPromptPath?: string;
    knowledgeBasePath?: string;
    repoRoot?: string;
    mcpServers: string[];
    maxSteps?: number;
    model?: string;
    workingDirectory?: string;
    investigationsPath?: string;
    retrospectTimeoutMinutes?: number;
    icmScriptsPath?: string;
}

export interface ProposedChange {
    id: string;
    type: 'edit' | 'create';
    filePath: string;
    description: string;
    content: string;
    originalContent?: string;
    status: 'pending' | 'approved' | 'rejected' | 'applied';
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
    // Metadata
    title?: string;
    query?: string;
    stamp?: string;
    timeRange?: string;
    trackingId?: string;
    issueType?: string;
    incidentId?: string;
    model?: string;
    productId?: string;
    pausedAt?: number;
    totalPausedTime?: number;
    finalReport?: string;
    retrospect?: RetrospectState;
    contestCount?: number;
}

export class AgentRunner extends EventEmitter {
    private state: InvestigationState;
    private config: AgentConfig;
    private toolManager: ToolManager;
    private paused: boolean = false;
    private aborted: boolean = false;
    private pendingInterventions: any[] = [];
    private copilotClient: CopilotClient;
    private openaiClient: OpenAI | null = null;
    private cachedCopilotToken: string | null = null;

    constructor(config: AgentConfig, initialMetadata: Partial<InvestigationState> = {}) {
        super();
        this.config = config;
        this.toolManager = new ToolManager();
        this.copilotClient = new CopilotClient();
        // Pass repo root from config to ToolManager for path resolution
        if (config.repoRoot) {
            this.toolManager.setRepoRoot(config.repoRoot);
        }
        this.state = {
            id: Date.now().toString(),
            status: 'running',
            thoughts: [],
            actions: [],
            logs: [],
            totalPausedTime: 0,
            ...initialMetadata
        };
    }

    async start(userQuery: string) {
        this.log(`Starting investigation for query: ${userQuery}`);

        // Save state immediately so the investigation exists even if initialization fails
        // This allows users to resume failed investigations instead of starting fresh
        await this.saveArtifacts();

        if (!this.toolManager.isConnected()) {
            this.log("ToolManager not connected. Initializing...");
            this.emit('thought', "System: Initializing KQL tools (trying Kusto CLI first, MCP Server as fallback)...");

            await this.toolManager.initialize(this.config.workingDirectory, (msg: string) => this.log(msg));

            // Re-check connection
            if (!this.toolManager.isConnected()) {
                const errorMsg = `System Warning: Failed to initialize KQL tools (neither Kusto CLI nor MCP Server available). Error: ${this.toolManager.initError || 'Unknown error'}.`;
                this.log(errorMsg);
                this.state.thoughts.push(errorMsg);
                this.emit('thought', errorMsg);
                
                // Pause and wait — when user clicks Resume we retry initialization
                this.state.thoughts.push("System: Investigation paused due to KQL tool initialization failure. Please check Kusto CLI or MCP server configuration and click Resume to retry.");
                this.pause();
                await this.saveArtifacts();

                // Block here until resume + successful connect (or abort)
                while (!this.aborted) {
                    // Spin while paused
                    while (this.paused && !this.aborted) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    if (this.aborted) return;

                    // User clicked Resume — retry initialization
                    this.log("Retrying KQL tool initialization after resume...");
                    this.emit('thought', "System: Retrying KQL tool initialization...");
                    await this.toolManager.initialize(this.config.workingDirectory, (msg: string) => this.log(msg));

                    if (this.toolManager.isConnected()) {
                        const backend = this.toolManager.getKqlBackend();
                        this.emit('thought', `System: KQL tools connected via ${backend}.`);
                        break; // Fall through to the main investigation loop
                    } else {
                        const retryErr = `System Warning: KQL tools still unavailable. Error: ${this.toolManager.initError || 'Unknown error'}.`;
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
            } else {
                const backend = this.toolManager.getKqlBackend();
                this.emit('thought', `System: KQL tools connected via ${backend}.`);
            }
        } else {
            this.log("ToolManager already connected.");
        }

        // Load System Prompt & Inject Metadata
        let systemPrompt = this.loadSystemPrompt();

        // Context Injection
        const contextParts = [];
        if (this.state.timeRange) contextParts.push(`Target Time Range: ${this.state.timeRange}`);
        if (this.state.stamp) contextParts.push(`Target Stamp/Environment: ${this.state.stamp}`);
        if (this.state.trackingId) contextParts.push(`Tracking ID: ${this.state.trackingId}`);
        if (this.state.issueType) contextParts.push(`Issue Type: ${this.state.issueType}`);
        if (this.state.incidentId) contextParts.push(`IcM Incident ID: ${this.state.incidentId}`);

        if (contextParts.length > 0) {
            systemPrompt += `\n\n## Investigation Context\nYou are investigating an issue with the following constraints:\n${contextParts.map(p => `- ${p}`).join('\n')}\n\nUse this context to filter your queries (e.g. strict time filtering).`;
        }

        // ICM Directive: if this investigation was started from an IcM incident, instruct the agent
        if (this.state.incidentId) {
            systemPrompt += `\n\n## ICM Incident Investigation\nThis investigation was initiated from IcM Incident ${this.state.incidentId}. Follow the ICM investigation guide (teleduct-icm-investigation.md):\n1. The incident context has already been extracted and is included in the user query below.\n2. Use the extracted stamp, time range, and symptom keywords to route to the correct specialized investigation guide.\n3. If stamp or time range is missing, attempt to extract them from the incident details in the query.\n4. Carry the IncidentId forward in all investigation state tracking.`;
        }

        // Main Loop
        let stepCount = 0;
        // Treat 0 as no limit (Infinity), undefined defaults to 50
        const maxSteps = (this.config.maxSteps !== undefined && this.config.maxSteps === 0)
            ? Infinity
            : (this.config.maxSteps || 50);
        let consecutiveThoughts = 0;
        let consecutiveLLMErrors = 0;
        const maxConsecutiveErrors = 3;

        while (!this.aborted && this.state.status !== 'completed' && stepCount < maxSteps) {
            stepCount++;

            // Check KQL Tool Connection Integrity (applies to both Kusto CLI and MCP backends)
            if (!this.toolManager.isConnected()) {
                if (!this.paused) {
                    this.log("KQL tools disconnected. Pausing investigation.");
                    const sysMsg = "System: KQL tools disconnected. Investigation paused. Click Resume to reconnect and continue.";
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
                // Flush any pending user interventions right before the LLM call
                // This ensures user messages are always the last thing the LLM sees
                while (this.pendingInterventions.length > 0) {
                    const msg = this.pendingInterventions.shift()!;
                    this.state.thoughts.push(msg);
                    this.state.actions.push(null as any);
                    this.emit('thought', msg);
                    this.log(`Injecting user intervention: ${msg}`);
                }

                const step = await this.callLLM(systemPrompt, userQuery, this.state.thoughts, consecutiveThoughts >= 2);

                if (step.thought) {
                    this.state.thoughts.push(step.thought);
                    this.emit('thought', step.thought);
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
                    
                    if (isActualError) {
                        consecutiveLLMErrors++;
                        this.log(`LLM error detected (${consecutiveLLMErrors}/${maxConsecutiveErrors}): ${thoughtStr.substring(0, 100)}`);
                        
                        if (consecutiveLLMErrors >= maxConsecutiveErrors) {
                            this.log(`Max consecutive LLM errors reached. Failing investigation.`);
                            this.state.status = 'failed';
                            this.emit('status', { status: 'failed' });
                            this.state.thoughts.push(`System: Investigation failed due to repeated LLM errors. Last error: ${thoughtStr}`);
                            this.state.actions.push(null as any);
                            await this.saveArtifacts();
                            break;
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

                    this.state.actions.push(step.action);
                    this.emit('action', step.action);

                    // Check for finish tool
                    if (step.action.tool === 'finish') {
                        this.state.status = 'completed';
                        this.log(`[DEBUG] Finish tool called with args: ${JSON.stringify(step.action.args)}`);
                        // Extract report from args
                        const report = step.action.args.report || step.action.args.summary || "Investigation Completed via finish tool.";

                        this.state.finalReport = report;
                        this.state.thoughts.push(`Observation: Report Generated.`);

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
                    // A single KQL result can be 300K+ chars (~75K tokens), which alone
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

                    if (consecutiveThoughts >= 3) {
                        this.log("Forcing tool usage due to consecutive thoughts.");
                        // We can force the next prompt to demand a tool
                        // But we can't easily inject it into `this.callLLM` without changing signature.
                        // Instead, we can append a system warning to the history? No, history is state.thoughts.
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
        // Budget: ~12.5k tokens for history => ~50k chars max
        const MAX_HISTORY_CHARS = 50_000;
        const HEAD_TAIL_CHARS = 20_000; // 20k head + 20k tail = 40k when truncated

        const history = this.state.thoughts.map((t, i) => {
            const action = this.state.actions[i];
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
        const path = require('path');
        return this.config.repoRoot
            || process.env.REPO_ROOT
            || path.resolve(process.cwd(), '../../..');
    }

    /**
     * Recursively scan a directory and return a formatted file listing.
     * Result is a markdown-style tree indented by depth, paths relative to repoRoot.
     */
    private discoverKnowledgeBase(): string {
        const path = require('path');
        const fs = require('fs');
        const repoRoot = this.getRepoRoot();
        const kbRelPath = this.config.knowledgeBasePath || '';

        const lines: string[] = [];

        const MAX_SCAN_DEPTH = 5;
        const scanDir = (dir: string, indent: number, depth: number = 0) => {
            if (depth > MAX_SCAN_DEPTH) return;
            let entries: string[];
            try {
                entries = fs.readdirSync(dir);
            } catch {
                return;
            }
            entries.sort();
            for (const entry of entries) {
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
        const path = require('path');
        const fs = require('fs');

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
                template = template.replace(/\{\{STAMP\}\}/g, this.state.stamp || 'N/A');
                template = template.replace(/\{\{ISSUE_TYPE\}\}/g, this.state.issueType || 'N/A');
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
- **Stamp**: ${this.state.stamp || 'N/A'}
- **Issue Type**: ${this.state.issueType || 'N/A'}

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
Tag each proposal: **[Fix Wrong Info]**, **[Add Missing Info]**, **[Improve Routing]**, **[New Guide]**, **[Prompt Refinement]**, **[New KQL Query]**

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
                    description: 'Read a file from the repository to inspect its current content.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path relative to repo root (e.g., docs/telemetry-investigations/README.md)' }
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
                            filePath: { type: 'string', description: 'File path relative to repo root (e.g., docs/telemetry-investigations/my-guide.md)' },
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
        if (!await this.copilotClient.isAuthenticated()) throw new Error("Not authenticated");
        const token = await this.copilotClient.getCopilotToken();

        // Create an AbortController so the retrospective can be cancelled
        this.retrospectAbortController = new AbortController();
        const abortSignal = this.retrospectAbortController.signal;

        // Per-call timeout equals the configured overall budget so a single slow API call
        // never times out before the user-configured limit fires.
        const perCallTimeoutMs = (this.config.retrospectTimeoutMinutes || 10) * 60 * 1000;

        // Reuse cached OpenAI client, recreating when token OR timeout config changes
        if (!this.openaiClient || this.cachedCopilotToken !== token || (this.openaiClient as any)._configuredTimeout !== perCallTimeoutMs) {
            this.cachedCopilotToken = token;
            this.openaiClient = new OpenAI({
                apiKey: token,
                baseURL: "https://api.githubcopilot.com",
                timeout: perCallTimeoutMs,
                defaultHeaders: {
                    'Editor-Version': 'vscode/1.85.1',
                    'Editor-Plugin-Version': 'copilot/1.155.0',
                    'User-Agent': 'GithubCopilot/1.155.0'
                }
            });
            (this.openaiClient as any)._configuredTimeout = perCallTimeoutMs;
        }
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
                const hasProposals = retro && retro.proposals && retro.proposals.length > 0;

                if (!hasProposals && totalReadCalls >= 1 && noProposalRetries < MAX_NO_PROPOSAL_RETRIES) {
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
                    : fnName;
                this.emit('retrospect-tool-activity', { tool: fnName, description: activityDesc, iteration: i + 1 });

                try {
                    if (fnName === 'read_file') {
                        // Dedup: if we already read this file, return a short notice instead of re-reading
                        const normalizedPath = (args.path || '').replace(/\\/g, '/').toLowerCase();
                        if (filesRead.has(normalizedPath)) {
                            result = `[Already read] You have already read "${args.path}" earlier in this session. Use the content from before. Do not re-read files — focus on proposing changes with propose_change.`;
                            this.log(`[Retrospect] read_file DEDUP: ${args.path} (already read)`);
                        } else {
                            result = this.toolManager.isConnected()
                                ? await this.toolManager.callTool('read_file', args)
                                : this.localReadFile(args.path);
                            // Cap file content to avoid blowing up context
                            if (result.length > MAX_READ_FILE_CHARS) {
                                result = result.substring(0, MAX_READ_FILE_CHARS) + `\n... [File truncated. Original: ${result.length} chars. Showing first ${MAX_READ_FILE_CHARS} chars.]`;
                            }
                            filesRead.add(normalizedPath);
                            totalReadCalls++;
                            this.log(`[Retrospect] read_file: ${args.path} (${result.length} chars, total reads: ${totalReadCalls})`);
                        }
                    } else if (fnName === 'list_dir') {
                        result = this.toolManager.isConnected()
                            ? await this.toolManager.callTool('list_dir', args)
                            : this.localListDir(args.path);
                        this.log(`[Retrospect] list_dir: ${args.path}`);
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
                const retro = this.state.retrospect;
                const hasProposals = retro && retro.proposals && retro.proposals.length > 0;
                if (totalReadCalls >= 6 && !hasProposals && fnName === 'read_file') {
                    this.log(`[Retrospect] ${totalReadCalls} files read with no proposals. Injecting pivot hint.`);
                }
            }

            // After processing all tool calls in this iteration, check if we should force proposal mode
            const retroState = this.state.retrospect;
            const hasAnyProposals = retroState && retroState.proposals && retroState.proposals.length > 0;
            if (totalReadCalls >= 6 && !hasAnyProposals && !postToolProposalNudgeSent) {
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

    private localReadFile(filePath: string): string {
        const fs = require('fs');
        const path = require('path');
        const repoRoot = path.resolve(this.getRepoRoot());
        
        const candidates = [
            path.resolve(repoRoot, filePath),
            path.resolve(filePath)
        ];

        for (const p of candidates) {
            // Security: only allow reading files within the repo root
            if (!p.startsWith(repoRoot)) continue;
            if (fs.existsSync(p)) {
                return fs.readFileSync(p, 'utf-8');
            }
        }
        return `File not found: ${filePath}`;
    }

    private localListDir(dirPath: string): string {
        const fs = require('fs');
        const path = require('path');
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
        const path = require('path');
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
            status: 'pending'
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
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        } catch (error: any) {
            const errMsg = error.name === 'AbortError'
                ? 'Retrospective was cancelled.'
                : `Error generating response: ${error.message}`;
            this.log(`[Retrospect] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            this.emit('retrospect', this.state.retrospect);
        } finally {
            clearTimeout(timeoutId!);
            this.retrospectAbortController = null;
        }
    }

    private retrospectAbortController: AbortController | null = null;
    private isRetrospectRunning = false;
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
            ? `Start by reading the investigation guides that were relevant (use read_file on the guides from ${kbPath}/ that match the issue type "${this.state.issueType || 'unknown'}").`
            : `Start by using list_dir to discover the knowledge base structure, then read_file on the guides that match the issue type "${this.state.issueType || 'unknown'}".`;
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
        const fs = require('fs');
        const path = require('path');
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

    private async saveArtifacts() {
        const fs = require('fs');
        const path = require('path');
        const baseDir = this.config.investigationsPath || path.join(this.getRepoRoot(), 'investigations');

        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        // Use the investigation creation date (from ID) to ensure consistent folder naming
        const startDate = !isNaN(Number(this.state.id)) ? new Date(Number(this.state.id)) : new Date();
        const timestamp = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const safeStamp = (this.state.stamp || 'UnknownStamp').replace(/[^a-zA-Z0-9-]/g, '');
        const safeId = this.state.id.replace(/[^a-zA-Z0-9]/g, '');
        const folderName = `${timestamp}_${safeStamp}_${safeId}`;

        const investigationDir = path.join(baseDir, folderName);
        if (!fs.existsSync(investigationDir)) {
            fs.mkdirSync(investigationDir, { recursive: true });
        }

        // Save JSON atomically (write to .tmp, then rename)
        const jsonPath = path.join(investigationDir, `state.json`);
        const tmpPath = jsonPath + '.tmp';
        this.log(`Saving JSON artifact to: ${jsonPath}`);
        fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
        fs.renameSync(tmpPath, jsonPath);

        // Generate Markdown Report
        const extractThoughtText = (t: any): string => {
            if (typeof t === 'string') return t;
            if (t && typeof t === 'object' && t.content) return String(t.content);
            return JSON.stringify(t);
        };

        const summaryText = this.state.finalReport
            || (this.state.thoughts.length > 0 ? extractThoughtText(this.state.thoughts[this.state.thoughts.length - 1]) : 'No summary available.');

        const report = `# Investigation Report: ${this.state.id}\n\n` +
            `**Status**: ${this.state.status}\n` +
            `**Stamp**: ${this.state.stamp || 'N/A'}\n` +
            `**Model**: ${this.state.model}\n` +
            `**Date**: ${new Date().toLocaleString()}\n\n` +
            `## Summary\n` +
            summaryText + `\n\n` +
            `## Execution Log\n\n` +
            this.state.thoughts.map((t, i) => {
                const action = this.state.actions[i];
                let entry = `### Step ${i + 1}\n**Thought**: ${extractThoughtText(t)}\n`;
                if (action) {
                    entry += `**Action**: \`${action.tool}\`\n\`\`\`json\n${JSON.stringify(action.args, null, 2)}\n\`\`\`\n`;
                    if (action.result) {
                        const res = typeof action.result === 'string' ? action.result : JSON.stringify(action.result, null, 2);
                        entry += `**Result**: \n\`\`\`\n${res.substring(0, 1000)}${res.length > 1000 ? '...' : ''}\n\`\`\`\n`;
                    }
                }
                return entry;
            }).join('\n');

        fs.writeFileSync(path.join(investigationDir, `report.md`), report);
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
        const formatted = `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)`;
        this.pendingInterventions.push({ role: 'user', content: formatted });
        this.log(`User intervention queued: ${message}`);
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
            `CONTESTED REPORT (attempt #${contestNum})`,
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

        // Reset retrospective (it analyzed a now-rejected report)
        this.state.retrospect = { messages: [], proposals: [], analysisComplete: false, completed: false };

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

    private loadSystemPrompt(): string {
        if (existsSync(this.config.systemPromptPath)) {
            return readFileSync(this.config.systemPromptPath, 'utf8');
        }
        return "You are a helpful assistant.";
    }

    public log(msg: string) {
        console.log(`[Agent] ${msg}`);
        this.state.logs.push(msg); // Keep pushing to logs for raw history/debugging if needed

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
        const maxAttempts = 2;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                if (!await this.copilotClient.isAuthenticated()) {
                    return {
                        thought: "Error: Not authenticated with GitHub Copilot. Please login via the dashboard.",
                        isFinal: true
                    };
                }

                const token = await this.copilotClient.getCopilotToken();

                // Reuse OpenAI client, recreating only when token changes
                if (!this.openaiClient || this.cachedCopilotToken !== token) {
                    this.cachedCopilotToken = token;
                    this.openaiClient = new OpenAI({
                        apiKey: token,
                        baseURL: "https://api.githubcopilot.com",
                        timeout: 120_000,
                        defaultHeaders: {
                            'Editor-Version': 'vscode/1.85.1',
                            'Editor-Plugin-Version': 'copilot/1.155.0',
                            'User-Agent': 'GithubCopilot/1.155.0'
                        }
                    });
                }
                const openai = this.openaiClient;

                const model = this.state.model || this.config.model || 'gpt-4o';

                this.log(`Calling LLM (${model}) [Attempt ${attempt + 1}]...`);

                let tools: any[] = [];
                try {
                    tools = await this.toolManager.listTools();
                } catch (e) {
                    this.log(`Warning: Failed to list tools: ${e}`);
                }

                // Per-message size guard: even after compaction, individual messages
                // can be oversized (e.g., a single KQL observation). Cap each message
                // to prevent a single entry from blowing the token budget.
                const MAX_MSG_CHARS = 80_000; // ~20K tokens per message
                const capContent = (content: string): string => {
                    if (content.length <= MAX_MSG_CHARS) return content;
                    const headSize = Math.floor(MAX_MSG_CHARS * 0.6);
                    const tailSize = Math.floor(MAX_MSG_CHARS * 0.3);
                    return content.substring(0, headSize) +
                        `\n\n... [MESSAGE TRUNCATED: ${content.length.toLocaleString()} chars → ${MAX_MSG_CHARS.toLocaleString()} chars] ...\n\n` +
                        content.substring(content.length - tailSize);
                };

                const messages = [
                    { role: 'system', content: system },
                    { role: 'user', content: userQuery },
                    ...currentHistory.map(h => {
                        // Support explicit role in history items
                        if (h && typeof h === 'object' && h.role && h.content) {
                            return { role: h.role, content: capContent(h.content) };
                        }
                        // Default to assistant for strings or other objects
                        if (typeof h === 'string') return { role: 'assistant', content: capContent(h) };
                        return { role: 'assistant', content: capContent(JSON.stringify(h)) };
                    })
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

                if (forceTool) {
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
                const maxPayloadChars = 400000; // ~100K tokens safety threshold
                
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

                // DEBUG: Log payload size/stats instead of full dump
                console.log(`[Agent] LLM Request: Model=${model}, Tools=${openAiTools?.length || 0}, ToolChoice=${toolChoice}, PayloadSize=${payloadStr.length} chars (~${estimatedTokens} tokens)`);

                const completion = await openai.chat.completions.create({
                    model: model,
                    messages: messages,
                    tools: openAiTools, // undefined if empty
                    tool_choice: toolChoice // undefined if no tools
                });

                const message = completion.choices[0].message;

                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0] as any;
                    return {
                        thought: message.content || "Deciding to use a tool...",
                        action: {
                            tool: toolCall.function.name,
                            args: JSON.parse(toolCall.function.arguments)
                        }
                    };
                }

                return {
                    thought: message.content,
                    isFinal: true
                };

            } catch (error: any) {
                // Check if this is a 400 error (token limit, malformed request, or oversized payload)
                if (error.status === 400) {
                    const errorMsg = error.message || 'Bad Request';
                    this.log(`400 Error (Attempt ${attempt + 1}): ${errorMsg}`);

                    // Try compaction for any 400 error (not just token-specific)
                    if (attempt < maxAttempts - 1) {
                        this.log("Attempting auto-compaction to recover from 400 error...");
                        const success = await this.compactHistory(system, userQuery, this.state.thoughts);
                        if (success) {
                            currentHistory = this.state.thoughts;
                            continue; // Retry loop
                        }
                    }

                    this.log(`Recovery from 400 error failed. Investigation cannot continue.`);
                    return {
                        thought: `System Alert: LLM returned 400 error (${errorMsg}). Auto-recovery failed. Investigation stopped to prevent infinite loop.`,
                        isFinal: true
                    };
                }

                this.log(`LLM Error: ${error.message}`);
                return {
                    thought: `Critical LLM Error: ${error.message}`,
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
            if (!await this.copilotClient.isAuthenticated()) {
                this.log("Cannot compact history: Copilot not authenticated.");
                return false;
            }
            const token = await this.copilotClient.getCopilotToken();

            // Reuse cached OpenAI client, recreating only when token changes
            if (!this.openaiClient || this.cachedCopilotToken !== token) {
                this.cachedCopilotToken = token;
                this.openaiClient = new OpenAI({
                    apiKey: token,
                    baseURL: "https://api.githubcopilot.com",
                    defaultHeaders: {
                        'Editor-Version': 'vscode/1.85.1',
                        'Editor-Plugin-Version': 'copilot/1.155.0',
                        'User-Agent': 'GithubCopilot/1.155.0'
                    }
                });
            }
            const openai = this.openaiClient;

            // Keep the last few thoughts intact for immediate context
            const keepRecent = 4;
            const olderThoughts = history.slice(0, -keepRecent);
            const recentThoughts = history.slice(-keepRecent);

            if (olderThoughts.length < 2) {
                this.log("Not enough history to compact.");
                return false;
            }

            // Build a summary of the older thoughts
            const olderText = olderThoughts.map((h, i) => {
                if (typeof h === 'string') return `[${i}] ${h.substring(0, 500)}`;
                if (h && h.content) return `[${i}] ${String(h.content).substring(0, 500)}`;
                return `[${i}] ${JSON.stringify(h).substring(0, 500)}`;
            }).join('\n');

            const model = this.state.model || 'gpt-4o';

            this.log(`Summarizing ${olderThoughts.length} older steps...`);

            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: 'You are a summarizer. Condense the following investigation conversation history into a concise summary. Preserve key findings, tool results, data points, and decisions. Remove verbose tool outputs but keep their conclusions. Output ONLY the summary, no preamble.' },
                    { role: 'user', content: `Original investigation query: ${userQuery}\n\nConversation history to summarize:\n${olderText}` }
                ]
            });

            const summary = completion.choices[0].message.content;
            if (!summary) throw new Error("Empty summary returned.");

            const sysMsg = `System: Context was automatically compacted to stay within token limits. ${olderThoughts.length} older messages were summarized.`;

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

            this.emit('thought', sysMsg);
            this.log(`Compaction complete. Summarized ${olderThoughts.length} entries (${olderActions.length} actions compacted).`);

            return true;
        } catch (err: any) {
            this.log(`Compaction failed: ${err.message}`);
            return false;
        }
    }

    private async executeAction(action: any): Promise<any> {
        this.log(`Executing tool: ${action.tool}`);
        try {
            return await this.toolManager.callTool(action.tool, action.args);
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
}
