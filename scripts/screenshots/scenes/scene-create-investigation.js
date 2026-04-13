/**
 * Scene 2: Dashboard overview → Create a new investigation.
 *
 * Starts on the dashboard showing 3 completed investigations,
 * then navigates to the New Investigation form, fills it in,
 * and launches the investigation.
 *
 * Continuous captions narrate every step.
 */

import { pause, go, setInvestigations, scrollShowcase } from '../lib/helpers.js';
import {
    injectOverlay,
    showCaption, hideCaption,
    showCursor, hideCursor,
    cursorClick, cursorMoveTo, cursorType,
    fadeTransition,
} from '../lib/overlay.js';

// 3 completed investigations for the dashboard
const DASHBOARD_INVESTIGATIONS = [
    {
        id: '1749790000000',
        status: 'completed',
        title: 'Pipeline latency root cause — oi-tds-prd-eus2p-01',
        createdBy: 'dvreich',
        query: 'Investigate P95 pipeline latency spike on oi-tds-prd-eus2p-01',
        stamp: 'oi-tds-prd-eus2p-01',
        target: 'oi-tds-prd-eus2p-01',
        timeRange: 'ago(6h)',
        issueType: 'Latency / Performance',
        category: 'latency',
        model: 'claude-sonnet-4-20250514',
        productId: 'sample-product',
        productName: 'AI Foundry Pipeline',
        verdict: 'warning',
        tags: ['p95-spike', 'on-call'],
        thoughtCount: 12,
        thoughts: [
            'Root cause identified: conservative queue polling intervals in GDS and Streaming stages account for 76% of end-to-end latency.',
        ],
        actions: [],
        logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# Pipeline Latency Root Cause\n\nGDS Queue Wait (1,886ms) and Streaming Queue Wait (1,590ms) account for 76% of end-to-end latency.',
    },
    {
        id: '1749780000000',
        status: 'completed',
        title: 'Queue throttling analysis — oi-tds-prd-wus2p-03',
        createdBy: 'dvreich',
        query: 'Investigate TeleductMessageThrottleException on oi-tds-prd-wus2p-03',
        stamp: 'oi-tds-prd-wus2p-03',
        target: 'oi-tds-prd-wus2p-03',
        timeRange: 'ago(2h)',
        issueType: 'Throttling / Quota',
        category: 'throttling',
        model: 'claude-sonnet-4-20250514',
        productId: 'sample-product',
        productName: 'AI Foundry Pipeline',
        verdict: 'critical',
        tags: ['sev2'],
        thoughtCount: 15,
        thoughts: [
            'Queue depth peaked at 28K messages on _Node_3 and _Node_5, triggering cascading throttle exceptions across the stamp.',
        ],
        actions: [],
        logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# Queue Throttling Analysis\n\nNodes _Node_3 and _Node_5 exceeded queue capacity (28K vs 10K baseline).',
    },
    {
        id: '1749770000000',
        status: 'completed',
        title: 'Service Fabric PLB balancing storm — app-prd-eus2p-02',
        createdBy: 'scheduler',
        query: 'Investigate Service Fabric placement load balancer balancing storm',
        stamp: 'app-prd-eus2p-02',
        target: 'app-prd-eus2p-02',
        timeRange: 'ago(12h)',
        issueType: 'Latency / Performance',
        category: 'latency',
        model: 'claude-sonnet-4-20250514',
        productId: 'sample-product',
        productName: 'AI Foundry Pipeline',
        source: 'scheduled',
        verdict: 'healthy',
        tags: ['deployment-related'],
        thoughtCount: 10,
        thoughts: [
            'PLB storm was triggered by a deployment that changed replica count from 5 to 7. Storm subsided after 45 minutes.',
        ],
        actions: [],
        logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# PLB Balancing Storm\n\nDeployment changed target replica count from 5 to 7, triggering a balancing storm.',
    },
];

