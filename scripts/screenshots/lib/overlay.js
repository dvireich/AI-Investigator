/**
 * Overlay system — cursor, highlights, captions, fade transitions.
 *
 * All visual elements are injected into the page DOM and controlled
 * via page.evaluate() calls.  The keepalive element forces Playwright's
 * VP8 encoder to produce frames even during static pauses.
 */

import { pause } from './helpers.js';

// These are set by the orchestrator via setRecordingState()
let recordingStartTime = 0;
let cleanSegments = [];

/** Let the orchestrator pass in the shared recording state. */
export function setRecordingState(startTime, segments) {
    recordingStartTime = startTime;
    cleanSegments = segments;
}

// ---------------------------------------------------------------------------
// Overlay injection
// ---------------------------------------------------------------------------

/**
 * Inject the persistent overlay container into the page.
 * Creates: #demo-fade, #demo-caption, #demo-cursor, #demo-cursor-ring,
 *          #demo-highlight, #demo-highlight-label, #demo-keepalive
 */
export async function injectOverlay(page, { startOpaque = false } = {}) {
    await page.evaluate(({ startOpaque }) => {
        // Remove any existing overlay elements (re-injection after navigation)
        for (const id of ['demo-fade', 'demo-caption-bar', 'demo-caption', 'demo-cursor', 'demo-cursor-ring', 'demo-highlight', 'demo-highlight-label', 'demo-keepalive']) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }

        const CAPTION_BAR_H = 120; // px — dedicated subtitle area

        // ── Permanent caption bar at the bottom ──
        const bar = document.createElement('div');
        bar.id = 'demo-caption-bar';
        Object.assign(bar.style, {
            position: 'fixed', left: '0', right: '0', bottom: '0',
            height: CAPTION_BAR_H + 'px', zIndex: '100003',
            background: '#060a13',
            borderTop: '1px solid rgba(56, 189, 248, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
        });
        document.body.appendChild(bar);

        // Caption text lives inside the bar
        const cap = document.createElement('div');
        cap.id = 'demo-caption';
        Object.assign(cap.style, {
            maxWidth: '1100px', width: '100%',
            textAlign: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            fontSize: '20px', fontWeight: '500',
            color: '#f1f5f9', letterSpacing: '0.01em',
            lineHeight: '1.45', padding: '0 40px',
            opacity: '0',
            transition: 'opacity 0.45s ease',
        });
        bar.appendChild(cap);

        // ── Fade overlay (covers content area only, not the caption bar) ──
        const fade = document.createElement('div');
        fade.id = 'demo-fade';
        Object.assign(fade.style, {
            position: 'fixed', top: '0', left: '0', right: '0',
            bottom: CAPTION_BAR_H + 'px',
            zIndex: '99999',
            background: '#0a0e17',
            opacity: startOpaque ? '1' : '0',
            pointerEvents: startOpaque ? 'all' : 'none',
            transition: 'opacity 0.6s ease-in-out',
        });
        document.body.appendChild(fade);

        // Reveal #root now that our overlay is covering it — clip to content area
        const root = document.getElementById('root');
        if (root) {
            root.style.visibility = 'visible';
            root.style.maxHeight = 'calc(100vh - ' + CAPTION_BAR_H + 'px)';
            root.style.overflow = 'hidden';
        }

        // Remove anti-flash style now that the opaque overlay is in place
        const antiFlash = document.getElementById('demo-anti-flash');
        if (antiFlash) antiFlash.remove();

        // ── Fake mouse cursor ──
        const cursor = document.createElement('div');
        cursor.id = 'demo-cursor';
        Object.assign(cursor.style, {
            position: 'fixed', zIndex: '100002', pointerEvents: 'none',
            width: '24px', height: '24px',
            left: '-50px', top: '-50px',
            transition: 'left 0.45s cubic-bezier(0.22,1,0.36,1), top 0.45s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease',
            opacity: '0',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
        });
        cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="#0a0e17" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>`;
        document.body.appendChild(cursor);

        // Click ripple ring
        const ring = document.createElement('div');
        ring.id = 'demo-cursor-ring';
        Object.assign(ring.style, {
            position: 'fixed', zIndex: '100001', pointerEvents: 'none',
            width: '40px', height: '40px', borderRadius: '50%',
            border: '2px solid rgba(56, 189, 248, 0.7)',
            left: '-50px', top: '-50px',
            transform: 'translate(-50%, -50%) scale(0)',
            opacity: '0',
        });
        document.body.appendChild(ring);

        // ── Highlight circle + label ──
        const hl = document.createElement('div');
        hl.id = 'demo-highlight';
        Object.assign(hl.style, {
            position: 'fixed', zIndex: '100000', pointerEvents: 'none',
            borderRadius: '50%',
            border: '2.5px solid rgba(56, 189, 248, 0.8)',
            boxShadow: '0 0 0 4px rgba(56, 189, 248, 0.15), 0 0 20px rgba(56, 189, 248, 0.2)',
            opacity: '0',
            transition: 'opacity 0.4s ease, left 0.4s ease, top 0.4s ease, width 0.4s ease, height 0.4s ease',
        });
        document.body.appendChild(hl);

        const hlLabel = document.createElement('div');
        hlLabel.id = 'demo-highlight-label';
        Object.assign(hlLabel.style, {
            position: 'fixed', zIndex: '100000', pointerEvents: 'none',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            fontSize: '14px', fontWeight: '600',
            color: '#38bdf8', letterSpacing: '0.02em',
            background: 'rgba(10, 14, 23, 0.9)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '8px', padding: '6px 14px',
            opacity: '0',
            transition: 'opacity 0.4s ease',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        });
        document.body.appendChild(hlLabel);

        // Add pulse animation for highlights
        if (!document.getElementById('demo-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'demo-pulse-style';
            style.textContent = `
                @keyframes demo-pulse {
                    0%, 100% { box-shadow: 0 0 0 4px rgba(56,189,248,0.15), 0 0 20px rgba(56,189,248,0.2); }
                    50% { box-shadow: 0 0 0 8px rgba(56,189,248,0.1), 0 0 30px rgba(56,189,248,0.3); }
                }
                @keyframes demo-click-ripple {
                    0% { transform: translate(-50%,-50%) scale(0); opacity: 0.7; }
                    100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        // ── Video keep-alive ──
        const keepAlive = document.createElement('div');
        keepAlive.id = 'demo-keepalive';
        Object.assign(keepAlive.style, {
            position: 'fixed', top: '0', left: '0',
            width: '1px', height: '1px',
            pointerEvents: 'none', zIndex: '99998',
            willChange: 'transform',
        });
        document.body.appendChild(keepAlive);

        (function __keepAliveLoop() {
            const el = document.getElementById('demo-keepalive');
            if (!el) return;
            const t = performance.now();
            el.style.transform = `translateZ(${(t % 2) * 0.1}px)`;
            requestAnimationFrame(__keepAliveLoop);
        })();
    }, { startOpaque });
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export async function showCaption(page, title, subtitle) {
    await page.evaluate(({ title, subtitle }) => {
        const cap = document.getElementById('demo-caption');
        if (!cap) return;
        cap.innerHTML = `<div style="font-size:13px;text-transform:uppercase;letter-spacing:0.14em;color:#38bdf8;margin-bottom:4px;font-weight:700">${title}</div>`
            + `<div>${subtitle}</div>`;
        cap.style.opacity = '1';
    }, { title, subtitle });
}

export async function hideCaption(page) {
    await page.evaluate(() => {
        const cap = document.getElementById('demo-caption');
        if (!cap) return;
        cap.style.opacity = '0';
    });
}

// ---------------------------------------------------------------------------
// Fake mouse cursor
// ---------------------------------------------------------------------------

export async function showCursor(page) {
    await page.evaluate(() => {
        const c = document.getElementById('demo-cursor');
        if (c) c.style.opacity = '1';
    });
}

export async function hideCursor(page) {
    await page.evaluate(() => {
        const c = document.getElementById('demo-cursor');
        if (c) c.style.opacity = '0';
    });
}

export async function cursorClick(page, locator, { pause: pauseSec = 0.3 } = {}) {
    const box = await locator.boundingBox();
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.evaluate(({ x, y }) => {
        const c = document.getElementById('demo-cursor');
        if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = '1'; }
    }, { x, y });
    await pause(0.5);

    await page.evaluate(({ x, y }) => {
        const ring = document.getElementById('demo-cursor-ring');
        if (ring) {
            ring.style.left = x + 'px';
            ring.style.top = y + 'px';
            ring.style.transform = 'translate(-50%,-50%) scale(0)';
            ring.style.opacity = '0.7';
            ring.style.transition = 'none';
            void ring.offsetHeight;
            ring.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
            ring.style.transform = 'translate(-50%,-50%) scale(1.5)';
            ring.style.opacity = '0';
        }
    }, { x, y });

    await locator.click();
    await pause(pauseSec);
}

