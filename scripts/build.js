#!/usr/bin/env node
/**
 * Unified build script for AI Investigator.
 * Builds frontend (Vite) + backend (TypeScript), then assembles a self-contained
 * dist/ folder that can be run with `node dist/server.js`.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const DIST = path.join(BACKEND, 'dist');
const PUBLIC = path.join(DIST, 'public');

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

console.log('=== AI Investigator Build ===\n');

// Step 1: Build frontend (vite build only — skip tsc type-check which fails on test files)
console.log('[1/4] Building frontend...');
run('npx vite build', FRONTEND);

// Step 2: Compile backend (uses tsconfig.build.json to exclude test files)
console.log('\n[2/4] Compiling backend...');
run('npx tsc -p tsconfig.build.json', BACKEND);

// Step 3: Copy frontend dist into backend dist/public
console.log('\n[3/4] Copying frontend build to dist/public...');
const frontendDist = path.join(FRONTEND, 'dist');
if (!fs.existsSync(frontendDist)) {
    console.error('ERROR: Frontend build output not found at', frontendDist);
    process.exit(1);
}
copyDir(frontendDist, PUBLIC);

// Step 4: Copy runtime assets
console.log('\n[4/4] Copying runtime assets...');
const assets = [
    { src: path.join(ROOT, 'prompts'), dest: path.join(DIST, '..', 'prompts') },
    { src: path.join(ROOT, 'scripts', 'icm'), dest: path.join(DIST, '..', 'scripts', 'icm') },
];
for (const { src, dest } of assets) {
    if (fs.existsSync(src)) {
        copyDir(src, dest);
        console.log(`  Copied ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
    }
}

// Write version.json if git info is available
try {
    const version = require(path.join(BACKEND, 'package.json')).version || '0.0.0';
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
    const buildDate = new Date().toISOString();
    const versionInfo = { version, commit, buildDate };
    fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify(versionInfo, null, 2));
    console.log(`  Wrote version.json: v${version} (${commit})`);
} catch {
    console.log('  Skipped version.json (git not available)');
}

console.log('\n=== Build complete ===');
console.log(`Output: ${path.relative(ROOT, DIST)}`);
console.log('Run with: node backend/dist/server.js');
