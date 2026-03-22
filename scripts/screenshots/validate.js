/**
 * Validate screenshot parity across README, capture.js, and docs/screenshots/.
 *
 * Cross-checks three sources to ensure nothing drifts:
 *   1. README.md — every ![...](docs/screenshots/*.png) image reference
 *   2. capture.js — every screenshot('name') call that produces a file
 *   3. docs/screenshots/ — every .png file on disk
 *
 * Exit code 0 = all checks pass, 1 = mismatches found.
 *
 * Usage:
 *   node validate.js            → run all checks
 *   node validate.js --fix      → print suggested fixes (no auto-edit)
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const README_PATH = join(ROOT, 'README.md');
const CAPTURE_PATH = join(__dirname, 'capture.js');
const SCREENSHOTS_DIR = join(ROOT, 'docs', 'screenshots');

// ---------------------------------------------------------------------------
// 1. Parse README — extract all ![...](docs/screenshots/*.png) references
// ---------------------------------------------------------------------------
function getReadmeScreenshots() {
    const readme = readFileSync(README_PATH, 'utf-8');
    const refs = new Set();
    // Match both active and commented-out image refs
    const regex = /!\[.*?\]\(docs\/screenshots\/([\w.-]+\.png)\)/g;
    let match;
    while ((match = regex.exec(readme)) !== null) {
        refs.add(match[1]);
    }
    return refs;
}

// ---------------------------------------------------------------------------
// 2. Parse capture.js — extract all screenshot('name') calls
// ---------------------------------------------------------------------------
function getCaptureScreenshots() {
    const source = readFileSync(CAPTURE_PATH, 'utf-8');
    const refs = new Set();
    // Match: screenshot(page, 'name')  or  screenshot(page, 'name', ...)
    const regex = /screenshot\(\s*page\s*,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        refs.add(`${match[1]}.png`);
    }
    return refs;
}

// ---------------------------------------------------------------------------
// 3. List disk files in docs/screenshots/
// ---------------------------------------------------------------------------
function getDiskScreenshots() {
    try {
        const files = readdirSync(SCREENSHOTS_DIR);
        return new Set(files.filter(f => f.endsWith('.png')));
    } catch {
        return new Set();
    }
}

// ---------------------------------------------------------------------------
// 4. Parse README — extract numbered walkthrough sections
// ---------------------------------------------------------------------------
function getReadmeSections() {
    const readme = readFileSync(README_PATH, 'utf-8');
    const sections = [];
    const regex = /^### (\d+)\. (.+)$/gm;
    let match;
    while ((match = regex.exec(readme)) !== null) {
        sections.push({ number: parseInt(match[1]), title: match[2] });
    }
    return sections;
}

// ---------------------------------------------------------------------------
// 5. Parse capture.js — count capture functions and main() calls
// ---------------------------------------------------------------------------
function getCaptureStats() {
    const source = readFileSync(CAPTURE_PATH, 'utf-8');
    const funcDefs = [...source.matchAll(/async function (capture\w+)\(/g)].map(m => m[1]);
    const mainCalls = [...source.matchAll(/await (capture\w+)\(page\)/g)].map(m => m[1]);
    return { funcDefs: new Set(funcDefs), mainCalls: new Set(mainCalls) };
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------
const readmeRefs = getReadmeScreenshots();
const captureRefs = getCaptureScreenshots();
const diskFiles = getDiskScreenshots();
const sections = getReadmeSections();
const { funcDefs, mainCalls } = getCaptureStats();

let errors = 0;
const issues = [];

function fail(msg) {
    issues.push(`  ❌ ${msg}`);
    errors++;
}

function pass(msg) {
    issues.push(`  ✅ ${msg}`);
}

console.log('═══════════════════════════════════════════════');
console.log('  Screenshot Parity Validation');
console.log('═══════════════════════════════════════════════\n');

// --- Check 1: Every README reference has a file on disk ---
console.log('📋 README → Disk');
for (const ref of readmeRefs) {
    if (!diskFiles.has(ref)) {
        fail(`README references ${ref} but file not found on disk`);
    }
}
if ([...readmeRefs].every(r => diskFiles.has(r))) {
    pass(`All ${readmeRefs.size} README references have files on disk`);
}

// --- Check 2: Every disk file is referenced in README ---
console.log('\n💾 Disk → README');
for (const file of diskFiles) {
    if (!readmeRefs.has(file)) {
        fail(`${file} exists on disk but not referenced in README`);
    }
}
if ([...diskFiles].every(f => readmeRefs.has(f))) {
    pass(`All ${diskFiles.size} disk files are referenced in README`);
}

// --- Check 3: Every capture.js screenshot call has a file on disk ---
console.log('\n📸 capture.js → Disk');
for (const ref of captureRefs) {
    if (!diskFiles.has(ref)) {
        fail(`capture.js produces ${ref} but file not found on disk`);
    }
}
if ([...captureRefs].every(r => diskFiles.has(r))) {
    pass(`All ${captureRefs.size} capture calls have files on disk`);
}

// --- Check 4: Every disk file has a capture function ---
console.log('\n💾 Disk → capture.js');
for (const file of diskFiles) {
    if (!captureRefs.has(file)) {
        fail(`${file} exists on disk but no capture function produces it`);
    }
}
if ([...diskFiles].every(f => captureRefs.has(f))) {
    pass(`All ${diskFiles.size} disk files have capture functions`);
}

// --- Check 5: Every defined capture function is called in main() ---
console.log('\n🔧 Capture functions → main()');
for (const func of funcDefs) {
    if (!mainCalls.has(func)) {
        fail(`${func}() is defined but never called in main()`);
    }
}
if ([...funcDefs].every(f => mainCalls.has(f))) {
    pass(`All ${funcDefs.size} capture functions are called in main()`);
}

// --- Check 6: Sequential numbering ---
console.log('\n🔢 Section numbering');
const expectedNumbers = sections.map((_, i) => i + 1);
const actualNumbers = sections.map(s => s.number);
const numbersMatch = JSON.stringify(expectedNumbers) === JSON.stringify(actualNumbers);
if (numbersMatch) {
    pass(`${sections.length} sections numbered sequentially 1–${sections.length}`);
} else {
    const gaps = [];
    for (let i = 0; i < sections.length; i++) {
        if (sections[i].number !== i + 1) {
            gaps.push(`Section "${sections[i].title}" is #${sections[i].number}, expected #${i + 1}`);
        }
    }
    for (const gap of gaps) fail(gap);
}

// --- Check 7: Parity count ---
console.log('\n📊 Summary');
console.log(`  README image refs:   ${readmeRefs.size}`);
console.log(`  capture.js outputs:  ${captureRefs.size}`);
console.log(`  Disk .png files:     ${diskFiles.size}`);
console.log(`  Walkthrough sections: ${sections.length}`);
console.log(`  Capture functions:   ${funcDefs.size}`);
console.log(`  main() calls:        ${mainCalls.size}`);

if (readmeRefs.size !== captureRefs.size || captureRefs.size !== diskFiles.size) {
    fail(`Count mismatch: README(${readmeRefs.size}) ≠ capture(${captureRefs.size}) ≠ disk(${diskFiles.size})`);
} else {
    pass(`All counts match: ${diskFiles.size} files`);
}

// --- Final result ---
console.log('\n═══════════════════════════════════════════════');
if (errors === 0) {
    console.log('  ✅ All checks passed — perfect parity!');
    console.log('═══════════════════════════════════════════════\n');
    process.exit(0);
} else {
    console.log(`  ❌ ${errors} issue(s) found:`);
    for (const issue of issues.filter(i => i.includes('❌'))) {
        console.log(issue);
    }
    console.log('═══════════════════════════════════════════════\n');
    process.exit(1);
}
