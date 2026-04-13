import { pause, loadFixture, setDetailOverride, VITE_URL } from '../lib/helpers.js';
import { showCaption, hideCaption, injectOverlay } from '../lib/overlay.js';

const BASE_STAGES = [
    { agentId: 'builtin-planner', agentName: 'Planner', description: 'Creates a structured investigation plan before execution.', color: '#0ea5e9', icon: '📋' },
    { agentId: 'builtin-investigator', agentName: 'Investigator', description: 'Runs the main investigation loop — queries data sources, analyzes results, and builds evidence.', color: '#10b981', icon: '🤖' },
    { agentId: 'builtin-devils-advocate', agentName: "Devil's Advocate", description: 'Challenges conclusions and probes for blind spots. Searches for alternative explanations.', color: '#ef4444', icon: '😈' },
    { agentId: 'builtin-validator', agentName: 'Validator', description: 'Reviews findings for accuracy, completeness, and evidence quality.', color: '#f59e0b', icon: '🛡️' },
    { agentId: 'builtin-summarizer', agentName: 'Summarizer', description: 'Distills findings into a concise executive summary with recommendations.', color: '#14b8a6', icon: '📊' },
    { agentId: 'builtin-retrospect', agentName: 'Retrospect', description: 'Analyzes the investigation and proposes knowledge-base improvements.', color: '#8b5cf6', icon: '✨' },
];

function makeStages(statuses, retries = {}, extras = {}) {
    return BASE_STAGES.map((s, i) => ({
        ...s,
        status: statuses[i],
        retryCount: retries[i] || 0,
        startedAt: statuses[i] !== 'pending' ? 1749819800000 + i * 100000 : undefined,
        completedAt: statuses[i] === 'completed' || statuses[i] === 'rejected' ? 1749819900000 + i * 100000 : undefined,
        ...(extras[i] || {}),
    }));
}

function buildState(base, stages, currentStageIndex, overrides = {}) {
    return {
        ...base,
        ...overrides,
        pipeline: {
            ...base.pipeline,
            currentStageIndex,
            stages,
        },
    };
}

// ── Progressive Live Session messages (accumulated per state) ──
const T_PLANNER = [
    "Starting investigation into pipeline latency on `oi-tds-prd-eus2p-02`. P95 at 7.2s, max reaching 10s — planning structured KQL approach.",
];
const T_PLAN_DONE = [
    { content: "**Plan created:** 1) Query E2E pipeline latency via `[KustoMessageProcessor]`, 2) Per-service lag breakdown via `[LagMetricMessageProcessor]`, 3) Queue wait analysis, 4) High-latency message traces.", type: "thought" },
];
const T_INV = [
    "Querying `[KustoMessageProcessor]` pipeline latency traces from TraceTelemetry...",
    { content: "Pipeline latency is **stable but high** — P50 = 5,165ms, P95 = 7,226ms, Max = 9,879ms across 361K messages. Steady-state, not a spike.", type: "thought" },
    { content: "Per-service lag: **TeleductDriverService** at 1,893ms → **StreamingDriverService** at 3,879ms — a **1,986ms gap** between adjacent services.", type: "thought" },
];
const T_DA = [
    { content: "Reviewing investigator findings... The analysis covers E2E latency and per-service breakdown. Checking for blind spots.", type: "thought" },
];
const T_DA_REJECT = [
    { content: "**REJECTED** — Queue wait times never analyzed. Per-service lag not root-caused. No config regression check.", type: "thought" },
];
const T_RETRY1 = [
    "Re-running with expanded scope — adding queue wait analysis and config regression checks...",
    { content: "Queue wait: Avg = **1,886ms**, P50 = 1,868ms, P95 = 3,355ms. Accounts for most of TeleductDriverService delay.", type: "thought" },
    { content: "`PollingIntervalMs` changed from **500ms → 2,000ms** on eus2p-02 three days ago — this 4× increase directly explains the queue wait spike.", type: "thought" },
];
const T_DA_PASS = [
    { content: "✓ All gaps addressed. Queue wait analyzed, config regression identified. Evidence chain complete.", type: "thought" },
];
const T_VALIDATOR = [
    { content: "Validating evidence quality — checking data accuracy and logical consistency of the root cause claim.", type: "thought" },
];
const T_VAL_REJECT = [
    { content: "**REJECTED** — No cross-stamp comparison. Cannot confirm eus2p-02's polling is abnormal without a healthy baseline.", type: "thought" },
];
const T_RETRY2 = [
    "Adding cross-stamp comparison — querying eus2p-01 as healthy baseline...",
    { content: "**eus2p-01:** PollingIntervalMs = 500ms, P95 = 1,850ms. **eus2p-02:** 2,000ms / 7,226ms. The 4× polling difference correlates with 3.9× latency difference.", type: "thought" },
];
const T_DA_PASS2 = [
    { content: "✓ Cross-stamp evidence is compelling. Investigation is thorough.", type: "thought" },
];
const T_VAL_PASS = [
    { content: "✓ Evidence validated. Cross-stamp comparison confirms polling interval regression as root cause.", type: "thought" },
];
const T_SUMMARIZER = [
    { content: "Distilling findings into executive summary with root cause, impact, and remediation...", type: "thought" },
    { content: "**Root Cause:** `PollingIntervalMs` 500ms → 2,000ms on eus2p-02 (3 days ago). **Impact:** P95 latency 1.8s → 7.2s. **Fix:** Revert config + add guardrails.", type: "thought" },
];
const T_RETRO = [
    { content: "Analyzing investigation process for knowledge-base improvements...", type: "thought" },
    { content: "Proposing KB update: Add `PollingIntervalMs` to config regression checklist. Flag polling changes > 2× as high-risk.", type: "thought" },
];
const T_COMPLETE = [
    { content: "✅ Investigation complete. Root cause identified, cross-validated, and documented.", type: "thought" },
];
const th = (...arrs) => arrs.flat();

