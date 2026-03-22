/**
 * IcM PIR Updater - Update specific sections of an existing PIR
 * 
 * Usage: node icm-update-pir.js <PIR_ID> [--section <section_name>]
 * Example: node icm-update-pir.js 1302820 --section analysis
 * 
 * Sections: timeline, impact, analysis, contributing, repair-items
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

async function updatePIR(pirId, section) {
    const browser = await ensurePlaywrightEdge();
    
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('microsofticm')) || context.pages()[0];
    if (!page || page.url() === 'about:blank') {
        page = await context.newPage();
    }
    
    try {
        console.log(`\n📋 Opening PIR ${pirId}...`);
        console.log('='.repeat(60));
        
        // Navigate to PIR
        await page.goto(`https://portal.microsofticm.com/imp/v5/retrospectives/Internal/${pirId}`, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        await page.waitForTimeout(3000);
        
        // Check if we need to switch to authoring mode
        const authoringButton = page.locator('button:has-text("Switch to authoring mode"), a:has-text("Switch to authoring mode")').first();
        
        if (await authoringButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('🔧 Switching to authoring mode...');
            await authoringButton.click();
            await page.waitForTimeout(2000);
            await page.waitForLoadState('networkidle');
            console.log('   ✅ Now in authoring mode.');
        }
        
        // Map section names to IcM section headers
        const sectionMap = {
            'timeline': 'Timeline',
            'impact': 'Impact',
            'analysis': 'Analysis',
            'contributing': 'Contributing factors',
            'repair-items': 'Repair items',
            'detection': 'Detection and mitigation',
            'troubleshooting': 'Troubleshooting'
        };
        
        if (section && sectionMap[section]) {
            console.log(`\n📍 Scrolling to section: ${sectionMap[section]}...`);
            
            // Try to find and scroll to the section
            const sectionHeader = page.locator(`text="${sectionMap[section]}"`).first();
            
            if (await sectionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
                await sectionHeader.scrollIntoViewIfNeeded();
                console.log(`   ✅ Scrolled to ${sectionMap[section]} section.`);
                
                // Look for Edit button near this section
                const editButton = page.locator(`button:has-text("Edit")`).first();
                if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                    console.log('   📝 Edit button found. Click it to edit this section.');
                }
            } else {
                console.log(`   ⚠️  Could not find section: ${sectionMap[section]}`);
            }
        } else {
            console.log('\n📍 No specific section requested.');
            console.log('   Available sections:');
            Object.keys(sectionMap).forEach(s => {
                console.log(`     --section ${s}`);
            });
        }
        
        // Show current PIR status
        const pageText = await page.locator('body').innerText();
        const statusMatch = pageText.match(/Incident report status\s*\n\s*([^\n]+)/);
        console.log(`\n   PIR Status: ${statusMatch ? statusMatch[1] : 'Unknown'}`);
        
        console.log('\n' + '='.repeat(60));
        console.log('Browser remains open for manual editing.');
        console.log('Make your changes and click Save in the IcM interface.');
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit(0);
}

// Parse arguments
const args = process.argv.slice(2);
const pirId = args[0];
let section = null;

const sectionIndex = args.indexOf('--section');
if (sectionIndex !== -1 && args[sectionIndex + 1]) {
    section = args[sectionIndex + 1];
}

if (!pirId) {
    console.log('Usage: node icm-update-pir.js <PIR_ID> [--section <section_name>]');
    console.log('');
    console.log('Examples:');
    console.log('  node icm-update-pir.js 1302820');
    console.log('  node icm-update-pir.js 1302820 --section analysis');
    console.log('  node icm-update-pir.js 1302820 --section timeline');
    console.log('');
    console.log('Sections: timeline, impact, analysis, contributing, repair-items, detection, troubleshooting');
    process.exit(1);
}

updatePIR(pirId, section);
