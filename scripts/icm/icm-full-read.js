/**
 * IcM Full Incident Reader — REST API approach
 *
 * Uses the IcM REST API (prod.microsofticm.com/api2) via the browser's
 * authenticated session. This avoids fragile DOM scraping entirely and
 * returns structured JSON data.
 *
 * The browser is only used as an auth proxy — we run fetch() inside the
 * browser context so the existing IcM SSO cookies/tokens are sent
 * automatically. No page navigation or DOM parsing is needed beyond the
 * initial IcM portal visit to establish the auth session.
 */

const { getPlaywrightChromium } = require('./ensure-dependencies');
const chromium = getPlaywrightChromium();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEBUGGING_PORT = 9222;
const PLAYWRIGHT_EDGE_DATA = path.join(process.env.LOCALAPPDATA, 'Playwright-Edge-Copilot');

/**
 * Emit a structured progress event to stdout (consumed by the backend SSE stream).
 * Format: [PROGRESS] JSON
 */
function emitProgress(step, status, detail) {
    const event = { type: 'progress', step, status, detail, ts: Date.now() };
    console.log(`[PROGRESS] ${JSON.stringify(event)}`);
}

/**
 * Emit a structured data event to stdout.
 * Format: [DATA] JSON
 */
function emitData(key, value) {
    const event = { type: 'data', key, value };
    console.log(`[DATA] ${JSON.stringify(event)}`);
}

async function isDebuggingPortOpen() {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${DEBUGGING_PORT}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
}

