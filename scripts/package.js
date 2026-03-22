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
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
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

// Step 2: Build exe with pkg
console.log('\n[2/4] Building executable...');
run(`npx @yao-pkg/pkg . --target node20-win-x64 --output "${path.join(RELEASE, EXE_NAME)}"`, BACKEND);

if (!fs.existsSync(path.join(RELEASE, EXE_NAME))) {
    console.error('ERROR: pkg failed to create executable.');
    process.exit(1);
}

const exeSize = (fs.statSync(path.join(RELEASE, EXE_NAME)).size / (1024 * 1024)).toFixed(1);
console.log(`  Created ${EXE_NAME} (${exeSize} MB)`);

// Step 3: Bundle Chromium (for PDF export)
if (!skipChromium) {
    console.log('\n[3/4] Bundling Chromium for PDF export...');

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
    console.log('\n[3/4] Skipping Chromium bundle (--no-chromium)');
}

// Step 4: Copy runtime assets + sample config
console.log('\n[4/4] Copying runtime assets...');

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
  2. Double-click ai-investigator.exe (or run from command line)
  3. Open http://localhost:3000 in your browser

Command-line options:
  --config <path>    Use a specific config file
  --no-open          Don't auto-open the browser

For full documentation, see: https://github.com/<org>/AI-Investigator
`;
fs.writeFileSync(path.join(RELEASE, 'README.txt'), readmeContent);

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
