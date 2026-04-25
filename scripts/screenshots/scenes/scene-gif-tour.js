/**
 * Scene: Full GIF Tour — 60-80s walkthrough of the entire app.
 *
 * Flow:
 *   1. Dashboard overview (scroll through cards, KPI bar)
 *   2. New Investigation (fill form, select saved workflow)
 *   3. Investigation detail (live session, pipeline tab)
 *   4. Settings → Pipeline tab (agent palette, saved workflows)
 *   5. About page (feature showcase)
 */

import { pause, go, setInvestigations, setDetailOverride, scrollShowcase, loadFixture } from '../lib/helpers.js';
import {
    injectOverlay,
    showCaption, hideCaption,
    showCursor, hideCursor,
    cursorClick, cursorMoveTo, cursorMoveXY, cursorType,
    showHighlight, hideHighlight,
    fadeTransition,
} from '../lib/overlay.js';

// ---------------------------------------------------------------------------
// Dashboard data — 5 mixed-status investigations
// ---------------------------------------------------------------------------
const DASHBOARD_INVESTIGATIONS = [
    {
        id: '1749820000000', status: 'running',
        title: 'Memory leak analysis — app-prd-weu-01',
        createdBy: 'dvreich',
        query: 'Investigate memory growth in worker process on app-prd-weu-01',
        stamp: 'app-prd-weu-01', target: 'app-prd-weu-01',
        timeRange: 'ago(4h)', issueType: 'Memory / Resource',
        category: 'memory', model: 'claude-sonnet-4-20250514',
        productId: 'sample-product', productName: 'AI Foundry Pipeline',
        verdict: null, tags: ['p2', 'memory-leak'],
        thoughtCount: 5,
        thoughts: ['Analyzing heap snapshots...'],
        actions: [], logs: ['Investigation started'],
    },
    {
        id: '1749790000000', status: 'completed',
        title: 'Pipeline latency root cause — oi-tds-prd-eus2p-01',
        createdBy: 'dvreich',
        query: 'Investigate P95 pipeline latency spike on oi-tds-prd-eus2p-01',
        stamp: 'oi-tds-prd-eus2p-01', target: 'oi-tds-prd-eus2p-01',
        timeRange: 'ago(6h)', issueType: 'Latency / Performance',
        category: 'latency', model: 'claude-sonnet-4-20250514',
        productId: 'sample-product', productName: 'AI Foundry Pipeline',
        verdict: 'warning', tags: ['p95-spike', 'on-call'],
        thoughtCount: 12,
        thoughts: ['Root cause identified: conservative queue polling intervals.'],
        actions: [], logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# Pipeline Latency Root Cause\n\nGDS Queue Wait and Streaming Queue Wait account for 76% of end-to-end latency.',
    },
    {
        id: '1749780000000', status: 'completed',
        title: 'Queue throttling analysis — oi-tds-prd-wus2p-03',
        createdBy: 'dvreich',
        query: 'Investigate TeleductMessageThrottleException on oi-tds-prd-wus2p-03',
        stamp: 'oi-tds-prd-wus2p-03', target: 'oi-tds-prd-wus2p-03',
        timeRange: 'ago(2h)', issueType: 'Throttling / Quota',
        category: 'throttling', model: 'claude-sonnet-4-20250514',
        productId: 'sample-product', productName: 'AI Foundry Pipeline',
        verdict: 'critical', tags: ['sev2'],
        thoughtCount: 15,
        thoughts: ['Queue depth peaked at 28K messages.'],
        actions: [], logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# Queue Throttling\n\nNodes exceeded queue capacity.',
    },
    {
        id: '1749770000000', status: 'completed',
        title: 'Service Fabric PLB storm — app-prd-eus2p-02',
        createdBy: 'scheduler',
        query: 'Investigate Service Fabric PLB balancing storm',
        stamp: 'app-prd-eus2p-02', target: 'app-prd-eus2p-02',
        timeRange: 'ago(12h)', issueType: 'Latency / Performance',
        category: 'latency', model: 'claude-sonnet-4-20250514',
        productId: 'sample-product', productName: 'AI Foundry Pipeline',
        source: 'scheduled', verdict: 'healthy', tags: ['deployment-related'],
        thoughtCount: 10,
        thoughts: ['PLB storm triggered by deployment.'],
        actions: [], logs: ['Investigation started', 'Investigation completed'],
        finalReport: '# PLB Balancing Storm\n\nDeployment changed replica count.',
    },
    {
        id: '1749760000000', status: 'paused',
        title: 'Certificate expiry audit — *.internal.contoso.com',
        createdBy: 'dvreich',
        query: 'Audit all certificates expiring within 30 days',
        stamp: 'cert-mgmt-prd-01', target: 'cert-mgmt-prd-01',
        timeRange: 'ago(24h)', issueType: 'Security / Compliance',
        category: 'security', model: 'gpt-4o',
        productId: 'sample-product', productName: 'AI Foundry Pipeline',
        verdict: null, tags: ['compliance', 'cert-rotation'],
        thoughtCount: 8,
        thoughts: ['Found 3 certificates expiring within 14 days.'],
        actions: [], logs: ['Investigation started', 'Investigation paused by user'],
    },
];

