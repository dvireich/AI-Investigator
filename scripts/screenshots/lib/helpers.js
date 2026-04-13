/**
 * Shared helpers for the demo recorder: fixtures, mock control, navigation,
 * typing, scrolling, and timing utilities.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// Re-export constants that scenes need
export const MOCK_PORT = 3099;
export const VITE_PORT = parseInt(process.env.VITE_PORT || '5174', 10);
export const VITE_URL = `http://localhost:${VITE_PORT}`;
export const MOCK_URL = `http://localhost:${MOCK_PORT}`;

// ---------------------------------------------------------------------------
// Fixtures & mock control
// ---------------------------------------------------------------------------

export function loadFixture(name) {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

export async function controlPost(path, body) {
    const res = await fetch(`${MOCK_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Control API ${path} failed: ${res.status}`);
}

export async function resetMock() {
    await controlPost('/__control/reset', {});
}

export async function setInvestigations(investigations) {
    await controlPost('/__control/set-investigations', { investigations });
}

export async function setDetailOverride(id, investigation) {
    await controlPost('/__control/set-detail-override', { id, investigation });
}

export async function setOnboarding(complete) {
    await controlPost('/__control/set-onboarding', { complete });
}

export async function setAnalyzeHang(hang) {
    await controlPost('/__control/set-analyze-hang', { hang });
}

export async function broadcastMessage(data) {
    await controlPost('/__control/broadcast', data);
}

// ---------------------------------------------------------------------------
// Navigation & waiting
// ---------------------------------------------------------------------------

/** Wait for React to finish rendering */
export async function waitForApp(page) {
    try {
        await page.waitForSelector(
            '[class*="animate-fade-in"], [class*="glass-card"], header',
            { timeout: 6000, state: 'attached' },
        );
    } catch {
        console.log('    ⚠ waitForApp selector not found, continuing...');
    }
    await pause(0.8);
}

/** Navigate and wait for render */
export async function go(page, path) {
    // Navigate — use domcontentloaded to get control before first paint
    await page.goto(`${VITE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // page.route() injects anti-flash CSS in <head> so #root is hidden
    // before first paint. Also set dark BG via JS as belt-and-suspenders.
    await page.evaluate(() => {
        document.documentElement.style.background = '#0a0e17';
        document.body.style.background = '#0a0e17';
        const root = document.getElementById('root');
        if (root) root.style.visibility = 'hidden';
    }).catch(() => {});
    // Wait for full load
    await page.waitForLoadState('load').catch(() => {});
    await pause(0.5);
    await waitForApp(page);
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export async function pause(seconds) {
    await new Promise(r => setTimeout(r, seconds * 1000));
}

/** Calculate caption reading time: ~1s per word, minimum 4s */
export function captionReadTime(title, subtitle) {
    const words = (title + ' ' + subtitle).split(/\s+/).filter(w => w.length > 0).length;
    return Math.max(4, words);
}

// ---------------------------------------------------------------------------
// Typing & scrolling
// ---------------------------------------------------------------------------

/** Type text character-by-character with a human-like cadence. */
export async function humanType(locator, text, { delayMs = 45 } = {}) {
    await locator.click();
    await locator.pressSequentially(text, { delay: delayMs });
}

/** Smooth scroll to bottom of the page, then back to top. */
export async function scrollShowcase(page, { downMs = 1500, pauseMs = 400, upMs = 800 } = {}) {
    await page.evaluate(async ({ downMs, pauseMs, upMs }) => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        if (scrollHeight <= viewportHeight) return;

        const steps = 30;
        const stepDelay = downMs / steps;
        for (let i = 1; i <= steps; i++) {
            window.scrollTo({ top: (scrollHeight * i) / steps, behavior: 'instant' });
            await new Promise(r => setTimeout(r, stepDelay));
        }
        await new Promise(r => setTimeout(r, pauseMs));

        const upSteps = 15;
        const upStepDelay = upMs / upSteps;
        for (let i = upSteps - 1; i >= 0; i--) {
            window.scrollTo({ top: (scrollHeight * i) / upSteps, behavior: 'instant' });
            await new Promise(r => setTimeout(r, upStepDelay));
        }
    }, { downMs, pauseMs, upMs });
}