async function ensurePlaywrightEdge() {
    let debuggingActive = await isDebuggingPortOpen();
    if (!debuggingActive) {
        emitProgress('connect', 'running', 'Launching Edge browser...');
        if (!fs.existsSync(PLAYWRIGHT_EDGE_DATA)) {
            fs.mkdirSync(PLAYWRIGHT_EDGE_DATA, { recursive: true });
        }
        const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        const edgeProcess = spawn(edgePath, [
            `--remote-debugging-port=${DEBUGGING_PORT}`,
            `--user-data-dir=${PLAYWRIGHT_EDGE_DATA}`,
            '--no-first-run', '--no-default-browser-check',
            // Use a real window size so popup windows (AAD identity provider
            // selection, consent prompts, etc.) inherit usable dimensions.
            // --start-minimized keeps the window hidden until we need it.
            '--window-size=1024,768',
            '--start-minimized',
            'about:blank'
        ], { detached: true, stdio: 'ignore', windowsHide: true });
        edgeProcess.unref();
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (await isDebuggingPortOpen()) { debuggingActive = true; break; }
        }
        if (!debuggingActive) { console.error('Failed to start Edge.'); process.exit(1); }
    } else {
        emitProgress('connect', 'running', 'Connecting to existing Edge session...');
    }
    return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUGGING_PORT}`);
}

/**
 * Bring the browser window to the foreground when user interaction is needed
 * (e.g., for authentication). Moves window to visible position and resizes.
 *
 * CDP requires two separate calls when the window is minimized:
 *   1. First set windowState to 'normal' (cannot change bounds while minimized)
 *   2. Then set the position and size bounds
 */
async function bringBrowserToForeground(page) {
    try {
        // Get the CDP session to control window position
        const client = await page.context().newCDPSession(page);
        
        // Get current window info
        const { windowId, bounds: currentBounds } = await client.send('Browser.getWindowForTarget');
        
        // Step 1: If window is minimized, restore it first (CDP won't change
        // geometry while minimized — the bounds update is silently ignored).
        if (currentBounds.windowState === 'minimized') {
            await client.send('Browser.setWindowBounds', {
                windowId,
                bounds: { windowState: 'normal' }
            });
            // Small delay to let the window manager process the state change
            await new Promise(r => setTimeout(r, 200));
        }

        // Step 2: Now set position and size
        await client.send('Browser.setWindowBounds', {
            windowId,
            bounds: {
                left: 100,
                top: 100,
                width: 1024,
                height: 768,
                windowState: 'normal'
            }
        });
        
        // Bring to front
        await page.bringToFront();
    } catch (e) {
        // Fallback: try to at least bring the page to front
        try { await page.bringToFront(); } catch { /* ignore */ }
    }

    // Listen for popup windows (AAD identity provider selection, consent
    // prompts, etc.) and resize them so the user can interact with them.
    // Without this, popups inherit a tiny size and are unusable.
    const context = page.context();
    if (!context._popupResizeRegistered) {
        context._popupResizeRegistered = true;
        context.on('page', async (popup) => {
            try {
                // Wait for popup to have a meaningful URL (skip about:blank)
                await popup.waitForLoadState('domcontentloaded').catch(() => {});
                const popupClient = await context.newCDPSession(popup);
                const { windowId: popupWindowId, bounds: popupBounds } = await popupClient.send('Browser.getWindowForTarget');

                // Restore if minimized
                if (popupBounds.windowState === 'minimized') {
                    await popupClient.send('Browser.setWindowBounds', {
                        windowId: popupWindowId,
                        bounds: { windowState: 'normal' }
                    });
                    await new Promise(r => setTimeout(r, 200));
                }

                // Resize and reposition — center it nicely
                await popupClient.send('Browser.setWindowBounds', {
                    windowId: popupWindowId,
                    bounds: {
                        left: 200,
                        top: 150,
                        width: 600,
                        height: 700,
                        windowState: 'normal'
                    }
                });
                await popup.bringToFront();
            } catch {
                // Popup may have closed before we could resize — ignore
            }
        });
    }
}

// ---------------------------------------------------------------------------
// IcM REST API helpers — intercept API responses from the portal's own calls
// ---------------------------------------------------------------------------

/**
 * Navigate to an IcM incident page and capture the API responses that the
 * portal SPA makes automatically. This leverages the portal's own auth tokens
 * and avoids CORS/token issues with direct fetch().
 *
 * We listen for network responses via Playwright's 'response' event — this is
 * non-intrusive and doesn't interfere with the portal's normal operation.
 */
async function interceptIncidentData(page, incidentId) {
    const captured = {
        details: null,
        descriptions: null,
    };

    // Set up response listener BEFORE navigating
    const responseHandler = async (response) => {
        const url = response.url();
        if (!url.includes('/api2/')) return;

        try {
            if (url.includes('GetIncidentDetails') && response.status() === 200) {
                const body = await response.json();
                captured.details = body;
            } else if (url.includes('getdescriptionentries') && response.status() === 200) {
                const body = await response.json();
                captured.descriptions = body;
            }
        } catch {
            // Response body may not be available or not JSON — ignore
        }
    };

    page.on('response', responseHandler);

    // Navigate to the incident summary page — this triggers the portal's API calls
    emitProgress('navigate', 'running', `Loading incident ${incidentId}...`);
    await page.goto(
        `https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/summary`,
        { waitUntil: 'networkidle', timeout: 60000 }
    );

    // Detect authentication requirement — check multiple signals:
    // 1. Full-page redirect to login domain
    // 2. Page content containing login forms (popup/iframe auth)
    // 3. Page not on microsofticm.com at all
    const currentUrl = page.url();
    const isOnLoginPage = currentUrl.includes('login.microsoftonline.com') || 
        currentUrl.includes('login.live.com') ||
        currentUrl.includes('login.windows.net');
    const isOnIcmPage = currentUrl.includes('microsofticm.com');
    
    // Also check if the page body suggests we're on a login/error page even if URL looks right
    let needsAuth = isOnLoginPage || !isOnIcmPage;
    if (!needsAuth && isOnIcmPage) {
        try {
            // Check if the portal SPA actually loaded (has incident-related content)
            // vs. showing an auth wall or error within the IcM domain
            needsAuth = await page.evaluate(() => {
                const body = document.body?.innerText || '';
                // IcM login redirects sometimes stay on the microsofticm domain
                // but show "Sign in" or empty pages
                if (body.length < 100) return true; // Nearly empty page = auth wall
                if (/sign\s*in|log\s*in|authentication\s*required/i.test(body) && body.length < 500) return true;
                return false;
            });
        } catch {
            // If evaluate fails, page might not be loaded properly
            needsAuth = true;
        }
    }

    if (needsAuth) {
        emitProgress('auth', 'running', 'Authentication required — please log in via the browser window...');
        
        // Bring browser window to foreground so user can log in
        await bringBrowserToForeground(page);
        
        // If we're not on the IcM page, navigate there to trigger the login redirect
        if (!isOnIcmPage && !isOnLoginPage) {
            await page.goto('https://portal.microsofticm.com/', { waitUntil: 'networkidle', timeout: 30000 });
        }
        
        // Wait for user to complete login and land on IcM (up to 3 minutes)
        try {
            await page.waitForURL('**/microsofticm.com/**', { timeout: 180000 });
            emitProgress('auth', 'done', 'Authenticated successfully');
            
            // Give the SPA time to load after auth redirect
            await page.waitForTimeout(3000);
            
            // Re-navigate to the actual incident page now that we're authenticated
            emitProgress('navigate', 'running', `Re-loading incident ${incidentId} after authentication...`);
            await page.goto(
                `https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/summary`,
                { waitUntil: 'networkidle', timeout: 60000 }
            );
            
            // Wait for SPA API calls to complete
            await page.waitForTimeout(5000);
        } catch (e) {
            emitProgress('auth', 'error', 'Login timeout — please try again');
            throw new Error('Authentication timeout');
        }
    }

    // Give the SPA a moment to complete any deferred API calls
    await page.waitForTimeout(3000);

    // If we didn't capture the details (maybe the portal cached them), try fetching directly
    if (!captured.details) {
        emitProgress('details', 'running', 'Fetching details via page context...');
        try {
            captured.details = await page.evaluate(async (id) => {
                const resp = await fetch(
                    `https://prod.microsofticm.com/api2/incidentapi/incidents(${id})/GetIncidentDetails` +
                    '?$expand=Attachments,CustomFields,ImpactedServices,ImpactedComponents,ImpactedTeams,AlertSource,RootCause,Tracking',
                    { credentials: 'include' }
                );
                return resp.ok ? await resp.json() : { error: true, status: resp.status };
            }, incidentId);
        } catch (e) {
            emitProgress('details', 'error', `Details fetch failed: ${e.message}`);
        }
    }

    // If both interception AND direct fetch failed, the auth cookies may be invalid.
    // Try one more time: bring browser to foreground so user can manually authenticate.
    if (!captured.details || captured.details.error) {
        emitProgress('auth', 'running', 'Data fetch failed — please verify you are logged in to IcM in the browser window...');
        await bringBrowserToForeground(page);
        
        // Navigate to IcM portal root to trigger any auth prompts
        try {
            await page.goto('https://portal.microsofticm.com/', { waitUntil: 'networkidle', timeout: 30000 });
        } catch { /* ignore nav errors */ }

        // Wait up to 2 minutes for user to sort out auth
        emitProgress('auth', 'running', 'Waiting for authentication — log in via the Edge browser window and then this will auto-retry...');
        await page.waitForTimeout(10000); // Give 10s for user to notice

        // Retry: navigate to incident and capture again
        try {
            captured.details = null;
            captured.descriptions = null;
            page.on('response', responseHandler);

            await page.goto(
                `https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/summary`,
                { waitUntil: 'networkidle', timeout: 60000 }
            );
            await page.waitForTimeout(5000);

            // Try direct fetch if interception still didn't work
            if (!captured.details) {
                captured.details = await page.evaluate(async (id) => {
                    const resp = await fetch(
                        `https://prod.microsofticm.com/api2/incidentapi/incidents(${id})/GetIncidentDetails` +
                        '?$expand=Attachments,CustomFields,ImpactedServices,ImpactedComponents,ImpactedTeams,AlertSource,RootCause,Tracking',
                        { credentials: 'include' }
                    );
                    return resp.ok ? await resp.json() : { error: true, status: resp.status };
                }, incidentId);
            }
            if (!captured.descriptions) {
                captured.descriptions = await page.evaluate(async (id) => {
                    const resp = await fetch(
                        `https://prod.microsofticm.com/api2/incidentapi/incidents/${id}/getdescriptionentries?$top=100&$skip=0`,
                        { credentials: 'include' }
                    );
                    return resp.ok ? await resp.json() : { error: true, status: resp.status };
                }, incidentId);
            }
            page.removeListener('response', responseHandler);

            if (captured.details && !captured.details.error) {
                emitProgress('auth', 'done', 'Authentication recovered — data loaded');
            }
        } catch (e) {
            emitProgress('auth', 'error', `Retry failed: ${e.message}. Please close all Edge windows, re-fetch the incident, and log in when prompted.`);
        }
    } else {
        // First attempt succeeded — still fetch descriptions if missing
        if (!captured.descriptions) {
            emitProgress('discussion', 'running', 'Fetching discussion via page context...');
            try {
                captured.descriptions = await page.evaluate(async (id) => {
                    const resp = await fetch(
                        `https://prod.microsofticm.com/api2/incidentapi/incidents/${id}/getdescriptionentries?$top=100&$skip=0`,
                        { credentials: 'include' }
                    );
                    return resp.ok ? await resp.json() : { error: true, status: resp.status };
                }, incidentId);
            } catch (e) {
                emitProgress('discussion', 'error', `Discussion fetch failed: ${e.message}`);
            }
        }
    }

    // Remove response listener (in case it wasn't already removed)
    try { page.removeListener('response', responseHandler); } catch { /* ignore */ }

    return captured;
}

