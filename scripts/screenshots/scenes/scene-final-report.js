/**
 * Scene 4: Final Report, Implement Recommendations & Notes
 *
 * Picks up from the completed investigation (end of Scene 3).
 * Shows the Final Report tab, scrolls through findings,
 * demonstrates the Implement Recommendations modal,
 * then switches to Notes and writes personal notes.
 */

import { pause, loadFixture, setDetailOverride, VITE_URL } from '../lib/helpers.js';
import {
    showCaption, hideCaption,
    injectOverlay,
    showCursor, hideCursor,
    cursorClick, cursorMoveTo, cursorType,
} from '../lib/overlay.js';

// ── Build the completed state with finalReport + retrospect ──

const FINAL_REPORT = `# Pipeline Latency Investigation — oi-tds-prd-eus2p-02

## Summary

Pipeline latency on \`oi-tds-prd-eus2p-02\` is dominated by **two Azure Storage queue polling cycles** that consume **76% of total end-to-end latency**. P50 = 5,165ms, P95 = 7,226ms, Max = 9,879ms across 361K+ messages.

## Root Cause

Messages spend most of their pipeline lifetime **waiting in queues to be polled**, not being processed. Two queue hops introduce a combined **3,476ms average wait**:

| Queue | Avg Wait | P50 | P95 | % of Total |
|---|---|---|---|---|
| GDS Queue → TeleductDriver | 1,886ms | 1,868ms | 3,355ms | 37% |
| Streaming Queue → StreamingDriver | 1,590ms | 1,478ms | 3,108ms | 31% |
| **Combined Queue Wait** | **3,476ms** | | | **68%** |

### Complete Latency Waterfall

\`\`\`
0s        1s        2s        3s        4s        5s
|---------|---------|---------|---------|---------| 
[===GDS Queue Wait===]                                 ~1,886ms (37%)
                     [=TeleductDriver=]                ~750ms (15%)
                              [==Streaming Queue==]    ~1,590ms (31%)
                                        [Services]    ~914ms (17%)
                                                      ══════════
                                                      ~5,140ms total
\`\`\`

## Per-Service Breakdown

| # | Service | Cumulative Lag | Incremental | % |
|---|---|---|---|---|
| 1 | TeleductDriverService | 1,893ms | 1,893ms | 37% |
| 2 | StreamingDriverService | 3,879ms | 1,986ms | 39% |
| 3 | DestinationResolverService | 3,888ms | 9ms | <1% |
| 4 | TransformationService | 3,960ms | 72ms | 1% |
| 5 | TableAggregationService | 4,196ms | 236ms | 5% |
| 6 | KustoIngestionService | 4,929ms | 733ms | 14% |

## Evidence

### Query: Pipeline Latency Distribution
\`\`\`kql
TraceTelemetry
| where ApplicationName contains 'oi-tds-prd-eus2p-02'
| where message startswith '[KustoMessageProcessor] The pipeline latency'
| parse message with * 'PipelineLatencyMs:' latencyMs:real ','
| summarize Avg=avg(latencyMs), P50=percentile(latencyMs,50),
    P95=percentile(latencyMs,95), Max=max(latencyMs), Count=count()
\`\`\`

### Query: GDS Queue Wait Time
\`\`\`kql
EventTelemetry
| where ApplicationName contains 'oi-tds-prd-eus2p-02'
| where name == 'GdsMessageTrackingEvent'
| extend QueueWaitMs = datetime_diff('millisecond',
    todatetime(QueueDequeueTime), todatetime(QueueEnqueueTime))
| summarize Avg=avg(QueueWaitMs), P50=percentile(QueueWaitMs,50),
    P95=percentile(QueueWaitMs,95), Count=count()
\`\`\`

## Recommendations

1. **P0 — Reduce GDS Queue Polling Interval** \`[code]\`: Change from ~2s to 500ms. Expected savings: ~900ms avg per message
2. **P1 — Reduce Streaming Queue Polling Interval** \`[code]\`: Change from ~1.5s to 500ms. Expected savings: ~700ms avg per message
3. **P2 — Reduce Table Aggregation Batching Window** \`[code]\`: Reduce batching window from 500ms to 200ms. Expected savings: ~200ms avg
4. **Monitoring**: Add queue wait time alerting when P50 exceeds 1s on either queue hop`;

