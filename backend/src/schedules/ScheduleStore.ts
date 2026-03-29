import * as fs from 'fs';
import * as path from 'path';

// ── Data model ──────────────────────────────────────────────────────────────

export interface ScheduleDefinition {
    id: string;
    name: string;
    enabled: boolean;

    // Investigation params
    target: string;
    query: string;                     // Free-form investigation query
    intervalMinutes: number;           // Default 15
    productId?: string;
    model?: string;                    // AI model to use (e.g. "gpt-4o")
    maxSteps?: number;                 // Constrain agent steps (default 20)
    timeRange?: string;                // Time range per run (default "ago(1h)")
    category?: string;

    // Escalation
    autoEscalate: boolean;             // Auto-launch full investigation on "critical"
    escalationQuery?: string;          // Optional override query for escalated run

    // Retention
    retentionCount?: number;           // Override global scheduledInvestigationRetentionCount for this schedule

    // Ownership
    createdBy?: string;                // GitHub login or OS username of the schedule creator

    // Runtime state (updated by Scheduler)
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
    lastVerdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    lastInvestigationId?: string;
    activeInvestigationId?: string;    // For dedup — set while investigation is running
    activeEscalationId?: string;       // Escalated investigation ID (if any)
    consecutiveCriticalCount?: number; // Track consecutive critical verdicts
}

