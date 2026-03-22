import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { IncidentProvider, IncidentProviderConfig, IncidentData, IncidentProgressEvent } from '../IncidentProvider';
import { nodeExecutable } from '../../../utils/appRoot';

/**
 * Microsoft IcM (Incident Management) provider.
 * Wraps the existing scripts/icm/icm-full-read.js Playwright-based scraper.
 */
export class IcmProvider implements IncidentProvider {
    readonly type = 'icm';
    readonly displayName = 'Microsoft IcM';

    private scriptsPath: string | null = null;

    configure(config: IncidentProviderConfig): void {
        if (config.scriptsPath) this.scriptsPath = config.scriptsPath;
    }

    async isAvailable(): Promise<boolean> {
        if (!this.scriptsPath) return false;
        const scriptFile = path.join(this.scriptsPath, 'icm-full-read.js');
        return fs.existsSync(scriptFile);
    }

    async fetchIncident(id: string, onProgress?: (event: IncidentProgressEvent) => void): Promise<IncidentData> {
        if (!this.scriptsPath) throw new Error('IcM scripts path not configured.');

        const scriptFile = path.join(this.scriptsPath, 'icm-full-read.js');
        if (!fs.existsSync(scriptFile)) {
            throw new Error(`IcM script not found: ${scriptFile}`);
        }

        return new Promise((resolve, reject) => {
            const child = spawn(nodeExecutable, [scriptFile, id], {
                cwd: this.scriptsPath!,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let metadata: any = {};
            let content = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed.startsWith('[PROGRESS] ')) {
                        try {
                            const event = JSON.parse(trimmed.substring('[PROGRESS] '.length));
                            onProgress?.({ type: 'progress', ...event });
                        } catch { /* ignore malformed progress */ }
                    } else if (trimmed.startsWith('[DATA] ')) {
                        try {
                            const event = JSON.parse(trimmed.substring('[DATA] '.length));
                            if (event.key === 'metadata') metadata = event.value;
                            if (event.key === 'content') content = event.value;
                            onProgress?.({ type: 'data', key: event.key, value: event.value });
                        } catch { /* ignore malformed data */ }
                    }
                }
            });

            child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            child.on('close', (code) => {
                if (code !== 0 && !metadata.title) {
                    reject(new Error(`IcM script failed (exit ${code}): ${stderr}`));
                    return;
                }

                // Extract target from metadata (IcM populates owningService or impactedServices)
                const target: string | undefined = metadata.owningService || metadata.impactedService || undefined;

                // Extract time range as ISO strings (let the agent format for its query language)
                let timeRange: string | undefined;
                if (metadata.impactingFrom || metadata.created) {
                    const start = metadata.impactingFrom || metadata.created;
                    const end = metadata.mitigatedAt || new Date().toISOString();
                    timeRange = `${start} to ${end}`;
                }

                const result: IncidentData = {
                    id,
                    title: metadata.title || `IcM Incident ${id}`,
                    severity: metadata.severity,
                    status: metadata.status,
                    owner: metadata.owner,
                    owningTeam: metadata.owningTeam,
                    createdAt: metadata.created,
                    mitigatedAt: metadata.mitigatedAt,
                    summary: metadata.summary,
                    target,
                    timeRange,
                    content
                };

                onProgress?.({ type: 'done' });
                resolve(result);
            });

            child.on('error', (err) => {
                reject(new Error(`Failed to spawn IcM script: ${err.message}`));
            });
        });
    }
}