// ---------------------------------------------------------------------------
// Severity & state mapping
// ---------------------------------------------------------------------------

/**
 * IcM stores severity as an integer that encodes severity + sub-severity.
 * Common values: 10=Sev0, 15=Sev1, 20=Sev1.5, 25=Sev2, 30=Sev3, 35=Sev3.5, 40=Sev4
 * Display severity = Math.floor(value / 10).
 */
function mapSeverity(rawSeverity) {
    if (rawSeverity == null) return 'Unknown';
    const num = typeof rawSeverity === 'number' ? rawSeverity : parseInt(rawSeverity, 10);
    if (isNaN(num)) return String(rawSeverity);
    if (num >= 0 && num <= 4) return String(num);  // Already a simple severity
    return String(Math.floor(num / 10));            // e.g. 25 → 2
}

function mapState(state) {
    const stateMap = {
        'ACTIVE': 'Active',
        'MITIGATED': 'Mitigated',
        'RESOLVED': 'Resolved',
        'CLOSED': 'Closed',
    };
    return stateMap[state?.toUpperCase()] || state || 'Unknown';
}

// ---------------------------------------------------------------------------
// HTML → plain text conversion for discussion entries
// ---------------------------------------------------------------------------

function htmlToText(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')          // Strip remaining tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')       // Collapse excessive newlines
        .trim();
}