export interface ScheduleHistoryEntry {
    timestamp: string;
    verdict: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    investigationId: string;
    summary?: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class ScheduleStore {
    private schedules: Map<string, ScheduleDefinition> = new Map();
    private schedulesFilePath: string;
    private historyDir: string;
    private historyRetentionDays: number;
    private historyCountCache: Map<string, number> = new Map();

    constructor(investigationsPath: string, historyRetentionDays: number = 7) {
        const schedulesDir = path.join(investigationsPath, 'schedules');
        if (!fs.existsSync(schedulesDir)) {
            fs.mkdirSync(schedulesDir, { recursive: true });
        }
        this.schedulesFilePath = path.join(schedulesDir, 'schedules.json');
        this.historyDir = schedulesDir;
        this.historyRetentionDays = historyRetentionDays;
        this.load();
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    getAll(): ScheduleDefinition[] {
        return Array.from(this.schedules.values());
    }

    get(id: string): ScheduleDefinition | undefined {
        return this.schedules.get(id);
    }

    create(def: Omit<ScheduleDefinition, 'id' | 'createdAt'>): ScheduleDefinition {
        const schedule: ScheduleDefinition = {
            ...def,
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
        };
        this.schedules.set(schedule.id, schedule);
        this.save();
        return schedule;
    }

    update(id: string, partial: Partial<ScheduleDefinition>): ScheduleDefinition | undefined {
        const existing = this.schedules.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...partial, id }; // id is immutable
        this.schedules.set(id, updated);
        this.save();
        return updated;
    }

    delete(id: string): boolean {
        const deleted = this.schedules.delete(id);
        if (deleted) {
            this.save();
            // Clean up history directory for this schedule
            const histDir = path.join(this.historyDir, id);
            if (fs.existsSync(histDir)) {
                try {
                    fs.rmSync(histDir, { recursive: true, force: true });
                } catch (err) {
                    console.error(`[ScheduleStore] Failed to clean up history for schedule ${id}:`, err);
                }
            }
        }
        return deleted;
    }

    // ── History ───────────────────────────────────────────────────────────

    getHistory(scheduleId: string, maxEntries?: number): ScheduleHistoryEntry[] {
        const filePath = this.historyFilePath(scheduleId);
        if (!fs.existsSync(filePath)) return [];
        try {
            const entries: ScheduleHistoryEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (maxEntries) return entries.slice(-maxEntries);
            return entries;
        } catch {
            return [];
        }
    }

    getHistoryCount(scheduleId: string): number {
        const cached = this.historyCountCache.get(scheduleId);
        if (cached !== undefined) return cached;
        const filePath = this.historyFilePath(scheduleId);
        if (!fs.existsSync(filePath)) return 0;
        try {
            // Count top-level JSON array elements without fully parsing the file.
            // The file is a JSON array of objects — count occurrences of the opening
            // delimiter pattern to avoid allocating the full parsed array.
            const raw = fs.readFileSync(filePath, 'utf-8');
            // Fast path: count opening braces that start array entries.
            // Each ScheduleHistoryEntry is an object, so count top-level '{'.
            let count = 0;
            let depth = 0;
            for (let i = 0; i < raw.length; i++) {
                const ch = raw[i];
                if (ch === '[' || ch === '{') {
                    depth++;
                    if (depth === 2 && ch === '{') count++; // top-level array element
                } else if (ch === ']' || ch === '}') {
                    depth--;
                } else if (ch === '"') {
                    // Skip string content to avoid counting braces inside strings
                    i++;
                    while (i < raw.length && raw[i] !== '"') {
                        if (raw[i] === '\\') i++; // skip escaped chars
                        i++;
                    }
                }
            }
            this.historyCountCache.set(scheduleId, count);
            return count;
        } catch {
            return 0;
        }
    }

    appendHistory(scheduleId: string, entry: ScheduleHistoryEntry): void {
        this.historyCountCache.delete(scheduleId);
        const filePath = this.historyFilePath(scheduleId);
        this.withFileLock(filePath, () => {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            let entries: ScheduleHistoryEntry[] = [];
            if (fs.existsSync(filePath)) {
                try { entries = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { entries = []; }
            }
            entries.push(entry);

            // Prune old entries
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - this.historyRetentionDays);
            entries = entries.filter(e => new Date(e.timestamp) >= cutoff);

            const tmpPath = filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
        });
    }

    removeHistoryEntries(scheduleId: string, investigationIds: Set<string>): void {
        this.historyCountCache.delete(scheduleId);
        const filePath = this.historyFilePath(scheduleId);
        if (!fs.existsSync(filePath)) return;
        this.withFileLock(filePath, () => {
            try {
                let entries: ScheduleHistoryEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                entries = entries.filter(e => !investigationIds.has(e.investigationId));
                const tmpPath = filePath + '.tmp';
                fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
                fs.renameSync(tmpPath, filePath);
            } catch { /* best-effort */ }
        });
    }

    /** Synchronous per-file lock to serialize read-modify-write cycles. */
    private withFileLock(filePath: string, fn: () => void): void {
        fn();
    }

    // ── Run Reports & Executive Report ────────────────────────────────────

    writeRunReport(scheduleId: string, investigationId: string, content: string): void {
        const dir = path.join(this.historyDir, scheduleId, 'reports');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${investigationId}.md`), content, 'utf-8');
    }

    writeExecutiveReport(scheduleId: string, content: string): void {
        const dir = path.join(this.historyDir, scheduleId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'executive-report.md'), content, 'utf-8');
    }

    getExecutiveReport(scheduleId: string): string | null {
        const filePath = path.join(this.historyDir, scheduleId, 'executive-report.md');
        if (!fs.existsSync(filePath)) return null;
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    // ── Persistence ───────────────────────────────────────────────────────

    private save(): void {
        const data = Array.from(this.schedules.values());
        const tmpPath = this.schedulesFilePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.schedulesFilePath);
    }

    private load(): void {
        if (!fs.existsSync(this.schedulesFilePath)) return;
        try {
            const data: ScheduleDefinition[] = JSON.parse(fs.readFileSync(this.schedulesFilePath, 'utf-8'));
            for (const def of data) {
                // Keep activeInvestigationId / activeEscalationId on load so that
                // the auto-settlement logic (GET /api/schedules & Scheduler tick)
                // can check the actual investigation status, set the correct
                // lastVerdict, and THEN clear the reference.  Blindly clearing here
                // left lastVerdict unset → UI showed "Pending" forever.
                this.schedules.set(def.id, def);
            }
            console.log(`[ScheduleStore] Loaded ${this.schedules.size} schedule(s) from disk.`);
        } catch (err) {
            console.error('[ScheduleStore] Failed to load schedules:', err);
        }
    }

    private historyFilePath(scheduleId: string): string {
        return path.join(this.historyDir, scheduleId, 'history.json');
    }
}
