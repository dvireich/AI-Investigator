/**
 * Preview recorder — records just Scene 1 (case study + pipeline builder)
 * so you can quickly iterate on the look and feel.
 *
 * Usage:
 *   node preview-scene1.js              → headless
 *   node preview-scene1.js --headed     → watch in real-time
 *   node preview-scene1.js --no-vite    → skip Vite (assume running)
 *
 * Output:
 *   docs/demo/preview-scene1.webm
 */

import { chromium } from 'playwright';
import { startServer, stopServer } from './mock-server.js';
import { spawn } from 'child_process';
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Lib
import { pause, VITE_PORT, MOCK_PORT } from './lib/helpers.js';
import { setRecordingState, injectOverlay, showCaption, hideCaption } from './lib/overlay.js';
import { showTitleCard, showCaseStudyCard } from './lib/cards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, '..', '..', 'frontend');
const DEMO_DIR = resolve(__dirname, '..', '..', 'docs', 'demo');

const ICON_PATH = join(FRONTEND_DIR, 'public', 'icon-circle.png');
const ICON_DATA_URL = existsSync(ICON_PATH)
    ? `data:image/png;base64,${readFileSync(ICON_PATH).toString('base64')}`
    : null;

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
    console.log('  Scene 1 Preview — Title + Case Study');
    console.log('═══════════════════════════════════════════════\n');

    if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true });

    console.log('🔧 Starting mock API server...');
    await startServer(MOCK_PORT);

    if (!noVite) { await startVite(); } else { console.log('  Skipping Vite (--no-vite)'); }
    await new Promise(r => setTimeout(r, 1500));

    console.log('\n🎥 Launching browser...\n');
    const browser = await chromium.launch({
        headless: !headed,
        args: [
            '--disable-gpu-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
        ],
    });

    // ── Warm up Vite: visit all pages we'll record so module bundles are cached ──
    console.log('  🔥 Warming up Vite...');
    const warmCtx = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        colorScheme: 'dark',
    });
    const warmPage = await warmCtx.newPage();
    try {
        await warmPage.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'networkidle', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
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
        await page.setContent(`<html><body style="margin:0;background:#0a0e17"></body></html>`);
        await pause(0.3);

        // Inject caption bar + overlays on the blank start page
        await injectOverlay(page);

        cleanSegments.push({ start: 0, end: null });

        // ── TITLE CARD ──
        console.log('  🎬 Title Card');
        await showTitleCard(page,
            'AI Investigator',
            'A multi-agent pipeline that investigates, learns, and improves —\nevery investigation makes the next one better',
            4.5,
            {
                imageUrl: ICON_DATA_URL,
                whileDisplayed: async () => {
                    await pause(0.7);
                    await showCaption(page,
                        'AI Investigator',
                        'Deploy autonomous AI agents to investigate complex production issues and learn from every investigation.');
                    await pause(5.3);
                    await hideCaption(page);
                    await pause(0.3);
                },
            });

        // ── CASE STUDY CARD — Show the problem ──
        console.log('  🎬 Case Study Card');
        await showCaseStudyCard(page, 14, {
            whileDisplayed: async () => {
                await showCaption(page,
                    'The Partnership',
                    'Our team powers the AI Foundry pipeline, a critical partnership processing 361k messages per hour.');
                await pause(6);
                await hideCaption(page);
                await pause(1);
                await showCaption(page,
                    'The Problem',
                    'The SLA requires P90 latency under 7.5 seconds, but we\'re averaging around 10 seconds.');
                await pause(4.8);
                await showCaption(page,
                    'The Challenge',
                    'That\'s 2.5 extra seconds we need to eliminate, but where is the latency hiding, and where do we even start?');
                await pause(6.4);
                await hideCaption(page);
                await pause(0.3);
            },
        });

        // ── TRANSITION MESSAGE — We'll solve this with AI Investigator ──
        console.log('  🎬 Transition Message');
        await showTitleCard(page,
            'Let\'s Solve This',
            'We\'ll use AI Investigator to find the root cause —\ndeploy AI agents to investigate, pinpoint causes, and recommend fixes',
            5,
            {
                imageUrl: ICON_DATA_URL,
                whileDisplayed: async () => {
                    await showCaption(page,
                        'The Plan',
                        'We\'ll deploy AI agents to investigate the latency, pinpoint root causes, and recommend concrete fixes.');
                    await pause(5.5);
                    await hideCaption(page);
                    await pause(0.3);
                },
            });

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

    // Rename output — find the newest webm by modification time (not alphabetically!)
    const dest = join(DEMO_DIR, 'preview-scene1.webm');
    const videoFiles = readdirSync(DEMO_DIR)
        .filter(f => f.endsWith('.webm') && f !== 'preview-scene1.webm')
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

main().then(() => {
    if (!process.exitCode) process.exitCode = 0;
});
