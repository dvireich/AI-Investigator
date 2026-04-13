/**
 * Scene 5: Retrospect — Knowledge Improvement
 *
 * Shows the Retrospect tab with completed analysis (agent messages, proposals),
 * then re-initiates the analysis to demonstrate the agent reading KB files
 * one by one and generating improvement proposals.
 */

import {
    pause, loadFixture, setDetailOverride,
    setAnalyzeHang, broadcastMessage, VITE_URL,
} from '../lib/helpers.js';
import {
    showCaption, hideCaption,
    injectOverlay,
    showCursor, hideCursor,
    cursorClick, cursorMoveTo,
} from '../lib/overlay.js';

// ── Knowledge-base file-reading messages for the re-run animation ──

const KB_FILE_READS = [
    {
        activity: 'Reading file: kb/checklists/config-regression.md',
        toolCall: { role: 'tool-call', toolName: 'read_file', content: 'Reading checklist: kb/checklists/config-regression.md' },
        toolResult: { role: 'tool-result', toolName: 'read_file', content: 'File: kb/checklists/config-regression.md — 12 items covering config change validation, rollback procedures, and diff analysis. No polling-specific checks found.' },
    },
    {
        activity: 'Reading file: kb/runbooks/latency-investigation.md',
        toolCall: { role: 'tool-call', toolName: 'read_file', content: 'Reading runbook: kb/runbooks/latency-investigation.md' },
        toolResult: { role: 'tool-result', toolName: 'read_file', content: 'File: kb/runbooks/latency-investigation.md — 8-step runbook for latency triage and bottleneck identification. Missing cross-stamp comparison step.' },
    },
    {
        activity: 'Searching: "polling interval" across knowledge base',
        toolCall: { role: 'tool-call', toolName: 'grep_search', content: 'Searching knowledge base for "polling interval" references' },
        toolResult: { role: 'tool-result', toolName: 'grep_search', content: '3 matches found:\n  kb/checklists/config-regression.md:8\n  kb/runbooks/latency-investigation.md:23\n  kb/patterns/config-drift.md:15' },
    },
    {
        activity: 'Reading file: kb/patterns/config-drift.md',
        toolCall: { role: 'tool-call', toolName: 'read_file', content: 'Reading pattern: kb/patterns/config-drift.md' },
        toolResult: { role: 'tool-result', toolName: 'read_file', content: 'File: kb/patterns/config-drift.md — Pattern for detecting configuration drift across stamps. Does not cover polling interval validation.' },
    },
    {
        activity: 'Reading file: kb/checklists/queue-health.md',
        toolCall: { role: 'tool-call', toolName: 'read_file', content: 'Reading checklist: kb/checklists/queue-health.md' },
        toolResult: { role: 'tool-result', toolName: 'read_file', content: 'File: kb/checklists/queue-health.md — 9 items covering queue depth, consumer lag, and DLQ monitoring. No polling frequency checks.' },
    },
];

const FINAL_ASSISTANT_MSG = {
    role: 'assistant',
    content: '**Analysis complete.** Found 3 knowledge base improvements:\n\n1. **config-regression.md** — Add `PollingIntervalMs` validation: flag changes exceeding 2× baseline as high-risk\n2. **queue-health.md** — Add queue polling frequency monitoring to the health checklist\n3. **latency-investigation.md** — Add cross-stamp configuration comparison as a required step',
};

const NEW_PROPOSALS = [
    {
        id: 'retro-new-1', type: 'edit',
        filePath: 'kb/checklists/config-regression.md',
        description: 'Add polling interval checks — flag changes > 2× baseline as high-risk',
        content: '## Config Regression Checklist\n\n- [ ] Verify config diff between healthy and unhealthy stamps\n- [ ] Check for recent config deployments in the affected time window\n- [ ] Review setting change history in Service Fabric\n- [ ] **Check PollingIntervalMs** — flag changes > 2× baseline as high-risk\n- [ ] Compare polling config across stamps for drift\n- [ ] Validate config values against baseline',
        originalContent: '## Config Regression Checklist\n\n- [ ] Verify config diff between healthy and unhealthy stamps\n- [ ] Check for recent config deployments in the affected time window\n- [ ] Review setting change history in Service Fabric\n- [ ] Validate config values against baseline',
        status: 'pending', source: 'retrospect',
    },
    {
        id: 'retro-new-2', type: 'edit',
        filePath: 'kb/checklists/queue-health.md',
        description: 'Add queue polling frequency monitoring to the health checklist',
        content: '## Queue Health Checklist\n\n- [ ] Check queue depth trends over the past hour\n- [ ] Verify consumer lag is within SLO thresholds\n- [ ] Monitor DLQ growth rate\n- [ ] **Check polling frequency** — verify PollingIntervalMs matches baseline\n- [ ] Compare polling config across stamps for drift\n- [ ] Review queue throughput vs capacity ratio',
        originalContent: '## Queue Health Checklist\n\n- [ ] Check queue depth trends over the past hour\n- [ ] Verify consumer lag is within SLO thresholds\n- [ ] Monitor DLQ growth rate\n- [ ] Review queue throughput vs capacity ratio',
        status: 'pending', source: 'retrospect',
    },
    {
        id: 'retro-new-3', type: 'edit',
        filePath: 'kb/runbooks/latency-investigation.md',
        description: 'Add cross-stamp configuration comparison step to latency runbook',
        content: '## Latency Investigation Runbook\n\n1. Identify the bottleneck service using latency waterfall\n2. Check queue polling intervals on affected stamp\n3. **Compare configuration across stamps** — run cross-stamp diff to detect config drift\n4. Analyze queue wait times per hop\n5. Review recent config deployments',
        originalContent: '## Latency Investigation Runbook\n\n1. Identify the bottleneck service using latency waterfall\n2. Check queue polling intervals on affected stamp\n3. Analyze queue wait times per hop\n4. Review recent config deployments',
        status: 'pending', source: 'retrospect',
    },
];