export async function cursorMoveTo(page, locator) {
    const box = await locator.boundingBox();
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(({ x, y }) => {
        const c = document.getElementById('demo-cursor');
        if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = '1'; }
    }, { x, y });
    await pause(0.65);
}

export async function cursorMoveXY(page, x, y) {
    await page.evaluate(({ x, y }) => {
        const c = document.getElementById('demo-cursor');
        if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = '1'; }
    }, { x, y });
    await pause(0.4);
}

export async function cursorType(page, locator, text, { delayMs = 40 } = {}) {
    await cursorClick(page, locator, { pause: 0.2 });
    await locator.pressSequentially(text, { delay: delayMs });
}

// ---------------------------------------------------------------------------
// Highlight circle + callout
// ---------------------------------------------------------------------------

export async function showHighlight(page, locator, label, { padding = 16, labelPos = 'right' } = {}) {
    const box = await locator.boundingBox();
    if (!box) return;

    await page.evaluate(({ box, label, padding, labelPos }) => {
        const hl = document.getElementById('demo-highlight');
        const hlLabel = document.getElementById('demo-highlight-label');
        if (!hl || !hlLabel) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const rawSize = Math.max(box.width, box.height) + padding * 2;
        const size = Math.min(rawSize, vw * 0.6, vh * 0.6);
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        const margin = 4;
        const clampedLeft = Math.max(margin, Math.min(cx - size / 2, vw - size - margin));
        const clampedTop = Math.max(margin, Math.min(cy - size / 2, vh - size - margin));

        hl.style.width = size + 'px';
        hl.style.height = size + 'px';
        hl.style.left = clampedLeft + 'px';
        hl.style.top = clampedTop + 'px';
        hl.style.opacity = '1';
        hl.style.animation = 'demo-pulse 2s ease-in-out infinite';

        hlLabel.textContent = label;
        hlLabel.style.left = 'auto';
        hlLabel.style.right = 'auto';

        const gap = 12;
        let lx, ly;
        if (labelPos === 'right') {
            lx = cx + size / 2 + gap;
            ly = cy - 12;
        } else if (labelPos === 'left') {
            lx = cx - size / 2 - gap - 160;
            ly = cy - 12;
        } else if (labelPos === 'top') {
            lx = cx - 50;
            ly = cy - size / 2 - 36;
        } else {
            lx = cx - 50;
            ly = cy + size / 2 + gap;
        }

        lx = Math.max(8, Math.min(lx, vw - 200));
        ly = Math.max(8, Math.min(ly, vh - 40));

        hlLabel.style.left = lx + 'px';
        hlLabel.style.top = ly + 'px';
        hlLabel.style.opacity = '1';
    }, { box, label, padding, labelPos });
}