async function swapState(page, id, state) {
    await setDetailOverride(id, state);
    // Soft-refetch: trigger the frontend's visibilitychange listener
    // which calls fetchInvestigation() — no page reload needed.
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
    });
    // Wait for the React re-render to settle
    await pause(1.2);
}

async function hoverAgent(page, agentName) {
    const stageNode = page.locator(`.cursor-pointer:has(span:text-is("${agentName}"))`).first();
    await stageNode.hover();
    await pause(0.8);
}

export default async function scenePipelineWalkthrough(page) {
    const base = loadFixture('investigation-pipeline-walkthrough.json');
    const id = base.id;

    // ── State 1: Planner running ──
    const state1 = buildState(base,
        makeStages(['running', 'pending', 'pending', 'pending', 'pending', 'pending']),
        0,
        { thoughts: th(T_PLANNER) }
    );
    await setDetailOverride(id, state1);

    // Navigate to the investigation page (anti-flash CSS hides content during load).
    // The preview script already set up a clean dark frame + overlay,
    // so the video looks clean while Vite loads behind the scenes.
    await page.goto(`${VITE_URL}/investigation/${id}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await page.waitForSelector('.rounded-full.border-2', { timeout: 8000 }).catch(() => {});
    await pause(0.3);

    // Re-inject overlay after navigation (previous one was destroyed by goto).
    // This reveals #root and removes anti-flash CSS.
    await injectOverlay(page);
    await pause(0.5);
    await hoverAgent(page, 'Planner');
    await showCaption(page, 'Planner Agent', 'The Planner breaks down the investigation into a structured plan, defining what data to query and which metrics to analyze.');
    await pause(6.5);
    await hideCaption(page);

    // ── State 2: Planner done, Investigator running ──
    const state2 = buildState(base,
        makeStages(['completed', 'running', 'pending', 'pending', 'pending', 'pending']),
        1,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV) }
    );
    await swapState(page, id, state2);
    await hoverAgent(page, 'Investigator');
    await showCaption(page, 'Investigator Agent', 'The Investigator executes the plan autonomously, querying data sources, running KQL queries, and building evidence for root cause.');
    await pause(7.5);
    await hideCaption(page);

    // ── State 3: Investigator done, Devil's Advocate running ──
    const state3 = buildState(base,
        makeStages(['completed', 'completed', 'running', 'pending', 'pending', 'pending']),
        2,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA) }
    );
    await swapState(page, id, state3);
    await hoverAgent(page, "Devil's Advocate");
    await showCaption(page, "Devil's Advocate", 'Now comes the adversarial review. The Devil\'s Advocate challenges every finding and searches for blind spots.');
    await pause(6.5);
    await hideCaption(page);

    // ── State 4: DA REJECTS → Investigator re-running (retry 1) ──
    // First show the rejection on the DA
    const state4a = buildState(base,
        makeStages(
            ['completed', 'running', 'rejected', 'pending', 'pending', 'pending'],
            { 1: 1 },
            { 2: { verdict: 'Rejected — incomplete queue wait analysis', feedback: 'Queue wait times not analyzed. Per-service lag metrics skipped. Config regression not checked.' } }
        ),
        1,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT) }
    );
    await swapState(page, id, state4a);
    await hoverAgent(page, "Devil's Advocate");
    await showCaption(page, 'Investigation Rejected', "The Devil's Advocate found critical blind spots, queue wait times were never analyzed, and config changes weren't checked.");
    await pause(6);
    await hideCaption(page);
    await pause(0.5);

    // Then show the Investigator re-running
    await hoverAgent(page, 'Investigator');
    await showCaption(page, 'Re-investigation', 'The Investigator automatically re-runs with expanded scope, now including queue wait analysis and config regression checks.');
    await pause(6.5);
    await hideCaption(page);

    // ── State 5: Investigator done (retry 1), DA running again ──
    const state5 = buildState(base,
        makeStages(
            ['completed', 'completed', 'running', 'pending', 'pending', 'pending'],
            { 1: 1 }
        ),
        2,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1) }
    );
    await swapState(page, id, state5);
    await hoverAgent(page, "Devil's Advocate");
    await showCaption(page, 'Second Review', "The Investigator addressed all feedback. The Devil's Advocate reviews the expanded analysis.");
    await pause(5);
    await hideCaption(page);

    // ── State 6: DA satisfied, Validator running ──
    const state6 = buildState(base,
        makeStages(
            ['completed', 'completed', 'completed', 'running', 'pending', 'pending'],
            { 1: 1 }
        ),
        3,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR) }
    );
    await swapState(page, id, state6);
    await hoverAgent(page, 'Validator');
    await showCaption(page, 'Validator Agent', "The Devil's Advocate is satisfied. Now the Validator checks evidence quality, data accuracy, and logical consistency.");
    await pause(6.5);
    await hideCaption(page);

    // ── State 7: Validator REJECTS → Investigator re-running (retry 2) ──
    // Show the Validator rejection
    const state7a = buildState(base,
        makeStages(
            ['completed', 'running', 'completed', 'rejected', 'pending', 'pending'],
            { 1: 2 },
            { 3: { verdict: 'Rejected — cross-stamp comparison missing', feedback: 'No comparison with healthy stamps to confirm the polling interval is the actual cause.' } }
        ),
        1,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR, T_VAL_REJECT) }
    );
    await swapState(page, id, state7a);
    await hoverAgent(page, 'Validator');
    await showCaption(page, 'Validator Rejection', "The Validator needs cross-stamp comparison data. How do we know eus2p-02's polling interval is abnormal without comparing to eus2p-01?");
    await pause(8.5);
    await hideCaption(page);
    await pause(0.5);

    // Show Investigator re-running
    await hoverAgent(page, 'Investigator');
    await showCaption(page, 'Third Investigation Pass', 'The Investigator now adds cross-stamp comparison, querying eus2p-01 as a healthy baseline.');
    await pause(6);
    await hideCaption(page);

    // ── State 8: Investigator done (retry 2), DA running, quick pass ──
    const state8 = buildState(base,
        makeStages(
            ['completed', 'completed', 'running', 'completed', 'pending', 'pending'],
            { 1: 2 }
        ),
        2,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR, T_VAL_REJECT, T_RETRY2) }
    );
    await swapState(page, id, state8);
    await showCaption(page, 'Final Review Cycle', "Third pass through the review agents. Devil's Advocate and Validator will both need to approve.");
    await pause(5);
    await hideCaption(page);

    // ── State 9: DA passes, Validator passes, Summarizer running ──
    const state9 = buildState(base,
        makeStages(
            ['completed', 'completed', 'completed', 'completed', 'running', 'pending'],
            { 1: 2 }
        ),
        4,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR, T_VAL_REJECT, T_RETRY2, T_DA_PASS2, T_VAL_PASS, T_SUMMARIZER) }
    );
    await swapState(page, id, state9);
    await hoverAgent(page, 'Summarizer');
    await showCaption(page, 'All Reviews Passed', "Both the Devil's Advocate and Validator approved. The Summarizer now creates the executive report.");
    await pause(5);
    await hideCaption(page);

    // ── State 10: Summarizer done, Retrospect running ──
    const state10 = buildState(base,
        makeStages(
            ['completed', 'completed', 'completed', 'completed', 'completed', 'running'],
            { 1: 2 }
        ),
        5,
        { thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR, T_VAL_REJECT, T_RETRY2, T_DA_PASS2, T_VAL_PASS, T_SUMMARIZER, T_RETRO) }
    );
    await swapState(page, id, state10);
    await hoverAgent(page, 'Retrospect');
    await showCaption(page, 'Retrospect Agent', "The final agent analyzes what worked and what didn't. Proposing improvements to the knowledge base for future investigations.");
    await pause(6);
    await hideCaption(page);

    // ── State 11: All completed ──
    const FINAL_REPORT = `## Root Cause Analysis: Pipeline Latency on oi-tds-prd-eus2p-02

### Executive Summary
The P95 pipeline latency on **oi-tds-prd-eus2p-02** reached **7,226ms** (max 9,879ms), significantly exceeding the 2,000ms SLA. Root cause: a configuration change 3 days ago increased \`PollingIntervalMs\` from **500ms to 2,000ms**.

### Key Findings
| Metric | eus2p-02 (affected) | eus2p-01 (healthy) |
|--------|--------------------|--------------------|
| PollingIntervalMs | 2,000ms | 500ms |
| P95 Latency | 7,226ms | 1,850ms |
| Queue Wait (avg) | 1,886ms | 423ms |

### Root Cause
A config deployment on **April 10** changed \`PollingIntervalMs\` from 500ms → 2,000ms on eus2p-02 only. This 4× increase in polling interval directly correlates with the 3.9× increase in E2E latency.

### Recommendations
1. **Immediate**: Revert \`PollingIntervalMs\` to 500ms on eus2p-02
2. **Short-term**: Add config drift alerting across stamps
3. **Long-term**: Implement guardrails to flag polling changes > 2×`;

    const RETROSPECT_DATA = {
        messages: [
            { role: 'assistant', content: 'Analyzing investigation process for knowledge-base improvements...' },
            { role: 'tool-call', content: 'Reading current config-regression checklist...', toolName: 'readFile' },
            { role: 'tool-result', content: 'File: kb/checklists/config-regression.md\n\nCurrent checklist has 12 items. No polling-related checks found.', toolName: 'readFile' },
            { role: 'assistant', content: '**Finding:** The config regression checklist lacks polling interval checks. This investigation required 3 passes because the initial scope missed queue wait analysis and cross-stamp comparison.\n\n**Proposed improvements:**\n1. Add `PollingIntervalMs` to config regression checklist\n2. Flag any polling config change > 2× as high-risk\n3. Always include cross-stamp comparison for latency investigations' },
        ],
        proposals: [
            {
                id: 'retro-1',
                type: 'edit',
                filePath: 'kb/checklists/config-regression.md',
                description: 'Add polling interval checks to config regression checklist',
                content: '## Polling Configuration\n- [ ] Check `PollingIntervalMs` — flag changes > 2× as high-risk\n- [ ] Compare polling config across stamps for drift\n- [ ] Verify queue wait times correlate with polling interval',
                status: 'pending',
                source: 'retrospect',
            },
        ],
        analysisComplete: true,
        completed: true,
    };

    const state11 = buildState(base,
        makeStages(
            ['completed', 'completed', 'completed', 'completed', 'completed', 'completed'],
            { 1: 2 }
        ),
        5,
        {
            status: 'completed',
            finalReport: FINAL_REPORT,
            retrospect: RETROSPECT_DATA,
            thoughts: th(T_PLANNER, T_PLAN_DONE, T_INV, T_DA, T_DA_REJECT, T_RETRY1, T_DA_PASS, T_VALIDATOR, T_VAL_REJECT, T_RETRY2, T_DA_PASS2, T_VAL_PASS, T_SUMMARIZER, T_RETRO, T_COMPLETE),
        }
    );
    await swapState(page, id, state11);
    await showCaption(page, 'Investigation Complete', 'Six agents, three review cycles, zero blind spots. Every finding has been challenged, validated, and summarized.');
    await pause(7.5);
    await hideCaption(page);
}
