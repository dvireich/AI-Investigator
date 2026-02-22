"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRunner = void 0;
const events_1 = require("events");
const fs_1 = require("fs");
const Tools_1 = require("./Tools");
const CopilotClient_1 = require("./CopilotClient");
const openai_1 = __importDefault(require("openai"));
class AgentRunner extends events_1.EventEmitter {
    constructor(config, initialMetadata = {}) {
        super();
        this.paused = false;
        this.aborted = false;
        this.pendingInterventions = [];
        this.config = config;
        this.toolManager = new Tools_1.ToolManager();
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
    async start(userQuery) {
        this.log(`Starting investigation for query: ${userQuery}`);
        // Save state immediately so the investigation exists even if initialization fails
        // This allows users to resume failed investigations instead of starting fresh
        await this.saveArtifacts();
        if (!this.toolManager.isConnected()) {
            this.log("ToolManager not connected. Initializing...");
            this.emit('thought', "System: Initializing KQL tools (trying Kusto CLI first, MCP Server as fallback)...");
            await this.toolManager.initialize(this.config.workingDirectory, (msg) => this.log(msg));
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
                    if (this.aborted)
                        return;
                    // User clicked Resume — retry initialization
                    this.log("Retrying KQL tool initialization after resume...");
                    this.emit('thought', "System: Retrying KQL tool initialization...");
                    await this.toolManager.initialize(this.config.workingDirectory, (msg) => this.log(msg));
                    if (this.toolManager.isConnected()) {
                        const backend = this.toolManager.getKqlBackend();
                        this.emit('thought', `System: KQL tools connected via ${backend}.`);
                        break; // Fall through to the main investigation loop
                    }
                    else {
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
                if (this.aborted)
                    return;
            }
            else {
                const backend = this.toolManager.getKqlBackend();
                this.emit('thought', `System: KQL tools connected via ${backend}.`);
            }
        }
        else {
            this.log("ToolManager already connected.");
        }
        // Load System Prompt & Inject Metadata
        let systemPrompt = this.loadSystemPrompt();
        // Context Injection
        const contextParts = [];
        if (this.state.timeRange)
            contextParts.push(`Target Time Range: ${this.state.timeRange}`);
        if (this.state.stamp)
            contextParts.push(`Target Stamp/Environment: ${this.state.stamp}`);
        if (this.state.trackingId)
            contextParts.push(`Tracking ID: ${this.state.trackingId}`);
        if (this.state.issueType)
            contextParts.push(`Issue Type: ${this.state.issueType}`);
        if (contextParts.length > 0) {
            systemPrompt += `\n\n## Investigation Context\nYou are investigating an issue with the following constraints:\n${contextParts.map(p => `- ${p}`).join('\n')}\n\nUse this context to filter your queries (e.g. strict time filtering).`;
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
                    const msg = this.pendingInterventions.shift();
                    this.state.thoughts.push(msg);
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
                            this.emit('status', 'failed');
                            this.state.thoughts.push(`System: Investigation failed due to repeated LLM errors. Last error: ${thoughtStr}`);
                            await this.saveArtifacts();
                            break;
                        }
                        // Continue to let it retry
                        continue;
                    }
                }
                else if (step.action) {
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
                        // Update last action result
                        const lastAction = this.state.actions[this.state.actions.length - 1];
                        lastAction.result = "Report generated and saved to finalReport field.";
                        this.log("Investigation completed by agent.");
                        await this.saveArtifacts();
                        break;
                    }
                    // 3. Execute Action
                    const result = await this.executeAction(step.action);
                    // Update the last action with result
                    const lastAction = this.state.actions[this.state.actions.length - 1];
                    lastAction.result = result;
                    this.state.thoughts.push(`Observation: ${JSON.stringify(result)}`);
                }
                else {
                    // No action implies just thinking/speaking. 
                    consecutiveThoughts++;
                    if (consecutiveThoughts >= 3) {
                        this.log("Forcing tool usage due to consecutive thoughts.");
                        // We can force the next prompt to demand a tool
                        // But we can't easily inject it into `this.callLLM` without changing signature.
                        // Instead, we can append a system warning to the history? No, history is state.thoughts.
                        this.state.thoughts.push("System Warning: You are looping with thoughts. You MUST call a tool now or finish.");
                    }
                }
                // Emit progress
                this.emit('progress', this.state);
                // Save state after every step to ensure persistence
                await this.saveArtifacts();
            }
            catch (error) {
                const errMsg = `System Error: Investigation failed due to an unexpected error: ${error.message || error}`;
                this.log(errMsg);
                // this.state.thoughts.push(errMsg); // Handled by log()
                // this.emit('thought', errMsg);     // Handled by log()
                this.state.status = 'failed';
                this.emit('status', 'failed');
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
            this.emit('status', 'paused');
            await this.saveArtifacts();
        }
    }
    initRetrospect() {
        if (!this.state.retrospect) {
            this.state.retrospect = { messages: [], proposals: [], analysisComplete: false, completed: false };
        }
        // Migrate legacy retrospect objects that don't have proposals/analysisComplete/completed
        if (!this.state.retrospect.proposals)
            this.state.retrospect.proposals = [];
        if (this.state.retrospect.analysisComplete === undefined)
            this.state.retrospect.analysisComplete = false;
        if (this.state.retrospect.completed === undefined)
            this.state.retrospect.completed = false;
        return this.state.retrospect;
    }
    setRetrospectCompleted(completed) {
        const retro = this.initRetrospect();
        retro.completed = completed;
        this.emit('retrospect', this.state.retrospect);
        return retro;
    }
    /** Rough token estimate: ~4 chars per token for English text */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    buildRetrospectHistory() {
        // Budget: ~25k tokens for history => ~100k chars max
        const MAX_HISTORY_CHARS = 100000;
        const HEAD_TAIL_CHARS = 40000; // 40k head + 40k tail = 80k when truncated
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
    buildRetrospectSystemPrompt() {
        return `You are a **Knowledge Base Improvement Specialist** reviewing a completed Teleduct pipeline investigation.

## Your Mission
Analyze the investigation transcript (provided in a separate message), identify where the knowledge base (investigation guides, agent prompts) failed the agent, and propose specific file changes that would make future investigations succeed on the first attempt.

## Investigation Context
- **Goal**: ${this.state.query}
- **Final Status**: ${this.state.status}
- **Stamp**: ${this.state.stamp || 'N/A'}
- **Issue Type**: ${this.state.issueType || 'N/A'}

## Knowledge Base Structure
The agent's knowledge lives in these locations (all paths relative to repo root):

### Agent System Prompt
- \`.github/agents/Teleduct_Investigation.agent.md\`

### Reusable Prompt Files (.github/prompts/)
- \`teleduct-latency-investigation.prompt.md\`
- \`teleduct-queue-investigation.prompt.md\`
- \`teleduct-infrastructure-investigation.prompt.md\`
- \`teleduct-blobreader-investigation.prompt.md\`
- \`teleduct-ingestion-investigation.prompt.md\`
- \`teleduct-discovery-metrics.prompt.md\`

### Investigation Guides (docs/telemetry-investigations/)
- \`README.md\`, \`investigation-methodology.md\`
- \`teleduct-la-pipeline-latency-investigation.md\`, \`teleduct-aux-pipeline-latency-investigation.md\`
- \`teleduct-message-lifecycle-investigation.md\`, \`teleduct-queue-retry-node-failure-investigation.md\`
- \`teleduct-queue-throttling-investigation.md\`, \`teleduct-kusto-error-investigation.md\`
- \`ParquetIngestionService-Latency-Investigation-Guide.md\`
- \`teleduct-blobreader-cache-miss-investigation.md\`, \`teleduct-vm-health-investigation.md\`
- \`teleduct-service-discovery.md\`, \`teleduct-dashboard-investigation-guide.md\`
- And others in the same directory

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
1. **Read the relevant investigation guides** by calling \`read_file\` immediately.
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
    buildRetrospectMessages(retroMessages) {
        const systemPrompt = this.buildRetrospectSystemPrompt();
        const effectiveHistory = this.buildRetrospectHistory();
        // Investigation transcript as a separate message (~25k tokens max)
        const transcriptMsg = `## Investigation Transcript\n${effectiveHistory}\n\n## Final Report\n${(this.state.finalReport || 'N/A').substring(0, 5000)}`;
        // Only include the last N retro messages to avoid accumulation blowup
        const MAX_RETRO_MESSAGES = 10;
        let recentMessages = retroMessages.length > MAX_RETRO_MESSAGES
            ? retroMessages.slice(-MAX_RETRO_MESSAGES)
            : [...retroMessages];
        // Sanitize broken message patterns: remove "Let me read..." assistant messages
        // that represent failed tool-calling attempts (model described plan but didn't act).
        // Also remove error messages from previous token overflow crashes.
        recentMessages = recentMessages.filter((msg, idx) => {
            if (msg.role !== 'assistant')
                return true;
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
        const cleanedMessages = [];
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
    getRetrospectTools() {
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
    async runRetrospectToolLoop(messages, tools) {
        const copilot = new CopilotClient_1.CopilotClient();
        if (!await copilot.isAuthenticated())
            throw new Error("Not authenticated");
        const token = await copilot.getCopilotToken();
        const openai = new openai_1.default({
            apiKey: token,
            baseURL: "https://api.githubcopilot.com",
            defaultHeaders: {
                'Editor-Version': 'vscode/1.85.1',
                'Editor-Plugin-Version': 'copilot/1.155.0',
                'User-Agent': 'GithubCopilot/1.155.0'
            }
        });
        const model = this.state.model || 'gpt-4o';
        const maxToolIterations = 20; // Safety cap
        const MAX_PROMPT_TOKENS = 110000; // Leave headroom below 128k limit
        const MAX_READ_FILE_CHARS = 12000; // ~3k tokens per file read
        let consecutiveNoToolCalls = 0; // Track when model refuses to use tools
        const MAX_NO_TOOL_RETRIES = 2; // Max times to re-prompt before accepting text response
        let proposalNudgeSent = false; // Track if we already nudged for proposals
        for (let i = 0; i < maxToolIterations; i++) {
            // Estimate token usage and trim old tool results if approaching limit
            const totalChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
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
                    return messages.filter((m) => m.role === 'assistant' && m.content).pop()?.content || 'Analysis complete (context limit reached).';
                }
            }
            // Force tool use on early iterations to prevent models (esp. Claude) from
            // just describing what they plan to do without actually calling tools.
            // 'required' = model MUST call at least one tool.
            // After tools have been used (i >= 3 or we have tool results), switch to 'auto'.
            const hasToolResults = messages.some((m) => m.role === 'tool');
            const effectiveToolChoice = (i < 3 && !hasToolResults) ? 'required' : 'auto';
            this.log(`[Retrospect] tool_choice=${effectiveToolChoice}, hasToolResults=${hasToolResults}`);
            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                tools: tools,
                tool_choice: effectiveToolChoice,
                temperature: 0.7
            });
            const message = completion.choices[0].message;
            this.log(`[Retrospect] Response: hasContent=${!!message.content}, toolCalls=${message.tool_calls?.length || 0}`);
            // If no tool calls, check if this is a real final response or the model avoiding tools
            if (!message.tool_calls || message.tool_calls.length === 0) {
                const responseText = message.content || '';
                // Detect "planning" responses where the model says it will use tools but didn't
                const isPlanningText = /\b(let me|i'll|i will|going to|start by)\b.*\b(read|look|examine|inspect|check|open|list|propose)\b/i.test(responseText);
                if (isPlanningText && consecutiveNoToolCalls < MAX_NO_TOOL_RETRIES) {
                    consecutiveNoToolCalls++;
                    this.log(`[Retrospect] Model returned planning text without tool calls (attempt ${consecutiveNoToolCalls}/${MAX_NO_TOOL_RETRIES}). Re-prompting...`);
                    // Add a nudge message to force the model to actually use tools
                    messages.push({
                        role: 'assistant',
                        content: responseText
                    });
                    messages.push({
                        role: 'user',
                        content: 'Do not describe what you plan to do. You MUST use the read_file or list_dir tools NOW to actually read the files. Call the tools directly in your response.'
                    });
                    continue; // Retry this iteration
                }
                // Check if the model produced analysis text but never created any proposals.
                // This happens when the model does read_file calls, produces a long analysis,
                // then returns its final response without ever calling propose_change.
                const retro = this.state.retrospect;
                const hasProposals = retro && retro.proposals && retro.proposals.length > 0;
                const hasToolResults = messages.some((m) => m.role === 'tool');
                const isSubstantialAnalysis = responseText.length > 300 && /\b(problem|issue|fix|change|improve|add|missing|update|propose|proposal)\b/i.test(responseText);
                if (!hasProposals && !proposalNudgeSent && hasToolResults && isSubstantialAnalysis) {
                    proposalNudgeSent = true;
                    this.log(`[Retrospect] Model produced analysis but no proposals. Nudging to create proposals...`);
                    messages.push({
                        role: 'assistant',
                        content: responseText
                    });
                    messages.push({
                        role: 'user',
                        content: 'Good analysis! Now you MUST use the propose_change tool to create actual file change proposals for each fix you identified. Call propose_change once for each file you want to modify or create. Do NOT just describe the changes — use the tool to propose them.'
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
                const fnName = toolCall.function.name;
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments);
                }
                catch (parseErr) {
                    this.log(`[Retrospect] Failed to parse tool args for ${fnName}: ${parseErr.message}`);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: Invalid JSON arguments: ${parseErr.message}`
                    });
                    continue;
                }
                let result;
                // Emit tool activity event so the UI shows what's happening
                const activityDesc = fnName === 'read_file' ? `Reading ${args.path}`
                    : fnName === 'list_dir' ? `Listing ${args.path}`
                        : fnName === 'propose_change' ? `Proposing change: ${(args.description || '').substring(0, 60)}`
                            : fnName;
                this.emit('retrospect-tool-activity', { tool: fnName, description: activityDesc, iteration: i + 1 });
                try {
                    if (fnName === 'read_file') {
                        result = this.toolManager.isConnected()
                            ? await this.toolManager.callTool('read_file', args)
                            : this.localReadFile(args.path);
                        // Cap file content to avoid blowing up context
                        if (result.length > MAX_READ_FILE_CHARS) {
                            result = result.substring(0, MAX_READ_FILE_CHARS) + `\n... [File truncated. Original: ${result.length} chars. Showing first ${MAX_READ_FILE_CHARS} chars.]`;
                        }
                        this.log(`[Retrospect] read_file: ${args.path} (${result.length} chars)`);
                    }
                    else if (fnName === 'list_dir') {
                        result = this.toolManager.isConnected()
                            ? await this.toolManager.callTool('list_dir', args)
                            : this.localListDir(args.path);
                        this.log(`[Retrospect] list_dir: ${args.path}`);
                    }
                    else if (fnName === 'propose_change') {
                        result = this.handleProposeChange(args);
                    }
                    else {
                        result = `Unknown tool: ${fnName}`;
                    }
                }
                catch (toolErr) {
                    this.log(`[Retrospect] Tool ${fnName} failed: ${toolErr.message}`);
                    result = `Error executing ${fnName}: ${toolErr.message}`;
                }
                // Add tool response
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: typeof result === 'string' ? result : JSON.stringify(result)
                });
            }
        }
        return "Analysis complete (tool iteration limit reached).";
    }
    localReadFile(filePath) {
        const fs = require('fs');
        const path = require('path');
        const repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), '../../..');
        const candidates = [
            filePath,
            path.join(repoRoot, filePath),
            path.resolve(filePath)
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return fs.readFileSync(p, 'utf-8');
            }
        }
        return `File not found: ${filePath}`;
    }
    localListDir(dirPath) {
        const fs = require('fs');
        const path = require('path');
        const repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), '../../..');
        const candidates = [
            dirPath,
            path.join(repoRoot, dirPath),
            path.resolve(dirPath)
        ];
        for (const p of candidates) {
            if (fs.existsSync(p) && fs.lstatSync(p).isDirectory()) {
                return JSON.stringify(fs.readdirSync(p));
            }
        }
        return `Directory not found: ${dirPath}`;
    }
    handleProposeChange(args) {
        const retro = this.initRetrospect();
        const proposalId = `proposal_${Date.now()}_${retro.proposals.length}`;
        // For edits, read the original file content so UI can show a diff
        let originalContent;
        if (args.type === 'edit') {
            const existing = this.localReadFile(args.filePath);
            if (!existing.startsWith('File not found:')) {
                originalContent = existing;
            }
        }
        const proposal = {
            id: proposalId,
            type: args.type,
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
    async runRetrospective(userMessage) {
        if (['running', 'paused'].includes(this.state.status)) {
            throw new Error("Retrospective is only available for completed, failed, or aborted investigations.");
        }
        const retro = this.initRetrospect();
        // Add User Message
        retro.messages.push({ role: 'user', content: userMessage });
        this.emit('retrospect', this.state.retrospect);
        const tools = this.getRetrospectTools();
        const messages = this.buildRetrospectMessages(retro.messages);
        try {
            const responseText = await this.runRetrospectToolLoop(messages, tools);
            retro.messages.push({ role: 'assistant', content: responseText });
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        }
        catch (error) {
            const errMsg = `Error generating response: ${error.message}`;
            this.log(`[Retrospect] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            this.emit('retrospect', this.state.retrospect);
        }
    }
    async runRetrospectiveAnalysis() {
        if (['running', 'paused'].includes(this.state.status)) {
            throw new Error("Retrospective analysis is only available for completed, failed, or aborted investigations.");
        }
        const retro = this.initRetrospect();
        if (retro.analysisComplete) {
            return; // Already analyzed
        }
        const tools = this.getRetrospectTools();
        const analysisRequest = `Analyze this investigation now. Start by reading the investigation guides that were relevant (use read_file on the guides from docs/telemetry-investigations/ that match the issue type "${this.state.issueType || 'unknown'}"). Cross-reference the guide content with the investigation transcript above. Then propose specific changes using propose_change for each improvement you identify. Focus on changes that would make this investigation succeed perfectly on the first attempt next time.`;
        const messages = this.buildRetrospectMessages([{ role: 'user', content: analysisRequest }]);
        try {
            const responseText = await this.runRetrospectToolLoop(messages, tools);
            retro.messages.push({ role: 'user', content: '[Auto-Analysis] System triggered initial investigation analysis' });
            retro.messages.push({ role: 'assistant', content: responseText });
            retro.analysisComplete = true;
            this.emit('retrospect', this.state.retrospect);
            await this.saveArtifacts();
        }
        catch (error) {
            const errMsg = `Error during auto-analysis: ${error.message}`;
            this.log(`[Retrospect] ERROR: ${errMsg}`);
            retro.messages.push({ role: 'assistant', content: errMsg });
            this.emit('retrospect', this.state.retrospect);
        }
    }
    updateProposalStatus(proposalId, status) {
        const retro = this.initRetrospect();
        const proposal = retro.proposals.find(p => p.id === proposalId);
        if (!proposal)
            return null;
        proposal.status = status;
        this.emit('retrospect', this.state.retrospect);
        return proposal;
    }
    async applyApprovedProposals() {
        const fs = require('fs');
        const path = require('path');
        const repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), '../../..');
        const retro = this.initRetrospect();
        const applied = [];
        const errors = [];
        for (const proposal of retro.proposals) {
            if (proposal.status !== 'approved')
                continue;
            try {
                const fullPath = path.isAbsolute(proposal.filePath)
                    ? proposal.filePath
                    : path.join(repoRoot, proposal.filePath);
                // Ensure directory exists
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, proposal.content, 'utf-8');
                proposal.status = 'applied';
                applied.push(proposal.filePath);
                this.log(`[Retrospect] Applied: ${proposal.filePath}`);
            }
            catch (e) {
                proposal.status = 'approved'; // Keep as approved so user can retry
                errors.push(`${proposal.filePath}: ${e.message}`);
                this.log(`[Retrospect] Failed to apply ${proposal.filePath}: ${e.message}`);
            }
        }
        this.emit('retrospect', this.state.retrospect);
        await this.saveArtifacts();
        return { applied, errors };
    }
    async saveArtifacts() {
        const fs = require('fs');
        const path = require('path');
        const baseDir = "C:/Repositories/AM-Teleduct/docs/telemetry-investigations/Investigations";
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
        // Save JSON
        const jsonPath = path.join(investigationDir, `state.json`);
        this.log(`Saving JSON artifact to: ${jsonPath}`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.state, null, 2));
        // Generate Markdown Report
        const report = `# Investigation Report: ${this.state.id}\n\n` +
            `**Status**: ${this.state.status}\n` +
            `**Stamp**: ${this.state.stamp || 'N/A'}\n` +
            `**Model**: ${this.state.model}\n` +
            `**Date**: ${new Date().toLocaleString()}\n\n` +
            `## Summary\n` +
            (this.state.thoughts.length > 0 ? this.state.thoughts[this.state.thoughts.length - 1] : "No summary available.") + `\n\n` +
            `## Execution Log\n\n` +
            this.state.thoughts.map((t, i) => {
                const action = this.state.actions[i];
                let entry = `### Step ${i + 1}\n**Thought**: ${typeof t === 'string' ? t : JSON.stringify(t)}\n`;
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
        this.emit('status', 'paused');
        this.log("Investigation paused.");
    }
    intervene(message) {
        const formatted = `User Intervention: ${message}\n(SYSTEM NOTE: You must acknowledge this user message in your next thought and adjust your plan accordingly.)`;
        this.pendingInterventions.push(formatted);
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
        this.emit('status', 'running');
        this.log("Investigation resumed.");
    }
    abort() { this.aborted = true; this.state.status = 'aborted'; this.emit('status', 'aborted'); }
    loadSystemPrompt() {
        if ((0, fs_1.existsSync)(this.config.systemPromptPath)) {
            return (0, fs_1.readFileSync)(this.config.systemPromptPath, 'utf8');
        }
        return "You are a helpful assistant.";
    }
    log(msg) {
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
    async callLLM(system, userQuery, history, forceTool = false) {
        let currentHistory = history;
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                // Need a way to access the singleton copilot client or pass it in.
                const { CopilotClient } = require('./CopilotClient');
                const copilot = new CopilotClient();
                if (!await copilot.isAuthenticated()) {
                    return {
                        thought: "Error: Not authenticated with GitHub Copilot. Please login via the dashboard.",
                        isFinal: true
                    };
                }
                const token = await copilot.getCopilotToken();
                const OpenAI = require('openai');
                // GitHub Copilot Endpoint
                const openai = new OpenAI({
                    apiKey: token,
                    baseURL: "https://api.githubcopilot.com",
                    defaultHeaders: {
                        'Editor-Version': 'vscode/1.85.1',
                        'Editor-Plugin-Version': 'copilot/1.155.0',
                        'User-Agent': 'GithubCopilot/1.155.0'
                    }
                });
                const model = this.state.model || this.config.model || 'gpt-4o';
                this.log(`Calling LLM (${model}) [Attempt ${attempt + 1}]...`);
                let tools = [];
                try {
                    tools = await this.toolManager.listTools();
                }
                catch (e) {
                    this.log(`Warning: Failed to list tools: ${e}`);
                }
                const messages = [
                    { role: 'system', content: system },
                    { role: 'user', content: userQuery },
                    ...currentHistory.map(h => {
                        // Support explicit role in history items
                        if (h && typeof h === 'object' && h.role && h.content) {
                            return { role: h.role, content: h.content };
                        }
                        // Default to assistant for strings or other objects
                        if (typeof h === 'string')
                            return { role: 'assistant', content: h };
                        return { role: 'assistant', content: JSON.stringify(h) };
                    })
                ];
                // FIX: If the last message is from the assistant, append a user message to satisfy API requirements
                if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    messages.push({ role: 'user', content: "Proceed with the next step." });
                }
                let openAiTools = tools.map(t => {
                    // Sanitize inputSchema for strict OpenAI compatibility
                    const schema = JSON.parse(JSON.stringify(t.inputSchema)); // Deep copy
                    // Helper to remove null types from anyOf
                    const sanitizeSchema = (s) => {
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
                            s.anyOf = s.anyOf.filter((sub) => sub.type !== 'null');
                            if (s.anyOf.length === 1) {
                                // Collapse single-item anyOf
                                Object.assign(s, s.anyOf[0]);
                                delete s.anyOf;
                            }
                            else if (s.anyOf.length === 0) {
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
                let toolChoice = openAiTools ? 'auto' : undefined;
                if (forceTool) {
                    if (openAiTools) {
                        this.log("Forcing tool_choice: 'required' due to consecutive thoughts.");
                        toolChoice = 'required';
                    }
                    else {
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
                    }
                    else {
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
                    const toolCall = message.tool_calls[0];
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
            }
            catch (error) {
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
    setModel(model) {
        // Also validate if model is in allowed list? Assuming server side validation or trust for now.
        this.log(`Simulating model switch from ${this.state.model} to ${model}...`);
        this.state.model = model;
        // Should we add a system thought to record this change?
        // this.state.thoughts.push(`System: Model switched to ${model} by user.`); // Log above covers it
    }
    async summarize() {
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
            }
            else {
                this.log("History summarization failed or was unnecessary.");
                const msg = "System: Summarization was unnecessary (not enough history).";
                this.state.thoughts.push(msg);
                this.emit('thought', msg);
            }
            return success;
        }
        catch (e) {
            this.log(`Error during summarization: ${e.message}`);
            const msg = `System Error: Summarization failed - ${e.message}`;
            this.state.thoughts.push(msg);
            this.emit('thought', msg);
            throw e;
        }
    }
    async compactHistory(system, userQuery, history) {
        try {
            const copilot = new CopilotClient_1.CopilotClient();
            if (!await copilot.isAuthenticated()) {
                this.log("Cannot compact history: Copilot not authenticated.");
                return false;
            }
            const token = await copilot.getCopilotToken();
            const openai = new openai_1.default({
                apiKey: token,
                baseURL: "https://api.githubcopilot.com",
                defaultHeaders: {
                    'Editor-Version': 'vscode/1.85.1',
                    'Editor-Plugin-Version': 'copilot/1.155.0',
                    'User-Agent': 'GithubCopilot/1.155.0'
                }
            });
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
                if (typeof h === 'string')
                    return `[${i}] ${h.substring(0, 500)}`;
                if (h && h.content)
                    return `[${i}] ${String(h.content).substring(0, 500)}`;
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
            if (!summary)
                throw new Error("Empty summary returned.");
            const sysMsg = `System: Context was automatically compacted to stay within token limits. ${olderThoughts.length} older messages were summarized.`;
            // Replace thoughts with compacted version
            this.state.thoughts = [
                `System [Memory]: Previous Investigation Summary:\n${summary}`,
                sysMsg,
                ...recentThoughts
            ];
            this.emit('thought', sysMsg);
            this.log(`Compaction complete. Summarized ${olderThoughts.length} entries.`);
            return true;
        }
        catch (err) {
            this.log(`Compaction failed: ${err.message}`);
            return false;
        }
    }
    async executeAction(action) {
        this.log(`Executing tool: ${action.tool}`);
        try {
            return await this.toolManager.callTool(action.tool, action.args);
        }
        catch (e) {
            return `Error: ${e.message}`;
        }
    }
}
exports.AgentRunner = AgentRunner;
