/**
 * Record an animated GIF walkthrough of the entire AI Investigator app.
 *
 * Records a WebM video via Playwright, then converts to an optimized GIF
 * using ffmpeg's two-pass palette technique for high quality at small size.
 *
 * Usage:
 *   node record-gif.js              → headless recording + GIF conversion
 *   node record-gif.js --headed     → watch the recording in real-time
 *   node record-gif.js --no-vite    → skip starting Vite (assume it's running)
 *   node record-gif.js --webm-only  → skip GIF conversion (just produce WebM)
 *
 * Output:
 *   docs/demo/app-tour.webm   — raw Playwright recording
 *   docs/demo/app-tour.gif    — optimized animated GIF
 */

import { chromium } from 'playwright';
import { startServer, stopServer } from './mock-server.js';
import { spawn, execSync } from 'child_process';
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Lib
import { pause, VITE_PORT, MOCK_PORT } from './lib/helpers.js';
import { setRecordingState, injectOverlay } from './lib/overlay.js';

// Scene
import sceneGifTour from './scenes/scene-gif-tour.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, '..', '..', 'frontend');
const DEMO_DIR = resolve(__dirname, '..', '..', 'docs', 'demo');

const args = process.argv.slice(2);
const noVite = args.includes('--no-vite');
const headed = args.includes('--headed');
const webmOnly = args.includes('--webm-only');

const VIDEO_WIDTH = 1400;
const VIDEO_HEIGHT = 900;
const GIF_WIDTH = 800;  // Scale down for reasonable GIF file size
const GIF_FPS = 12;     // Good balance of smoothness vs file size

const cleanSegments = [];

// ---------------------------------------------------------------------------
// Vite management
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
// WebM → GIF conversion
// ---------------------------------------------------------------------------
function convertToGif(webmPath, gifPath) {
    console.log('\n🎨 Converting to GIF...');
    console.log(`  Input:  ${webmPath}`);
    console.log(`  Output: ${gifPath}`);
    console.log(`  Size:   ${GIF_WIDTH}px wide @ ${GIF_FPS}fps\n`);

    const palettePath = join(DEMO_DIR, '_palette.png');

    try {
        // Pass 1: Generate optimal palette from the video
        console.log('  Pass 1/2: Generating palette...');
        execSync(
            `ffmpeg -y -i "${webmPath}" -vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "${palettePath}"`,
            { stdio: 'pipe' },
        );

        // Pass 2: Use palette to produce high-quality GIF
        console.log('  Pass 2/2: Encoding GIF...');
        execSync(
            `ffmpeg -y -i "${webmPath}" -i "${palettePath}" -lavfi "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${gifPath}"`,
            { stdio: 'pipe' },
        );

        // Clean up palette
        try { unlinkSync(palettePath); } catch { /* ok */ }

        const sizeMB = (statSync(gifPath).size / (1024 * 1024)).toFixed(1);
        console.log(`  ✅ GIF created: ${sizeMB} MB`);
    } catch (err) {
        console.error('  ❌ GIF conversion failed:', err.message);
        console.error('  Make sure ffmpeg is installed and on PATH.');
        console.error('  You can still use the WebM file directly.');
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  AI Investigator — GIF Tour Recorder');
    console.log('═══════════════════════════════════════════════\n');

    if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true });

    console.log('🔧 Starting mock API server...');
    await startServer(MOCK_PORT);

    if (!noVite) { await startVite(); } else { console.log('  Skipping Vite (--no-vite)'); }
    await new Promise(r => setTimeout(r, 1500));

    console.log('\n🎥 Launching browser...\n');
    const browser = await chromium.launch({ headless: !headed });

    // ── Warm up Vite ──
    console.log('  🔥 Warming up Vite...');
    const warmCtx = await browser.newContext({
        viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
        colorScheme: 'dark',
    });
    const warmPage = await warmCtx.newPage();
    try {
        for (const path of ['/', '/new', '/settings', '/about', '/investigation/1749820000000']) {
            await warmPage.goto(`http://localhost:${VITE_PORT}${path}`, { waitUntil: 'networkidle', timeout: 20000 });
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) { console.log('    ⚠ Warm-up warning:', e.message); }
    await warmPage.close();
    await warmCtx.close();
    console.log('  ✅ Vite warmed up\n');

    // ── Create recording context ──
    const context = await browser.newContext({
        viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        recordVideo: { dir: DEMO_DIR, size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } },
    });
    const page = await context.newPage();

    // Anti-flash: inject dark CSS into every HTML document response
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (req.resourceType() !== 'document') return route.continue();
        // Force IPv4 — Node 23 resolves localhost to ::1 but Vite listens on 127.0.0.1
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
        // Start with a blank dark page
        await page.setContent('<html><body style="margin:0;background:#0a0e17"></body></html>');
        await injectOverlay(page);
        await pause(0.3);

        cleanSegments.push({ start: 0, end: null });

        // ── Run the full tour scene ──
        console.log('  🎬 Recording full tour...\n');
        await sceneGifTour(page);

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

    // ── Rename the Playwright output ──
    const webmDest = join(DEMO_DIR, 'app-tour.webm');
    const videoFiles = readdirSync(DEMO_DIR)
        .filter(f => f.endsWith('.webm') && f !== 'app-tour.webm')
        .map(f => ({ name: f, mtime: statSync(join(DEMO_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    if (videoFiles.length > 0) {
        const rawSrc = join(DEMO_DIR, videoFiles[0].name);
        try { unlinkSync(webmDest); } catch { /* ok */ }
        renameSync(rawSrc, webmDest);
        const sizeMB = (readFileSync(webmDest).length / (1024 * 1024)).toFixed(1);
        console.log(`\n📹 WebM saved: ${sizeMB} MB → ${webmDest}`);

        // ── Convert to GIF ──
        if (!webmOnly) {
            const gifDest = join(DEMO_DIR, 'app-tour.gif');
            convertToGif(webmDest, gifDest);
        }
    } else {
        console.error('❌ No WebM output file found!');
        process.exitCode = 1;
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log('  ✅ GIF tour recording complete!');
    console.log('  📁 Output: docs/demo/');
    console.log('═══════════════════════════════════════════════\n');
}

main();
