#!/usr/bin/env node
/**
 * Package script for AI Investigator.
 * Creates a standalone Windows executable using @yao-pkg/pkg, bundles Chromium,
 * and assembles a distributable zip-ready folder.
 *
 * Prerequisites: Run `npm run build` first to populate backend/dist/.
 *
 * Usage:
 *   node scripts/package.js              — Build exe + bundle Chromium
 *   node scripts/package.js --no-chromium — Build exe without Chromium (smaller, faster)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const DIST = path.join(BACKEND, 'dist');
const RELEASE = path.join(ROOT, 'release');
const EXE_NAME = 'ai-investigator.exe';

const skipChromium = process.argv.includes('--no-chromium');

function run(cmd, cwd) {
    console.log(`\n> ${cmd} (in ${path.relative(ROOT, cwd) || '.'})`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        // Remove contents, not the dir itself (avoids EPERM when cwd is inside it)
        for (const entry of fs.readdirSync(dir)) {
            fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
    } else {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Validate prerequisites
if (!fs.existsSync(path.join(DIST, 'server.js'))) {
    console.error('ERROR: backend/dist/server.js not found. Run `npm run build` first.');
    process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'public', 'index.html'))) {
    console.error('ERROR: backend/dist/public/index.html not found. Run `npm run build` first.');
    process.exit(1);
}

console.log('=== AI Investigator Packaging ===\n');

// Step 1: Clean release directory
console.log('[1/4] Preparing release directory...');
cleanDir(RELEASE);

// Step 2: Bundle with esbuild for minimal exe size
console.log('\n[2/5] Bundling backend with esbuild...');
const BUNDLED = path.join(DIST, 'server.bundled.js');
run(
    `npx esbuild dist/server.js --bundle --platform=node --target=node20 --outfile=dist/server.bundled.js --external:puppeteer --metafile=dist/meta.json`,
    BACKEND,
);
const bundledSize = (fs.statSync(BUNDLED).size / (1024 * 1024)).toFixed(1);
console.log(`  Bundled to ${bundledSize} MB (from ${fs.readdirSync(path.join(BACKEND, 'node_modules')).length}+ node_modules packages)`);

// Create a launcher wrapper that shows instant startup feedback
const LAUNCHER = path.join(DIST, 'launcher.js');
fs.writeFileSync(LAUNCHER, `#!/usr/bin/env node
// Launcher — shows instant feedback while the server boots
process.stdout.write('\\n');
process.stdout.write('  ╔══════════════════════════════════════╗\\n');
process.stdout.write('  ║       AI Investigator v' + (require('./version.json').version || '?').padEnd(12) + '║\\n');
process.stdout.write('  ╠══════════════════════════════════════╣\\n');
process.stdout.write('  ║  Starting server...                  ║\\n');
process.stdout.write('  ╚══════════════════════════════════════╝\\n');
process.stdout.write('\\n');
require('./server.bundled.js');
`);
console.log('  Created launcher.js');

// Step 3: Build exe with pkg (from an isolated staging dir to avoid bundling node_modules)
console.log('\n[3/5] Building executable...');

// Create a minimal staging directory with only what pkg needs
const STAGE = path.join(ROOT, '.pkg-stage');
cleanDir(STAGE);

// Copy the bundled server + launcher + assets
fs.copyFileSync(BUNDLED, path.join(STAGE, 'server.bundled.js'));
fs.copyFileSync(LAUNCHER, path.join(STAGE, 'launcher.js'));
copyDir(path.join(DIST, 'public'), path.join(STAGE, 'public'));
if (fs.existsSync(path.join(DIST, 'version.json'))) {
    fs.copyFileSync(path.join(DIST, 'version.json'), path.join(STAGE, 'version.json'));
}

// Write a minimal package.json for pkg
const stagePkg = {
    name: 'ai-investigator',
    bin: 'launcher.js',
    pkg: {
        assets: ['public/**/*', 'version.json', 'server.bundled.js'],
    },
};
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(stagePkg, null, 2));

// Use custom icon if available
const ICON = path.join(ROOT, 'scripts', 'icon.ico');
const iconFlag = fs.existsSync(ICON) ? ` --icon "${ICON}"` : '';

// Run pkg from BACKEND (where it's installed) but target the staging dir
run(`npx @yao-pkg/pkg "${STAGE}" --target node20-win-x64 --output "${path.join(RELEASE, EXE_NAME)}"${iconFlag}`, BACKEND);

// Clean up staging dir
fs.rmSync(STAGE, { recursive: true, force: true });

if (!fs.existsSync(path.join(RELEASE, EXE_NAME))) {
    console.error('ERROR: pkg failed to create executable.');
    process.exit(1);
}

const exeSize = (fs.statSync(path.join(RELEASE, EXE_NAME)).size / (1024 * 1024)).toFixed(1);
console.log(`  Created ${EXE_NAME} (${exeSize} MB)`);

