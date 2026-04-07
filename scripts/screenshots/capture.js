/**
 * Automated screenshot capture for the AI Investigator README.
 *
 * Launches a mock API server and the Vite dev server, then uses Playwright
 * to navigate every page/state and capture 37 screenshots to docs/screenshots/.
 *
 * Usage:
 *   node capture.js              → full run (starts mock + Vite, captures all)
 *   node capture.js --no-vite    → skip starting Vite (assume it's already running)
 *   node capture.js --headed     → run browser in headed mode for debugging
 */

import { chromium } from 'playwright';
import { startServer, stopServer } from './mock-server.js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, '..', '..', 'docs', 'screenshots');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const FRONTEND_DIR = resolve(__dirname, '..', '..', 'frontend');
const MOCK_PORT = 3099;
const VITE_PORT = parseInt(process.env.VITE_PORT || '5174', 10);
const VITE_URL = `http://localhost:${VITE_PORT}`;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

const VIEWPORT = { width: 1400, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 812 }; // iPhone-size

// Parse CLI flags
const args = process.argv.slice(2);
const noVite = args.includes('--no-vite');
const headed = args.includes('--headed');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name) {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

async function controlPost(path, body) {
    const res = await fetch(`${MOCK_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Control API ${path} failed: ${res.status}`);
}

async function resetMock() {
    await controlPost('/__control/reset', {});
}

async function setDetailOverride(id, investigation) {
    await controlPost('/__control/set-detail-override', { id, investigation });
}

async function setAuth(authObj) {
    await controlPost('/__control/set-auth', authObj);
}

async function setOnboarding(complete) {
    await controlPost('/__control/set-onboarding', { complete });
}

async function screenshot(page, name, opts = {}) {
    const filePath = join(SCREENSHOTS_DIR, `${name}.png`);
    // Capture to buffer first, then write with retry to handle transient
    // file-lock errors (antivirus, VS Code file watcher, etc.)
    const buffer = await page.screenshot({ fullPage: false, ...opts });
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            writeFileSync(filePath, buffer);
            console.log(`  ✓ ${name}.png`);
            return;
        } catch (err) {
            if (attempt < 3 && (err.code === 'UNKNOWN' || err.code === 'EBUSY' || err.code === 'EPERM')) {
                console.log(`  ⚠ ${name}.png write failed (attempt ${attempt}/3), retrying...`);
                await new Promise(r => setTimeout(r, 500 * attempt));
            } else {
                throw err;
            }
        }
    }
}

/** Wait for the React app to finish rendering */
async function waitForApp(page) {
    // Wait for the app shell to mount — match elements visible on both desktop and mobile
    // Use :visible pseudo-class to skip hidden nav on mobile viewport
    await page.waitForSelector('[class*="animate-fade-in"], [class*="glass-card"], header', { timeout: 10000, state: 'attached' });
    // Small extra pause for animations to settle
    await page.waitForTimeout(800);
}

/** Navigate, wait for render, and dismiss any animation */
async function navigateTo(page, path) {
    await page.goto(`${VITE_URL}${path}`, { waitUntil: 'networkidle' });
    await waitForApp(page);
}

// ---------------------------------------------------------------------------
// Screenshot capture functions
// ---------------------------------------------------------------------------

