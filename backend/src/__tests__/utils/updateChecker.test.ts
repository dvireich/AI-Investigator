import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-level mocks
vi.mock('fs', () => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
}));

vi.mock('../../utils/appRoot', () => ({
    isPackaged: false,
    distDir: '/mock/dist',
    appRoot: '/mock/root',
}));

// Import fs after mocking
import * as fs from 'fs';

describe('updateChecker', () => {
    let mod: typeof import('../../utils/updateChecker');

    beforeEach(async () => {
        vi.resetModules();
        // Re-apply mocks after resetModules
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(false),
            readFileSync: vi.fn().mockReturnValue('{}'),
        }));
        vi.doMock('../../utils/appRoot', () => ({
            isPackaged: false,
            distDir: '/mock/dist',
            appRoot: '/mock/root',
        }));
        mod = await import('../../utils/updateChecker');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('loadLocalVersion', () => {
        it('returns default version when no version.json exists', async () => {
            vi.resetModules();
            const fsMock = { existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() };
            vi.doMock('fs', () => fsMock);
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            const freshMod = await import('../../utils/updateChecker');
            const result = freshMod.loadLocalVersion();
            expect(result.version).toBe('0.0.0');
            expect(result.commit).toBe('unknown');
        });

        it('loads version from file when it exists', async () => {
            vi.resetModules();
            const versionData = { version: '1.2.3', commit: 'abc1234', buildDate: '2026-01-01T00:00:00Z' };
            const fsMock = {
                existsSync: vi.fn().mockReturnValue(true),
                readFileSync: vi.fn().mockReturnValue(JSON.stringify(versionData)),
            };
            vi.doMock('fs', () => fsMock);
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            const freshMod = await import('../../utils/updateChecker');
            const result = freshMod.loadLocalVersion();
            expect(result).toEqual(versionData);
        });

        it('falls back to default when version.json is corrupt', async () => {
            vi.resetModules();
            const fsMock = {
                existsSync: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
                readFileSync: vi.fn().mockReturnValue('not-valid-json'),
            };
            vi.doMock('fs', () => fsMock);
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            const freshMod = await import('../../utils/updateChecker');
            const result = freshMod.loadLocalVersion();
            expect(result.version).toBe('0.0.0');
        });
    });

    describe('setUpdateManifestUrl', () => {
        it('sets the manifest URL', () => {
            expect(() => mod.setUpdateManifestUrl('https://example.com/latest.json')).not.toThrow();
        });
    });

    describe('getVersionStatus', () => {
        it('returns base status in non-production, non-packaged mode', async () => {
            const status = await mod.getVersionStatus();
            expect(status.current).toBe('0.0.0');
            expect(status.updateAvailable).toBe(false);
            expect(status.latest).toBeNull();
        });

        it('returns base status when NODE_ENV is production but GitHub API fails', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: { get: vi.fn().mockRejectedValue(new Error('Network error')) },
            }));
            const freshMod = await import('../../utils/updateChecker');
            const status = await freshMod.getVersionStatus();
            expect(status.updateAvailable).toBe(false);
            process.env.NODE_ENV = origEnv;
        });

        it('checks GitHub Releases API when no manifest URL is set', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            tag_name: 'v2.0.0',
                            html_url: 'https://github.com/dvireich/AI-Investigator/releases/tag/v2.0.0',
                            assets: [{ browser_download_url: 'https://github.com/download/v2.0.0.zip' }],
                        },
                    }),
                },
            }));
            const freshMod = await import('../../utils/updateChecker');
            const status = await freshMod.getVersionStatus(true);
            expect(status.updateAvailable).toBe(true);
            expect(status.latest).toBe('2.0.0');
            expect(status.downloadUrl).toBe('https://github.com/download/v2.0.0.zip');
            expect(status.releaseNotesUrl).toBe('https://github.com/dvireich/AI-Investigator/releases/tag/v2.0.0');
            process.env.NODE_ENV = origEnv;
        });

        it('handles GitHub release with no tag_name or empty assets', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            tag_name: null,
                            html_url: 'https://github.com/dvireich/AI-Investigator/releases/latest',
                            assets: [],
                        },
                    }),
                },
            }));
            const freshMod = await import('../../utils/updateChecker');
            const status = await freshMod.getVersionStatus(true);
            expect(status.latest).toBe('');
            expect(status.downloadUrl).toBe('https://github.com/dvireich/AI-Investigator/releases/latest');
            process.env.NODE_ENV = origEnv;
        });

        it('checks for updates when in production mode with manifest URL', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: {
                    get: vi.fn().mockResolvedValue({
                        data: {
                            version: '2.0.0',
                            releaseDate: '2026-03-22',
                            downloadUrl: 'https://example.com/download',
                            releaseNotesUrl: 'https://example.com/notes',
                        },
                    }),
                },
            }));
            const freshMod = await import('../../utils/updateChecker');
            freshMod.setUpdateManifestUrl('https://example.com/latest.json');
            const status = await freshMod.getVersionStatus(true);
            expect(status.updateAvailable).toBe(true);
            expect(status.latest).toBe('2.0.0');
            expect(status.downloadUrl).toBe('https://example.com/download');
            process.env.NODE_ENV = origEnv;
        });

        it('returns cached result when not forced and recent', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            const axiosGet = vi.fn().mockResolvedValue({
                data: { version: '2.0.0', releaseDate: '2026-03-22', downloadUrl: 'https://example.com/download', releaseNotesUrl: 'https://example.com/notes' },
            });
            vi.doMock('axios', () => ({ default: { get: axiosGet } }));
            const freshMod = await import('../../utils/updateChecker');
            freshMod.setUpdateManifestUrl('https://example.com/latest.json');

            // First call — fetches
            await freshMod.getVersionStatus(true);
            expect(axiosGet).toHaveBeenCalledTimes(1);

            // Second call without force — uses cache
            await freshMod.getVersionStatus(false);
            expect(axiosGet).toHaveBeenCalledTimes(1);

            process.env.NODE_ENV = origEnv;
        });

        it('handles network errors gracefully', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: { get: vi.fn().mockRejectedValue(new Error('Network error')) },
            }));
            const freshMod = await import('../../utils/updateChecker');
            freshMod.setUpdateManifestUrl('https://example.com/latest.json');
            const status = await freshMod.getVersionStatus(true);
            expect(status.updateAvailable).toBe(false);
            process.env.NODE_ENV = origEnv;
        });

        it('detects same version as not needing update', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            const versionData = { version: '1.0.0', commit: 'abc', buildDate: '2026-01-01T00:00:00Z' };
            vi.doMock('fs', () => ({
                existsSync: vi.fn().mockReturnValue(true),
                readFileSync: vi.fn().mockReturnValue(JSON.stringify(versionData)),
            }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: {
                    get: vi.fn().mockResolvedValue({
                        data: { version: '1.0.0', releaseDate: '2026-03-22', downloadUrl: 'https://example.com/download', releaseNotesUrl: 'https://example.com/notes' },
                    }),
                },
            }));
            const freshMod = await import('../../utils/updateChecker');
            freshMod.setUpdateManifestUrl('https://example.com/latest.json');
            const status = await freshMod.getVersionStatus(true);
            expect(status.updateAvailable).toBe(false);
            expect(status.latest).toBe('1.0.0');
            process.env.NODE_ENV = origEnv;
        });

        it('detects older latest version as not needing update', async () => {
            vi.resetModules();
            const origEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            const versionData = { version: '2.0.0', commit: 'abc', buildDate: '2026-01-01T00:00:00Z' };
            vi.doMock('fs', () => ({
                existsSync: vi.fn().mockReturnValue(true),
                readFileSync: vi.fn().mockReturnValue(JSON.stringify(versionData)),
            }));
            vi.doMock('../../utils/appRoot', () => ({ isPackaged: false, distDir: '/mock/dist', appRoot: '/mock/root' }));
            vi.doMock('axios', () => ({
                default: {
                    get: vi.fn().mockResolvedValue({
                        data: { version: '1.5.0', releaseDate: '2026-03-22', downloadUrl: 'x', releaseNotesUrl: 'y' },
                    }),
                },
            }));
            const freshMod = await import('../../utils/updateChecker');
            freshMod.setUpdateManifestUrl('https://example.com/latest.json');
            const status = await freshMod.getVersionStatus(true);
            expect(status.updateAvailable).toBe(false);
            process.env.NODE_ENV = origEnv;
        });
    });
});
