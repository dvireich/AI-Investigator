/**
 * Preview recorder — records just Scene 2 (create a new investigation)
 * so you can quickly iterate on the look and feel.
 *
 * This scene starts on the /settings page (where Scene 1 ended) and
 * navigates to /new via the top-nav "New" link, fills in the form,
 * and clicks "Start Investigation".
 *
 * Usage:
 *   node preview-scene2.js              → headless
 *   node preview-scene2.js --headed     → watch in real-time
 *   node preview-scene2.js --no-vite    → skip Vite (assume running)
 *
 * Output:
 *   docs/demo/preview-scene2.webm
 */

import { chromium } from 'playwright';
import { startServer, stopServer } from './mock-server.js';
import { spawn } from 'child_process';
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Lib
import { pause, VITE_PORT, MOCK_PORT } from './lib/helpers.js';
import { setRecordingState, injectOverlay } from './lib/overlay.js';

// Scene
import sceneCreateInvestigation from './scenes/scene-create-investigation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, '..', '..', 'frontend');
const DEMO_DIR = resolve(__dirname, '..', '..', 'docs', 'demo');

const args = process.argv.slice(2);
const noVite = args.includes('--no-vite');
const headed = args.includes('--headed');

const cleanSegments = [];

// ---------------------------------------------------------------------------
let viteProcess = null;
async function startVite() {
    console.log('🚀 Starting Vite dev server...');
    return new Promise((resolve, reject) => {
        viteProcess = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
            cwd: FRONTEND_DIR, shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, BACKEND_PORT: String(MOCK_PORT) },
        });
        let started = false;
        const timeout = setTimeout(() => { if (!started) reject(new Error('Vite timeout')); }, 30000);
        viteProcess.stdout.on('data', d => {
            if ((d.toString().includes('Local:') || d.toString().includes('ready in')) && !started) {
                started = true; clearTimeout(timeout); console.log('  Vite ready'); resolve();
            }
        });
        viteProcess.stderr.on('data', d => {
            if (d.toString().includes('EADDRINUSE')) { clearTimeout(timeout); reject(new Error('Port in use')); }
        });
        viteProcess.on('error', e => { clearTimeout(timeout); reject(e); });
    });
}
function stopVite() { if (viteProcess) { viteProcess.kill('SIGTERM'); viteProcess = null; } }

// ---------------------------------------------------------------------------
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  Scene 2 Preview — Dashboard + Create Investigation');
    console.log('═══════════════════════════════════════════════\n');

    if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true });

    console.log('🔧 Starting mock API server...');
    await startServer(MOCK_PORT);

    if (!noVite) { await startVite(); } else { console.log('  Skipping Vite (--no-vite)'); }
    await new Promise(r => setTimeout(r, 1500));

    console.log('\n🎥 Launching browser...\n');
    const browser = await chromium.launch({ headless: !headed });

    // ── Warm up Vite: visit pages we'll use so module bundles are cached ──
    console.log('  🔥 Warming up Vite...');
    const warmCtx = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        colorScheme: 'dark',
    });
    const warmPage = await warmCtx.newPage();
    try {
        await warmPage.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'networkidle', timeout: 20000 });
        await new Promise(r => setTimeout(r, 1500));
        await warmPage.goto(`http://localhost:${VITE_PORT}/new`, { waitUntil: 'networkidle', timeout: 20000 });
        await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.log('    ⚠ Warm-up warning:', e.message); }
    await warmPage.close();
    await warmCtx.close();
    console.log('  ✅ Vite warmed up\n');

    // ── Now create the real recording context ──
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        recordVideo: { dir: DEMO_DIR, size: { width: 1400, height: 900 } },
    });
    const page = await context.newPage();

    // Intercept HTML responses to inject dark-background CSS directly in <head>.
    // This prevents white flash because inline CSS is parsed before first paint —
    // unlike addInitScript which is JS that runs AFTER the initial HTML render.
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (req.resourceType() !== 'document') {
            return route.continue();
        }
        // Force IPv4 — Node 23 resolves localhost to ::1 (IPv6) but Vite only listens on 127.0.0.1
        const ipv4Url = req.url().replace('//localhost:', '//127.0.0.1:');
        const response = await route.fetch({ url: ipv4Url });
        let body = await response.text();
        const antiFlashCSS = '<style id="demo-anti-flash">html,body{background:#0a0e17!important}#root{visibility:hidden!important;max-height:calc(100vh - 120px)!important;overflow:hidden!important}</style>';
        body = body.replace('<head>', '<head>' + antiFlashCSS);
        await route.fulfill({ response, body, headers: { ...response.headers(), 'content-type': 'text/html' } });
    });

    const startTime = Date.now();
    setRecordingState(startTime, cleanSegments);

    try {
        // Start with a blank dark page — the scene will navigate to dashboard itself
        await page.setContent('<html><body style="margin:0;background:#0a0e17"></body></html>');
        await injectOverlay(page);
        await pause(0.3);

        cleanSegments.push({ start: 0, end: null });

        // ── SCENE 2: Create Investigation ──
        console.log('  🎬 Create Investigation');
        await sceneCreateInvestigation(page);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n⏱  Recording duration: ${elapsed}s`);

        if (cleanSegments.length > 0 && cleanSegments[cleanSegments.length - 1].end === null) {
            cleanSegments[cleanSegments.length - 1].end = parseFloat(elapsed);
        }
    } catch (err) {
        console.error('\n❌ Recording failed:', err);
        process.exitCode = 1;
    } finally {
        await page.close();
        await context.close();
        await browser.close();
        if (!noVite) stopVite();
        await stopServer();
    }

    // Rename output — find the newest webm by modification time
    const dest = join(DEMO_DIR, 'preview-scene2.webm');
    const videoFiles = readdirSync(DEMO_DIR)
        .filter(f => f.endsWith('.webm') && f !== 'preview-scene2.webm')
        .map(f => ({ name: f, mtime: statSync(join(DEMO_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    if (videoFiles.length > 0) {
        const rawSrc = join(DEMO_DIR, videoFiles[0].name);
        try { unlinkSync(dest); } catch { /* ok */ }
        renameSync(rawSrc, dest);
        const sizeMB = (readFileSync(dest).length / (1024 * 1024)).toFixed(1);
        console.log(`\n═══════════════════════════════════════════════`);
        console.log(`  ✅ Preview saved! (${sizeMB} MB)`);
        console.log(`  📁 ${dest}`);
        console.log(`═══════════════════════════════════════════════\n`);
    }
}

main();
