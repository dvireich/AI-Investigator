/**
 * Full-screen presentation cards — title cards and the case-study card.
 */

import { pause } from './helpers.js';

/**
 * Show a full-screen title card (dark gradient bg with centered text).
 * Optionally displays an image above the heading (e.g. the investigator icon).
 */
export async function showTitleCard(page, heading, tagline, durationSec = 3.5, { imageUrl, whileDisplayed } = {}) {
    await page.evaluate(({ heading, tagline, imageUrl }) => {
        const card = document.createElement('div');
        card.id = 'demo-title-card';
        Object.assign(card.style, {
            position: 'fixed', top: '0', left: '0', right: '0',
            bottom: '120px', zIndex: '100001',
            background: 'linear-gradient(135deg, #0a0e17 0%, #0f172a 100%)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            opacity: '0',
            transition: 'opacity 0.8s ease-in-out',
        });
        const imgHtml = imageUrl
            ? `<img src="${imageUrl}" style="width:120px;height:120px;border-radius:50%;margin-bottom:28px;box-shadow:0 0 40px rgba(56,189,248,0.25)" />`
            : '';
        card.innerHTML = `
            ${imgHtml}
            <div style="font-size:48px;font-weight:700;color:#f1f5f9;letter-spacing:-0.02em;margin-bottom:16px;text-align:center">${heading}</div>
            <div style="font-size:20px;font-weight:400;color:#94a3b8;letter-spacing:0.02em;text-align:center;max-width:600px;line-height:1.6">${tagline}</div>
        `;
        document.body.appendChild(card);
        void card.offsetHeight;
        card.style.opacity = '1';
    }, { heading, tagline, imageUrl });
    if (whileDisplayed) {
        await whileDisplayed();
    } else {
        await pause(durationSec);
    }

    await page.evaluate(() => {
        const card = document.getElementById('demo-title-card');
        if (card) card.style.opacity = '0';
    });
    await pause(0.9);
    await page.evaluate(() => {
        const card = document.getElementById('demo-title-card');
        if (card) card.remove();
    });
}

/**
 * Show a rich case-study presentation card with blue gradient,
 * spiky latency time-series chart, and AI Foundry target line.
 */
