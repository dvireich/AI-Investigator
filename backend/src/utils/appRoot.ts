/**
 * Application root path resolution for both normal Node.js and packaged exe modes.
 *
 * When running as a pkg-packaged exe, __dirname points to a virtual snapshot filesystem
 * inside the executable. Real filesystem paths (config, prompts, data) must be resolved
 * relative to the exe's directory instead.
 */
import * as path from 'path';

/** True when running inside a pkg-packaged executable. */
export const isPackaged: boolean = !!(process as any).pkg;

/**
 * The application installation root directory.
 *
 * - **Normal mode** (node dist/server.js): two levels up from backend/dist/ → repo root
 * - **Exe mode** (ai-investigator.exe): directory containing the executable
 */
export const appRoot: string = isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, '..', '..');

/**
 * Resolve a path relative to the app root.
 * Absolute paths are returned unchanged.
 */
export function resolveFromRoot(...segments: string[]): string {
    const joined = path.join(...segments);
    return path.isAbsolute(joined) ? joined : path.join(appRoot, joined);
}

/**
 * The backend dist directory (compiled JS output).
 *
 * - **Normal mode**: backend/dist/
 * - **Exe mode**: snapshot filesystem __dirname (for bundled assets like public/)
 */
export const distDir: string = __dirname;

/**
 * The path to use when spawning Node.js child processes.
 * In exe mode, uses the system `node` since the embedded runtime can't spawn children.
 */
export const nodeExecutable: string = isPackaged ? 'node' : process.execPath;
