import * as fs from 'fs';
import * as path from 'path';
import type { PipelineDefinition } from '../agent/pipeline/PipelineDefinition';
import type { AgentDefinition } from '../agent/pipeline/AgentDefinition';

// ── Data model ──────────────────────────────────────────────────────────────

/// <summary>
/// A user-saved workflow — wraps a PipelineDefinition with metadata.
/// </summary>
export interface SavedWorkflow {
    /// <summary>Unique identifier for the saved workflow.</summary>
    id: string;
    /// <summary>Display name for this workflow.</summary>
    name: string;
    /// <summary>Optional description.</summary>
    description?: string;
    /// <summary>Optional icon emoji.</summary>
    icon?: string;
    /// <summary>The full pipeline definition (stages + agents).</summary>
    pipeline: PipelineDefinition;
    /// <summary>ISO timestamp of creation.</summary>
    createdAt: string;
    /// <summary>ISO timestamp of last update.</summary>
    updatedAt: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

/// <summary>
/// File-based store for user-saved workflow definitions.
/// Follows the same pattern as QueryBankStore and ScheduleStore.
/// </summary>
export class WorkflowStore {
    /// <summary>In-memory cache of all saved workflows, keyed by id.</summary>
    private workflows: Map<string, SavedWorkflow> = new Map();
    /// <summary>Path to the JSON persistence file.</summary>
    private filePath: string;

    /// <summary>
    /// Constructs a WorkflowStore that persists to a file under the given directory.
    /// </summary>
    constructor(investigationsPath: string) {
        if (!fs.existsSync(investigationsPath)) { // ensure parent directory exists
            fs.mkdirSync(investigationsPath, { recursive: true });
        }
        this.filePath = path.join(investigationsPath, 'workflows.json'); // persisted file
        this.load(); // hydrate from disk on startup
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    /// <summary>Returns all saved workflows.</summary>
    getAll(): SavedWorkflow[] {
        return Array.from(this.workflows.values()); // return copy of values
    }

    /// <summary>Returns a single saved workflow by id, or undefined if not found.</summary>
    get(id: string): SavedWorkflow | undefined {
        return this.workflows.get(id); // O(1) lookup
    }

    /// <summary>Creates a new saved workflow and persists to disk.</summary>
    create(data: Omit<SavedWorkflow, 'id' | 'createdAt' | 'updatedAt'>): SavedWorkflow {
        const now = new Date().toISOString(); // consistent timestamp
        const saved: SavedWorkflow = {
            ...data,
            id: Date.now().toString(), // unique-enough id for single-user
            createdAt: now,
            updatedAt: now,
        };
        this.workflows.set(saved.id, saved); // add to cache
        this.save(); // flush to disk
        return saved;
    }

    /// <summary>Updates an existing saved workflow by id. Returns undefined if not found.</summary>
    update(id: string, partial: Partial<SavedWorkflow>): SavedWorkflow | undefined {
        const existing = this.workflows.get(id); // find existing
        if (!existing) return undefined; // not found
        const updated: SavedWorkflow = {
            ...existing,
            ...partial,
            id, // id is immutable
            createdAt: existing.createdAt, // createdAt is immutable
            updatedAt: new Date().toISOString(), // bump updatedAt
        };
        this.workflows.set(id, updated); // update cache
        this.save(); // flush to disk
        return updated;
    }

    /// <summary>Deletes a saved workflow by id. Returns true if found and deleted.</summary>
    delete(id: string): boolean {
        const deleted = this.workflows.delete(id); // remove from cache
        if (deleted) this.save(); // flush only if something changed
        return deleted;
    }

    // ── Persistence ───────────────────────────────────────────────────────

    /// <summary>Atomically writes all workflows to disk.</summary>
    private save(): void {
        const data = Array.from(this.workflows.values()); // serialize values
        const tmpPath = this.filePath + '.tmp'; // write to temp first
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8'); // pretty-print JSON
        fs.renameSync(tmpPath, this.filePath); // atomic rename
    }

    /// <summary>Loads workflows from disk into the in-memory map.</summary>
    private load(): void {
        if (!fs.existsSync(this.filePath)) return; // nothing to load
        try {
            const data: SavedWorkflow[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); // parse JSON
            for (const w of data) { // populate map
                this.workflows.set(w.id, w);
            }
            console.log(`[WorkflowStore] Loaded ${this.workflows.size} saved workflow(s) from disk.`); // startup log
        } catch (e) {
            console.error('[WorkflowStore] Failed to load workflows from disk:', e); // log but don't crash
        }
    }
}

// ── Data model ──────────────────────────────────────────────────────────────

/// <summary>
/// A user-saved custom agent definition — reusable across workflows.
/// </summary>
export interface SavedAgent {
    /// <summary>Unique identifier for the saved agent.</summary>
    id: string;
    /// <summary>The full agent definition.</summary>
    agent: AgentDefinition;
    /// <summary>ISO timestamp of creation.</summary>
    createdAt: string;
    /// <summary>ISO timestamp of last update.</summary>
    updatedAt: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

/// <summary>
/// File-based store for user-saved custom agent definitions.
/// </summary>
export class CustomAgentStore {
    /// <summary>In-memory cache of all saved agents, keyed by id.</summary>
    private agents: Map<string, SavedAgent> = new Map();
    /// <summary>Path to the JSON persistence file.</summary>
    private filePath: string;

