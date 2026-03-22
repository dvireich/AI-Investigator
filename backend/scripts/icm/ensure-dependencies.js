const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const PACKAGE_JSON_PATH = path.join(SCRIPT_DIR, 'package.json');
const PACKAGE_LOCK_PATH = path.join(SCRIPT_DIR, 'package-lock.json');

function readDeclaredDependencies() {
    if (!fs.existsSync(PACKAGE_JSON_PATH)) {
        return [];
    }

    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return Object.keys(packageJson.dependencies || {});
}

function isModuleResolvable(moduleName) {
    try {
        require.resolve(moduleName, { paths: [SCRIPT_DIR] });
        return true;
    } catch (error) {
        return false;
    }
}

function installDependencies() {
    const command = fs.existsSync(PACKAGE_LOCK_PATH) ? 'npm ci' : 'npm install';
    console.log(`📦 Installing script dependencies (${command})...`);
    execSync(command, {
        cwd: SCRIPT_DIR,
        stdio: 'inherit',
        shell: true
    });
}

function ensureDependencies() {
    const dependencies = readDeclaredDependencies();
    if (dependencies.length === 0) {
        return;
    }

    const missingDependencies = dependencies.filter((moduleName) => !isModuleResolvable(moduleName));
    if (missingDependencies.length === 0) {
        return;
    }

    console.log(`📦 Missing dependencies detected: ${missingDependencies.join(', ')}`);
    installDependencies();

    const stillMissing = dependencies.filter((moduleName) => !isModuleResolvable(moduleName));
    if (stillMissing.length > 0) {
        throw new Error(`Unable to resolve dependencies after install: ${stillMissing.join(', ')}`);
    }
}

function getPlaywrightChromium() {
    ensureDependencies();
    return require('playwright').chromium;
}

module.exports = {
    ensureDependencies,
    getPlaywrightChromium
};
