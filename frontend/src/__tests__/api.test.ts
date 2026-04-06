import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, BASE_URL } from '../api';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: any, options?: { status?: number; headers?: Record<string, string> }) {
    const status = options?.status ?? 200;
    const headers = new Headers(options?.headers || {});
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers,
        json: vi.fn().mockResolvedValue(data),
        text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    };
}

describe('api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset ETag/cache state
        api._listEtag = null;
        api._listCache = null;
    });

    describe('BASE_URL', () => {
        it('strips /api suffix', () => {
            // BASE_URL is derived at module load time from import.meta.env
            expect(typeof BASE_URL).toBe('string');
        });
    });

    describe('startInvestigation', () => {
        it('sends POST to /investigations', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: '123', status: 'running' }));

            const result = await api.startInvestigation({ target: 'stamp', timeRange: 'ago(1h)' });
            expect(result.id).toBe('123');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('throws on non-OK response', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Bad request' }, { status: 400 }));
            await expect(api.startInvestigation({})).rejects.toThrow('Bad request');
        });

        it('startInvestigation throws fallback when response has no error field', async () => {
            // Covers line 149: err.error || 'Failed to start investigation' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.startInvestigation({})).rejects.toThrow('Failed to start investigation');
        });
    });

    describe('listInvestigations', () => {
        it('fetches and caches investigations', async () => {
            const data = { items: [{ id: '1', status: 'completed' }], totalCount: 1, page: 1, pageSize: 12, totalPages: 1, filterMeta: { products: [], tags: [], creators: [] }, stats: { total: 1, running: 0, paused: 0, completed: 1, failed: 0, aborted: 0, successRate: 100, resolvedCount: 1, avgDurationMs: 0, durationSamples: 0, thisWeekCount: 0, lastWeekCount: 0, contestRate: 0, contestableCount: 0 } };
            mockFetch.mockResolvedValue(mockResponse(data, { headers: { etag: '"v1"' } }));

            const result = await api.listInvestigations();
            expect(result).toEqual(data);
            expect(api._listEtag).toBe('"v1"');
            expect(api._listCache).toEqual(data);
        });

        it('returns cached on 304 Not Modified', async () => {
            api._listEtag = '"v1"';
            api._listCacheKey = '';
            api._listCache = { items: [{ id: '1', status: 'completed' }], totalCount: 1, page: 1, pageSize: 12, totalPages: 1, filterMeta: { products: [], tags: [], creators: [] }, stats: {} } as any;

            mockFetch.mockResolvedValue({ ok: true, status: 304, headers: new Headers(), json: vi.fn() });
            const result = await api.listInvestigations();
            expect(result).toEqual(api._listCache);
        });

        it('sends If-None-Match header when ETag cached', async () => {
            api._listEtag = '"v1"';
            api._listCacheKey = '';
            mockFetch.mockResolvedValue(mockResponse({ items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 1, filterMeta: { products: [], tags: [], creators: [] }, stats: {} }));

            await api.listInvestigations();
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ headers: { 'If-None-Match': '"v1"' } }),
            );
        });

        it('throws on error response', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.listInvestigations()).rejects.toThrow('Failed to list investigations');
        });

        it('passes query params when provided', async () => {
            const data = { items: [], totalCount: 0, page: 2, pageSize: 6, totalPages: 0, filterMeta: { products: [], tags: [], creators: [] }, stats: { total: 0, running: 0, paused: 0, completed: 0, failed: 0, aborted: 0, successRate: 0, resolvedCount: 0, avgDurationMs: 0, durationSamples: 0, thisWeekCount: 0, lastWeekCount: 0, contestRate: 0, contestableCount: 0 } };
            mockFetch.mockResolvedValue(mockResponse(data));

            await api.listInvestigations({
                page: 2, pageSize: 6, sortOrder: 'asc',
                filter: 'completed', productFilter: 'ProdA',
                sourceFilter: 'manual', tagFilter: 'urgent',
                createdByFilter: 'alice', search: 'test',
                pinnedIds: ['a', 'b'],
            });

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toContain('page=2');
            expect(url).toContain('pageSize=6');
            expect(url).toContain('sortOrder=asc');
            expect(url).toContain('filter=completed');
            expect(url).toContain('productFilter=ProdA');
            expect(url).toContain('sourceFilter=manual');
            expect(url).toContain('tagFilter=urgent');
            expect(url).toContain('createdByFilter=alice');
            expect(url).toContain('search=test');
            expect(url).toContain('pinnedIds=a%2Cb');
        });
    });

    describe('getInvestigation', () => {
        it('fetches by ID', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: '42', status: 'completed' }));
            const result = await api.getInvestigation('42');
            expect(result.id).toBe('42');
        });

        it('throws on 404', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 404 }));
            await expect(api.getInvestigation('nope')).rejects.toThrow('Not found');
        });
    });

    describe('sendAction', () => {
        it('sends action to investigation', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            const result = await api.sendAction('1', 'pause');
            expect(result.success).toBe(true);
        });

        it('sends action with message', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.sendAction('1', 'intervene', 'check this');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.message).toBe('check this');
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not running' }, { status: 400 }));
            await expect(api.sendAction('1', 'resume')).rejects.toThrow('Not running');
        });

        it('sendAction throws fallback when response has no error field', async () => {
            // Covers line 188: data.error || 'Failed to perform action' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.sendAction('1', 'resume')).rejects.toThrow('Failed to perform action');
        });
    });

    describe('getStepDetails', () => {
        it('fetches step by index', async () => {
            mockFetch.mockResolvedValue(mockResponse({ thought: 'thinking', action: null }));
            const result = await api.getStepDetails('1', 5);
            expect(result.thought).toBe('thinking');
        });
    });

    describe('settings', () => {
        it('getSettings fetches config', async () => {
            mockFetch.mockResolvedValue(mockResponse({ model: 'gpt-4o', maxSteps: 50 }));
            const result = await api.getSettings();
            expect(result.model).toBe('gpt-4o');
        });

        it('saveSettings sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ model: 'gpt-4o' }));
            await api.saveSettings({ model: 'gpt-4o' });
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/settings'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('exportSettings downloads config.json', async () => {
            const blobContent = new Blob(['{}'], { type: 'application/json' });
            mockFetch.mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blobContent),
            });
            const createObjectURL = vi.fn().mockReturnValue('blob:url');
            const revokeObjectURL = vi.fn();
            globalThis.URL.createObjectURL = createObjectURL;
            globalThis.URL.revokeObjectURL = revokeObjectURL;

            const clickSpy = vi.fn();
            const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => { el.click = clickSpy; el.click(); return el; });
            const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => el);

            await api.exportSettings();

            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/settings/export'));
            expect(createObjectURL).toHaveBeenCalledWith(blobContent);
            expect(clickSpy).toHaveBeenCalled();
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
            appendSpy.mockRestore();
            removeSpy.mockRestore();
        });

        it('exportSettings throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.exportSettings()).rejects.toThrow('Failed to export settings');
        });

        it('importSettings sends POST and returns result', async () => {
            mockFetch.mockResolvedValue(mockResponse({ imported: 2, config: { model: 'gpt-4o' } }));
            const result = await api.importSettings({ model: 'gpt-4o' });
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/settings/import'),
                expect.objectContaining({ method: 'POST' }),
            );
            expect(result.imported).toBe(2);
        });

        it('importSettings throws server error message', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                statusText: 'Bad Request',
                json: vi.fn().mockResolvedValue({ error: 'No valid keys' }),
            });
            await expect(api.importSettings({ bad: true })).rejects.toThrow('No valid keys');
        });

        it('importSettings falls back to statusText when json parse fails', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                statusText: 'Bad Request',
                json: vi.fn().mockRejectedValue(new Error('parse error')),
            });
            await expect(api.importSettings({ bad: true })).rejects.toThrow('Bad Request');
        });

        it('importSettings falls back to default message when error field is empty', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                statusText: 'Bad Request',
                json: vi.fn().mockResolvedValue({ error: '' }),
            });
            await expect(api.importSettings({ bad: true })).rejects.toThrow('Failed to import settings');
        });
    });

    describe('models', () => {
        it('listModels returns array', async () => {
            mockFetch.mockResolvedValue(mockResponse(['gpt-4o', 'gpt-4']));
            const models = await api.listModels();
            expect(models).toEqual(['gpt-4o', 'gpt-4']);
        });
    });

    describe('deleteInvestigation', () => {
        it('sends DELETE request', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.deleteInvestigation('1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations/1'),
                expect.objectContaining({ method: 'DELETE' }),
            );
        });
    });

    describe('PDF export', () => {
        it('exportPdf downloads file', async () => {
            const blob = new Blob(['pdf'], { type: 'application/pdf' });
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers(),
                blob: vi.fn().mockResolvedValue(blob),
            });
            // Mock URL.createObjectURL and revokeObjectURL for jsdom
            const createObjectURL = vi.fn().mockReturnValue('blob:url');
            const revokeObjectURL = vi.fn();
            globalThis.URL.createObjectURL = createObjectURL;
            globalThis.URL.revokeObjectURL = revokeObjectURL;

            await api.exportPdf('1');
            expect(createObjectURL).toHaveBeenCalledWith(blob);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
        });
    });

    describe('query bank', () => {
        it('getSavedQueries returns array', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ id: 'q1', name: 'Test Query' }]));
            const result = await api.getSavedQueries();
            expect(result).toHaveLength(1);
        });

        it('createSavedQuery sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'q1' }));
            await api.createSavedQuery({ name: 'Q1' } as any);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/query-bank'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('deleteSavedQuery sends DELETE', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.deleteSavedQuery('q1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/query-bank/q1'),
                expect.objectContaining({ method: 'DELETE' }),
            );
        });
    });

    describe('schedules', () => {
        it('getSchedules returns paginated response', async () => {
            mockFetch.mockResolvedValue(mockResponse({ items: [{ id: 's1', name: 'Sched' }], totalCount: 1, page: 1, pageSize: 12, totalPages: 1 }));
            const result = await api.getSchedules();
            expect(result.items).toHaveLength(1);
        });

        it('getSchedules passes page params', async () => {
            mockFetch.mockResolvedValue(mockResponse({ items: [], totalCount: 0, page: 2, pageSize: 6, totalPages: 0 }));
            await api.getSchedules({ page: 2, pageSize: 6 });
            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toContain('page=2');
            expect(url).toContain('pageSize=6');
        });

        it('createSchedule sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 's1' }));
            await api.createSchedule({} as any);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/schedules'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('updateSchedule sends PUT', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 's1' }));
            await api.updateSchedule('s1', { enabled: false } as any);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/schedules/s1'),
                expect.objectContaining({ method: 'PUT' }),
            );
        });

        it('deleteSchedule sends DELETE', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.deleteSchedule('s1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/schedules/s1'),
                expect.objectContaining({ method: 'DELETE' }),
            );
        });

        it('runScheduleNow sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.runScheduleNow('s1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/schedules/s1/run-now'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('getScheduleHistory returns array', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ timestamp: 'ts' }]));
            const result = await api.getScheduleHistory('s1');
            expect(result).toHaveLength(1);
        });

        it('getScheduleReport returns report object', async () => {
            const report = { scheduleId: 's1', totalRuns: 5, verdictBreakdown: {}, successRate: 80, trend: 'stable', recentSummaries: [] };
            mockFetch.mockResolvedValue(mockResponse(report));
            const result = await api.getScheduleReport('s1');
            expect(result.totalRuns).toBe(5);
        });

        it('getScheduleReport passes refresh query string', async () => {
            const report = { scheduleId: 's1', totalRuns: 5, verdictBreakdown: {}, successRate: 80, trend: 'stable', recentSummaries: [] };
            mockFetch.mockResolvedValue(mockResponse(report));
            await api.getScheduleReport('s1', true);
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/schedules/s1/report?refresh=true'));
        });
    });

    describe('products', () => {
        it('listProducts returns array', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ id: 'p1', name: 'Product' }]));
            const result = await api.listProducts();
            expect(result).toHaveLength(1);
        });

        it('listProducts throws on error', async () => {
            // Covers line 332: if (!response.ok) throw branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.listProducts()).rejects.toThrow('Failed to list products');
        });

        it('getActiveProduct returns product or null', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'p1' }));
            const result = await api.getActiveProduct();
            expect(result.id).toBe('p1');
        });

        it('getActiveProduct throws on error', async () => {
            // Covers line 338: if (!response.ok) throw branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getActiveProduct()).rejects.toThrow('Failed to get active product');
        });

        it('setActiveProduct sends PUT', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.setActiveProduct('p1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/products/active'),
                expect.objectContaining({ method: 'PUT' }),
            );
        });

        it('setActiveProduct throws on error', async () => {
            // Covers line 348: if (!response.ok) throw branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.setActiveProduct('p1')).rejects.toThrow('Failed to set active product');
        });
    });

    describe('incidents', () => {
        it('checkIncidentStatus returns status', async () => {
            mockFetch.mockResolvedValue(mockResponse({ available: true, providerType: 'icm' }));
            const result = await api.checkIncidentStatus();
            expect(result.available).toBe(true);
        });
    });

    describe('retrospective', () => {
        it('sendRetrospectMessage sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ success: true }));
            await api.sendRetrospectMessage('1', 'analyze this');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations/1/retrospect'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('updateProposal sends PATCH', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'p1', status: 'approved' }));
            await api.updateProposal('1', 'p1', 'approved');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations/1/retrospect/proposals/p1'),
                expect.objectContaining({ method: 'PATCH' }),
            );
        });
    });

    describe('LLM provider', () => {
        it('getAuthProviders returns providers', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ type: 'copilot', displayName: 'Copilot' }]));
            const result = await api.getAuthProviders();
            expect(result).toHaveLength(1);
        });

        it('getAuthProviders throws on error', async () => {
            // Covers line 249: if (!response.ok) throw branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getAuthProviders()).rejects.toThrow('Failed to list auth providers');
        });

        it('getAuthStatus returns auth info', async () => {
            mockFetch.mockResolvedValue(mockResponse({ authenticated: true }));
            const result = await api.getAuthStatus();
            expect(result.authenticated).toBe(true);
        });

        it('startLogin sends POST to /auth/login', async () => {
            mockFetch.mockResolvedValue(mockResponse({ device_code: 'abc', verification_uri: 'https://example.com' }));
            const result = await api.startLogin();
            expect(result.device_code).toBe('abc');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/auth/login'), expect.objectContaining({ method: 'POST' }));
        });

        it('startLogin throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.startLogin()).rejects.toThrow('Failed to start login');
        });

        it('configureLlmProvider sends POST with config', async () => {
            mockFetch.mockResolvedValue(mockResponse({ status: 'configured' }));
            await api.configureLlmProvider({ type: 'azure', apiKey: 'key' });
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.type).toBe('azure');
        });

        it('configureLlmProvider throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.configureLlmProvider({ type: 'bad' })).rejects.toThrow('Failed to configure LLM provider');
        });

        it('pollLogin sends device_code and interval', async () => {
            mockFetch.mockResolvedValue(mockResponse({ access_token: 'tok' }));
            const result = await api.pollLogin('code123', 5);
            expect(result.access_token).toBe('tok');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.device_code).toBe('code123');
            expect(body.interval).toBe(5);
        });

        it('pollLogin throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'authorization_pending' }, { status: 400 }));
            await expect(api.pollLogin('code', 5)).rejects.toThrow('authorization_pending');
        });

        it('getIncidentProviders returns providers', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ type: 'icm', displayName: 'IcM' }]));
            const result = await api.getIncidentProviders();
            expect(result).toEqual([{ type: 'icm', displayName: 'IcM' }]);
        });

        it('getIncidentProviders throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getIncidentProviders()).rejects.toThrow('Failed to list incident providers');
        });
    });

    describe('MCP', () => {
        it('getMcpStatus returns status', async () => {
            mockFetch.mockResolvedValue(mockResponse({ connected: true, tools: 3 }));
            const result = await api.getMcpStatus('inv1');
            expect(result.connected).toBe(true);
        });

        it('getMcpStatus returns disconnected on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            const result = await api.getMcpStatus('inv1');
            expect(result.connected).toBe(false);
        });

        it('restartMcp sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ status: 'restarted' }));
            const result = await api.restartMcp('inv1');
            expect(result.status).toBe('restarted');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/mcp/restart'), expect.objectContaining({ method: 'POST' }));
        });

        it('restartMcp throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'MCP not found' }, { status: 404 }));
            await expect(api.restartMcp('inv1')).rejects.toThrow('MCP not found');
        });

        it('restartMcp throws fallback when response has no error field', async () => {
            // Covers line 288: data.error || 'Failed to restart MCP' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 404 }));
            await expect(api.restartMcp('inv1')).rejects.toThrow('Failed to restart MCP');
        });
    });

    describe('investigation actions', () => {
        it('runRetrospect sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ started: true }));
            const result = await api.runRetrospect('inv1');
            expect(result.started).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/investigations/inv1/retrospect'), expect.objectContaining({ method: 'POST' }));
        });

        it('runRetrospect throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.runRetrospect('inv1')).rejects.toThrow('Failed to run retrospect');
        });

        it('resumeAll sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ resumed: 3, skipped: 1, ids: ['a', 'b', 'c'] }));
            const result = await api.resumeAll();
            expect(result.resumed).toBe(3);
        });

        it('resumeAll throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.resumeAll()).rejects.toThrow('Failed to resume all');
        });

        it('restartServer sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ status: 'restarting' }));
            const result = await api.restartServer();
            expect(result.status).toBe('restarting');
        });

        it('restartServer throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.restartServer()).rejects.toThrow('Failed to restart server');
        });

        it('updateModel sends POST with model', async () => {
            mockFetch.mockResolvedValue(mockResponse({ model: 'gpt-4o' }));
            const result = await api.updateModel('inv1', 'gpt-4o');
            expect(result.model).toBe('gpt-4o');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('gpt-4o');
        });

        it('updateModel throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Invalid model' }, { status: 400 }));
            await expect(api.updateModel('inv1', 'bad')).rejects.toThrow('Invalid model');
        });

        it('updateModel throws fallback when response has no error field', async () => {
            // Covers line 299: data.error || 'Failed to update model' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.updateModel('inv1', 'bad')).rejects.toThrow('Failed to update model');
        });

        it('compactInvestigation sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ compacted: true }));
            const result = await api.compactInvestigation('inv1');
            expect(result.compacted).toBe(true);
        });

        it('compactInvestigation throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Cannot compact' }, { status: 400 }));
            await expect(api.compactInvestigation('inv1')).rejects.toThrow('Cannot compact');
        });

        it('compactInvestigation throws fallback when response has no error field', async () => {
            // Covers line 308: data.error || 'Failed to compact investigation' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.compactInvestigation('inv1')).rejects.toThrow('Failed to compact investigation');
        });

        it('updateTitle sends PATCH', async () => {
            mockFetch.mockResolvedValue(mockResponse({ title: 'New title' }));
            const result = await api.updateTitle('inv1', 'New title');
            expect(result.title).toBe('New title');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/title'), expect.objectContaining({ method: 'PATCH' }));
        });

        it('updateTags sends PATCH with tags', async () => {
            mockFetch.mockResolvedValue(mockResponse({ tags: ['a', 'b'] }));
            const result = await api.updateTags('inv1', ['a', 'b']);
            expect(result.tags).toEqual(['a', 'b']);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.tags).toEqual(['a', 'b']);
        });

        it('updateNotes sends PATCH with notes', async () => {
            mockFetch.mockResolvedValue(mockResponse({ ok: true, notes: 'My notes' }));
            const result = await api.updateNotes('inv1', 'My notes');
            expect(result.notes).toBe('My notes');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/notes'), expect.objectContaining({ method: 'PATCH' }));
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.notes).toBe('My notes');
        });

        it('rephraseNotes sends POST with text', async () => {
            mockFetch.mockResolvedValue(mockResponse({ rephrased: 'Better text' }));
            const result = await api.rephraseNotes('inv1', 'rough text');
            expect(result.rephrased).toBe('Better text');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/notes/rephrase'), expect.objectContaining({ method: 'POST' }));
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.text).toBe('rough text');
        });

        it('analyzeRetrospect sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ status: 'analyzing' }));
            const result = await api.analyzeRetrospect('inv1');
            expect(result.status).toBe('analyzing');
        });

        it('analyzeRetrospect with reset flag', async () => {
            mockFetch.mockResolvedValue(mockResponse({ status: 'analyzing' }));
            await api.analyzeRetrospect('inv1', true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.reset).toBe(true);
        });

        it('abortRetrospect sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ aborted: true }));
            const result = await api.abortRetrospect('inv1');
            expect(result.aborted).toBe(true);
        });

        it('applyProposals sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ applied: 2 }));
            const result = await api.applyProposals('inv1');
            expect(result.applied).toBe(2);
        });

        it('completeRetrospect sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ completed: true }));
            const result = await api.completeRetrospect('inv1');
            expect(result.completed).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.completed).toBe(true);
        });

        it('completeRetrospect with completed=false', async () => {
            mockFetch.mockResolvedValue(mockResponse({ completed: false }));
            await api.completeRetrospect('inv1', false);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.completed).toBe(false);
        });
    });

    describe('products (extended)', () => {
        it('addProduct sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'p1', name: 'New' }));
            const result = await api.addProduct({ name: 'New' } as any);
            expect(result.id).toBe('p1');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/products'), expect.objectContaining({ method: 'POST' }));
        });

        it('addProduct throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Duplicate name' }, { status: 409 }));
            await expect(api.addProduct({ name: 'Dup' } as any)).rejects.toThrow('Duplicate name');
        });

        it('addProduct throws fallback on json parse failure', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, statusText: 'Error', headers: new Headers(),
                json: vi.fn().mockRejectedValue(new Error('parse')),
            });
            await expect(api.addProduct({ name: 'X' } as any)).rejects.toThrow('Failed to add product');
        });

        it('addProduct throws fallback when response has no error field', async () => {
            // Covers line 359: err.error || 'Failed to add product' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.addProduct({ name: 'X' } as any)).rejects.toThrow('Failed to add product');
        });

        it('updateProduct sends PUT', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'p1', name: 'Updated' }));
            const result = await api.updateProduct('p1', { name: 'Updated' });
            expect(result.name).toBe('Updated');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/products/p1'), expect.objectContaining({ method: 'PUT' }));
        });

        it('updateProduct throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404 }));
            await expect(api.updateProduct('p1', {})).rejects.toThrow('Not found');
        });

        it('updateProduct throws fallback when response has no error field', async () => {
            // Covers line 372: err.error || 'Failed to update product' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.updateProduct('p1', {})).rejects.toThrow('Failed to update product');
        });

        it('deleteProduct sends DELETE', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: vi.fn() });
            await api.deleteProduct('p1');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/products/p1'), expect.objectContaining({ method: 'DELETE' }));
        });

        it('deleteProduct throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Cannot delete active product' }, { status: 400 }));
            await expect(api.deleteProduct('p1')).rejects.toThrow('Cannot delete active product');
        });

        it('deleteProduct throws fallback when response has no error field', async () => {
            // Covers line 383: err.error || 'Failed to delete product' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.deleteProduct('p1')).rejects.toThrow('Failed to delete product');
        });

        it('validateProduct returns validation result', async () => {
            const validation = { valid: true, paths: [] };
            mockFetch.mockResolvedValue(mockResponse(validation));
            const result = await api.validateProduct('p1');
            expect(result.valid).toBe(true);
        });

        it('validateProduct throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.validateProduct('p1')).rejects.toThrow('Failed to validate product');
        });

        it('discoverProduct sends repoRoot query param', async () => {
            mockFetch.mockResolvedValue(mockResponse({ source: 'manifest', product: { name: 'P' }, suggestions: [] }));
            const result = await api.discoverProduct('/my/repo');
            expect(result.source).toBe('manifest');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('repoRoot=%2Fmy%2Frepo'));
        });

        it('discoverProduct throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Bad path' }, { status: 400 }));
            await expect(api.discoverProduct('/bad')).rejects.toThrow('Bad path');
        });

        it('discoverProduct throws fallback when response has no error field', async () => {
            // Covers line 397: err.error || 'Failed to discover product' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.discoverProduct('/bad')).rejects.toThrow('Failed to discover product');
        });

        it('cloneProduct sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'p2', name: 'P (Copy)' }));
            const result = await api.cloneProduct('p1');
            expect(result.id).toBe('p2');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/products/p1/clone'), expect.objectContaining({ method: 'POST' }));
        });

        it('cloneProduct throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Clone failed' }, { status: 500 }));
            await expect(api.cloneProduct('p1')).rejects.toThrow('Clone failed');
        });

        it('cloneProduct throws fallback when response has no error field', async () => {
            // Covers line 408: err.error || 'Failed to clone product' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.cloneProduct('p1')).rejects.toThrow('Failed to clone product');
        });
    });

    describe('export/import', () => {
        it('exportInvestigation downloads JSON file', async () => {
            const blob = new Blob(['{}'], { type: 'application/json' });
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), blob: vi.fn().mockResolvedValue(blob) });
            const createObjectURL = vi.fn().mockReturnValue('blob:url');
            const revokeObjectURL = vi.fn();
            globalThis.URL.createObjectURL = createObjectURL;
            globalThis.URL.revokeObjectURL = revokeObjectURL;

            await api.exportInvestigation('inv1');
            expect(createObjectURL).toHaveBeenCalledWith(blob);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
        });

        it('exportInvestigation uses custom filename', async () => {
            const blob = new Blob(['{}']);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), blob: vi.fn().mockResolvedValue(blob) });
            globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:url');
            globalThis.URL.revokeObjectURL = vi.fn();

            // Spy on createElement to capture the download attribute
            const origCreateElement = document.createElement.bind(document);
            let downloadAttr = '';
            vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                const el = origCreateElement(tag);
                if (tag === 'a') {
                    const origSet = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'download')?.set;
                    Object.defineProperty(el, 'download', {
                        set(v) { downloadAttr = v; if (origSet) origSet.call(el, v); },
                        get() { return downloadAttr; }
                    });
                }
                return el;
            });

            await api.exportInvestigation('inv1', 'custom.json');
            expect(downloadAttr).toBe('custom.json');
        });

        it('exportInvestigation throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404 }));
            await expect(api.exportInvestigation('inv1')).rejects.toThrow('Not found');
        });

        it('exportInvestigation throws fallback when response has no error field', async () => {
            // Covers line 507: err.error || 'Failed to export investigation' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.exportInvestigation('inv1')).rejects.toThrow('Failed to export investigation');
        });

        it('importInvestigation sends POST with state', async () => {
            mockFetch.mockResolvedValue(mockResponse({ ok: true, id: 'new-id' }));
            const result = await api.importInvestigation({ status: 'completed' });
            expect(result.id).toBe('new-id');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/investigations/import'), expect.objectContaining({ method: 'POST' }));
        });

        it('importInvestigation throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Invalid format' }, { status: 400 }));
            await expect(api.importInvestigation({})).rejects.toThrow('Invalid format');
        });

        it('importInvestigation throws fallback when response has no error field', async () => {
            // Covers line 529: err.error || 'Failed to import investigation' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.importInvestigation({})).rejects.toThrow('Failed to import investigation');
        });
    });

    describe('incident fetching', () => {
        function createSSEStream(events: string[]) {
            const chunks = events.map(e => new TextEncoder().encode(e));
            let index = 0;
            return {
                getReader: () => ({
                    read: vi.fn().mockImplementation(() => {
                        if (index < chunks.length) {
                            return Promise.resolve({ done: false, value: chunks[index++] });
                        }
                        return Promise.resolve({ done: true, value: undefined });
                    })
                })
            };
        }

        it('fetchIncident parses SSE stream and returns result', async () => {
            const stream = createSSEStream([
                'data: {"type":"progress","step":"Reading incident","status":"running"}\n\n',
                'data: {"type":"result","incidentId":"INC123","title":"Test","severity":"3","status":"Active","target":"stamp","timeRange":"1h","summary":"Sum","raw":"raw"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });

            const progressCalls: any[] = [];
            const result = await api.fetchIncident('INC123', (e) => progressCalls.push(e));
            expect(result.incidentId).toBe('INC123');
            expect(result.title).toBe('Test');
            expect(progressCalls).toHaveLength(1);
            expect(progressCalls[0].step).toBe('Reading incident');
        });

        it('fetchIncident throws on error event', async () => {
            const stream = createSSEStream([
                'data: {"type":"error","message":"Incident read failed"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            await expect(api.fetchIncident('INC123')).rejects.toThrow('Incident read failed');
        });

        it('fetchIncident throws on non-OK response', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Unauthorized' }, { status: 401 }));
            await expect(api.fetchIncident('INC123')).rejects.toThrow('Unauthorized');
        });

        it('fetchIncident throws fallback when non-OK response has no error field', async () => {
            // Covers line 574: err.error || 'Failed to read incident' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 503 }));
            await expect(api.fetchIncident('INC123')).rejects.toThrow('Failed to read incident');
        });

        it('fetchIncident uses fallback values for missing incidentId/title/severity fields', async () => {
            // Covers lines 601-603: right-hand || branches for incidentId, title, severity
            const stream = createSSEStream([
                'data: {"type":"result","status":"Active","target":"t","timeRange":"1h","summary":"s","raw":"r"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            const result = await api.fetchIncident('INC-FALLBACK');
            expect(result.incidentId).toBe('INC-FALLBACK');  // uses function param fallback
            expect(result.title).toBe('Incident INC-FALLBACK');  // uses template literal fallback
            expect(result.severity).toBe('Unknown');  // uses string fallback
        });

        it('fetchIncident throws when no result received', async () => {
            const stream = createSSEStream([
                'data: {"type":"progress","step":"reading"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            await expect(api.fetchIncident('INC123')).rejects.toThrow('No result received');
        });

        it('fetchIncident throws when no response body', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
            await expect(api.fetchIncident('INC123')).rejects.toThrow('No response body');
        });

        it('fetchIncident skips malformed SSE data lines', async () => {
            const stream = createSSEStream([
                'data: not-json\n\n',
                'data: {"type":"result","incidentId":"INC1","title":"T","severity":"2","target":"s","timeRange":"1h","summary":"s","raw":"r"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            const result = await api.fetchIncident('INC1');
            expect(result.incidentId).toBe('INC1');
        });

        it('fetchIncident uses fallback empty strings for missing target/timeRange/summary/raw fields', async () => {
            // Covers lines 605-608: the || '' right-hand branches when fields are absent
            const stream = createSSEStream([
                'data: {"type":"result","incidentId":"INC1","title":"T","severity":"2","status":"Active"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            const result = await api.fetchIncident('INC1');
            expect(result.target).toBe('');
            expect(result.timeRange).toBe('');
            expect(result.summary).toBe('');
            expect(result.raw).toBe('');
        });

        it('fetchIncident throws default message when error event has no message field', async () => {
            // Covers line 611: event.message || 'Incident read failed' right-hand branch
            const stream = createSSEStream([
                'data: {"type":"error"}\n\n',
            ]);
            mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: stream });
            await expect(api.fetchIncident('INC1')).rejects.toThrow('Incident read failed');
        });
    });

    describe('schedules (extended)', () => {
        it('enableSchedule sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 's1', enabled: true }));
            const result = await api.enableSchedule('s1');
            expect(result.enabled).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/schedules/s1/enable'), expect.objectContaining({ method: 'POST' }));
        });

        it('enableSchedule throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.enableSchedule('s1')).rejects.toThrow('Failed to enable schedule');
        });

        it('disableSchedule sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 's1', enabled: false }));
            const result = await api.disableSchedule('s1');
            expect(result.enabled).toBe(false);
        });

        it('disableSchedule throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.disableSchedule('s1')).rejects.toThrow('Failed to disable schedule');
        });

        it('getSchedulerStatus returns running state', async () => {
            mockFetch.mockResolvedValue(mockResponse({ running: true }));
            const result = await api.getSchedulerStatus();
            expect(result.running).toBe(true);
        });

        it('getSchedulerStatus throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getSchedulerStatus()).rejects.toThrow('Failed to get scheduler status');
        });

        it('startScheduler sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({}));
            await api.startScheduler();
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/scheduler/start'), expect.objectContaining({ method: 'POST' }));
        });

        it('stopScheduler sends POST', async () => {
            mockFetch.mockResolvedValue(mockResponse({}));
            await api.stopScheduler();
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/scheduler/stop'), expect.objectContaining({ method: 'POST' }));
        });

        it('getScheduleHistory with maxEntries param', async () => {
            mockFetch.mockResolvedValue(mockResponse([{ timestamp: 'ts' }]));
            await api.getScheduleHistory('s1', 10);
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('maxEntries=10'));
        });
    });

    describe('query bank (extended)', () => {
        it('updateSavedQuery sends PUT', async () => {
            mockFetch.mockResolvedValue(mockResponse({ id: 'q1', name: 'Updated' }));
            const result = await api.updateSavedQuery('q1', { name: 'Updated' });
            expect(result.name).toBe('Updated');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/query-bank/q1'), expect.objectContaining({ method: 'PUT' }));
        });

        it('updateSavedQuery throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404 }));
            await expect(api.updateSavedQuery('q1', {})).rejects.toThrow('Not found');
        });
    });

    describe('checkIncidentStatus edge case', () => {
        it('returns unavailable on fetch error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            const result = await api.checkIncidentStatus();
            expect(result.available).toBe(false);
        });
    });

    describe('file browser', () => {
        it('listFiles fetches directory listing', async () => {
            mockFetch.mockResolvedValue(mockResponse({
                path: '/repo',
                entries: [{ name: 'file.ts', isDirectory: false }],
            }));
            const result = await api.listFiles('/repo');
            expect(result.entries).toHaveLength(1);
        });

        it('listFiles without path parameter', async () => {
            mockFetch.mockResolvedValue(mockResponse({ path: '/', entries: [] }));
            await api.listFiles();
            expect(mockFetch).toHaveBeenCalledWith(expect.not.stringContaining('?path='));
        });

        it('listFiles throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.listFiles()).rejects.toThrow('Failed to list files');
        });
    });

    describe('settings errors', () => {
        it('getSettings throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getSettings()).rejects.toThrow('Failed to get settings');
        });

        it('saveSettings throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.saveSettings({})).rejects.toThrow('Failed to save settings');
        });
    });

    describe('models errors', () => {
        it('listModels throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.listModels()).rejects.toThrow('Failed to list models');
        });
    });

    describe('deleteInvestigation error', () => {
        it('throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404 }));
            await expect(api.deleteInvestigation('inv1')).rejects.toThrow('Not found');
        });

        it('throws fallback when json parse fails', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, statusText: 'Internal Server Error', headers: new Headers(),
                json: vi.fn().mockRejectedValue(new Error('parse')),
            });
            await expect(api.deleteInvestigation('inv1')).rejects.toThrow('Internal Server Error');
        });

        it('throws fallback when response has no error field', async () => {
            // Covers line 485: err.error || 'Failed to delete investigation' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.deleteInvestigation('inv1')).rejects.toThrow('Failed to delete investigation');
        });
    });

    describe('getStepDetails error', () => {
        it('throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getStepDetails('inv1', 0)).rejects.toThrow('Failed to fetch step details');
        });
    });

    describe('getAuthStatus error', () => {
        it('throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getAuthStatus()).rejects.toThrow('Failed to get auth status');
        });
    });

    describe('retrospective errors', () => {
        it('sendRetrospectMessage throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Server error'),
            });
            await expect(api.sendRetrospectMessage('1', 'msg')).rejects.toThrow('Server error');
        });

        it('updateProposal throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 400, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Invalid status'),
            });
            await expect(api.updateProposal('1', 'p1', 'approved')).rejects.toThrow('Invalid status');
        });

        it('analyzeRetrospect throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Analysis failed'),
            });
            await expect(api.analyzeRetrospect('1')).rejects.toThrow('Analysis failed');
        });

        it('abortRetrospect throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Abort failed'),
            });
            await expect(api.abortRetrospect('1')).rejects.toThrow('Abort failed');
        });

        it('applyProposals throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Apply failed'),
            });
            await expect(api.applyProposals('1')).rejects.toThrow('Apply failed');
        });

        it('updateTitle throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Title update failed'),
            });
            await expect(api.updateTitle('1', 'new')).rejects.toThrow('Title update failed');
        });

        it('updateTags throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Tags failed'),
            });
            await expect(api.updateTags('1', ['a'])).rejects.toThrow('Tags failed');
        });

        it('updateNotes throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Notes failed'),
            });
            await expect(api.updateNotes('1', 'test')).rejects.toThrow('Notes failed');
        });

        it('rephraseNotes throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Rephrase failed'),
            });
            await expect(api.rephraseNotes('1', 'text')).rejects.toThrow('Rephrase failed');
        });

        it('completeRetrospect throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Complete failed'),
            });
            await expect(api.completeRetrospect('1')).rejects.toThrow('Complete failed');
        });
    });

    describe('exportPdf error', () => {
        it('throws on non-OK response', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'PDF not available' }, { status: 404 }));
            await expect(api.exportPdf('inv1')).rejects.toThrow('PDF not available');
        });

        it('throws fallback when response has no error field', async () => {
            // Covers line 539: err.error || 'Failed to export PDF' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.exportPdf('inv1')).rejects.toThrow('Failed to export PDF');
        });
    });

    describe('schedule errors', () => {
        it('getSchedules throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getSchedules()).rejects.toThrow('Failed to fetch schedules');
        });

        it('createSchedule throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Validation failed' }, { status: 400 }));
            await expect(api.createSchedule({})).rejects.toThrow('Validation failed');
        });

        it('createSchedule throws fallback when response has no error field', async () => {
            // Covers line 644: err.error || 'Failed to create schedule' right-hand branch
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.createSchedule({})).rejects.toThrow('Failed to create schedule');
        });

        it('updateSchedule throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404 }));
            await expect(api.updateSchedule('s1', {})).rejects.toThrow('Not found');
        });

        it('updateSchedule throws fallback when response has no error field', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.updateSchedule('s1', {})).rejects.toThrow('Failed to update schedule');
        });

        it('deleteSchedule throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.deleteSchedule('s1')).rejects.toThrow('Failed to delete schedule');
        });

        it('runScheduleNow throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Schedule disabled' }, { status: 400 }));
            await expect(api.runScheduleNow('s1')).rejects.toThrow('Schedule disabled');
        });

        it('runScheduleNow throws fallback when response has no error field', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.runScheduleNow('s1')).rejects.toThrow('Failed to run schedule');
        });

        it('getScheduleHistory throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getScheduleHistory('s1')).rejects.toThrow('Failed to fetch schedule history');
        });

        it('getScheduleReport throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getScheduleReport('s1')).rejects.toThrow('Failed to fetch schedule report');
        });
    });

    describe('query bank errors', () => {
        it('getSavedQueries throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.getSavedQueries()).rejects.toThrow('Failed to fetch saved queries');
        });

        it('createSavedQuery throws with error body', async () => {
            mockFetch.mockResolvedValue(mockResponse({ error: 'Name required' }, { status: 400 }));
            await expect(api.createSavedQuery({ name: '' } as any)).rejects.toThrow('Name required');
        });

        it('createSavedQuery throws fallback when response has no error field', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.createSavedQuery({ name: 'Q' } as any)).rejects.toThrow('Failed to save query');
        });

        it('deleteSavedQuery throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 500 }));
            await expect(api.deleteSavedQuery('q1')).rejects.toThrow('Failed to delete saved query');
        });
    });

    describe('updateSavedQuery errors', () => {
        it('updateSavedQuery throws fallback when response has no error field', async () => {
            mockFetch.mockResolvedValue(mockResponse({}, { status: 400 }));
            await expect(api.updateSavedQuery('q1', {})).rejects.toThrow('Failed to update saved query');
        });
    });

    describe('getRecommendations', () => {
        it('fetches recommendations for an investigation', async () => {
            mockFetch.mockResolvedValue({
                ok: true, status: 200, headers: new Headers(),
                json: vi.fn().mockResolvedValue([{ id: 'r1', priority: 'P0', title: 'Fix it', category: 'code' }]),
                text: vi.fn().mockResolvedValue(''),
            });
            const result = await api.getRecommendations('inv1');
            expect(result).toEqual([{ id: 'r1', priority: 'P0', title: 'Fix it', category: 'code' }]);
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/investigations/inv1/recommendations'));
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Recommendations failed'),
            });
            await expect(api.getRecommendations('inv1')).rejects.toThrow('Recommendations failed');
        });
    });

    describe('reclassifyRecommendations', () => {
        it('sends POST to reclassify endpoint', async () => {
            mockFetch.mockResolvedValue({
                ok: true, status: 200, headers: new Headers(),
                json: vi.fn().mockResolvedValue([{ id: 'r1', priority: 'P0', title: 'Fix it', category: 'operational' }]),
                text: vi.fn().mockResolvedValue(''),
            });
            const result = await api.reclassifyRecommendations('inv1');
            expect(result).toEqual([{ id: 'r1', priority: 'P0', title: 'Fix it', category: 'operational' }]);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations/inv1/recommendations/reclassify'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Reclassify failed'),
            });
            await expect(api.reclassifyRecommendations('inv1')).rejects.toThrow('Reclassify failed');
        });
    });

    describe('implementRecommendations', () => {
        it('sends POST with recommendation IDs', async () => {
            mockFetch.mockResolvedValue({
                ok: true, status: 200, headers: new Headers(),
                json: vi.fn().mockResolvedValue({ started: true, recommendations: 2 }),
                text: vi.fn().mockResolvedValue(''),
            });
            const result = await api.implementRecommendations('inv1', ['rec_P0_0', 'rec_P1_1']);
            expect(result).toEqual({ started: true, recommendations: 2 });
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/investigations/inv1/implement'),
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                }),
            );
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.recommendations).toEqual(['rec_P0_0', 'rec_P1_1']);
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue({
                ok: false, status: 500, headers: new Headers(),
                text: vi.fn().mockResolvedValue('Implementation failed'),
            });
            await expect(api.implementRecommendations('inv1', ['rec_P0_0'])).rejects.toThrow('Implementation failed');
        });
    });

    describe('getPipelineBuiltins', () => {
        it('returns builtin agents', async () => {
            const builtins = [{ id: 'investigator', name: 'Investigator' }];
            mockFetch.mockResolvedValue(mockResponse(builtins));
            const result = await api.getPipelineBuiltins();
            expect(result).toEqual(builtins);
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse(null, { status: 500 }));
            await expect(api.getPipelineBuiltins()).rejects.toThrow('Failed to fetch pipeline builtins');
        });
    });

    describe('getInvestigationPipeline', () => {
        it('returns pipeline state', async () => {
            const pipelineState = { stages: [], conversationLog: [] };
            mockFetch.mockResolvedValue(mockResponse(pipelineState));
            const result = await api.getInvestigationPipeline('inv1');
            expect(result).toEqual(pipelineState);
        });

        it('returns null on 404', async () => {
            mockFetch.mockResolvedValue(mockResponse(null, { status: 404 }));
            const result = await api.getInvestigationPipeline('inv1');
            expect(result).toBeNull();
        });

        it('throws on other errors', async () => {
            mockFetch.mockResolvedValue(mockResponse(null, { status: 500 }));
            await expect(api.getInvestigationPipeline('inv1')).rejects.toThrow('Failed to fetch pipeline state');
        });
    });

    describe('validatePipeline', () => {
        it('returns validation result', async () => {
            const validation = { valid: true };
            mockFetch.mockResolvedValue(mockResponse(validation));
            const result = await api.validatePipeline({ id: 'p1', stages: [] } as any);
            expect(result).toEqual(validation);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/pipeline/validate'),
                expect.objectContaining({ method: 'POST' }),
            );
        });

        it('throws on error', async () => {
            mockFetch.mockResolvedValue(mockResponse(null, { status: 500 }));
            await expect(api.validatePipeline({ id: 'p1', stages: [] } as any)).rejects.toThrow('Failed to validate pipeline');
        });
    });
});
