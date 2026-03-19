import * as fs from 'fs';
import * as path from 'path';

// ── Data model ──────────────────────────────────────────────────────────────

export interface SavedQuery {
    id: string;
    name: string;

    // Investigation params (all optional — user saves whichever fields they want)
    target?: string;
    query?: string;
    category?: string;
    correlationId?: string;
    timeRange?: string;           // e.g. "ago(1h)" or "between(datetime(...) .. datetime(...))"
    timeMode?: 'preset' | 'custom';
    model?: string;
    productId?: string;
    intervalMinutes?: number;      // Schedule interval (e.g. 60 for hourly)

    // Metadata
    createdAt: string;
    updatedAt: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class QueryBankStore {
    private queries: Map<string, SavedQuery> = new Map();
    private filePath: string;

    constructor(investigationsPath: string) {
        if (!fs.existsSync(investigationsPath)) {
            fs.mkdirSync(investigationsPath, { recursive: true });
        }
        this.filePath = path.join(investigationsPath, 'query-bank.json');
        this.load();
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    getAll(): SavedQuery[] {
        return Array.from(this.queries.values());
    }

    get(id: string): SavedQuery | undefined {
        return this.queries.get(id);
    }

    create(data: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): SavedQuery {
        const now = new Date().toISOString();
        const saved: SavedQuery = {
            ...data,
            id: Date.now().toString(),
            createdAt: now,
            updatedAt: now,
        };
        this.queries.set(saved.id, saved);
        this.save();
        return saved;
    }

    update(id: string, partial: Partial<SavedQuery>): SavedQuery | undefined {
        const existing = this.queries.get(id);
        if (!existing) return undefined;
        const updated: SavedQuery = {
            ...existing,
            ...partial,
            id,                                    // id is immutable
            createdAt: existing.createdAt,          // createdAt is immutable
            updatedAt: new Date().toISOString(),
        };
        this.queries.set(id, updated);
        this.save();
        return updated;
    }

    delete(id: string): boolean {
        const deleted = this.queries.delete(id);
        if (deleted) this.save();
        return deleted;
    }

    // ── Persistence ───────────────────────────────────────────────────────

    private save(): void {
        const data = Array.from(this.queries.values());
        const tmpPath = this.filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.filePath);
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) return;
        try {
            const data: SavedQuery[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
            for (const q of data) {
                this.queries.set(q.id, q);
            }
            console.log(`[QueryBankStore] Loaded ${this.queries.size} saved query/queries from disk.`);
        } catch (err) {
            console.error('[QueryBankStore] Failed to load saved queries:', err);
        }
    }
}
