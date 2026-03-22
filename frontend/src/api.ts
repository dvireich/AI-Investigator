import type { ScheduleDefinition, ScheduleHistoryEntry } from './types/schedule';

export interface SavedQuery {
    id: string;
    name: string;
    target?: string;
    query?: string;
    category?: string;
    correlationId?: string;
    timeRange?: string;
    timeMode?: 'preset' | 'custom';
    model?: string;
    productId?: string;
    intervalMinutes?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Product {
    id: string;
    name: string;
    repoRoot: string;
    systemPromptPath: string;
    knowledgeBasePath: string;
    workingDirectory: string;
    investigationsPath: string;
}

export interface PathValidationResult {
    field: string;
    label: string;
    value: string;
    isAbsolute: boolean;
    exists: boolean;
    error: string | null;
}

export interface ProductValidation {
    valid: boolean;
    paths: PathValidationResult[];
}

export interface DiscoverResult {
    source: 'manifest' | 'auto-discovered' | 'none';
    product: Partial<Product>;
    suggestions: string[];
}

const API_URL = import.meta.env.VITE_API_URL || '/api';

// Derive the base URL (without /api) for WebSocket connections
// When using relative URLs, BASE_URL becomes '' so WebSocket connects to same origin
export const BASE_URL = API_URL.replace(/\/api$/, '');

export interface ProposedChange {
    id: string;
    type: 'edit' | 'create';
    filePath: string;
    description: string;
    content: string;
    originalContent?: string;
    status: 'pending' | 'approved' | 'rejected' | 'applied';
    source?: 'retrospect' | 'implementation';
}

export interface Recommendation {
    id: string;
    priority: string;
    title: string;
    description: string;
    category: 'code' | 'operational';
}

export interface RetrospectMessage {
    role: 'user' | 'assistant' | 'tool-call' | 'tool-result';
    content: string;
    toolName?: string;
    isError?: boolean;
}

export interface RetrospectState {
    messages: RetrospectMessage[];
    proposals: ProposedChange[];
    analysisComplete: boolean;
    analysisFailed?: boolean;
    completed: boolean;
}

export interface Investigation {
    id: string;
    status: 'running' | 'paused' | 'aborted' | 'completed' | 'failed';
    thoughts: string[];
    thoughtCount?: number;
    actions: any[];
    logs: string[];
    title?: string;
    query?: string;
    target?: string;
    timeRange?: string;
    correlationId?: string;
    category?: string;
    incidentId?: string;
    model?: string;
    productId?: string;
    productName?: string;
    pausedAt?: number;
    totalPausedTime?: number;
    finalReport?: string;
    retrospect?: RetrospectState;
    contestCount?: number;
    tags?: string[];
    createdBy?: string;
    storagePath?: string;
    lastModified?: number;
    // Scheduled investigation fields
    source?: 'manual' | 'scheduled';
    scheduleId?: string;
    verdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';
}

export interface IncidentPreview {
    incidentId: string;
    title: string;
    severity: string;
    status: string;
    target: string;
    timeRange: string;
    summary: string;
    raw: string;
}

export interface IncidentProgressEvent {
    type: 'progress' | 'data' | 'result' | 'error';
    step?: string;
    status?: 'running' | 'done' | 'error';
    detail?: string;
    // result fields
    incidentId?: string;
    title?: string;
    severity?: string;
    incidentStatus?: string;
    target?: string;
    timeRange?: string;
    summary?: string;
    raw?: string;
    message?: string;
}

export const api = {
    startInvestigation: async (data: any) => {
        const response = await fetch(`${API_URL}/investigations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to start investigation');
        }
        return response.json();
    },

    // ETag tracking for conditional polling
    _listEtag: null as string | null,
    _listCache: null as Investigation[] | null,

    listInvestigations: async (): Promise<Investigation[]> => {
        const headers: Record<string, string> = {};
        if (api._listEtag) {
            headers['If-None-Match'] = api._listEtag;
        }
        const response = await fetch(`${API_URL}/investigations`, { headers });
        if (response.status === 304 && api._listCache) {
            return api._listCache; // Not modified — return cached data
        }
        if (!response.ok) throw new Error('Failed to list investigations');
        const etag = response.headers.get('etag');
        if (etag) api._listEtag = etag;
        const data = await response.json();
        api._listCache = data;
        return data;
    },

    getInvestigation: async (id: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}`);
        if (!response.ok) throw new Error('Not found');
        return response.json();
    },

    sendAction: async (id: string, action: string, message?: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, message })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to perform action');
        return data;
    },

    getStepDetails: async (id: string, index: number) => {
        const response = await fetch(`${API_URL}/investigations/${id}/steps/${index}`);
        if (!response.ok) throw new Error('Failed to fetch step details');
        return response.json();
    },

    runRetrospect: async (id: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/retrospect`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to run retrospect');
        return response.json();
    },

    resumeAll: async (): Promise<{ resumed: number; skipped: number; ids: string[] }> => {
        const response = await fetch(`${API_URL}/investigations/resume-all`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to resume all');
        return response.json();
    },

    restartServer: async (): Promise<{ status: string }> => {
        const response = await fetch(`${API_URL}/server/restart`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to restart server');
        return response.json();
    },

    // Auth
    getAuthStatus: async () => {
        const response = await fetch(`${API_URL}/auth/status`);
        if (!response.ok) throw new Error('Failed to get auth status');
        return response.json();
    },

    startLogin: async () => {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to start login');
        return response.json();
    },

    configureLlmProvider: async (providerConfig: { type: string; [key: string]: any }) => {
        const response = await fetch(`${API_URL}/auth/configure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(providerConfig)
        });
        if (!response.ok) throw new Error('Failed to configure LLM provider');
        return response.json();
    },

    getAuthProviders: async (): Promise<Array<{ type: string; displayName?: string; authRequirement: { type: string; envVar?: string } }>> => {
        const response = await fetch(`${API_URL}/auth/providers`);
        if (!response.ok) throw new Error('Failed to list auth providers');
        return response.json();
    },

    getIncidentProviders: async (): Promise<Array<{ type: string; displayName: string }>> => {
        const response = await fetch(`${API_URL}/incidents/providers`);
        if (!response.ok) throw new Error('Failed to list incident providers');
        return response.json();
    },

    pollLogin: async (device_code: string, interval: number) => {
        const response = await fetch(`${API_URL}/auth/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code, interval })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
    },

    listModels: async () => {
        const response = await fetch(`${API_URL}/models`);
        if (!response.ok) throw new Error('Failed to list models');
        return response.json();
    },

    // MCP
    getMcpStatus: async (id: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/mcp/status`);
        if (!response.ok) return { connected: false };
        return response.json();
    },

    restartMcp: async (id: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/mcp/restart`, {
            method: 'POST'
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to restart MCP');
        return data;
    },

    updateModel: async (id: string, model: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update model');
        return data;
    },

    compactInvestigation: async (id: string) => {
        const response = await fetch(`${API_URL}/investigations/${id}/compact`, {
            method: 'POST'
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to compact investigation');
        return data;
    },

    // Settings
    getSettings: async () => {
        const response = await fetch(`${API_URL}/settings`);
        if (!response.ok) throw new Error('Failed to get settings');
        return response.json();
    },

    saveSettings: async (settings: any) => {
        const response = await fetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!response.ok) throw new Error('Failed to save settings');
        return response.json();
    },

    // Products
    listProducts: async (): Promise<Product[]> => {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error('Failed to list products');
        return response.json();
    },

    getActiveProduct: async (): Promise<Product | null> => {
        const response = await fetch(`${API_URL}/products/active`);
        if (!response.ok) throw new Error('Failed to get active product');
        return response.json();
    },

    setActiveProduct: async (productId: string): Promise<void> => {
        const response = await fetch(`${API_URL}/products/active`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId })
        });
        if (!response.ok) throw new Error('Failed to set active product');
    },

    addProduct: async (product: Omit<Product, 'id'>): Promise<Product> => {
        const response = await fetch(`${API_URL}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to add product' }));
            throw new Error(err.error || 'Failed to add product');
        }
        return response.json();
    },

    updateProduct: async (id: string, product: Partial<Product>): Promise<Product> => {
        const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to update product' }));
            throw new Error(err.error || 'Failed to update product');
        }
        return response.json();
    },

    deleteProduct: async (id: string): Promise<void> => {
        const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to delete product' }));
            throw new Error(err.error || 'Failed to delete product');
        }
    },

    validateProduct: async (id: string): Promise<ProductValidation> => {
        const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}/validate`);
        if (!response.ok) throw new Error('Failed to validate product');
        return response.json();
    },

    discoverProduct: async (repoRoot: string): Promise<DiscoverResult> => {
        const response = await fetch(`${API_URL}/products/discover?repoRoot=${encodeURIComponent(repoRoot)}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to discover product' }));
            throw new Error(err.error || 'Failed to discover product');
        }
        return response.json();
    },

    cloneProduct: async (id: string): Promise<Product> => {
        const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}/clone`, {
            method: 'POST',
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to clone product' }));
            throw new Error(err.error || 'Failed to clone product');
        }
        return response.json();
    },

    sendRetrospectMessage: async (id: string, message: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    analyzeRetrospect: async (id: string, reset: boolean = false) => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    abortRetrospect: async (id: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect/abort`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    updateProposal: async (id: string, proposalId: string, status: 'approved' | 'rejected') => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect/proposals/${proposalId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    applyProposals: async (id: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect/apply`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    getRecommendations: async (id: string): Promise<Recommendation[]> => {
        const res = await fetch(`${API_URL}/investigations/${id}/recommendations`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    implementRecommendations: async (id: string, recommendations: string[]) => {
        const res = await fetch(`${API_URL}/investigations/${id}/implement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recommendations })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    updateTitle: async (id: string, title: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}/title`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    updateTags: async (id: string, tags: string[]) => {
        const res = await fetch(`${API_URL}/investigations/${id}/tags`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    deleteInvestigation: async (id: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || 'Failed to delete investigation');
        }
        return res.json();
    },

    completeRetrospect: async (id: string, completed: boolean = true) => {
        const res = await fetch(`${API_URL}/investigations/${id}/retrospect/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    // --- Share / Import / Export ---

    /** Download the full investigation state as a JSON file for sharing */
    exportInvestigation: async (id: string, filename?: string) => {
        const response = await fetch(`${API_URL}/investigations/${encodeURIComponent(id)}/export`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to export investigation');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `investigation-${id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /** Import an investigation from a JSON state object */
    importInvestigation: async (state: any): Promise<{ ok: boolean; id: string }> => {
        const response = await fetch(`${API_URL}/investigations/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to import investigation');
        }
        return response.json();
    },

    /** Download the final report as a PDF document */
    exportPdf: async (id: string, filename?: string) => {
        const response = await fetch(`${API_URL}/investigations/${encodeURIComponent(id)}/pdf`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to export PDF');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `investigation-${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    listFiles: async (path?: string) => {
        const response = await fetch(`${API_URL}/files/list${path ? `?path=${encodeURIComponent(path)}` : ''}`);
        if (!response.ok) throw new Error('Failed to list files');
        return response.json();
    },

    // Incident Provider
    checkIncidentStatus: async (): Promise<{ available: boolean; message?: string; providerType?: string }> => {
        const response = await fetch(`${API_URL}/incidents/status`);
        if (!response.ok) return { available: false, message: 'Failed to check incident provider status' };
        return response.json();
    },

    fetchIncident: async (
        incidentId: string,
        onProgress?: (event: IncidentProgressEvent) => void
    ): Promise<IncidentPreview> => {
        const response = await fetch(`${API_URL}/incidents/${encodeURIComponent(incidentId)}/read`, {
            method: 'POST'
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to read incident');
        }

        // Consume SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let result: IncidentPreview | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const event: IncidentProgressEvent = JSON.parse(line.substring(6));
                        if (event.type === 'progress' && onProgress) {
                            onProgress(event);
                        } else if (event.type === 'result') {
                            result = {
                                incidentId: event.incidentId || incidentId,
                                title: event.title || `Incident ${incidentId}`,
                                severity: event.severity || 'Unknown',
                                status: (event as any).status || '',
                                target: event.target || '',
                                timeRange: event.timeRange || '',
                                summary: event.summary || '',
                                raw: event.raw || ''
                            };
                        } else if (event.type === 'error') {
                            throw new Error(event.message || 'Incident read failed');
                        }
                    } catch (e) {
                        if (e instanceof Error && e.message !== 'Incident read failed') {
                            /* skip parse errors */
                        } else {
                            throw e;
                        }
                    }
                }
            }
        }

        if (!result) throw new Error('No result received from incident provider');
        return result;
    },

    // ── Schedules ──────────────────────────────────────────────────────

    getSchedules: async (): Promise<ScheduleDefinition[]> => {
        const response = await fetch(`${API_URL}/schedules`);
        if (!response.ok) throw new Error('Failed to fetch schedules');
        return response.json();
    },

    createSchedule: async (def: Partial<ScheduleDefinition>): Promise<ScheduleDefinition> => {
        const response = await fetch(`${API_URL}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(def),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to create schedule');
        }
        return response.json();
    },

    updateSchedule: async (id: string, partial: Partial<ScheduleDefinition>): Promise<ScheduleDefinition> => {
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partial),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to update schedule');
        }
        return response.json();
    },

    deleteSchedule: async (id: string): Promise<void> => {
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete schedule');
    },

    runScheduleNow: async (id: string): Promise<void> => {
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}/run-now`, { method: 'POST' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to run schedule');
        }
    },

    enableSchedule: async (id: string): Promise<ScheduleDefinition> => {
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}/enable`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to enable schedule');
        return response.json();
    },

    disableSchedule: async (id: string): Promise<ScheduleDefinition> => {
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}/disable`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to disable schedule');
        return response.json();
    },

    getScheduleHistory: async (id: string, maxEntries?: number): Promise<ScheduleHistoryEntry[]> => {
        const params = maxEntries ? `?maxEntries=${maxEntries}` : '';
        const response = await fetch(`${API_URL}/schedules/${encodeURIComponent(id)}/history${params}`);
        if (!response.ok) throw new Error('Failed to fetch schedule history');
        return response.json();
    },

    getSchedulerStatus: async (): Promise<{ running: boolean }> => {
        const response = await fetch(`${API_URL}/scheduler/status`);
        if (!response.ok) throw new Error('Failed to get scheduler status');
        return response.json();
    },

    startScheduler: async (): Promise<void> => {
        await fetch(`${API_URL}/scheduler/start`, { method: 'POST' });
    },

    stopScheduler: async (): Promise<void> => {
        await fetch(`${API_URL}/scheduler/stop`, { method: 'POST' });
    },

    // ── Query Bank ──────────────────────────────────────────────────────

    getSavedQueries: async (): Promise<SavedQuery[]> => {
        const response = await fetch(`${API_URL}/query-bank`);
        if (!response.ok) throw new Error('Failed to fetch saved queries');
        return response.json();
    },

    createSavedQuery: async (data: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedQuery> => {
        const response = await fetch(`${API_URL}/query-bank`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to save query');
        }
        return response.json();
    },

    updateSavedQuery: async (id: string, partial: Partial<SavedQuery>): Promise<SavedQuery> => {
        const response = await fetch(`${API_URL}/query-bank/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partial),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to update saved query');
        }
        return response.json();
    },

    deleteSavedQuery: async (id: string): Promise<void> => {
        const response = await fetch(`${API_URL}/query-bank/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete saved query');
    },
};