export default async function sceneGifTour(page) {
    // ══════════════════════════════════════════════════════════════════
    //  ACT 1: Dashboard (12s)
    // ══════════════════════════════════════════════════════════════════
    console.log('    📊 Act 1: Dashboard');

    await setInvestigations(DASHBOARD_INVESTIGATIONS);
    await go(page, '/');
    await injectOverlay(page);
    await page.waitForSelector('[class*="glass-card"], [class*="card"]', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page,
        'AI Investigator',
        'An autonomous AI agent system for investigating production incidents. Let\'s take a tour.');
    await showCursor(page);
    await pause(4);

    // Collapse analytics to show more cards
    const analyticsToggle = page.locator('text=Analytics').first();
    if (await analyticsToggle.isVisible().catch(() => false)) {
        await cursorClick(page, analyticsToggle);
        await pause(0.5);
    }

    await showCaption(page,
        'Dashboard',
        'All investigations at a glance — running, completed, paused. With KPI bar, search, and filtering.');

    // Scroll to show investigation cards
    await page.mouse.move(700, 400);
    for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 120);
        await pause(0.2);
    }
    await pause(3);

    // Scroll back up
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(1.5);

    // ══════════════════════════════════════════════════════════════════
    //  ACT 2: New Investigation + Workflow Selector (20s)
    // ══════════════════════════════════════════════════════════════════
    console.log('    📝 Act 2: New Investigation');

    await fadeTransition(page, async () => {
        await go(page, '/new');
    });
    await page.waitForSelector('#inv-target', { timeout: 5000 }).catch(() => {});
    await pause(0.5);

    await showCaption(page,
        'New Investigation',
        'Fill in the target, category, time range, and model to start an investigation.');
    await showCursor(page);

    // Fill target
    const stampInput = page.locator('#inv-target');
    if (await stampInput.isVisible()) {
        await cursorType(page, stampInput, 'oi-tds-prd-eus2p-02', { delayMs: 40 });
    }
    await pause(1);

    // Select category
    const categorySelect = page.locator('select:has(option[value="latency"])').first();
    if (await categorySelect.isVisible()) {
        await cursorClick(page, categorySelect);
        await categorySelect.selectOption('latency');
        await pause(0.8);
    }

    // Time range
    const timePreset = page.locator('button:has-text("Past 1 Hour")').first();
    if (await timePreset.isVisible()) {
        await cursorClick(page, timePreset);
        await pause(0.8);
    }

    // Model
    const modelSelect = page.locator('#inv-model');
    if (await modelSelect.isVisible()) {
        await cursorClick(page, modelSelect);
        await page.selectOption('#inv-model', 'claude-sonnet-4-20250514');
        await pause(0.8);
    }

    // Scroll down to Agent Configuration / Workflow section
    await showCaption(page,
        'Agent Workflows',
        'Choose from built-in presets or your own saved custom workflows. Searchable and paginated.');
    await page.mouse.move(700, 400);
    for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 150);
        await pause(0.25);
    }
    await pause(2);

    // Try to click a saved workflow
    const savedWorkflow = page.locator('button:has-text("Security Deep Dive")').first();
    if (await savedWorkflow.isVisible().catch(() => false)) {
        await cursorClick(page, savedWorkflow);
        await pause(1);

        await showCaption(page,
            'Saved Custom Workflow',
            'Security Deep Dive — a 5-stage custom pipeline you designed. Reusable across investigations.');
        await pause(3.5);
    } else {
        // Fallback: select Deep Investigation
        const deepBtn = page.locator('button:has-text("Deep Investigation")').first();
        if (await deepBtn.isVisible().catch(() => false)) {
            await cursorClick(page, deepBtn);
            await pause(1);
        }
        await showCaption(page,
            'Standard Pipeline',
            'Five agents: Investigator, Signal Grounding, Validator, Proposer, and Retrospect.');
        await pause(3.5);
    }

    // Scroll to query and type
    for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 120);
        await pause(0.25);
    }

    const queryInput = page.locator('#inv-query');
    if (await queryInput.isVisible()) {
        await showCaption(page,
            'Investigation Query',
            'Describe what you\'re investigating — the AI agents use this as their mission brief.');
        await cursorType(page, queryInput,
            'P90 latency is 10s, SLA target is 7.5s. Find where the extra 2.5s is spent.',
            { delayMs: 25 });
        await pause(2);
    }

    // ══════════════════════════════════════════════════════════════════
    //  ACT 3: Investigation Detail — Live Session (14s)
    // ══════════════════════════════════════════════════════════════════
    console.log('    🔍 Act 3: Live Investigation');

    await fadeTransition(page, async () => {
        await go(page, '/investigation/1749820000000');
    });

    await page.waitForSelector('[class*="glass-card"]', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page,
        'Live Investigation',
        'Watch the AI agent think in real-time. Each step shows tool calls, reasoning, and findings.');
    await showCursor(page);
    await pause(5);

    // Click Pipeline tab if visible
    const pipelineTab = page.locator('button:has-text("Pipeline"), a:has-text("Pipeline")').first();
    if (await pipelineTab.isVisible().catch(() => false)) {
        await showCaption(page,
            'Pipeline Timeline',
            'Track progress through the multi-agent pipeline — see which agent is active and what\'s completed.');
        await cursorClick(page, pipelineTab);
        await pause(4);
    }

    // ══════════════════════════════════════════════════════════════════
    //  ACT 4: Settings — Pipeline Builder (28s)
    // ══════════════════════════════════════════════════════════════════
    console.log('    ⚙️  Act 4: Settings Pipeline Builder');

    await fadeTransition(page, async () => {
        await go(page, '/settings');
    });

    await page.waitForSelector('[class*="glass-card"]', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page,
        'Settings',
        'Nine configuration tabs — Connections, Paths, Agent Behavior, Pipeline, Agents, Schedules, Analytics, Appearance, System.');
    await showCursor(page);
    await pause(3);

    // Click Pipeline tab
    const pipelineSettingsTab = page.locator('button:has-text("Pipeline")').first();
    if (await pipelineSettingsTab.isVisible().catch(() => false)) {
        await cursorClick(page, pipelineSettingsTab);
        await pause(1.5);

        await showCaption(page,
            'Default Pipeline',
            'Pick a built-in preset as your default — Standard, Incident Response, Quick Health Check, Compliance Review, or none.');
        await pause(3);
    }

    // Open the Pipeline Builder modal — the marquee feature.
    const createWorkflowBtn = page.locator('button:has-text("Create New Workflow")').first();
    if (await createWorkflowBtn.isVisible().catch(() => false)) {
        await cursorClick(page, createWorkflowBtn);
        await pause(1.5);

        await showCaption(page,
            'Pipeline Builder',
            'Compose your own multi-agent workflow. Pick an icon, name it, and chain agents from the palette.');
        await pause(3);

        // Type a workflow name
        const wfName = page.locator('input[placeholder*="Custom Workflow"], input[placeholder*="My Custom"]').first();
        if (await wfName.isVisible().catch(() => false)) {
            await cursorType(page, wfName, 'Cert Rotation Audit', { delayMs: 35 });
            await pause(0.8);
        }

        // Open icon picker
        const iconSwatch = page.locator('text=Icon').first().locator('..').locator('button').first();
        if (await iconSwatch.count() > 0) {
            await showCaption(page,
                'Icon Picker',
                'Pick an emoji to make your workflow recognizable in the launcher and timeline.');
            await cursorMoveTo(page, iconSwatch);
            await iconSwatch.dispatchEvent('click').catch(() => {});
            await pause(2);

            // Pick the shield icon (🛡️) for the Cert Rotation workflow.
            // The icon-picker grid sits inside an overlay modal; real mouse
            // clicks can be intercepted, so move the cursor there for the
            // viewer and then dispatch the click event directly.
            const shieldIcon = page.locator('button:has-text("🛡️")').first();
            if (await shieldIcon.count() > 0) {
                await cursorMoveTo(page, shieldIcon);
                await shieldIcon.dispatchEvent('click').catch(() => {});
                await pause(1);
            }
        }

        // Add agents from the palette: Triage → Investigator → Validator
        await showCaption(page,
            'Agent Palette',
            'Click any agent chip to drop it on the canvas — built-in agents, your saved agents, or define a brand-new custom one.');
        for (const agentName of ['Triage', 'Investigator', 'Validator']) {
            // AgentChip renders <button>...<span class="font-medium">{name}</span>...</button>.
            const chip = page.locator(`button:has(span.font-medium:text-is("${agentName}"))`).first();
            if (await chip.count() > 0) {
                // Move the cursor for visual feedback, then dispatch a real
                // click event — bypasses overlay pointer-event interception
                // that auto-actionable .click() would hit.
                await cursorMoveTo(page, chip);
                await chip.dispatchEvent('click').catch(() => {});
                await pause(0.7);
            }
        }
        await pause(2);

        // Close the modal — Cancel or X
        const cancelBtn = page.locator('button:has-text("Cancel")').first();
        if (await cancelBtn.count() > 0) {
            await cursorMoveTo(page, cancelBtn);
            await cancelBtn.dispatchEvent('click').catch(() => {});
            await pause(0.8);
        }
    }

    // Switch to the Agents tab — showcases the Agent Library
    const agentsSettingsTab = page.locator('button:has-text("Agents")').filter({ hasNot: page.locator('text=Behavior') }).first();
    if (await agentsSettingsTab.isVisible().catch(() => false)) {
        await cursorClick(page, agentsSettingsTab);
        await pause(1.5);

        await showCaption(page,
            'Agent Library',
            '14 built-in agents across investigation, validation, planning, and remediation. Add your own custom agents anytime.');
        await pause(3);
    }

    // ══════════════════════════════════════════════════════════════════
    //  ACT 5: About Page (8s)
    // ══════════════════════════════════════════════════════════════════
    console.log('    ℹ️  Act 5: About Page');

    await fadeTransition(page, async () => {
        await go(page, '/about');
    });

    await page.waitForSelector('[class*="glass-card"], h1', { timeout: 5000 }).catch(() => {});
    await pause(1);

    await showCaption(page,
        'About',
        'Feature showcase, pipeline diagram, capabilities overview, and tech stack.');
    await showCursor(page);

    // Smooth scroll down and back up to showcase the page
    await scrollShowcase(page, { downMs: 3000, pauseMs: 500, upMs: 1200 });
    await pause(2);

    // ── Outro ──
    await showCaption(page,
        'AI Investigator',
        'Autonomous production investigation — powered by multi-agent AI pipelines.');
    await pause(3);

    await hideCaption(page);
    await hideCursor(page);
    await pause(0.5);
}