async function captureOnboardingWizard(page) {
    console.log('\n📸 Onboarding Wizard...');
    await resetMock();
    await setOnboarding(false);
    await page.goto(`${VITE_URL}/onboarding`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Advance to LLM provider step (more visually informative)
    const getStarted = page.locator('button:has-text("Get Started"), button:has-text("Get started")').first();
    if (await getStarted.isVisible()) {
        await getStarted.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'onboarding-wizard');
    await setOnboarding(true); // restore
}

async function captureAboutPage(page) {
    console.log('\n📸 About page...');
    await resetMock();
    await navigateTo(page, '/about');
    await page.waitForTimeout(800);
    await screenshot(page, 'about-page');
}

async function captureDashboardOverview(page) {
    console.log('\n📸 Dashboard screenshots...');
    await resetMock();
    await navigateTo(page, '/');
    // Wait for investigation cards to render
    await page.waitForTimeout(1200);
    // Ensure list view is active so investigations are visible as rows
    const listBtn = page.locator('button[title*="List"], button[aria-label*="list"], button:has(svg.lucide-list)').first();
    if (await listBtn.isVisible()) {
        await listBtn.click();
        await page.waitForTimeout(600);
    }
    await screenshot(page, 'dashboard-overview', { fullPage: true });

    // Dismiss the update banner so it doesn't clutter subsequent screenshots
    const dismissBtn = page.locator('[class*="w-72"] button:has(svg.lucide-x)').first();
    if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await dismissBtn.click();
        await page.waitForTimeout(300);
    }
}

async function captureDashboardMixed(page) {
    // dashboard.png — the "mixed state" variant
    await resetMock();
    await navigateTo(page, '/');
    await page.waitForTimeout(1200);
    await screenshot(page, 'dashboard');
}

async function captureDashboardResumeAll(page) {
    console.log('\n📸 Dashboard — Resume All (post-restart)...');
    // Switch to the "all paused" fixture so the Resume All button appears
    await controlPost('/__control/set-investigations-all-paused', {});
    await navigateTo(page, '/');
    await page.waitForTimeout(1200);
    await screenshot(page, 'dashboard-resume-all');
    // Reset back to default
    await resetMock();
}

async function captureNewInvestigation(page) {
    console.log('\n📸 New Investigation...');
    await resetMock();
    await navigateTo(page, '/new');
    // Fill in some fields to make the form look populated
    await page.waitForTimeout(500);

    // Type into the stamp input
    const stampInput = page.locator('input[placeholder*="stamp"], input[placeholder*="Stamp"], input[placeholder*="application"]').first();
    if (await stampInput.isVisible()) {
        await stampInput.fill('app-prd-eus2p-01');
    }

    // Select an issue type if there's a dropdown
    const issueSelect = page.locator('select').first();
    if (await issueSelect.isVisible()) {
        const options = await issueSelect.locator('option').allTextContents();
        if (options.length > 1) {
            await issueSelect.selectOption({ index: 1 });
        }
    }

    // Click a time preset button (e.g., "Past 6 Hours")
    const timePreset = page.locator('button:has-text("Past 6 Hours"), button:has-text("6 Hours"), button:has-text("6h")').first();
    if (await timePreset.isVisible()) {
        await timePreset.click();
    }

    await page.waitForTimeout(400);
    await screenshot(page, 'new-investigation');
}