    /// <summary>
    /// Constructs a CustomAgentStore that persists to a file under the given directory.
    /// </summary>
    constructor(investigationsPath: string) {
        if (!fs.existsSync(investigationsPath)) { // ensure parent directory exists
            fs.mkdirSync(investigationsPath, { recursive: true });
        }
        this.filePath = path.join(investigationsPath, 'custom-agents.json'); // persisted file
        this.load(); // hydrate from disk on startup
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    /// <summary>Returns all saved custom agents.</summary>
    getAll(): SavedAgent[] {
        return Array.from(this.agents.values()); // return copy of values
    }

    /// <summary>Returns a single saved agent by id, or undefined if not found.</summary>
    get(id: string): SavedAgent | undefined {
        return this.agents.get(id); // O(1) lookup
    }

    /// <summary>Creates a new saved agent and persists to disk.</summary>
    create(data: Omit<SavedAgent, 'id' | 'createdAt' | 'updatedAt'>): SavedAgent {
        const now = new Date().toISOString(); // consistent timestamp
        const saved: SavedAgent = {
            ...data,
            id: Date.now().toString(), // unique-enough id
            createdAt: now,
            updatedAt: now,
        };
        this.agents.set(saved.id, saved); // add to cache
        this.save(); // flush to disk
        return saved;
    }

    /// <summary>Updates an existing saved agent by id. Returns undefined if not found.</summary>
    update(id: string, partial: Partial<SavedAgent>): SavedAgent | undefined {
        const existing = this.agents.get(id); // find existing
        if (!existing) return undefined; // not found
        const updated: SavedAgent = {
            ...existing,
            ...partial,
            id, // id is immutable
            createdAt: existing.createdAt, // createdAt is immutable
            updatedAt: new Date().toISOString(), // bump updatedAt
        };
        this.agents.set(id, updated); // update cache
        this.save(); // flush to disk
        return updated;
    }

    /// <summary>Deletes a saved agent by id. Returns true if found and deleted.</summary>
    delete(id: string): boolean {
        const deleted = this.agents.delete(id); // remove from cache
        if (deleted) this.save(); // flush only if something changed
        return deleted;
    }

    // ── Persistence ───────────────────────────────────────────────────────

    /// <summary>Atomically writes all agents to disk.</summary>
    private save(): void {
        const data = Array.from(this.agents.values()); // serialize values
        const tmpPath = this.filePath + '.tmp'; // write to temp first
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8'); // pretty-print JSON
        fs.renameSync(tmpPath, this.filePath); // atomic rename
    }

    /// <summary>Loads agents from disk into the in-memory map.</summary>
    private load(): void {
        if (!fs.existsSync(this.filePath)) return; // nothing to load
        try {
            const data: SavedAgent[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); // parse JSON
            for (const a of data) { // populate map
                this.agents.set(a.id, a);
            }
            console.log(`[CustomAgentStore] Loaded ${this.agents.size} saved custom agent(s) from disk.`); // startup log
        } catch (e) {
            console.error('[CustomAgentStore] Failed to load custom agents from disk:', e); // log but don't crash
        }
    }
}
