/**
 * IcM PIR Reader - Read incident details and existing PIR content
 * 
 * Usage: node icm-read-pir.js <INCIDENT_ID>
 * Example: node icm-read-pir.js 712467004
 */

const { getPlaywrightChromium } = require('./ensure-dependencies');
const chromium = getPlaywrightChromium();
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEBUGGING_PORT = 9222;
const PLAYWRIGHT_EDGE_DATA = path.join(process.env.LOCALAPPDATA, 'Playwright-Edge-Copilot');

async function isDebuggingPortOpen() {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${DEBUGGING_PORT}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function ensurePlaywrightEdge() {
    let debuggingActive = await isDebuggingPortOpen();
    
    if (!debuggingActive) {
        console.log('🚀 Launching Playwright Edge...');
        
        if (!fs.existsSync(PLAYWRIGHT_EDGE_DATA)) {
            fs.mkdirSync(PLAYWRIGHT_EDGE_DATA, { recursive: true });
        }
        
        const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        const edgeProcess = spawn(edgePath, [
            `--remote-debugging-port=${DEBUGGING_PORT}`,
            `--user-data-dir=${PLAYWRIGHT_EDGE_DATA}`,
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank'
        ], {
            detached: true,
            stdio: 'ignore'
        });
        edgeProcess.unref();
        
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (await isDebuggingPortOpen()) {
                debuggingActive = true;
                break;
            }
        }
        
        if (!debuggingActive) {
            console.error('❌ Failed to start Playwright Edge.');
            process.exit(1);
        }
        console.log('   ✅ Playwright Edge started.');
    } else {
        console.log('✅ Connecting to existing Playwright Edge...');
    }
    
    return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUGGING_PORT}`);
}

async function readIncidentAndPIR(incidentId) {
    const browser = await ensurePlaywrightEdge();
    
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('microsofticm')) || context.pages()[0];
    if (!page || page.url() === 'about:blank') {
        page = await context.newPage();
    }
    
    try {
        console.log(`\n📋 Reading Incident ${incidentId}...`);
        console.log('='.repeat(60));
        
        // Navigate to incident retrospective tab
        await page.goto(`https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/retrospective`, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        await page.waitForTimeout(3000);
        
        // Get incident summary
        const title = await page.title();
        console.log(`\nTitle: ${title}`);
        
        // Get basic incident info from page
        const pageText = await page.locator('body').innerText();
        
        // Extract key info using patterns
        const severityMatch = pageText.match(/Severity\s*\n\s*(\d)/);
        const statusMatch = pageText.match(/Status\s*\n\s*(\w+)/);
        const durationMatch = pageText.match(/Duration\s*\n\s*([^\n]+)/);
        const owningServiceMatch = pageText.match(/Owning service\s*\n\s*([^\n]+)/);
        const owningTeamMatch = pageText.match(/Owning team\s*\n\s*([^\n]+)/);
        
        console.log('\n--- Incident Summary ---');
        console.log(`Severity: ${severityMatch ? severityMatch[1] : 'N/A'}`);
        console.log(`Status: ${statusMatch ? statusMatch[1] : 'N/A'}`);
        console.log(`Duration: ${durationMatch ? durationMatch[1] : 'N/A'}`);
        console.log(`Owning Service: ${owningServiceMatch ? owningServiceMatch[1] : 'N/A'}`);
        console.log(`Owning Team: ${owningTeamMatch ? owningTeamMatch[1] : 'N/A'}`);
        
        // Find retrospective link
        const retroLink = page.locator('a[href*="/retrospectives/Internal/"]').first();
        let retroUrl = null;
        
        if (await retroLink.isVisible({ timeout: 5000 }).catch(() => false)) {
            retroUrl = await retroLink.getAttribute('href');
            if (retroUrl && !retroUrl.startsWith('http')) {
                retroUrl = 'https://portal.microsofticm.com' + retroUrl;
            }
            
            // Extract PIR ID from URL
            const pirIdMatch = retroUrl.match(/\/Internal\/(\d+)/);
            const pirId = pirIdMatch ? pirIdMatch[1] : 'Unknown';
            
            console.log(`\n✅ Found existing PIR: ${pirId}`);
            console.log(`   URL: ${retroUrl}`);
            
            // Navigate to PIR
            await page.goto(retroUrl, { waitUntil: 'networkidle', timeout: 60000 });
            await page.waitForTimeout(3000);
            
            // Get PIR content
            const pirContent = await page.locator('body').innerText();
            
            // Extract key sections
            console.log('\n--- PIR Content ---\n');
            
            // Extract time metrics
            const ttdMatch = pirContent.match(/TTD\s*\n\s*([^\n]+)/);
            const tteMatch = pirContent.match(/TTE\s*\n\s*([^\n]+)/);
            const ttmMatch = pirContent.match(/TTM\s*\n\s*([^\n]+)/);
            
            console.log('Time Metrics:');
            console.log(`  TTD: ${ttdMatch ? ttdMatch[1] : 'N/A'}`);
            console.log(`  TTE: ${tteMatch ? tteMatch[1] : 'N/A'}`);
            console.log(`  TTM: ${ttmMatch ? ttmMatch[1] : 'N/A'}`);
            
            // Extract root cause category
            const rootCauseMatch = pirContent.match(/Root cause category\s*\n\s*([^\n]+)/);
            console.log(`\nRoot Cause Category: ${rootCauseMatch ? rootCauseMatch[1] : 'N/A'}`);
            
            // Print full content for reference
            console.log('\n--- Full PIR Text ---\n');
            console.log(pirContent.substring(0, 15000));
            
        } else {
            console.log('\n⚠️  No existing PIR found for this incident.');
            console.log('   Use icm-create-pir.js to create one.');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Done!');
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit(0);
}

// Main
const incidentId = process.argv[2];
if (!incidentId) {
    console.log('Usage: node icm-read-pir.js <INCIDENT_ID>');
    console.log('Example: node icm-read-pir.js 712467004');
    process.exit(1);
}

readIncidentAndPIR(incidentId);