export async function hideHighlight(page) {
    await page.evaluate(() => {
        const hl = document.getElementById('demo-highlight');
        const hlLabel = document.getElementById('demo-highlight-label');
        if (hl) { hl.style.opacity = '0'; hl.style.animation = 'none'; }
        if (hlLabel) { hlLabel.style.opacity = '0'; }
    });
}

// ---------------------------------------------------------------------------
// Fade transition
// ---------------------------------------------------------------------------

/**
 * Fade to black, perform the scene setup (navigate, set fixture, etc.),
 * then fade back in. This hides the jarring page reload between scenes.
 */
export async function fadeTransition(page, setupFn) {
    const fadeOutTime = (Date.now() - recordingStartTime) / 1000;
    if (cleanSegments.length > 0) {
        cleanSegments[cleanSegments.length - 1].end = fadeOutTime;
    }

    await page.evaluate(() => {
        const fade = document.getElementById('demo-fade');
        if (fade) { fade.style.opacity = '1'; fade.style.pointerEvents = 'all'; }
    });
    await pause(0.65);

    await setupFn();

    await injectOverlay(page, { startOpaque: true });

    // Wait for React / Vite lazy chunks to finish rendering
    // behind the opaque overlay before we reveal.
    // Also wait for networkidle to ensure all async chunks are loaded.
    await page.waitForLoadState('networkidle').catch(() => {});
    await pause(2.5);

    await page.evaluate(() => {
        const fade = document.getElementById('demo-fade');
        if (fade) { fade.style.opacity = '0'; fade.style.pointerEvents = 'none'; }
    });
    await pause(0.6);

    const fadeInTime = (Date.now() - recordingStartTime) / 1000;
    cleanSegments.push({ start: fadeInTime, end: null });
}