// Step 4: Bundle Chromium (for PDF export)
if (!skipChromium) {
    console.log('\n[4/5] Bundling Chromium for PDF export...');

    // Find Puppeteer's downloaded Chromium
    let chromiumSrc = null;
    try {
        const puppeteer = require(path.join(BACKEND, 'node_modules', 'puppeteer'));
        const browserPath = puppeteer.executablePath ? puppeteer.executablePath() : null;
        if (browserPath && fs.existsSync(browserPath)) {
            // browserPath is like .../chrome-win64/chrome.exe — we want the chrome-win64 folder
            chromiumSrc = path.dirname(browserPath);
        }
    } catch {
        // Fallback: search common Puppeteer cache locations
        const cacheDir = path.join(require('os').homedir(), '.cache', 'puppeteer');
        if (fs.existsSync(cacheDir)) {
            const chromeDir = findChromeDir(cacheDir);
            if (chromeDir) chromiumSrc = chromeDir;
        }
    }

    if (chromiumSrc && fs.existsSync(chromiumSrc)) {
        const chromiumDest = path.join(RELEASE, 'chromium', path.basename(chromiumSrc));
        copyDir(chromiumSrc, chromiumDest);
        const chromiumSize = getDirSize(chromiumDest);
        console.log(`  Bundled Chromium (${(chromiumSize / (1024 * 1024)).toFixed(0)} MB)`);
    } else {
        console.warn('  WARNING: Chromium not found. PDF export will require manual Chromium installation.');
        console.warn('  Run `npx puppeteer browsers install chrome` to install Chromium.');
    }
} else {
    console.log('\n[4/5] Skipping Chromium bundle (--no-chromium)');
}

// Step 5: Copy runtime assets + sample config
console.log('\n[5/5] Copying runtime assets...');

// Copy prompts
const promptsSrc = path.join(ROOT, 'prompts');
if (fs.existsSync(promptsSrc)) {
    copyDir(promptsSrc, path.join(RELEASE, 'prompts'));
    console.log('  Copied prompts/');
}

// Copy IcM scripts
const icmSrc = path.join(ROOT, 'scripts', 'icm');
if (fs.existsSync(icmSrc)) {
    copyDir(icmSrc, path.join(RELEASE, 'scripts', 'icm'));
    console.log('  Copied scripts/icm/');
}

// Create sample config
const sampleConfig = path.join(BACKEND, 'config.sample.json');
if (fs.existsSync(sampleConfig)) {
    fs.copyFileSync(sampleConfig, path.join(RELEASE, 'config.sample.json'));
    console.log('  Copied config.sample.json');
}

// Copy version.json
const versionFile = path.join(DIST, 'version.json');
if (fs.existsSync(versionFile)) {
    fs.copyFileSync(versionFile, path.join(RELEASE, 'version.json'));
}

// Create a simple README
const readmeContent = `AI Investigator
===============

Quick Start:
  1. Copy config.sample.json to config.json and edit with your settings
  2. Double-click "Start AI Investigator.cmd" to launch
  3. The dashboard opens automatically in your browser

  If a previous instance is running, it will be closed automatically.

Windows SmartScreen:
  On first run, Windows may show "Windows protected your PC".
  Click "More info" then "Run anyway" — this is expected for
  unsigned applications distributed outside the Microsoft Store.

Command-line options:
  --config <path>    Use a specific config file
  --no-open          Don't auto-open the browser

Notes:
  - The server runs on http://localhost:3000 by default.

For full documentation, see: https://github.com/dvireich/AI-Investigator
`;
fs.writeFileSync(path.join(RELEASE, 'README.txt'), readmeContent);

// Create a fast-launch wrapper (.cmd) — shows instant feedback while the exe loads
const launcherCmd = `@echo off
title AI Investigator
echo.
echo   ======================================
echo        AI Investigator
echo   ======================================
echo.
echo   Starting server, please wait...
echo.
"%~dp0ai-investigator.exe" %*
`;
fs.writeFileSync(path.join(RELEASE, 'Start AI Investigator.cmd'), launcherCmd);
console.log('  Created Start AI Investigator.cmd');

// Summary
console.log('\n=== Packaging complete ===');
console.log(`Output: ${path.relative(ROOT, RELEASE)}/`);
console.log('Contents:');
for (const entry of fs.readdirSync(RELEASE)) {
    const stat = fs.statSync(path.join(RELEASE, entry));
    const size = stat.isDirectory()
        ? `${(getDirSize(path.join(RELEASE, entry)) / (1024 * 1024)).toFixed(0)} MB`
        : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;
    console.log(`  ${entry.padEnd(30)} ${size}`);
}

// Helper: recursively find chrome.exe directory
function findChromeDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === 'chrome.exe') return dir;
        if (entry.isDirectory()) {
            const found = findChromeDir(full);
            if (found) return found;
        }
    }
    return null;
}

// Helper: get total directory size in bytes
function getDirSize(dir) {
    let size = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            size += getDirSize(full);
        } else {
            size += fs.statSync(full).size;
        }
    }
    return size;
}