const RETROSPECT_DATA = {
    messages: [
        { role: 'assistant', content: 'Analyzing investigation process for knowledge-base improvements...' },
        { role: 'tool-call', content: 'Reading current config-regression checklist...', toolName: 'readFile' },
        { role: 'tool-result', content: 'File: kb/checklists/config-regression.md — 12 items, no polling-related checks.', toolName: 'readFile' },
        { role: 'assistant', content: '**Proposed improvements:**\n1. Add `PollingIntervalMs` to config regression checklist\n2. Flag polling config changes > 2× as high-risk\n3. Always include cross-stamp comparison for latency investigations' },
    ],
    proposals: [
        {
            id: 'retro-1', type: 'edit',
            filePath: 'kb/checklists/config-regression.md',
            description: 'Add polling interval checks to config regression checklist',
            content: '## Polling Configuration\n- [ ] Check PollingIntervalMs — flag changes > 2× as high-risk\n- [ ] Compare polling config across stamps for drift',
            status: 'pending', source: 'retrospect',
        },
    ],
    analysisComplete: true,
    completed: true,
};

const BASE_STAGES = [
    { agentId: 'builtin-planner', agentName: 'Planner', description: 'Creates a structured investigation plan.', color: '#0ea5e9', icon: '📋', status: 'completed', retryCount: 0, startedAt: 1749819800000, completedAt: 1749819900000 },
    { agentId: 'builtin-investigator', agentName: 'Investigator', description: 'Runs the main investigation loop.', color: '#10b981', icon: '🤖', status: 'completed', retryCount: 2, startedAt: 1749819900000, completedAt: 1749820100000 },
    { agentId: 'builtin-devils-advocate', agentName: "Devil's Advocate", description: 'Challenges conclusions.', color: '#ef4444', icon: '😈', status: 'completed', retryCount: 0, startedAt: 1749820100000, completedAt: 1749820200000 },
    { agentId: 'builtin-validator', agentName: 'Validator', description: 'Reviews findings for accuracy.', color: '#f59e0b', icon: '🛡️', status: 'completed', retryCount: 0, startedAt: 1749820200000, completedAt: 1749820300000 },
    { agentId: 'builtin-summarizer', agentName: 'Summarizer', description: 'Creates executive summary.', color: '#14b8a6', icon: '📊', status: 'completed', retryCount: 0, startedAt: 1749820300000, completedAt: 1749820400000 },
    { agentId: 'builtin-retrospect', agentName: 'Retrospect', description: 'Proposes knowledge-base improvements.', color: '#8b5cf6', icon: '✨', status: 'completed', retryCount: 0, startedAt: 1749820400000, completedAt: 1749820500000 },
];

