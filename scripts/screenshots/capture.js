/**
 * Automated screenshot capture for the AI Investigator README.
 *
 * Launches a mock API server and the Vite dev server, then uses Playwright
 * to navigate every page/state and capture 18 screenshots to docs/screenshots/.
 *
 * Usage:
 *   node capture.js              → full run (starts mock + Vite, captures all)
 *   node capture.js --no-vite    → skip starting Vite (assume it's already running)
 *   node capture.js --headed     → run browser in headed mode for debugging
 */

import { chromium } from 'playwright';
import { startServer, stopServer } from './mock-server.js';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, '..', '..', 'docs', 'screenshots');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const FRONTEND_DIR = resolve(__dirname, '..', '..', 'frontend');
const MOCK_PORT = 3099;
const VITE_PORT = 5174;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

const VIEWPORT = { width: 1400, height: 900 };

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

async function screenshot(page, name, opts = {}) {
    const path = join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path, fullPage: false, ...opts });
    console.log(`  ✓ ${name}.png`);
}

/** Wait for the React app to finish rendering */
async function waitForApp(page) {
    // Wait for the app shell to mount
    await page.waitForSelector('[class*="animate-fade-in"], [class*="glass-card"], nav', { timeout: 10000 });
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

async function captureDashboardOverview(page) {
    console.log('\n📸 Dashboard screenshots...');
    await resetMock();
    await navigateTo(page, '/');
    // Wait for investigation cards to render
    await page.waitForTimeout(1200);
    await screenshot(page, 'dashboard-overview');
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
        await stampInput.fill('oi-tds-prd-eus2p-01');
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

async function captureFailedInvestigation(page) {
    console.log('\n📸 Failed Investigation...');
    const inv = loadFixture('investigation-failed.json');
    await setDetailOverride(inv.id, inv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(800);
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
            completed: false,
        },
    };
    await setDetailOverride(inv.id, analyzingInv);
    await navigateTo(page, `/investigation/${inv.id}`);
    await page.waitForTimeout(600);

    // Switch to Retrospect tab
    const retroTab = page.locator('button:has-text("Retrospect")').first();
    if (await retroTab.isVisible()) {
        await retroTab.click();
        await page.waitForTimeout(800);
    }
    await screenshot(page, 'retrospective-analysis');
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
    const productCard = page.locator('[class*="glass-card"]').first();
    if (await productCard.isVisible()) {
        const expandBtn = productCard.locator('button').first();
        if (await expandBtn.isVisible()) {
            await expandBtn.click();
            await page.waitForTimeout(400);
        }
    }

    await screenshot(page, 'settings');
}

async function captureAuthFlow(page) {
    console.log('\n📸 Auth Flow...');
    // Set auth to unauthenticated
    await setAuth({ authenticated: false, username: null });
    await navigateTo(page, '/');
    await page.waitForTimeout(800);
    await screenshot(page, 'auth-flow');
    // Restore auth
    await setAuth({ authenticated: true, username: 'user@microsoft.com' });
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
            env: { ...process.env, VITE_API_URL: `http://localhost:${MOCK_PORT}/api` },
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
        // ---- Capture all 19 screenshots ----

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

        // Auth
        await captureAuthFlow(page);

        console.log('\n═══════════════════════════════════════════════');
        console.log('  ✅ All 19 screenshots captured successfully!');
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