export default async function sceneCreateInvestigation(page) {
    console.log('  🎬 Scene 2: Dashboard → Create Investigation');

    // ── Set up dashboard with 3 completed investigations ──
    await setInvestigations(DASHBOARD_INVESTIGATIONS);

    // Navigate to dashboard
    await go(page, '/');

    // Re-inject overlay after navigation (go() destroys DOM)
    await injectOverlay(page);

    // Wait for the dashboard to render
    await page.waitForSelector('[class*="glass-card"], [class*="card"]', { timeout: 5000 }).catch(() => {});
    await pause(1.5);

    // ── Dashboard caption ──
    await showCaption(page,
        'Investigation Dashboard',
        'The dashboard shows all past and active investigations. Here we see three completed analyses.');
    await showCursor(page);
    await pause(4);

    // ── Collapse Analytics so investigation cards are closer ──
    const analyticsToggle = page.locator('text=Analytics').first();
    if (await analyticsToggle.isVisible().catch(() => false)) {
        await cursorClick(page, analyticsToggle);
        await pause(0.8);
    }

    // ── Scroll down to reveal investigation cards below the fold ──
    await showCaption(page,
        'All Investigations',
        'All your past and active investigations appear here. Let\'s scroll down to see the completed ones.');
    await pause(2);

    // Scroll down aggressively to reach the cards (~1400px below)
    await page.mouse.move(700, 400);
    for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 160);
        await pause(0.25);
    }
    await pause(1.8);

    // ── Hover over the first investigation card ──
    await showCaption(page,
        'Previous Investigations',
        'Each card shows the investigation status, target stamp, category, and a summary of findings.');

    // Try to find investigation cards by their content
    const firstCard = page.locator('a[href*="/investigation/"]').first();
    if (await firstCard.isVisible().catch(() => false)) {
        await cursorMoveTo(page, firstCard);
        await pause(4.5);
    } else {
        // Fallback — scroll a bit more and try again
        for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, 150);
            await pause(0.25);
        }
        await pause(1);
        const cardRetry = page.locator('a[href*="/investigation/"]').first();
        if (await cardRetry.isVisible().catch(() => false)) {
            await cursorMoveTo(page, cardRetry);
            await pause(4.5);
        }
    }

    // ── Scroll back up before clicking "New" ──
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(1.5);

    // ── Click "New" to create a new investigation ──
    await showCaption(page,
        'New Investigation',
        'Let\'s create a new investigation to track down the latency issue on stamp eus2p-02.');

    const newNavLink = page.locator('a:has-text("New"), button:has-text("New")').first();
    if (await newNavLink.isVisible()) {
        await cursorClick(page, newNavLink);
        await pause(3);
    }

    // Wait for the form to load
    await page.waitForSelector('#inv-target', { timeout: 5000 }).catch(() => {});
    await pause(1.5);

    // ── Step 1: Target Name ──
    await showCaption(page,
        'Target Scope',
        'We target the specific stamp showing elevated latency, oi-tds-prd-eus2p-02.');

    const stampInput = page.locator('#inv-target');
    if (await stampInput.isVisible()) {
        await cursorType(page, stampInput, 'oi-tds-prd-eus2p-02', { delayMs: 50 });
        await pause(5);
    }

    // ── Step 2: Category — select Latency ──
    await showCaption(page,
        'Issue Category',
        'We select "Latency / Performance" so the agents focus their analysis on timing metrics.');

    const categorySelect = page.locator('select:has(option[value="latency"])').first();
    if (await categorySelect.isVisible()) {
        await cursorClick(page, categorySelect);
        await categorySelect.selectOption('latency');
        await pause(5.5);
    }

    // ── Step 3: Time Range — Past 1 Hour ──
    await showCaption(page,
        'Time Window',
        'We look at the past hour, that\'s when the latency spike was observed.');

    const timePreset = page.locator('button:has-text("Past 1 Hour")').first();
    if (await timePreset.isVisible()) {
        await cursorClick(page, timePreset);
        await pause(3.5);
    }

    // ── Step 4: AI Model — select Claude Opus 4.6 ──
    await showCaption(page,
        'AI Model',
        'We select Claude Opus 4.6, the most capable model for complex production investigations.');

    const modelSelect = page.locator('#inv-model');
    if (await modelSelect.isVisible()) {
        await cursorClick(page, modelSelect);
        await page.selectOption('#inv-model', 'claude-opus-4.6');
        await pause(5.5);
    }

    // ── Step 5: Scroll down to show agent configuration ──
    await showCaption(page,
        'Agent Workflow',
        'Now we select the investigation workflow, Deep Investigation for a thorough root-cause analysis.');

    await page.mouse.move(700, 400);
    for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 150);
        await pause(0.3);
    }
    await pause(2);

    // ── Step 6: Select Deep Investigation workflow ──
    const deepInvBtn = page.locator('button:has-text("Deep Investigation")').first();
    if (await deepInvBtn.isVisible()) {
        await cursorClick(page, deepInvBtn);
        await pause(4);
    }

    await showCaption(page,
        'Deep Investigation',
        'Six agents in sequence: Planner → Investigator → Devil\'s Advocate → Validator → Summarizer → Retrospect.');
    await pause(7);

    // ── Step 7: Scroll to query field and type ──
    for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 120);
        await pause(0.3);
    }
    await pause(0.3);

    await showCaption(page,
        'Investigation Query',
        'We describe what we\'re looking for. The agents will use this as their investigation brief.');

    const queryInput = page.locator('#inv-query');
    if (await queryInput.isVisible()) {
        await cursorType(page, queryInput,
            'P90 latency is ~10s, SLA target is 7.5s. Identify where the extra 2.5s is spent and recommend specific optimizations.',
            { delayMs: 30 });
        await pause(1);
    }

    // ── Step 8: Scroll to submit button and click ──
    for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 100);
        await pause(0.3);
    }
    await pause(0.5);

    await showCaption(page,
        'Launch',
        'Everything is configured. Let\'s start the investigation and let the AI agents do their work.');

    const submitBtn = page.locator('button:has-text("Start Investigation")').first();
    if (await submitBtn.isVisible()) {
        await cursorClick(page, submitBtn);
        await pause(1);
    }

    // ── Step 9: Investigation detail page — show pipeline stepper ──
    // The page auto-navigates to /investigation/:id after clicking Start
    // Wait for the detail page to fully load
    await page.waitForLoadState('networkidle').catch(() => {});
    await pause(2);

    // Re-inject overlay since the page navigated
    await injectOverlay(page);

    // Scroll to top to ensure stepper is visible
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await pause(0.5);

    // Wait for the pipeline stepper to appear (it needs stages.length > 1)
    await page.waitForSelector('.rounded-full.border-2', { timeout: 10000 }).catch((e) => {
        console.log('    ⚠ Pipeline stepper not found:', e.message);
    });
    await pause(1.5);

    await showCaption(page,
        'Investigation Launched',
        'Six AI agents are now queued. The Planner is already analyzing the investigation brief.');
    await showCursor(page);

    // Hover over the pipeline stepper area
    const stepperDot = page.locator('.rounded-full.border-2').first();
    if (await stepperDot.isVisible().catch(() => false)) {
        await cursorMoveTo(page, stepperDot);
    }

    await pause(4);

    await hideCaption(page);
    await hideCursor(page);
    await pause(0.5);
}