async function captureInvestigationStart(page) {
    console.log('\n📸 Investigation Start...');
    const inv = loadFixture('investigation-running.json');
    // Show early-stage: only 1 thought visible
    const earlyInv = { ...inv, thoughts: inv.thoughts.slice(0, 1), actions: inv.actions.slice(0, 1), thoughtCount: 1 };
    await setDetailOverride(inv.id, earlyInv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    await screenshot(page, 'investigation-start');
}

async function captureLiveSession(page) {
    console.log('\n📸 Live Session...');
    const inv = loadFixture('investigation-live-session.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(1000);
    await screenshot(page, 'live-session');
}

async function capturePausedByUser(page) {
    console.log('\n📸 Paused Investigation...');
    const inv = loadFixture('investigation-paused.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    await screenshot(page, 'paused-by-user');
}

async function captureUserIntervention(page) {
    console.log('\n📸 User Intervention...');
    const inv = loadFixture('investigation-live-session.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Type something into the intervention input
    const intervInput = page.locator('input[placeholder*="feedback"], input[placeholder*="instructions"], input[placeholder*="Provide"]').first();
    if (await intervInput.isVisible()) {
        await intervInput.fill('Also check if there were any recent VMSS scaling events');
    }
    await page.waitForTimeout(400);
    await screenshot(page, 'user-intervention');
}

async function captureConsentReport(page) {
    console.log('\n📸 Contest Report...');
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Switch to Report tab
    const reportTab = page.locator('button:has-text("Report")').first();
    if (await reportTab.isVisible()) {
        await reportTab.click();
        await page.waitForTimeout(600);
    }

    // Scroll to and click the "Contest Report" button to show the form
    const contestBtn = page.locator('button:has-text("Contest Report")').first();
    if (await contestBtn.isVisible()) {
        await contestBtn.scrollIntoViewIfNeeded();
        await contestBtn.click();
        await page.waitForTimeout(400);
    }

    // Type feedback
    const textarea = page.locator('textarea[placeholder*="wrong"], textarea[placeholder*="Explain"]').first();
    if (await textarea.isVisible()) {
        await textarea.fill('The report mentions 3 affected workspaces but we received escalations from at least 7 workspace owners. Please also check CMK-encrypted workspaces.');
    }
    await page.waitForTimeout(400);
    await screenshot(page, 'Consent-report');
}

async function captureInvestigationConsentResume(page) {
    console.log('\n📸 Investigation after contest...');
    const inv = loadFixture('investigation-contested.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    // Make sure we're on the Live tab
    const liveTab = page.locator('button:has-text("Live")').first();
    if (await liveTab.isVisible()) {
        await liveTab.click();
        await page.waitForTimeout(600);
    }
    await screenshot(page, 'investigation-consent-resume');
}

async function captureTokenAlert(page) {
    console.log('\n📸 Token Alert...');
    // Create a running investigation with a token limit thought
    const inv = loadFixture('investigation-live-session.json');
    const tokenInv = {
        ...inv,
        thoughts: [
            ...inv.thoughts,
            { content: "System Alert: Token limit approaching (85% used). Consider summarizing the conversation to free up context.", type: "thought" },
        ],
        thoughtCount: inv.thoughtCount + 1,
    };
    await setDetailOverride(inv.id, tokenInv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    await screenshot(page, 'token-alert');
}

async function captureFinalReport(page) {
    console.log('\n📸 Final Report...');
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Switch to Report tab
    const reportTab = page.locator('button:has-text("Report")').first();
    if (await reportTab.isVisible()) {
        await reportTab.click();
        await page.waitForTimeout(800);
    }
    await screenshot(page, 'final-report');
}

async function captureImplementRecommendations(page) {
    console.log('\n📸 Implement Recommendations...');
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Switch to Report tab
    const reportTab = page.locator('button:has-text("Report")').first();
    if (await reportTab.isVisible()) {
        await reportTab.click();
        await page.waitForTimeout(600);
    }

    // Click "Implement Recommendations" button to open the modal
    const implBtn = page.locator('button:has-text("Implement Recommendations")').first();
    if (await implBtn.isVisible()) {
        await implBtn.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'implement-recommendations');
}

async function captureFailedInvestigation(page) {
    console.log('\n📸 Failed Investigation...');
    await resetMock();
    const inv = loadFixture('investigation-failed.json');
    await setDetailOverride(inv.id, inv);
    await page.goto(`${VITE_URL}/investigation/${inv.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'failed-investigation');
}

async function captureRetrospectiveAnalysis(page) {
    console.log('\n📸 Retrospective Analysis (analyzing state)...');
    const inv = loadFixture('investigation-retrospect.json');
    // Show an "analyzing" state — remove proposals, set analysisComplete=false
    const analyzingInv = {
        ...inv,
        retrospect: {
            ...inv.retrospect,
            messages: inv.retrospect.messages.slice(0, 4), // only show early messages
            proposals: [],
            analysisComplete: false,
            analysisFailed: false,
            completed: false,
        },
    };
    await setDetailOverride(inv.id, analyzingInv);

    // Tell the mock server to hang on the analyze endpoint so the fetch stays
    // pending and isAnalyzing remains true in React state.
    await controlPost('/__control/set-analyze-hang', { hang: true });

    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Switch to Retrospect tab (triggers the auto-analysis useEffect)
    const retroTab = page.locator('button:has-text("Retrospect")').first();
    if (await retroTab.isVisible()) {
        await retroTab.click();
        await page.waitForTimeout(1200);
    }
    await screenshot(page, 'retrospective-analysis');

    // Reset hang mode
    await controlPost('/__control/set-analyze-hang', { hang: false });
}

async function captureRetrospectiveAnalyzeInvestigation(page) {
    console.log('\n📸 Retrospective — Analyze Investigation...');
    const inv = loadFixture('investigation-retrospect.json');
    // Show analysis complete with proposals
    const fullInv = {
        ...inv,
        retrospect: {
            ...inv.retrospect,
            analysisComplete: true,
            completed: false,
        },
    };
    await setDetailOverride(inv.id, fullInv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    const retroTab = page.locator('button:has-text("Retrospect")').first();
    if (await retroTab.isVisible()) {
        await retroTab.click();
        await page.waitForTimeout(800);
    }
    await screenshot(page, 'retrospective-analyze-investigation');
}

async function captureProposalsPanel(page) {
    console.log('\n📸 Proposals Panel...');
    const inv = loadFixture('investigation-retrospect.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    const retroTab = page.locator('button:has-text("Retrospect")').first();
    if (await retroTab.isVisible()) {
        await retroTab.click();
        await page.waitForTimeout(800);
    }

    // Try to expand a proposal if there's a clickable header
    const proposalHeaders = page.locator('[class*="proposal"], [class*="Proposal"], button:has-text("prop-")');
    const count = await proposalHeaders.count();
    if (count > 0) {
        await proposalHeaders.first().click();
        await page.waitForTimeout(400);
    }

    await screenshot(page, 'proposals-panel');
}

async function captureRetrospectiveChat(page) {
    console.log('\n📸 Retrospective Chat...');
    const inv = loadFixture('investigation-retrospect-chat.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    const retroTab = page.locator('button:has-text("Retrospect")').first();
    if (await retroTab.isVisible()) {
        await retroTab.click();
        await page.waitForTimeout(800);
    }
    await screenshot(page, 'retrospective-chat');
}

async function captureSettings(page) {
    console.log('\n📸 Settings...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(1000);

    // Click on Products tab if it exists (to show the most interesting tab)
    const productsTab = page.locator('button:has-text("Products")').first();
    if (await productsTab.isVisible()) {
        await productsTab.click();
        await page.waitForTimeout(600);
    }

    // Expand the first product to show path details
    // The product card header is a div with cursor-pointer that toggles expansion
    const productExpandRow = page.locator('div.cursor-pointer:has(svg.lucide-chevron-down)').first();
    if (await productExpandRow.isVisible()) {
        await productExpandRow.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'settings');
}

async function captureSettingsAnalytics(page) {
    console.log('\n📸 Settings — Analytics Widgets...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(800);

    // Click on the Analytics tab
    const analyticsTab = page.locator('button:has-text("Analytics")').first();
    if (await analyticsTab.isVisible()) {
        await analyticsTab.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'settings-analytics');
}

async function captureSettingsConnections(page) {
    console.log('\n📸 Settings — Connections...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(800);

    const connectionsTab = page.locator('button:has-text("Connections")').first();
    if (await connectionsTab.isVisible()) {
        await connectionsTab.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'settings-connections');
}

async function captureSettingsSchedules(page) {
    console.log('\n📸 Settings — Schedules...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(800);

    const schedulesTab = page.locator('button:has-text("Schedules")').first();
    if (await schedulesTab.isVisible()) {
        await schedulesTab.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'settings-schedules');
}

async function captureSettingsAppearance(page) {
    console.log('\n📸 Settings — Appearance...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(800);

    const appearanceTab = page.locator('button:has-text("Appearance")').first();
    if (await appearanceTab.isVisible()) {
        await appearanceTab.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'settings-appearance');
}

async function captureSettingsPipelineEmpty(page) {
    console.log('\n📸 Settings — Pipeline (empty)...');
    // Override settings to remove pipeline so the empty builder is shown
    const base = loadFixture('settings.json');
    const noPipeline = { ...base.settings };
    delete noPipeline.pipeline;
    await controlPost('/__control/set-settings-override', { settings: noPipeline });
    await navigateTo(page, '/settings');
    await page.waitForTimeout(1000);

    const pipelineTab = page.locator('button:has-text("Pipeline")').first();
    if (await pipelineTab.isVisible()) {
        await pipelineTab.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'settings-pipeline-empty');
    await resetMock();
}

async function captureSettingsPipeline(page) {
    console.log('\n📸 Settings — Pipeline (default)...');
    await resetMock();
    await navigateTo(page, '/settings');
    await page.waitForTimeout(1000);

    const pipelineTab = page.locator('button:has-text("Pipeline")').first();
    if (await pipelineTab.isVisible()) {
        await pipelineTab.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'settings-pipeline', { fullPage: true });
}

async function captureInvestigationNotes(page) {
    console.log('\n📸 Investigation Notes...');
    await resetMock();
    // Load the completed investigation that has userNotes
    const completedInv = loadFixture('investigation-completed.json');
    await setDetailOverride(completedInv.id, completedInv);

    await navigateTo(page, `/investigation/${completedInv.id}`);
    await page.waitForTimeout(1000);

    // Click the Notes tab
    const notesTab = page.locator('button:has-text("Notes")').first();
    if (await notesTab.isVisible()) {
        await notesTab.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'investigation-notes');
}

async function captureAuthFlow(page) {
    console.log('\n📸 Auth Flow...');
    // Set auth to unauthenticated with device-flow so the Connect button appears
    await setAuth({
        authenticated: false,
        username: null,
        providerType: 'copilot',
        authRequirement: { type: 'oauth-device-flow' },
    });
    await navigateTo(page, '/');
    await page.waitForTimeout(800);

    // Click the Connect / Configure button to open the device-code login modal
    const connectBtn = page.locator('button:has-text("Connect"), button:has-text("Configure LLM")').first();
    if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'auth-flow');

    // Close modal if open
    const closeBtn = page.locator('button:has-text("Close"), button:has-text("Cancel")').first();
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
    }

    // Restore auth
    await setAuth({ authenticated: true, username: 'user@microsoft.com' });
}

// ---------------------------------------------------------------------------
// Share, Export & Import screenshot capture functions
// ---------------------------------------------------------------------------

async function captureShareExportButtons(page) {
    console.log('\n📸 Share & Export Buttons...');
    // Use completed investigation — share/PDF buttons are visible for non-running states
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    // Stay on the Live/default tab so the sidebar buttons are visible
    await screenshot(page, 'share-export-buttons');
}

async function captureDragDropImport(page) {
    console.log('\n📸 Drag & Drop Import Overlay...');
    await resetMock();
    await navigateTo(page, '/');
    await page.waitForTimeout(800);

    // Simulate a dragenter event to trigger the drag-and-drop overlay
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['{}'], 'investigation.json', { type: 'application/json' }));
        const event = new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
        });
        document.dispatchEvent(event);
    });
    await page.waitForTimeout(600);

    await screenshot(page, 'drag-drop-import');

    // Dismiss the overlay by simulating dragleave
    await page.evaluate(() => {
        const event = new DragEvent('dragleave', {
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(event);
    });
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Mobile screenshot capture functions
// ---------------------------------------------------------------------------

async function captureMobileDashboard(page) {
    console.log('\n📱 Mobile Dashboard...');
    await resetMock();
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateTo(page, '/');
    await page.waitForTimeout(1200);
    await screenshot(page, 'mobile-dashboard');
    await page.setViewportSize(VIEWPORT);
}

async function captureMobileInvestigationDetail(page) {
    console.log('\n📱 Mobile Investigation Detail...');
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
    await screenshot(page, 'mobile-investigation-detail');
    await page.setViewportSize(VIEWPORT);
}

async function captureMobileContestReport(page) {
    console.log('\n📱 Mobile Contest Report...');
    const inv = loadFixture('investigation-completed.json');
    await setDetailOverride(inv.id, inv);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Click the Report tab
    const reportTab = page.locator('button:has-text("Report")').first();
    if (await reportTab.isVisible()) {
        await reportTab.click();
        await page.waitForTimeout(500);
    }

    // Click Contest button if visible
    const contestBtn = page.locator('button:has-text("Contest")').first();
    if (await contestBtn.isVisible()) {
        await contestBtn.click();
        await page.waitForTimeout(400);
    }

    await screenshot(page, 'mobile-contest-report');
    await page.setViewportSize(VIEWPORT);
}

async function captureMobileNewInvestigation(page) {
    console.log('\n📱 Mobile New Investigation...');
    await resetMock();
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateTo(page, '/new');
    await page.waitForTimeout(500);
    await screenshot(page, 'mobile-new-investigation');
    await page.setViewportSize(VIEWPORT);
}

async function captureMobileSettings(page) {
    console.log('\n📱 Mobile Settings...');
    await resetMock();
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateTo(page, '/settings');
    await page.waitForTimeout(800);
    await screenshot(page, 'mobile-settings');
    await page.setViewportSize(VIEWPORT);
}

// ---------------------------------------------------------------------------
// Schedules & Query Bank screenshots
// ---------------------------------------------------------------------------

async function captureSchedules(page) {
    console.log('\n📸 Schedules page...');
    await resetMock();
    // Navigate to dashboard first to reset React app state after drag-drop overlay
    await navigateTo(page, '/');
    await page.waitForTimeout(500);
    await navigateTo(page, '/schedules');
    await page.waitForTimeout(1500);

    // Expand the first schedule to show history
    // Schedule rows have a clickable div with cursor-pointer containing a chevron
    const firstScheduleRow = page.locator('div.cursor-pointer:has(svg.lucide-chevron-right)').first();
    if (await firstScheduleRow.isVisible()) {
        await firstScheduleRow.click();
        await page.waitForTimeout(800);
    }

    await screenshot(page, 'schedules');
}

async function captureScheduleForm(page) {
    console.log('\n📸 Schedule Form...');
    await resetMock();
    await navigateTo(page, '/schedules/new');
    await page.waitForTimeout(1200);

    // Fill in the schedule name
    const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await nameInput.isVisible()) {
        await nameInput.fill('EUS2P Hourly Health Check');
    }

    // Fill stamp
    const stampInput = page.locator('input[placeholder*="stamp"], input[placeholder*="Stamp"], input[placeholder*="application"]').first();
    if (await stampInput.isVisible()) {
        await stampInput.fill('app-prd-eus2p-01');
    }

    await page.waitForTimeout(400);
    await screenshot(page, 'schedule-form');
}

async function captureQueryBank(page) {
    console.log('\n📸 Query Bank...');
    await resetMock();
    await navigateTo(page, '/new');
    await page.waitForTimeout(1200);

    // Click the Query Bank button/dropdown to open it
    const queryBankBtn = page.locator('button:has-text("Query Bank"), button:has-text("Saved"), button:has-text("Load"), [title*="Query Bank"], [title*="query bank"], [title*="saved"]').first();
    if (await queryBankBtn.isVisible()) {
        await queryBankBtn.click();
        await page.waitForTimeout(600);
    }

    await screenshot(page, 'query-bank');
}

// ---------------------------------------------------------------------------
// Vite dev server management
// ---------------------------------------------------------------------------

let viteProcess = null;

async function startVite() {
    console.log('🚀 Starting Vite dev server...');
    return new Promise((resolve, reject) => {
        viteProcess = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
            cwd: FRONTEND_DIR,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, BACKEND_PORT: String(MOCK_PORT) },
        });

        let started = false;
        const timeout = setTimeout(() => {
            if (!started) reject(new Error('Vite did not start within 30s'));
        }, 30000);

        viteProcess.stdout.on('data', (data) => {
            const text = data.toString();
            if (text.includes('Local:') || text.includes('ready in')) {
                if (!started) {
                    started = true;
                    clearTimeout(timeout);
                    console.log('  Vite dev server ready');
                    resolve();
                }
            }
        });

        viteProcess.stderr.on('data', (data) => {
            // Vite logs some things to stderr that are warnings, not errors
            const text = data.toString();
            if (text.includes('EADDRINUSE')) {
                clearTimeout(timeout);
                reject(new Error(`Port ${VITE_PORT} is already in use`));
            }
        });

        viteProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function stopVite() {
    if (viteProcess) {
        console.log('  Stopping Vite dev server...');
        viteProcess.kill('SIGTERM');
        viteProcess = null;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  AI Investigator — Screenshot Capture');
    console.log('═══════════════════════════════════════════════\n');

    // 1. Start mock server
    console.log('🔧 Starting mock API server...');
    await startServer(MOCK_PORT);

    // 2. Start Vite (unless --no-vite)
    if (!noVite) {
        await startVite();
    } else {
        console.log('  Skipping Vite (--no-vite)');
    }

    // Small delay for Vite to be fully ready
    await new Promise(r => setTimeout(r, 1500));

    // 3. Launch Playwright
    console.log('\n🌐 Launching browser...');
    const browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,     // Retina-quality screenshots
        colorScheme: 'dark',
    });
    const page = await context.newPage();

    // Disable animations for crisp screenshots
    await page.emulateMedia({ reducedMotion: 'reduce' });

    try {
        // ---- Capture all 37 screenshots ----

        // Onboarding
        await captureOnboardingWizard(page);

        // Dashboard
        await captureDashboardOverview(page);
        await captureDashboardMixed(page);
        await captureDashboardResumeAll(page);

        // New Investigation form
        await captureNewInvestigation(page);

        // Investigation Detail — various states
        await captureInvestigationStart(page);
        await captureLiveSession(page);
        await capturePausedByUser(page);
        await captureUserIntervention(page);
        await captureTokenAlert(page);

        // Report & Contest
        await captureFinalReport(page);
        await captureImplementRecommendations(page);
        await captureConsentReport(page);
        await captureInvestigationConsentResume(page);

        // Failed
        await captureFailedInvestigation(page);

        // Retrospective
        await captureRetrospectiveAnalysis(page);
        await captureRetrospectiveAnalyzeInvestigation(page);
        await captureProposalsPanel(page);
        await captureRetrospectiveChat(page);

        // Settings
        await captureSettings(page);
        await captureSettingsPipelineEmpty(page);
        await captureSettingsPipeline(page);
        await captureSettingsConnections(page);
        await captureSettingsSchedules(page);
        await captureSettingsAnalytics(page);
        await captureSettingsAppearance(page);

        // Auth
        await captureAuthFlow(page);

        // Share & Export
        await captureShareExportButtons(page);

        // Schedules & Query Bank (before drag-drop which can corrupt page state)
        await captureSchedules(page);
        await captureScheduleForm(page);
        await captureQueryBank(page);

        // Drag & Drop Import (must be after schedules — dispatches synthetic drag events)
        await captureDragDropImport(page);

        // About
        await captureAboutPage(page);

        // Investigation Notes
        await captureInvestigationNotes(page);

        // Mobile screenshots
        await captureMobileDashboard(page);
        await captureMobileInvestigationDetail(page);
        await captureMobileContestReport(page);
        await captureMobileNewInvestigation(page);
        await captureMobileSettings(page);

        console.log('\n═══════════════════════════════════════════════');
        console.log('  ✅ All 39 screenshots captured successfully!');
        console.log(`  📁 Output: docs/screenshots/`);
        console.log('═══════════════════════════════════════════════\n');

    } catch (err) {
        console.error('\n❌ Screenshot capture failed:', err);
        process.exitCode = 1;
    } finally {
        await browser.close();
        if (!noVite) stopVite();
        await stopServer();
    }
}

main();
