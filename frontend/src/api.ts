export interface Product {
    id: string;
    name: string;
    repoRoot: string;
    systemPromptPath: string;
    retrospectPromptPath: string;
    knowledgeBasePath: string;
    workingDirectory: string;
    investigationsPath: string;
    icmScriptsPath: string;
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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Derive the base URL (without /api) for WebSocket connections
export const BASE_URL = API_URL.replace(/\/api$/, '');

export interface ProposedChange {
    id: string;
    type: 'edit' | 'create';
    filePath: string;
    description: string;
    content: string;
    originalContent?: string;
    status: 'pending' | 'approved' | 'rejected' | 'applied';
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
    actions: any[];
    logs: string[];
    title?: string;
    query?: string;
    stamp?: string;
    timeRange?: string;
    trackingId?: string;
    issueType?: string;
    incidentId?: string;
    model?: string;
    productId?: string;
    productName?: string;
    pausedAt?: number;
    totalPausedTime?: number;
    finalReport?: string;
    retrospect?: RetrospectState;
    contestCount?: number;
}

export interface IcmIncidentPreview {
    incidentId: string;
    title: string;
    severity: string;
    status: string;
    owner: string;
    owningTeam: string;
    stamp: string;
    timeRange: string;
    summary: string;
    raw: string;
}

export interface IcmProgressEvent {
    type: 'progress' | 'data' | 'result' | 'error';
    step?: string;
    status?: 'running' | 'done' | 'error';
    detail?: string;
    // result fields
    incidentId?: string;
    title?: string;
    severity?: string;
    incidentStatus?: string;  // renamed to avoid conflict with 'status' field above
    owner?: string;
    owningTeam?: string;
    stamp?: string;
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

    listInvestigations: async () => {
        const response = await fetch(`${API_URL}/investigations`);
        if (!response.ok) throw new Error('Failed to list investigations');
        return response.json();
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

    startAzureLogin: async () => {
        const response = await fetch(`${API_URL}/auth/azure-login`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to start Azure login');
        return response.json();
    },

    getAzureAuthStatus: async () => {
        const response = await fetch(`${API_URL}/auth/azure-status`);
        if (!response.ok) throw new Error('Failed to get Azure auth status');
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

    updateTitle: async (id: string, title: string) => {
        const res = await fetch(`${API_URL}/investigations/${id}/title`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
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

    listFiles: async (path?: string) => {
        const response = await fetch(`${API_URL}/files/list${path ? `?path=${encodeURIComponent(path)}` : ''}`);
        if (!response.ok) throw new Error('Failed to list files');
        return response.json();
    },

    // ICM
    checkIcmStatus: async (): Promise<{ available: boolean; message?: string }> => {
        const response = await fetch(`${API_URL}/icm/status`);
        if (!response.ok) return { available: false, message: 'Failed to check ICM status' };
        return response.json();
    },

    fetchIcmIncident: async (
        incidentId: string,
        onProgress?: (event: IcmProgressEvent) => void
    ): Promise<IcmIncidentPreview> => {
        const response = await fetch(`${API_URL}/icm/${encodeURIComponent(incidentId)}/read`, {
            method: 'POST'
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Failed to read ICM incident');
        }

        // Consume SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let result: IcmIncidentPreview | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const event: IcmProgressEvent = JSON.parse(line.substring(6));
                        if (event.type === 'progress' && onProgress) {
                            onProgress(event);
                        } else if (event.type === 'result') {
                            result = {
                                incidentId: event.incidentId || incidentId,
                                title: event.title || `IcM Incident ${incidentId}`,
                                severity: event.severity || 'Unknown',
                                status: (event as any).status || '',
                                owner: event.owner || '',
                                owningTeam: event.owningTeam || '',
                                stamp: event.stamp || '',
                                timeRange: event.timeRange || '',
                                summary: event.summary || '',
                                raw: event.raw || ''
                            };
                        } else if (event.type === 'error') {
                            throw new Error(event.message || 'ICM read failed');
                        }
                    } catch (e) {
                        if (e instanceof Error && e.message !== 'ICM read failed') {
                            /* skip parse errors */
                        } else {
                            throw e;
                        }
                    }
                }
            }
        }

        if (!result) throw new Error('No result received from ICM script');
        return result;
    }
};
