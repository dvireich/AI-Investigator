const { getPlaywrightChromium } = require('./ensure-dependencies');
const chromium = getPlaywrightChromium();
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEBUGGING_PORT = 9222;

// Source: Edge "Copilot" profile
const EDGE_USER_DATA = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
const COPILOT_PROFILE = 'Profile 2';

// Destination: Dedicated Playwright data directory (copy of Copilot profile)
const PLAYWRIGHT_EDGE_DATA = path.join(process.env.LOCALAPPDATA, 'Playwright-Edge-Copilot');

// Check if debugging port is already open
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

// Check if Playwright profile is set up
function isPlaywrightProfileSetUp() {
    const localState = path.join(PLAYWRIGHT_EDGE_DATA, 'Local State');
    const cookies = path.join(PLAYWRIGHT_EDGE_DATA, 'Default', 'Network', 'Cookies');
    return fs.existsSync(localState) && fs.existsSync(cookies);
}

// Copy Copilot profile to Playwright directory
function setupPlaywrightProfile() {
    console.log('📁 Setting up Playwright profile from Copilot profile...');
    
    const sourceProfile = path.join(EDGE_USER_DATA, COPILOT_PROFILE);
    const destProfile = path.join(PLAYWRIGHT_EDGE_DATA, 'Default');
    
    // Create directories
    fs.mkdirSync(destProfile, { recursive: true });
    fs.mkdirSync(path.join(destProfile, 'Network'), { recursive: true });
    
    // Copy Local State (contains encryption key)
    const localStateSrc = path.join(EDGE_USER_DATA, 'Local State');
    const localStateDest = path.join(PLAYWRIGHT_EDGE_DATA, 'Local State');
    
    try {
        // Use robocopy to copy files (handles locked files better)
        console.log('   Copying auth data...');
        
        // Copy Local State
        if (fs.existsSync(localStateSrc)) {
            execSync(`copy "${localStateSrc}" "${localStateDest}" /Y`, { stdio: 'ignore', shell: true });
        }
        
        // Copy key profile files
        const filesToCopy = [
            'Cookies',
            'Login Data', 
            'Web Data',
            'Preferences',
            'Secure Preferences'
        ];
        
        for (const file of filesToCopy) {
            const src = path.join(sourceProfile, file);
            const dest = path.join(destProfile, file);
            if (fs.existsSync(src)) {
                try {
                    execSync(`copy "${src}" "${dest}" /Y`, { stdio: 'ignore', shell: true });
                } catch (e) { /* file might be locked */ }
            }
        }
        
        // Copy Network folder (contains cookies in newer Edge)
        const networkSrc = path.join(sourceProfile, 'Network');
        const networkDest = path.join(destProfile, 'Network');
        if (fs.existsSync(networkSrc)) {
            try {
                execSync(`xcopy "${networkSrc}" "${networkDest}" /E /Y /Q`, { stdio: 'ignore', shell: true });
            } catch (e) { /* might be locked */ }
        }
        
        console.log('   ✅ Profile copied successfully!');
        return true;
    } catch (error) {
        console.log('   ⚠️  Some files could not be copied (Edge may be using them).');
        console.log('   If login is required, please close Edge once and run: node icm-check.js --setup');
        return false;
    }
}

(async () => {
    // Check for --setup flag
    const isSetupMode = process.argv.includes('--setup');
    
    if (isSetupMode) {
        console.log('🔧 SETUP MODE: Copying Copilot profile to Playwright directory...');
        console.log('   Please make sure Edge is CLOSED before running setup.\n');
        
        // Check if Edge is running
        try {
            const tasklist = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { encoding: 'utf8' });
            if (tasklist.includes('msedge.exe')) {
                console.log('❌ Edge is running. Please close ALL Edge windows and run again:');
                console.log('   node icm-check.js --setup');
                process.exit(1);
            }
        } catch (e) {}
        
        setupPlaywrightProfile();
        console.log('\n✅ Setup complete! You can now run: node icm-check.js');
        process.exit(0);
    }
    
    // Check if Playwright profile exists, if not try to set it up
    if (!isPlaywrightProfileSetUp()) {
        console.log('🔑 First run - setting up Playwright profile from Copilot...');
        setupPlaywrightProfile();
    }
    
    // Check if Playwright Edge is already running
    let debuggingActive = await isDebuggingPortOpen();
    
    if (!debuggingActive) {
        console.log('🚀 Launching Playwright Edge (with Copilot profile copy)...');
        console.log('   Data directory:', PLAYWRIGHT_EDGE_DATA);
        
        // Launch Edge with debugging, using Playwright data directory
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
        
        // Wait for Edge to start
        console.log('   Waiting for Edge to start...');
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
    
    // Connect to Edge via CDP
    console.log('🔗 Connecting via Chrome DevTools Protocol...');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUGGING_PORT}`);
    
    // Get the default context and create/get a page
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('microsofticm')) || context.pages()[0];
    if (!page || page.url() === 'about:blank') {
        page = await context.newPage();
    }
    
    try {
        // List of incidents to fetch
        const incidents = [
            { id: '614738279', name: 'Incident 1' },
            { id: '604347016', name: 'Incident 2' },
            { id: '541446392', name: 'Incident 3' }
        ];
        
        for (const incident of incidents) {
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📋 Fetching ${incident.name}: Incident ${incident.id}`);
            console.log('='.repeat(80));
            
            // First go to incident to find retrospective link
            await page.goto(`https://portal.microsofticm.com/imp/v5/incidents/details/${incident.id}/retrospective`, {
                waitUntil: 'networkidle',
                timeout: 60000
            });
            await page.waitForTimeout(2000);
            
            // Find retrospective link
            const retroLink = page.locator('a[href*="/retrospectives/Internal/"]').first();
            let retroUrl = null;
            
            if (await retroLink.isVisible({ timeout: 5000 }).catch(() => false)) {
                retroUrl = await retroLink.getAttribute('href');
                if (retroUrl && !retroUrl.startsWith('http')) {
                    retroUrl = 'https://portal.microsofticm.com' + retroUrl;
                }
            }
            
            if (retroUrl) {
                console.log(`Found retrospective: ${retroUrl}`);
                await page.goto(retroUrl, { waitUntil: 'networkidle', timeout: 60000 });
                await page.waitForTimeout(3000);
                
                const pirContent = await page.locator('body').innerText();
                console.log('\n--- PIR Content ---\n');
                console.log(pirContent.substring(0, 20000));
            } else {
                console.log('No retrospective found for this incident');
                // Show incident summary instead
                await page.goto(`https://portal.microsofticm.com/imp/v5/incidents/details/${incident.id}/summary`, {
                    waitUntil: 'networkidle',
                    timeout: 60000
                });
                await page.waitForTimeout(2000);
                const summaryContent = await page.locator('body').innerText();
                console.log('\n--- Incident Summary ---\n');
                console.log(summaryContent.substring(0, 10000));
            }
        }

        console.log('\n\n' + '='.repeat(80));
        console.log('✅ All incidents fetched!');
        console.log('='.repeat(80));

        console.log('\n--- Browser will stay open (you can continue using it) ---');

    } catch (error) {
        console.error('Error:', error.message);
    }
    
    // Don't close browser - let it stay open for the user
    console.log('✅ Done! Edge stays open for your use.');
    process.exit(0);
})();
