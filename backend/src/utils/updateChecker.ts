/**
 * Update checker — compares localversion with latest release on GitHub.
 * Only active in packaged exe or explicit production mode.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isPackaged, distDir, appRoot } from './appRoot';

export interface VersionInfo {
    version: string;
    commit: string;
    buildDate: string;
}

export interface UpdateManifest {
    version: string;
    releaseDate: string;
    downloadUrl: string;
    releaseNotesUrl: string;
    sha256?: string;
}

export interface VersionStatus {
    current: string;
    commit: string;
    buildDate: string;
    latest: string | null;
    updateAvailable: boolean;
    downloadUrl: string | null;
    releaseNotesUrl: string | null;
    lastChecked: string | null;
}

/** Load local version.json written during build. */
export function loadLocalVersion(): VersionInfo {
    // In exe mode, look next to the exe; in normal mode, look in dist/
    const locations = [
        path.join(appRoot, 'version.json'),
        path.join(distDir, 'version.json'),
    ];

    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            try {
                return JSON.parse(fs.readFileSync(loc, 'utf-8'));
            } catch {
                // corrupt file, try next
            }
        }
    }

    return { version: '0.0.0', commit: 'unknown', buildDate: new Date().toISOString() };
}

let cachedStatus: VersionStatus | null = null;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// The URL to check for updates. Set via UPDATES_URL env var or config.
let updateManifestUrl: string | null = null;

export function setUpdateManifestUrl(url: string): void {
    updateManifestUrl = url;
}

/**
 * Compare two semver-like version strings (e.g., "1.2.3").
 * Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const c = parse(current);
    const l = parse(latest);
    for (let i = 0; i < Math.max(c.length, l.length); i++) {
        const cv = c[i] || 0;
        const lv = l[i] || 0;
        if (lv > cv) return true;
        if (lv < cv) return false;
    }
    return false;
}

/** Check for updates. Caches result for CHECK_INTERVAL_MS. */
export async function getVersionStatus(forceCheck = false): Promise<VersionStatus> {
    const local = loadLocalVersion();

    const base: VersionStatus = {
        current: local.version,
        commit: local.commit,
        buildDate: local.buildDate,
        latest: null,
        updateAvailable: false,
        downloadUrl: null,
        releaseNotesUrl: null,
        lastChecked: cachedStatus?.lastChecked || null,
    };

    // Only check for updates in exe mode or production
    if (!isPackaged && process.env.NODE_ENV !== 'production') {
        return base;
    }

    // Use cached result if recent enough
    if (!forceCheck && cachedStatus && (Date.now() - lastCheckTime) < CHECK_INTERVAL_MS) {
        return cachedStatus;
    }

    if (!updateManifestUrl) {
        return base;
    }

    try {
        // Dynamic import to avoid pulling in axios at module load
        const axios = (await import('axios')).default;
        const response = await axios.get<UpdateManifest>(updateManifestUrl, { timeout: 10000 });
        const manifest = response.data;

        const status: VersionStatus = {
            ...base,
            latest: manifest.version,
            updateAvailable: isNewerVersion(local.version, manifest.version),
            downloadUrl: manifest.downloadUrl,
            releaseNotesUrl: manifest.releaseNotesUrl,
            lastChecked: new Date().toISOString(),
        };

        cachedStatus = status;
        lastCheckTime = Date.now();
        return status;
    } catch {
        // Network error — return base with cached data if available
        return cachedStatus || base;
    }
}
