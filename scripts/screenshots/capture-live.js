/**
 * Capture a screenshot from the LIVE running AI Investigator dashboard.
 *
 * Unlike capture.js (which uses mock data), this connects to the real
 * backend/frontend on the configured port and captures the actual state.
 *
 * Usage:
 *   node capture-live.js                         # capture from http://localhost:3000
 *   node capture-live.js --port 3001             # custom port
 *   node capture-live.js --output hero.png       # custom output filename
 *   node capture-live.js --headed                # visible browser for debugging
 *
 * Output: docs/screenshots/dashboard-overview.png (by default)
 */

import { chromium } from 'playwright';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, '..', '..', 'docs', 'screenshots');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const port = getArg('port', '3000');
const output = getArg('output', 'dashboard-overview.png');
const headed = args.includes('--headed');
const baseUrl = `http://localhost:${port}`;

async function main() {
    console.log(`Capturing live dashboard at ${baseUrl} ...`);

    const browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    // Allow animations and charts to settle
    await page.waitForTimeout(2000);

    // Switch to list view so investigations are visible as rows
    const listBtn = page.locator('button[title*="List"], button[aria-label*="list"], button:has(svg.lucide-list)').first();
    if (await listBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await listBtn.click();
        await page.waitForTimeout(600);
    }

    const outPath = join(SCREENSHOTS_DIR, output);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`✓ Saved ${outPath}`);

    await browser.close();
}

main().catch((err) => {
    console.error('Screenshot capture failed:', err.message);
    process.exit(1);
});