// ── Scroll helper for the messages container ──

const MSG_SCROLL_SEL = '.space-y-4.overflow-y-auto, .overflow-y-auto.p-4';
const scrollMessages = (page, px) => page.evaluate(({ sel, px }) => {
    // Find the messages scroll container (inside the left chat panel)
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight) {
            el.scrollBy({ top: px, behavior: 'smooth' });
            return;
        }
    }
}, { sel: MSG_SCROLL_SEL, px });

// Scroll messages to bottom
const scrollMessagesToBottom = (page) => page.evaluate(({ sel }) => {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            return;
        }
    }
}, { sel: MSG_SCROLL_SEL });


export default async function sceneRetrospect(page) {
    const base = loadFixture('investigation-retrospect.json');
    const id = base.id;

    // Use the fixture as-is — it has rich retrospect data:
    // 8 messages (assistant, tool-call×4, tool-result×3, assistant)
    // 4 proposals (pending×2, approved, rejected)
    // analysisComplete: true, completed: false
    const inv = { ...base };

    await setDetailOverride(id, inv);

    // Navigate to the investigation page
    await page.goto(`${VITE_URL}/investigation/${id}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await page.waitForSelector('.rounded-full.border-2', { timeout: 8000 }).catch(() => {});
    await pause(0.3);
    await injectOverlay(page);
    await pause(0.5);

    // ════════════════════════════════════════════════════
    //  Part 1: View Completed Retrospect
    // ════════════════════════════════════════════════════

    await showCaption(page, 'Retrospect — Knowledge Improvement',
        'After an investigation completes, the Retrospect agent analyzes the process and proposes improvements to the knowledge base.');
    await showCursor(page);
    await pause(2);

    // Click the Retrospect tab
    const retroTab = page.locator('button:has-text("Retrospect")').first();
    await cursorClick(page, retroTab);
    await pause(2);

    // Wait for retrospect content to render
    await page.waitForSelector('text=Knowledge Improvement', { timeout: 5000 }).catch(() => {});
    await pause(1.5);

    await showCaption(page, 'Agent Activity Log',
        'Every step the agent took is logged, reading files, searching patterns, and analyzing gaps in the existing knowledge base.');
    await pause(4);

    // Scroll down through messages to show the agent's work
    for (let i = 0; i < 4; i++) {
        await scrollMessages(page, 180);
        await pause(1);
    }
    await pause(1);

    // ── Show proposals panel ──
    await showCaption(page, 'Proposed Changes',
        'The agent proposes specific file edits. Each shows the file path, a description, and a diff preview of the changes.');
    await pause(5);

    // Expand the first proposal to show the diff
    const proposalItems = page.locator('span.font-mono.text-slate-400').first();
    if (await proposalItems.isVisible().catch(() => false)) {
        await cursorClick(page, proposalItems);
        await pause(2.5);
    }

    await showCaption(page, 'Diff Preview',
        'Green lines show additions, red lines show removals. Reviewers can approve or reject each change individually.');
    await pause(7);

    // ════════════════════════════════════════════════════
    //  Part 2: Re-run the Analysis
    // ════════════════════════════════════════════════════

    await showCaption(page, 'Re-run Analysis',
        'Let\'s re-initiate the analysis. The agent will reread all knowledge base files and look for new improvement opportunities.');
    await pause(3);

    // Step 1: Set analyzeHang BEFORE triggering re-analysis
    // This makes the POST /analyze hang so isAnalyzing stays true
    await setAnalyzeHang(true);

    // Step 2: Update fixture — set analysisComplete=false to trigger auto-analysis
    // Clear the proposals and messages for a fresh re-run
    const rerunState = {
        ...inv,
        retrospect: {
            messages: [
                { role: 'assistant', content: 'Re-analyzing investigation process against knowledge base...' },
            ],
            proposals: [],
            analysisComplete: false,
            completed: false,
        },
    };
    await setDetailOverride(id, rerunState);

    // Step 3: Click "Re-run Analysis" button
    const rerunBtn = page.locator('button:has-text("Re-run Analysis")').first();
    if (await rerunBtn.isVisible().catch(() => false)) {
        await cursorClick(page, rerunBtn);
        await pause(1);
    }

    // Step 4: Broadcast retrospect update to trigger refetch → auto-trigger fires
    await broadcastMessage({ type: 'retrospect', data: {} });
    await pause(2);

    // Wait for bouncing dots / thinking indicator to appear
    await page.waitForSelector('.animate-bounce', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page, 'Reading Knowledge Base',
        'The agent iterates through knowledge base files, checklists, runbooks, and patterns, comparing each against the investigation findings.');
    await pause(2);

    // ── Simulate file-by-file reading ──
    let accumulatedMessages = [
        { role: 'assistant', content: 'Re-analyzing investigation process against knowledge base...' },
    ];

    for (let i = 0; i < 3; i++) {
        const step = KB_FILE_READS[i];

        // Show tool activity (the "Reading file: xxx" text below bouncing dots)
        await broadcastMessage({
            type: 'retrospect-tool-activity',
            data: { description: step.activity },
        });
        await pause(1.2);

        // Add tool-call message to accumulated list
        accumulatedMessages.push(step.toolCall);
        const stateWithCall = {
            ...inv,
            retrospect: {
                messages: [...accumulatedMessages],
                proposals: [],
                analysisComplete: false,
                completed: false,
            },
        };
        await setDetailOverride(id, stateWithCall);
        await broadcastMessage({ type: 'retrospect', data: {} });
        await pause(0.5);

        // Add tool-result message
        accumulatedMessages.push(step.toolResult);
        const stateWithResult = {
            ...inv,
            retrospect: {
                messages: [...accumulatedMessages],
                proposals: [],
                analysisComplete: false,
                completed: false,
            },
        };
        await setDetailOverride(id, stateWithResult);
        await broadcastMessage({ type: 'retrospect', data: {} });
        await pause(0.3);

        // Scroll to bottom to keep new messages visible
        await scrollMessagesToBottom(page);
        await pause(0.2);
    }

    // ── Analysis complete: add final assistant message + proposals ──
    await showCaption(page, 'Generating Improvements',
        'Based on the investigation findings, the agent identifies gaps and proposes targeted changes to prevent similar issues.');
    await pause(2);

    accumulatedMessages.push(FINAL_ASSISTANT_MSG);
    const completedState = {
        ...inv,
        retrospect: {
            messages: [...accumulatedMessages],
            proposals: NEW_PROPOSALS,
            analysisComplete: true,
            completed: false,
        },
    };
    await setDetailOverride(id, completedState);

    // Clear hang and broadcast completion
    await setAnalyzeHang(false);
    await broadcastMessage({ type: 'retrospect', data: {} });
    await pause(2);

    // Scroll to bottom to see the final message
    await scrollMessagesToBottom(page);
    await pause(2);

    // Wait for the "Analysis finished" indicator
    await page.waitForSelector('text=/Analysis finished/', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page, 'Analysis Complete',
        'Three new improvements proposed, each targets a specific knowledge base file with concrete changes.');
    await pause(4);

    // ════════════════════════════════════════════════════
    //  Part 3: Review & Approve Proposals
    // ════════════════════════════════════════════════════

    // Click first proposal to expand it
    const newProposal = page.locator('span.font-mono.text-slate-400').first();
    if (await newProposal.isVisible().catch(() => false)) {
        await cursorClick(page, newProposal);
        await pause(2);
    }

    await showCaption(page, 'Review & Approve',
        'Each proposal can be individually approved or rejected, then applied with one click to update the knowledge base files.');
    await pause(3);

    // Click Approve on the first proposal
    const approveBtn = page.locator('button:has-text("Approve")').first();
    if (await approveBtn.isVisible().catch(() => false)) {
        await cursorClick(page, approveBtn);
        await pause(1);

        // Update fixture to reflect approval
        const approvedProposals = [...NEW_PROPOSALS];
        approvedProposals[0] = { ...approvedProposals[0], status: 'approved' };
        const approvedState = {
            ...inv,
            retrospect: {
                ...completedState.retrospect,
                proposals: approvedProposals,
            },
        };
        await setDetailOverride(id, approvedState);
        await broadcastMessage({ type: 'retrospect', data: {} });
        await pause(2);
    }

    // Show the Apply button
    const applyBtn = page.locator('button:has-text("Apply")').first();
    if (await applyBtn.isVisible().catch(() => false)) {
        await cursorMoveTo(page, applyBtn);
        await pause(1);
    }

    await showCaption(page, 'Apply to Knowledge Base',
        'Click Apply to write the approved changes directly to the knowledge base. The next investigation will automatically benefit from these improvements.');
    await pause(7);

    await showCaption(page, 'Continuous Improvement',
        'Every investigation makes the agent smarter. Each retrospective adds knowledge, refines checklists, and sharpens future investigations. A positive improvement loop, forever.');
    await pause(9.5);

    await hideCaption(page);
    await hideCursor(page);
    await pause(0.5);
}
