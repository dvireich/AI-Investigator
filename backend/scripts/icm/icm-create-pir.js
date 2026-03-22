/**
 * IcM PIR Creator - Create a new Internal PIR for an incident
 * 
 * Usage: node icm-create-pir.js <INCIDENT_ID>
 * Example: node icm-create-pir.js 712467004
 */

const { getPlaywrightChromium } = require('./ensure-dependencies');
const chromium = getPlaywrightChromium();
const { spawn } = require('child_process');
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

async function createPIR(incidentId) {
    const browser = await ensurePlaywrightEdge();
    
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('microsofticm')) || context.pages()[0];
    if (!page || page.url() === 'about:blank') {
        page = await context.newPage();
    }
    
    try {
        console.log(`\n📋 Creating PIR for Incident ${incidentId}...`);
        console.log('='.repeat(60));
        
        // Navigate to incident retrospective tab
        await page.goto(`https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/retrospective`, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        await page.waitForTimeout(3000);
        
        // Check if PIR already exists
        const existingPIR = page.locator('a[href*="/retrospectives/Internal/"]').first();
        if (await existingPIR.isVisible({ timeout: 3000 }).catch(() => false)) {
            const retroUrl = await existingPIR.getAttribute('href');
            const pirIdMatch = retroUrl.match(/\/Internal\/(\d+)/);
            console.log(`\n⚠️  PIR already exists: ${pirIdMatch ? pirIdMatch[1] : 'Unknown'}`);
            console.log('   Use icm-read-pir.js to read it or icm-update-pir.js to update it.');
            process.exit(0);
        }
        
        // Look for "Create internal report" button
        console.log('\n🔍 Looking for "Create internal report" button...');
        
        const createButton = page.locator('button:has-text("Create internal report"), a:has-text("Create internal report")').first();
        
        if (await createButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('   Found button, clicking...');
            await createButton.click();
            await page.waitForTimeout(3000);
            await page.waitForLoadState('networkidle');
            
            // Check if we're now on a PIR creation/edit page
            const currentUrl = page.url();
            console.log(`\n   Current URL: ${currentUrl}`);
            
            if (currentUrl.includes('/retrospectives/')) {
                console.log('\n✅ PIR creation initiated!');
                console.log('   The browser has navigated to the PIR editor.');
                console.log('   You can now fill in the PIR details in the browser window.');
                
                // Get the new PIR ID
                const pirIdMatch = currentUrl.match(/\/Internal\/(\d+)/);
                if (pirIdMatch) {
                    console.log(`\n   New PIR ID: ${pirIdMatch[1]}`);
                }
            } else {
                // May have opened a modal, check for it
                console.log('   Checking for modal dialog...');
                await page.waitForTimeout(2000);
                
                const pageText = await page.locator('body').innerText();
                if (pageText.includes('Create retrospective') || pageText.includes('internal report')) {
                    console.log('\n✅ PIR creation dialog opened!');
                    console.log('   Please complete the creation in the browser window.');
                }
            }
        } else {
            console.log('\n❌ Could not find "Create internal report" button.');
            console.log('   This could mean:');
            console.log('   - A PIR already exists (check icm-read-pir.js)');
            console.log('   - You don\'t have permission to create a PIR');
            console.log('   - The page structure has changed');
            
            // Show what's on the page
            console.log('\n   Page content preview:');
            const pageText = await page.locator('body').innerText();
            console.log(pageText.substring(0, 2000));
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('Browser remains open for manual interaction.');
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit(0);
}

// Main
const incidentId = process.argv[2];
if (!incidentId) {
    console.log('Usage: node icm-create-pir.js <INCIDENT_ID>');
    console.log('Example: node icm-create-pir.js 712467004');
    process.exit(1);
}

createPIR(incidentId);