// ---------------------------------------------------------------------------
// Build structured output from API data
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    } catch {
        return dateStr;
    }
}

function calcDuration(impactStartTime) {
    if (!impactStartTime) return '';
    const start = new Date(impactStartTime);
    const now = new Date();
    const diffMs = now - start;
    if (diffMs < 0) return '';
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${hours}h`);
    parts.push(`${mins}m`);
    return parts.join(' ');
}

function buildMetadata(details) {
    const stampMatch = (details.Title || '').match(/(oi-tds-[\w-]+|ax-tds-[\w-]+)/i);
    return {
        title: details.Title || '',
        severity: mapSeverity(details.Severity),
        status: mapState(details.State),
        stamp: stampMatch ? stampMatch[0] : '',
        owningTeam: details.OwningTeamName || '',
        owner: details.ContactDisplayName || details.ContactAlias || '',
        created: details.CreatedDate || '',
        impactingFrom: details.ImpactStartTime || details.SourceCreateTime || '',
        mitigateTime: details.MitigateTime || '',
        duration: calcDuration(details.ImpactStartTime),
        monitorId: details.MonitorId || '',
        routingId: details.RoutingId || '',
        hitCount: details.HitCount || 0,
        rootCauseOption: details.RootCauseOption || '',
        incidentType: details.Type || '',
        correlationId: details.CorrelationId || '',
    };
}

function buildSummarySection(details, descriptions) {
    const parts = [];
    const entries = descriptions?.Items || descriptions || [];

    if (Array.isArray(entries) && entries.length > 0) {
        parts.push('Discussion entries:');
        for (const entry of entries) {
            const date = entry.SubmitDate || entry.Date || '';
            const author = entry.SubmittedByDisplayName || entry.SubmittedBy || '';
            const category = entry.Category || '';
            const text = entry.IsHtml ? htmlToText(entry.Text || '') : (entry.Text || '').trim();

            if (text) {
                const header = [category, author, date ? `at ${formatDate(date)}` : '']
                    .filter(Boolean).join(' — ');
                parts.push(`\n[${header}]`);
                parts.push(text.substring(0, 2000));
            }
        }
    } else {
        parts.push('No discussion entries.');
    }

    return parts.join('\n');
}

function buildImpactSection(details) {
    const parts = [];

    // Impact timing
    if (details.ImpactStartTime) parts.push(`Impact start: ${formatDate(details.ImpactStartTime)}`);
    if (details.MitigateTime) parts.push(`Mitigation time: ${formatDate(details.MitigateTime)}`);
    if (details.LastCorrelationTime) parts.push(`Last correlated: ${formatDate(details.LastCorrelationTime)}`);
    parts.push(`Hit count: ${details.HitCount || 0}`);

    // Monitor info
    if (details.MonitorId) {
        parts.push(`\nMonitor: ${details.MonitorId}`);
        if (details.MonitorName) parts.push(`Monitor name: ${details.MonitorName}`);
    }

    // Alert source
    if (details.AlertSource?.Name) parts.push(`Alert source: ${details.AlertSource.Name}`);

    // Classification
    parts.push(`\nIncident type: ${details.Type || 'N/A'}`);
    parts.push(`Source origin: ${details.SourceOrigin || 'N/A'}`);
    parts.push(`Routing ID: ${details.RoutingId || 'N/A'}`);
    if (details.CloudName) parts.push(`Cloud: ${details.CloudName}`);
    parts.push(`Is customer impacting: ${details.IsCustomerImpacting ? 'Yes' : 'No'}`);
    parts.push(`Is security risk: ${details.IsSecurityRisk ? 'Yes' : 'No'}`);

    // Impacted services & components
    if (details.ImpactedServices?.length > 0) {
        const services = details.ImpactedServices.map(s => s.ServiceName || `ServiceId:${s.ServiceId}`);
        parts.push(`\nImpacted services: ${services.join(', ')}`);
    }
    if (details.ImpactedComponents?.length > 0) {
        const components = details.ImpactedComponents.map(c => c.ComponentName || c.Value || JSON.stringify(c));
        parts.push(`Impacted components: ${components.join(', ')}`);
    }
    if (details.ImpactedTeams?.length > 0) {
        const teams = details.ImpactedTeams.map(t => t.TeamName || `TeamId:${t.TeamId}`);
        parts.push(`Impacted teams: ${teams.join(', ')}`);
    }

    // Custom fields
    if (details.CustomFields?.length > 0) {
        parts.push('\nCustom fields:');
        for (const cf of details.CustomFields) {
            parts.push(`  ${cf.Name || cf.FieldName}: ${cf.Value || cf.FieldValue || 'N/A'}`);
        }
    }

    // Correlation ID (contains monitor + resource info)
    if (details.CorrelationId) parts.push(`\nCorrelation ID: ${details.CorrelationId}`);

    return parts.join('\n');
}

function buildRootCauseSection(details) {
    const parts = [];
    const rc = details.RootCause;

    parts.push(`Root cause status: ${details.RootCauseOption || 'N/A'}`);

    if (rc && (rc.Title || rc.Description || rc.Category)) {
        if (rc.Title) parts.push(`Title: ${rc.Title}`);
        if (rc.Category) parts.push(`Category: ${rc.Category}`);
        if (rc.SubCategory) parts.push(`Sub-category: ${rc.SubCategory}`);
        if (rc.Description) parts.push(`Description: ${rc.Description}`);
        if (rc.IsCausedByChange != null) parts.push(`Caused by change: ${rc.IsCausedByChange ? 'Yes' : 'No'}`);
    } else {
        parts.push('No root cause data.');
    }

    // Mitigation info
    parts.push('');
    if (details.MitigateTime) {
        parts.push(`Mitigated at: ${formatDate(details.MitigateTime)}`);
        if (details.HowFixed) parts.push(`How fixed: ${details.HowFixed}`);
    } else {
        parts.push('Not yet mitigated.');
    }

    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function readFullIncident(incidentId) {
    const browser = await ensurePlaywrightEdge();
    emitProgress('connect', 'done', 'Connected to Edge');

    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('microsofticm')) || context.pages()[0];
    if (!page || page.url() === 'about:blank') { page = await context.newPage(); }

    try {
        // Navigate to incident page and intercept API responses
        const captured = await interceptIncidentData(page, incidentId);

        if (!captured.details || captured.details.error) {
            const errMsg = captured.details?.error
                ? `API error: ${captured.details.status} ${captured.details.statusText}`
                : 'Failed to capture incident details from portal API calls';
            emitProgress('details', 'error', errMsg);
            process.exit(1);
        }

        emitProgress('navigate', 'done', 'Incident page loaded');
        const details = captured.details;
        emitProgress('details', 'done', 'Incident details loaded');

        // Build and emit structured metadata
        const metadata = buildMetadata(details);
        emitData('metadata', metadata);

        // Discussion entries
        const descriptions = captured.descriptions;
        emitProgress('discussion', 'done', descriptions ? 'Discussion entries loaded' : 'No discussion data captured');

        // --- Build sections ---
        emitProgress('building', 'running', 'Building incident report...');

        const summarySection = buildSummarySection(details, descriptions);
        const impactSection = buildImpactSection(details);
        const rootCauseSection = buildRootCauseSection(details);

        const sections = {
            summary: summarySection,
            impact: impactSection,
            rootCause: rootCauseSection,
        };

        // --- 4. Build the full text output ---
        const output = [];

        output.push(`--- INCIDENT INFO ---`);
        output.push('');
        output.push(`Incident ${incidentId}`);
        output.push(`Title: ${metadata.title}`);
        output.push(`Severity: ${metadata.severity}`);
        output.push(`Status: ${metadata.status}`);
        output.push(`Owner: ${metadata.owner}`);
        output.push(`Owning team: ${metadata.owningTeam}`);
        output.push(`Created: ${formatDate(metadata.created)}`);
        output.push(`Impact start: ${formatDate(metadata.impactingFrom)}`);
        if (metadata.mitigateTime) output.push(`Mitigated: ${formatDate(metadata.mitigateTime)}`);
        output.push(`Duration: ${metadata.duration}`);
        if (metadata.routingId) output.push(`Routing ID: ${metadata.routingId}`);

        output.push('');
        output.push(`--- SUMMARY & DISCUSSION ---`);
        output.push('');
        output.push(summarySection);

        output.push('');
        output.push(`--- IMPACT ASSESSMENT ---`);
        output.push('');
        output.push(impactSection);

        output.push('');
        output.push(`--- ROOT CAUSE & MITIGATION ---`);
        output.push('');
        output.push(rootCauseSection);

        const fullOutput = output.join('\n');
        emitData('content', fullOutput);
        emitData('sections', sections);

        emitProgress('building', 'done', 'Report built');
        emitProgress('complete', 'done', 'All data loaded successfully');

    } catch (error) {
        emitProgress('error', 'error', error.message);
        console.error('Error:', error.message);
    }
    process.exit(0);
}

const incidentId = process.argv[2] || '739068128';
readFullIncident(incidentId);
