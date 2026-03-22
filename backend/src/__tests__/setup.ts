import * as fs from 'fs';
import * as path from 'path';

// Ensure config.json exists before any test imports server.ts
// On CI, only config.sample.json is tracked in git; config.json is gitignored.
// This must run in setupFiles (before test file imports) so that server.ts
// module-level code can load config from disk.
// We create a minimal config with safe paths rather than copying config.sample.json,
// because the sample contains placeholder absolute paths (e.g. /path/to/MyProduct)
// that would fail on Linux CI.
const backendConfigFile = path.resolve(process.cwd(), 'config.json');
if (!fs.existsSync(backendConfigFile)) {
    fs.writeFileSync(backendConfigFile, JSON.stringify({
        model: 'gpt-4o',
        maxSteps: 50,
        products: [],
    }));
}