export default async function sceneFinalReport(page) {
    const base = loadFixture('investigation-pipeline-walkthrough.json');
    const id = base.id;

    // Set the investigation to completed state with full report + retrospect
    const completedState = {
        ...base,
        status: 'completed',
        finalReport: FINAL_REPORT,
        retrospect: RETROSPECT_DATA,
        contestCount: 0,
        pipeline: {
            ...base.pipeline,
            currentStageIndex: 5,
            stages: BASE_STAGES,
        },
        thoughts: [
            "Starting investigation into pipeline latency on `oi-tds-prd-eus2p-02`.",
            { content: "**Root Cause:** `PollingIntervalMs` 500ms → 2,000ms on eus2p-02. **Impact:** P95 latency 1.8s → 7.2s. **Fix:** Revert config + add guardrails.", type: "thought" },
            { content: "✅ Investigation complete. Root cause identified, cross-validated, and documented.", type: "thought" },
        ],
    };
    await setDetailOverride(id, completedState);

    // Navigate to the investigation page
    await page.goto(`${VITE_URL}/investigation/${id}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await page.waitForSelector('.rounded-full.border-2', { timeout: 8000 }).catch(() => {});
    await pause(0.3);
    await injectOverlay(page);
    await pause(0.5);

    // ── Timing instrumentation (SRT sync) ──
    const _t0 = Date.now();
    const _SRT = [0, 6960, 15040, 23040, 34000, 49980, 58380, 65680, 72480, 78240];
    let _ci = 0;
    const _logT = (label) => { const a = Date.now() - _t0; const t = _SRT[_ci]; console.log(`  TIMING caption ${_ci+1} "${label}" at ${a}ms (target: ${t}ms, diff: ${a-t > 0 ? '+' : ''}${a-t}ms)`); _ci++; };

    // ════════════════════════════════════════════════════
    //  Part 1: Final Report
    // ════════════════════════════════════════════════════

    _logT('Final Report');
    await showCaption(page, 'Final Report', 'The investigation is complete \u2014 let\'s review the generated report with root cause analysis and recommendations');
    await showCursor(page);
    await pause(2);

    // Click the Final Report tab
    const reportTab = page.locator('button:has-text("Final Report")').first();
    await cursorClick(page, reportTab);
    await pause(2.8);

    // Wait for report content to render
    await page.waitForSelector('h1:has-text("Investigation Report")', { timeout: 5000 }).catch(() => {});
    await pause(1);

    // ── Scroll through the report ──
    // The report lives inside an overflow-y-auto container (not the page body),
    // so page.mouse.wheel() won't work. Scroll the inner container directly.
    const SCROLL_SEL = '.overflow-y-auto.bg-slate-950';
    const scrollReport = (px) => page.evaluate(({ sel, px }) => {
        const el = document.querySelector(sel);
        if (el) el.scrollBy({ top: px, behavior: 'smooth' });
    }, { sel: SCROLL_SEL, px });

    _logT('Root Cause Analysis');
    await showCaption(page, 'Root Cause Analysis', 'The report identifies queue polling delays as the root cause \u2014 two queue hops consume 76% of total latency');
    await pause(4.0);

    // Slow scroll through the report to show content
    for (let i = 0; i < 5; i++) {
        await scrollReport(220);
        await pause(0.8);
    }

    _logT('Evidence & Queries');
    await showCaption(page, 'Evidence & Queries', 'Every finding is backed by specific KQL queries \u2014 the exact queries the agents ran are included for reproducibility');
    await pause(3.95);

    // Continue scrolling
    for (let i = 0; i < 5; i++) {
        await scrollReport(220);
        await pause(0.8);
    }

    _logT('Actionable Recommendations');
    await showCaption(page, 'Actionable Recommendations', 'The report includes prioritized recommendations \u2014 P0 through P2 \u2014 with specific code changes and expected impact');
    await pause(3.3);

    // Scroll to reveal the action buttons at the bottom
    for (let i = 0; i < 3; i++) {
        await scrollReport(250);
        await pause(0.6);
    }
    await pause(0.5);

    // ── Temporarily hide the caption bar so the action buttons are visible ──
    // The caption bar (120px) overlaps the bottom of the report panel.
    await hideCaption(page);
    await page.evaluate(() => {
        const bar = document.getElementById('demo-caption-bar');
        if (bar) { bar.style.transition = 'height 0.4s ease, opacity 0.4s ease'; bar.style.height = '0px'; bar.style.opacity = '0'; }
        const root = document.getElementById('root');
        if (root) { root.style.transition = 'max-height 0.4s ease'; root.style.maxHeight = '100vh'; }
    });
    await pause(0.5);

    // Scroll a bit more to make sure buttons are in view
    await scrollReport(300);
    await pause(0.8);

    // ── Contest Report ──
    const contestBtn = page.locator('button:has-text("Contest Report")').first();
    if (await contestBtn.isVisible().catch(() => false)) {
        await cursorMoveTo(page, contestBtn);
        await pause(1);

        // Click to open the inline contest form
        await cursorClick(page, contestBtn);
        await pause(1);
    }

    // Restore caption bar to describe the contest form
    await page.evaluate(() => {
        const bar = document.getElementById('demo-caption-bar');
        if (bar) { bar.style.height = '120px'; bar.style.opacity = '1'; }
        const root = document.getElementById('root');
        if (root) { root.style.maxHeight = 'calc(100vh - 120px)'; }
    });
    await pause(0.3);

    _logT('Contest Report');
    await showCaption(page, 'Contest Report', 'Disagreed with the analysis? Type your feedback and the agents will re-investigate \u2014 addressing blind spots and expanding their scope');
    await pause(7.05);

    // Cancel the contest form
    const cancelBtn = page.locator('button:text("Cancel")').first();
    if (await cancelBtn.isVisible().catch(() => false)) {
        await cursorClick(page, cancelBtn);
        await pause(0.5);
    }
    await hideCaption(page);
    await pause(0.5);

    // ── Implement Recommendations ──
    // Hide caption bar again to reveal buttons
    await page.evaluate(() => {
        const bar = document.getElementById('demo-caption-bar');
        if (bar) { bar.style.height = '0px'; bar.style.opacity = '0'; }
        const root = document.getElementById('root');
        if (root) { root.style.maxHeight = '100vh'; }
    });
    await pause(0.5);

    // Scroll down again to reveal buttons (contest form may have pushed them)
    await scrollReport(300);
    await pause(0.8);

    const implBtn = page.locator('button:has-text("Implement Recommendations")').first();
    if (await implBtn.isVisible().catch(() => false)) {
        await cursorMoveTo(page, implBtn);
        await pause(1);
        await cursorClick(page, implBtn);
        await pause(2);
    }

    // Restore caption bar for the modal
    await page.evaluate(() => {
        const bar = document.getElementById('demo-caption-bar');
        if (bar) { bar.style.height = '120px'; bar.style.opacity = '1'; }
        const root = document.getElementById('root');
        if (root) { root.style.maxHeight = 'calc(100vh - 120px)'; }
    });
    await pause(0.3);

    // Wait for the modal to appear
    await page.waitForSelector('text=Generate Implementation', { timeout: 5000 }).catch(() => {});
    await pause(0.5);

    _logT('Implement Recommendations');
    await showCaption(page, 'Implement Recommendations', 'The modal shows all recommendations grouped by priority \u2014 code items have checkboxes, operational items are flagged for manual action');
    await pause(6.8);

    // Scroll inside the modal to show more recommendations
    const modalContent = page.locator('[class*="overflow-y-auto"]').last();
    if (await modalContent.isVisible().catch(() => false)) {
        await modalContent.evaluate(el => el.scrollBy(0, 200));
        await pause(1.5);
    }

    _logT('Generate Implementation');
    await showCaption(page, 'Generate Implementation', 'Selected P0 code changes are pre-checked \u2014 click Generate to have the AI create the actual code patches');
    await pause(4.85);

    // Click Generate Implementation
    const generateBtn = page.locator('button:has-text("Generate Implementation")').first();
    if (await generateBtn.isVisible().catch(() => false)) {
        await cursorClick(page, generateBtn);
        await pause(1);
    }
    await hideCaption(page);
    await pause(0.3);

    // ════════════════════════════════════════════════════
    //  Part 2: Notes Tab
    // ════════════════════════════════════════════════════

    _logT('Investigation Notes');
    await showCaption(page, 'Investigation Notes', 'Finally, let\'s add personal notes \u2014 useful for tracking action items or context for future reference');

    // Click the Notes tab
    const notesTab = page.locator('button:has-text("Notes")').first();
    await cursorClick(page, notesTab);
    await pause(0.3);

    // Wait for notes content to appear
    await page.waitForSelector('h2:has-text("Notes")', { timeout: 5000 }).catch(() => {});
    await pause(0.1);

    // Switch to Write mode
    const writeBtn = page.locator('button:has-text("Write")').first();
    if (await writeBtn.isVisible().catch(() => false)) {
        await cursorClick(page, writeBtn);
        await pause(0.1);
    }

    // Type some notes
    const textarea = page.locator('textarea[placeholder*="Write your notes"]').first();
    if (await textarea.isVisible().catch(() => false)) {
        await cursorType(page, textarea,
            '## Follow-up Actions\n\n- [ ] Revert PollingIntervalMs to 500ms on eus2p-02\n- [ ] Verify latency drop after config revert\n- [ ] Schedule review with SRE team for cross-stamp config drift alerting',
            { delayMs: 8 });
        await pause(0.1);
    }

    // Click Save
    _logT('Save Notes');
    await showCaption(page, 'Save Notes', 'Notes support Markdown \u2014 great for checklists, links, and structured follow-ups');

    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.isVisible().catch(() => false)) {
        await cursorClick(page, saveBtn);
        await pause(2.2);
    }

    // Switch to Preview to show rendered markdown
    const previewBtn = page.locator('button:has-text("Preview")').first();
    if (await previewBtn.isVisible().catch(() => false)) {
        await cursorClick(page, previewBtn);
        await pause(1.5);
    }

    _logT('Markdown Preview');
    await showCaption(page, 'Markdown Preview', 'Switch to preview to see your notes rendered \u2014 checkboxes, headers, and formatting all work');
    await pause(4.5);

    await hideCaption(page);
    await hideCursor(page);
    await pause(0.5);
}