export async function showCaseStudyCard(page, durationSec = 6, { whileDisplayed } = {}) {
    await page.evaluate(() => {
        const card = document.createElement('div');
        card.id = 'demo-title-card';
        Object.assign(card.style, {
            position: 'fixed', top: '0', left: '0', right: '0',
            bottom: '120px', zIndex: '100001',
            background: 'linear-gradient(135deg, #0c1a3a 0%, #0a2e6b 40%, #1e3a8a 100%)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            opacity: '0',
            transition: 'opacity 0.8s ease-in-out',
            padding: '0 60px',
        });

        card.innerHTML = `
            <!-- top label -->
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.18em;color:#60a5fa;margin-bottom:12px;font-weight:600">Study Case</div>

            <!-- heading -->
            <div style="font-size:38px;font-weight:700;color:#f1f5f9;letter-spacing:-0.02em;text-align:center;margin-bottom:8px;line-height:1.25">
                Reduce Pipeline Latency
            </div>
            <div style="font-size:20px;color:#93c5fd;text-align:center;margin-bottom:36px;font-weight:400">
                AI Foundry partnership requires P90 latency ≤ 7.5s — current P90 is ~10s
            </div>

            <!-- latency time-series chart -->
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:24px 28px 16px;max-width:700px;width:100%">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;font-weight:600">P90 End-to-End Latency</div>
                    <div style="display:flex;gap:18px;font-size:11px">
                        <span style="color:#fca5a5">● <span style="color:#94a3b8">Current P90</span></span>
                        <span style="color:#4ade80">● <span style="color:#94a3b8">AI Foundry SLA</span></span>
                    </div>
                </div>
                <svg viewBox="0 0 700 250" style="width:100%;height:auto">
                    <defs>
                        <linearGradient id="redArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.35"/>
                            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.03"/>
                        </linearGradient>
                    </defs>
                    <!-- grid lines -->
                    <line x1="55" y1="20"    x2="680" y2="20"    stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="47.1"  x2="680" y2="47.1"  stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="74.3"  x2="680" y2="74.3"  stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="101.4" x2="680" y2="101.4" stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="128.6" x2="680" y2="128.6" stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="155.7" x2="680" y2="155.7" stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="182.9" x2="680" y2="182.9" stroke="rgba(255,255,255,0.06)"/>
                    <line x1="55" y1="210"   x2="680" y2="210"   stroke="rgba(255,255,255,0.1)"/>
                    <!-- Y-axis labels (0 s – 14 s) -->
                    <text x="48" y="24"  fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">14s</text>
                    <text x="48" y="51"  fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">12s</text>
                    <text x="48" y="78"  fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">10s</text>
                    <text x="48" y="105" fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">8s</text>
                    <text x="48" y="133" fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">6s</text>
                    <text x="48" y="160" fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">4s</text>
                    <text x="48" y="187" fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">2s</text>
                    <text x="48" y="214" fill="#64748b" font-size="11" text-anchor="end" font-family="Inter,system-ui,sans-serif">0s</text>
                    <!-- X-axis labels -->
                    <text x="55"  y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-60m</text>
                    <text x="159" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-50m</text>
                    <text x="263" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-40m</text>
                    <text x="367" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-30m</text>
                    <text x="472" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-20m</text>
                    <text x="576" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">-10m</text>
                    <text x="680" y="232" fill="#64748b" font-size="11" text-anchor="middle" font-family="Inter,system-ui,sans-serif">Now</text>
                    <!-- AI Foundry target line (7.5 s) — green dashed -->
                    <line x1="55" y1="108.2" x2="680" y2="108.2" stroke="#22c55e" stroke-width="2" stroke-dasharray="8,5"/>
                    <rect x="562" y="93" width="116" height="20" rx="4" fill="rgba(34,197,94,0.15)"/>
                    <text x="620" y="106" fill="#4ade80" font-size="11" text-anchor="middle" font-weight="600" font-family="Inter,system-ui,sans-serif">AI Foundry: 7.5s</text>
                    <!-- Red area fill (latency above baseline) -->
                    <path d="M55,85.1 L82.2,53.9 L109.3,90.6 L136.5,70.2 L163.7,45.8 L190.9,81.1 L218,63.4 L245.2,58 L272.4,94.6 L299.6,64.8 L326.7,49.9 L353.9,86.5 L381.1,67.5 L408.3,43.1 L435.4,77 L462.6,72.9 L489.8,52.6 L517,89.2 L544.1,62.1 L571.3,55.3 L598.5,83.8 L625.7,66.1 L652.8,59.4 L680,71.6 L680,210 L55,210 Z" fill="url(#redArea)"/>
                    <!-- Red spiky line -->
                    <path d="M55,85.1 L82.2,53.9 L109.3,90.6 L136.5,70.2 L163.7,45.8 L190.9,81.1 L218,63.4 L245.2,58 L272.4,94.6 L299.6,64.8 L326.7,49.9 L353.9,86.5 L381.1,67.5 L408.3,43.1 L435.4,77 L462.6,72.9 L489.8,52.6 L517,89.2 L544.1,62.1 L571.3,55.3 L598.5,83.8 L625.7,66.1 L652.8,59.4 L680,71.6" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <!-- Highlight dots on peaks -->
                    <circle cx="163.7" cy="45.8" r="3.5" fill="#ef4444"/>
                    <circle cx="408.3" cy="43.1" r="3.5" fill="#ef4444"/>
                    <circle cx="326.7" cy="49.9" r="3.5" fill="#ef4444"/>
                    <circle cx="489.8" cy="52.6" r="3.5" fill="#ef4444"/>
                    <!-- Average annotation -->
                    <rect x="60" y="60" width="74" height="20" rx="4" fill="rgba(239,68,68,0.18)"/>
                    <text x="97" y="74" fill="#fca5a5" font-size="11" text-anchor="middle" font-weight="600" font-family="Inter,system-ui,sans-serif">avg ~10s</text>
                </svg>
            </div>

            <!-- stamp label -->
            <div style="margin-top:24px;font-size:13px;color:#64748b;text-align:center">
                Stamp: <span style="color:#93c5fd;font-weight:500">oi-tds-prd-eus2p-02</span> · 361K messages/hr · Time range: last 1 hour
            </div>
        `;

        document.body.appendChild(card);
        void card.offsetHeight;
        card.style.opacity = '1';
    });
    if (whileDisplayed) {
        await whileDisplayed();
    } else {
        await pause(durationSec);
    }

    await page.evaluate(() => {
        const card = document.getElementById('demo-title-card');
        if (card) card.style.opacity = '0';
    });
    await pause(0.9);
    await page.evaluate(() => {
        const card = document.getElementById('demo-title-card');
        if (card) card.remove();
    });
}
