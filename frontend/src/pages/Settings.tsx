import { useState, useEffect, useRef } from 'react';
import { Save, Cpu, Monitor, Layout, Activity, CheckCircle2, AlertCircle, FolderOpen, LayoutGrid, List, Package, Plus, Pencil, Trash2, X, GitBranch, FileText, Database, Terminal, Archive, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy, Check, Search, Loader2, Sparkles, BookOpen, ClipboardCopy, BarChart3, Plug, Eye, EyeOff, Wrench, Download, Upload, Bell, Volume2, Calendar, Library } from 'lucide-react';
import { WIDGET_REGISTRY, getSelectedWidgetIds, setSelectedWidgetIds, DEFAULT_WIDGET_IDS } from '../components/charts/widgetRegistry';
import { api, type SavedWorkflow } from '../api';
import { useToast } from '../components/Toast';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Tooltip } from '../components/Tooltip';
import { TIME_PRESETS } from '../constants';
import { FileBrowserModal } from '../components/FileBrowserModal';
import { PipelineBuilder, BuiltinDetailModal, PIPELINE_PRESETS, buildPipelinePreset } from '../components/PipelineBuilder';
import { AgentLibrary } from '../components/AgentLibrary';
import type { AgentDefinition } from '../types/pipeline';
import { useNotification, getNotifEnabled, setNotifEnabled, getNotifSound, setNotifSound, getNotifEvents, setNotifEvents, ALL_NOTIF_EVENTS, type NotifEvent } from '../hooks/useNotification';

export const Settings = () => {
    const { toast, confirm } = useToast();
    const [activeTab, setActiveTab] = useState('connections');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const providerTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const widgetTimerRef = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => {
        clearTimeout(saveTimerRef.current);
        clearTimeout(providerTimerRef.current);
        clearTimeout(widgetTimerRef.current);
    }, []);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [defaultView, setDefaultView] = useState<'grid' | 'list'>(
        () => (localStorage.getItem('inv-view') as 'grid' | 'list') ?? 'grid'
    );

    // Notification preferences (synced to both localStorage and server config)
    const [notifEnabled, _setNotifEnabled] = useState(getNotifEnabled);
    const [notifSoundOn, _setNotifSoundOn] = useState(getNotifSound);
    const [notifEvents, _setNotifEvents] = useState<NotifEvent[]>(getNotifEvents);
    const { requestPermission } = useNotification();

    const toggleNotifEnabled = async (enabled: boolean) => {
        if (enabled && 'Notification' in window && Notification.permission !== 'granted') {
            const perm = await requestPermission();
            if (perm !== 'granted') return;
        }
        setNotifEnabled(enabled);
        _setNotifEnabled(enabled);
        setDirty(true);
        setSaveSuccess(false);
    };
    const toggleNotifSound = (on: boolean) => {
        setNotifSound(on);
        _setNotifSoundOn(on);
        setDirty(true);
        setSaveSuccess(false);
    };
    const toggleNotifEvent = (event: NotifEvent) => {
        const next = notifEvents.includes(event)
            ? notifEvents.filter(e => e !== event)
            : [...notifEvents, event];
        setNotifEvents(next);
        _setNotifEvents(next);
        setDirty(true);
        setSaveSuccess(false);
    };

    // Provider configuration state
    const [llmProviders, setLlmProviders] = useState<Array<{ type: string; displayName?: string; authRequirement: { type: string; envVar?: string } }>>([]);
    const [incidentProviders, setIncidentProviders] = useState<Array<{ type: string; displayName: string }>>([]);
    const [llmProviderType, setLlmProviderType] = useState('copilot');
    const [llmApiKey, setLlmApiKey] = useState('');
    const [llmBaseUrl, setLlmBaseUrl] = useState('');
    const [llmApiVersion, setLlmApiVersion] = useState('2024-02-15-preview');
    const [incidentProviderType, setIncidentProviderType] = useState('manual');
    const [showApiKey, setShowApiKey] = useState(false);
    const [providerSaving, setProviderSaving] = useState(false);
    const [providerSaveSuccess, setProviderSaveSuccess] = useState(false);
    const [providerError, setProviderError] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; providerType?: string } | null>(null);

    // MCP server configuration state
    interface McpServerEntry { name: string; command: string; args: string; env: string; cwd: string; }
    const emptyMcpServer = (): McpServerEntry => ({ name: '', command: '', args: '', env: '', cwd: '' });
    const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
    const [showMcpForm, setShowMcpForm] = useState(false);
    const [editingMcpIndex, setEditingMcpIndex] = useState<number | null>(null);
    const [mcpForm, setMcpForm] = useState<McpServerEntry>(emptyMcpServer());
    const [dirty, setDirty] = useState(false);

    // Warn before navigating away with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    const handleDefaultViewChange = (mode: 'grid' | 'list') => {
        setDefaultView(mode);
        localStorage.setItem('inv-view', mode);
        handleChange('defaultView', mode);
    };

    const [defaultSortOrder, setDefaultSortOrder] = useState<'newest' | 'oldest' | 'steps' | 'modified'>('newest');
    const handleDefaultSortOrderChange = (order: 'newest' | 'oldest' | 'steps' | 'modified') => {
        setDefaultSortOrder(order);
        localStorage.setItem('inv-sort', order);
        handleChange('defaultSortOrder', order);
    };

    // File Browser State
    const [showFileBrowser, setShowFileBrowser] = useState(false);
    const [browserMode, setBrowserMode] = useState<'file' | 'directory'>('file');

    // Paths tab: which top-level path field the browser is targeting
    type PathFieldKey = 'investigationsPath';
    const [pathsBrowserTarget, setPathsBrowserTarget] = useState<PathFieldKey | null>(null);

    // Pipeline configuration state
    const [builtinAgents, setBuiltinAgents] = useState<import('../types/pipeline').AgentDefinition[]>([]);
    const [pipelineConfig, setPipelineConfig] = useState<import('../types/pipeline').PipelineDefinition | null>(null);
    const [pipelineJson, setPipelineJson] = useState('');

    // Saved workflows state (for load/save in pipeline tab)
    const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
    const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
    const [editingPipeline, setEditingPipeline] = useState<import('../types/pipeline').PipelineDefinition | null>(null);
    const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
    const [saveWorkflowName, setSaveWorkflowName] = useState('');
    const [saveWorkflowDesc, setSaveWorkflowDesc] = useState('');
    const [saveWorkflowIcon, setSaveWorkflowIcon] = useState('🔧');
    const [showIconPicker, setShowIconPicker] = useState(false);
    const [savingWorkflow, setSavingWorkflow] = useState(false);
    const [viewingAgent, setViewingAgent] = useState<AgentDefinition | null>(null);
    const [selectedPipelineSource, setSelectedPipelineSource] = useState<string | null>(null);
    const [pipelinePage, setPipelinePage] = useState(0);
    const [pipelineSearch, setPipelineSearch] = useState('');
    const [savedWfPage, setSavedWfPage] = useState(0);
    const [savedWfSearch, setSavedWfSearch] = useState('');

    const [config, setConfig] = useState({
        maxConcurrentInvestigations: 3,
        maxSteps: 50,
        retrospectTimeoutMinutes: 10,
        autoRefreshInterval: 30,
        defaultTimeRange: 'ago(1h)',
        notifications: true,
        model: 'gpt-4-turbo',
        defaultView: 'grid' as 'grid' | 'list',
        defaultPageSize: 12,
        investigationsPath: ''
    });

    useEffect(() => {
        loadSettings();
        loadModels();
        loadProviders();
        // Load pipeline builtins
        api.getPipelineBuiltins().then(setBuiltinAgents).catch(() => {});
        // Load saved workflows for load/save
        api.getSavedWorkflows().then(setSavedWorkflows).catch(() => {});
    }, []);

    const loadProviders = async () => {
        try {
            const [llmList, incidentList, status] = await Promise.all([
                api.getAuthProviders(),
                api.getIncidentProviders(),
                api.getAuthStatus(),
            ]);
            setLlmProviders(llmList);
            setIncidentProviders(incidentList);
            setAuthStatus(status);
            if (status.providerType) {
                setLlmProviderType(status.providerType);
            }
        } catch (e) {
            console.error('Failed to load providers:', e);
        }
    };

    const loadModels = async () => {
        try {
            const models = await api.listModels();
            setAvailableModels(Array.from(new Set(models)));
        } catch (e) {
            console.error("Failed to load models", e);
            setAvailableModels(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']);
        }
    };

    const loadSettings = async () => {
        try {
            setLoading(true);
            const settings = await api.getSettings();
            setConfig(prev => ({ ...prev, ...settings }));
            // Sync defaultView UI state from server config (source of truth)
            if (settings.defaultView === 'grid' || settings.defaultView === 'list') {
                setDefaultView(settings.defaultView);
            }
            if (['newest', 'oldest', 'steps', 'modified'].includes(settings.defaultSortOrder)) {
                setDefaultSortOrder(settings.defaultSortOrder);
            }
            // Sync provider state from saved config
            if (settings.llmProvider?.type) {
                setLlmProviderType(settings.llmProvider.type);
            }
            if (settings.incidentProvider?.type) {
                setIncidentProviderType(settings.incidentProvider.type);
            }
            // Sync notification preferences from server config to localStorage
            if (typeof settings.notifEnabled === 'boolean') {
                setNotifEnabled(settings.notifEnabled);
                _setNotifEnabled(settings.notifEnabled);
            }
            if (typeof settings.notifSound === 'boolean') {
                setNotifSound(settings.notifSound);
                _setNotifSoundOn(settings.notifSound);
            }
            if (Array.isArray(settings.notifEvents)) {
                setNotifEvents(settings.notifEvents);
                _setNotifEvents(settings.notifEvents);
            }
            // Sync MCP servers from saved config
            if (Array.isArray(settings.mcpServers)) {
                setMcpServers(settings.mcpServers.map((s: any) => ({
                    name: s.name,
                    command: s.command,
                    args: Array.isArray(s.args) ? s.args.join(' ') : (s.args || ''),
                    env: s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    cwd: s.cwd || '',
                })));
            }
            // Sync analytics widget selection from server config to localStorage
            if (Array.isArray(settings.analyticsWidgets) && settings.analyticsWidgets.length === 3) {
                setSelectedWidgetIds(settings.analyticsWidgets);
                setSelectedWidgets(settings.analyticsWidgets);
            }
            // Sync analytics visibility from server config to localStorage
            if (typeof settings.analyticsVisible === 'boolean') {
                localStorage.setItem('inv-analytics', String(settings.analyticsVisible));
            }
            // Sync pipeline config
            if (settings.pipeline) {
                setPipelineConfig(settings.pipeline);
                setPipelineJson(JSON.stringify(settings.pipeline, null, 2));
                // Try to match loaded pipeline to a preset or saved workflow
                const matchedPreset = PIPELINE_PRESETS.find(p => p.name === settings.pipeline!.name);
                if (matchedPreset) {
                    setSelectedPipelineSource(`preset:${matchedPreset.id}`);
                }
            }
        } catch (err) {
            console.error("Failed to load settings:", err);
            setError("Failed to load settings from server.");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key: string, value: any) => {
        // Protect against NaN from cleared numeric inputs
        if (typeof value === 'number' && isNaN(value)) return;
        setConfig(prev => ({ ...prev, [key]: value }));
        setDirty(true);
        // Reset success message on change
        if (saveSuccess) setSaveSuccess(false);
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            await api.saveSettings({
                ...config,
                notifEnabled,
                notifSound: notifSoundOn,
                notifEvents,
                analyticsWidgets: selectedWidgets,
                pipeline: pipelineConfig || undefined,
            });
            setSaveSuccess(true);
            setDirty(false);
            saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            console.error("Failed to save settings:", err);
            setError(err.message || "Failed to save settings.");
        } finally {
            setSaving(false);
        }
    };

    const [selectedWidgets, setSelectedWidgets] = useState<string[]>(getSelectedWidgetIds);
    const [widgetSaveSuccess, setWidgetSaveSuccess] = useState(false);

    const handleSaveProviders = async () => {
        setProviderSaving(true);
        setProviderError(null);
        setProviderSaveSuccess(false);
        try {
            // Build the LLM provider config
            const llmConfig: Record<string, any> = { type: llmProviderType };
            const selectedProvider = llmProviders.find(p => p.type === llmProviderType);
            const authReq = selectedProvider?.authRequirement?.type;
            if (authReq === 'api-key' || authReq === 'api-key-and-endpoint') {
                if (llmApiKey) llmConfig.apiKey = llmApiKey;
            }
            if (authReq === 'api-key-and-endpoint') {
                if (llmBaseUrl) llmConfig.baseUrl = llmBaseUrl;
                if (llmApiVersion) llmConfig.apiVersion = llmApiVersion;
            }

            // Configure LLM provider via dedicated endpoint
            await api.configureLlmProvider(llmConfig);

            // Build MCP servers config for persistence
            const mcpServersConfig = mcpServers.map(s => {
                const entry: any = { name: s.name, command: s.command };
                const args = s.args.trim();
                if (args) entry.args = args.split(/\s+/);
                if (s.env.trim()) {
                    entry.env = Object.fromEntries(
                        s.env.split('\n').filter(l => l.includes('=')).map(l => {
                            const eq = l.indexOf('=');
                            return [l.substring(0, eq).trim(), l.substring(eq + 1).trim()];
                        })
                    );
                }
                if (s.cwd.trim()) entry.cwd = s.cwd.trim();
                return entry;
            });

            // Save incident provider + MCP servers via settings
            await api.saveSettings({ incidentProvider: { type: incidentProviderType }, mcpServers: mcpServersConfig });

            // Refresh status
            const status = await api.getAuthStatus();
            setAuthStatus(status);

            // Refresh models for the new provider
            await loadModels();

            setProviderSaveSuccess(true);
            providerTimerRef.current = setTimeout(() => setProviderSaveSuccess(false), 3000);
        } catch (err: any) {
            setProviderError(err.message || 'Failed to save provider configuration');
        } finally {
            setProviderSaving(false);
        }
    };

    const toggleWidget = (id: string) => {
        setSelectedWidgets(prev => {
            if (prev.includes(id)) {
                if (prev.length <= 3) return prev; // minimum 3
                return prev.filter(w => w !== id);
            }
            if (prev.length >= 3) {
                // Replace the last one
                return [...prev.slice(0, 2), id];
            }
            return [...prev, id];
        });
    };

    const handleSaveWidgets = async () => {
        setSelectedWidgetIds(selectedWidgets);
        try {
            await api.saveSettings({ analyticsWidgets: selectedWidgets });
        } catch {
            // localStorage save succeeded; server sync is best-effort
        }
        setWidgetSaveSuccess(true);
        widgetTimerRef.current = setTimeout(() => setWidgetSaveSuccess(false), 3000);
    };

    const handleResetWidgets = () => {
        setSelectedWidgets(DEFAULT_WIDGET_IDS);
    };

    const tabs = [
        { id: 'connections', label: 'Connections', icon: <Plug size={18} /> },
        { id: 'paths', label: 'Paths', icon: <FolderOpen size={18} /> },
        { id: 'agent', label: 'Agent Behavior', icon: <Cpu size={18} /> },
        { id: 'pipeline', label: 'Pipeline', icon: <GitBranch size={18} /> },
        { id: 'agents', label: 'Agents', icon: <Library size={18} /> },
        { id: 'schedules', label: 'Schedules', icon: <Calendar size={18} /> },
        { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
        { id: 'appearance', label: 'Appearance', icon: <Layout size={18} /> },
        { id: 'system', label: 'System', icon: <Monitor size={18} /> },
    ];

    const handleSaveWorkflow = async () => {
        setSavingWorkflow(true);
        try {
            const descTrimmed = saveWorkflowDesc.trim();
            if (editingWorkflowId) {
                const updated = await api.updateSavedWorkflow(editingWorkflowId, {
                    name: saveWorkflowName.trim(),
                    description: descTrimmed || undefined,
                    icon: saveWorkflowIcon,
                    pipeline: editingPipeline,
                });
                setSavedWorkflows(savedWorkflows.map(w => w.id === editingWorkflowId ? updated : w));
                // Refresh the preview if this workflow is currently selected
                if (selectedPipelineSource === `saved:${editingWorkflowId}`) {
                    setPipelineConfig({ ...updated.pipeline, name: updated.name });
                    setPipelineJson(JSON.stringify(updated.pipeline, null, 2));
                }
                toast('success', 'Workflow updated');
            } else {
                const saved = await api.createSavedWorkflow({
                    name: saveWorkflowName.trim(),
                    description: descTrimmed || undefined,
                    icon: saveWorkflowIcon,
                    pipeline: editingPipeline,
                });
                setSavedWorkflows([...savedWorkflows, saved]);
                toast('success', 'Workflow saved');
            }
            setShowWorkflowEditor(false);
        } catch (err: any) {
            toast('error', err.message || 'Failed to save workflow');
        } finally {
            setSavingWorkflow(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto min-h-[calc(100dvh-6rem)] md:h-[calc(100dvh-6rem)] flex flex-col md:flex-row gap-4 md:gap-8 animate-fade-in">
            {/* Sidebar Navigation */}
            <div className="w-full md:w-64 md:shrink-0">
                <Breadcrumbs crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Settings' }]} />
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-4 md:mb-8 px-4">Settings</h1>

                <div className="flex md:flex-col gap-1 md:gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0 px-1 md:px-0">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center space-x-2 md:space-x-3 px-4 md:px-6 py-2.5 md:py-4 rounded-xl transition-all font-semibold text-sm whitespace-nowrap md:w-full ${activeTab === tab.id
                                ? 'glass-card text-brand-400 border-b-2 md:border-b-0 md:border-l-2 border-brand-500'
                                : 'text-slate-500 hover:bg-slate-800/40 hover:text-slate-300'
                                }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 glass-card overflow-hidden flex flex-col relative">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6 sm:space-y-10 relative z-10 custom-scrollbar">

                    {activeTab === 'connections' && (() => {
                        const selectedProvider = llmProviders.find(p => p.type === llmProviderType);
                        const authReq = selectedProvider?.authRequirement?.type || 'none';
                        return (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Plug className="text-emerald-400" /> Connections
                                </h2>
                                <p className="text-slate-400">Bring your own LLM, tools, and integrations. The investigator is provider-agnostic — you supply the AI brain, MCP tool servers, and incident source.</p>
                            </div>

                            {/* LLM Provider */}
                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                            <Sparkles size={18} className="text-brand-400" /> LLM Provider
                                        </h3>
                                        <p className="text-sm text-slate-500 mt-1">Choose the AI model provider that powers investigations.</p>
                                    </div>
                                    {authStatus && (
                                        <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold ${
                                            authStatus.authenticated
                                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${authStatus.authenticated ? 'bg-green-400' : 'bg-amber-400'}`} />
                                            {authStatus.authenticated ? 'Connected' : 'Not Connected'}
                                        </span>
                                    )}
                                </div>

                                {/* Provider Type Selector */}
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-300">Provider</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                                        {llmProviders.map(provider => (
                                            <button
                                                key={provider.type}
                                                onClick={() => {
                                                    setLlmProviderType(provider.type);
                                                    setLlmApiKey('');
                                                    setLlmBaseUrl('');
                                                    setShowApiKey(false);
                                                    setProviderError(null);
                                                }}
                                                className={`px-4 py-3 rounded-xl text-sm font-bold transition-all text-center ${
                                                    llmProviderType === provider.type
                                                        ? 'bg-brand-500/20 text-brand-300 border-2 border-brand-500/40 shadow-lg shadow-brand-500/10'
                                                        : 'bg-slate-800/60 text-slate-400 border-2 border-slate-700/40 hover:border-slate-600/60 hover:text-slate-300'
                                                }`}
                                            >
                                                {provider.displayName || provider.type}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Auth Requirement Hint */}
                                <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
                                    authReq === 'none'
                                        ? 'bg-green-500/5 border border-green-500/15 text-green-300'
                                        : authReq === 'oauth-device-flow'
                                        ? 'bg-blue-500/5 border border-blue-500/15 text-blue-300'
                                        : 'bg-slate-800/40 border border-slate-700/30 text-slate-400'
                                }`}>
                                    {authReq === 'none' && (
                                        <><CheckCircle2 size={16} className="text-green-400 shrink-0" /> No authentication required. Make sure your Ollama server is running locally.</>
                                    )}
                                    {authReq === 'api-key' && (
                                        <><AlertCircle size={16} className="text-slate-400 shrink-0" /> Requires an API key.{selectedProvider?.authRequirement?.envVar && <> You can also set the <span className="font-mono text-xs bg-slate-700/60 px-1.5 py-0.5 rounded">{selectedProvider.authRequirement.envVar}</span> environment variable.</>}</>
                                    )}
                                    {authReq === 'api-key-and-endpoint' && (
                                        <><AlertCircle size={16} className="text-slate-400 shrink-0" /> Requires an API key, endpoint URL, and API version.</>
                                    )}
                                    {authReq === 'oauth-device-flow' && (
                                        <><Activity size={16} className="text-blue-400 shrink-0" /> Uses device-flow authentication. Click Save, then connect via the header badge.</>
                                    )}
                                </div>

                                {/* Conditional Config Fields */}
                                {(authReq === 'api-key' || authReq === 'api-key-and-endpoint') && (
                                    <div className="space-y-4">
                                        {/* API Key */}
                                        <div className="space-y-2">
                                            <label htmlFor="settings-api-key" className="text-sm font-bold text-slate-300">API Key</label>
                                            <div className="relative">
                                                <input
                                                    id="settings-api-key"
                                                    type={showApiKey ? 'text' : 'password'}
                                                    value={llmApiKey}
                                                    onChange={(e) => setLlmApiKey(e.target.value)}
                                                    placeholder="Enter your API key"
                                                    className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none font-mono text-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                                                >
                                                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-500">Leave blank to keep the existing key unchanged.</p>
                                        </div>

                                        {/* Endpoint (Azure OpenAI only) */}
                                        {authReq === 'api-key-and-endpoint' && (
                                            <>
                                                <div className="space-y-2">
                                                    <label htmlFor="settings-base-url" className="text-sm font-bold text-slate-300">Base URL / Endpoint</label>
                                                    <input
                                                        id="settings-base-url"
                                                        type="text"
                                                        value={llmBaseUrl}
                                                        onChange={(e) => setLlmBaseUrl(e.target.value)}
                                                        placeholder="https://your-resource.openai.azure.com"
                                                        className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none font-mono text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label htmlFor="settings-api-version" className="text-sm font-bold text-slate-300">API Version</label>
                                                    <input
                                                        id="settings-api-version"
                                                        type="text"
                                                        value={llmApiVersion}
                                                        onChange={(e) => setLlmApiVersion(e.target.value)}
                                                        placeholder="2024-02-15-preview"
                                                        className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none font-mono text-sm"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Incident Provider */}
                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-6">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <BookOpen size={18} className="text-amber-400" /> Incident Provider
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1">Choose how incidents are fetched for pre-filling investigations.</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-300">Provider</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {incidentProviders.map(provider => (
                                            <button
                                                key={provider.type}
                                                onClick={() => setIncidentProviderType(provider.type)}
                                                className={`px-4 py-3 rounded-xl text-sm font-bold transition-all text-center ${
                                                    incidentProviderType === provider.type
                                                        ? 'bg-amber-500/20 text-amber-300 border-2 border-amber-500/40 shadow-lg shadow-amber-500/10'
                                                        : 'bg-slate-800/60 text-slate-400 border-2 border-slate-700/40 hover:border-slate-600/60 hover:text-slate-300'
                                                }`}
                                            >
                                                {provider.displayName}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className={`p-3 rounded-xl text-sm flex items-center gap-2 ${
                                    incidentProviderType === 'manual'
                                        ? 'bg-slate-800/40 border border-slate-700/30 text-slate-400'
                                        : 'bg-amber-500/5 border border-amber-500/15 text-amber-300'
                                }`}>
                                    {incidentProviderType === 'manual' && (
                                        <><CheckCircle2 size={16} className="text-slate-500 shrink-0" /> Manual entry only — incident details are typed in by the user.</>
                                    )}
                                    {incidentProviderType === 'icm' && (
                                        <><AlertCircle size={16} className="text-amber-400 shrink-0" /> Requires IcM scripts and credentials. See the product setup for scriptsPath configuration.</>
                                    )}
                                    {incidentProviderType === 'pagerduty' && (
                                        <><AlertCircle size={16} className="text-amber-400 shrink-0" /> Requires a PagerDuty API key and configured base URL.</>
                                    )}
                                </div>
                            </div>

                            {/* MCP Tool Servers */}
                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-6">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Wrench size={18} className="text-cyan-400" /> MCP Tool Servers
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1">Connect external tools via the Model Context Protocol. Each server provides tools the agent can use during investigations.</p>
                                </div>

                                <button
                                    onClick={() => {
                                        setMcpForm(emptyMcpServer());
                                        setEditingMcpIndex(null);
                                        setShowMcpForm(true);
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-sm font-bold transition-all"
                                >
                                    <Plus size={16} /> Add Server
                                </button>

                                {/* Server List */}
                                {mcpServers.length === 0 && !showMcpForm && (
                                    <div className="text-center py-8 border-2 border-dashed border-slate-700/40 rounded-xl">
                                        <Wrench size={24} className="text-slate-600 mx-auto mb-2" />
                                        <p className="text-sm text-slate-500">No MCP servers configured.</p>
                                        <p className="text-xs text-slate-600 mt-1">The agent will only have built-in tools (read_file, list_dir, finish).</p>
                                    </div>
                                )}

                                {mcpServers.map((server, idx) => (
                                    <div key={idx} className="bg-slate-900/40 rounded-xl border border-slate-700/30 p-4 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-cyan-500/10 rounded-lg">
                                                    <Terminal size={16} className="text-cyan-400" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white text-sm">{server.name || 'Unnamed Server'}</div>
                                                    <div className="text-xs text-slate-500 font-mono">{server.command} {server.args}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => {
                                                        setMcpForm({ ...server });
                                                        setEditingMcpIndex(idx);
                                                        setShowMcpForm(true);
                                                    }}
                                                    className="p-2 text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-all"
                                                    title="Edit server"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setMcpServers(prev => prev.filter((_, i) => i !== idx))}
                                                    className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                                    title="Remove server"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        {server.cwd && (
                                            <div className="text-xs text-slate-500"><span className="text-slate-600">cwd:</span> <span className="font-mono">{server.cwd}</span></div>
                                        )}
                                        {server.env && (
                                            <div className="text-xs text-slate-500"><span className="text-slate-600">env:</span> {server.env.split('\n').filter(Boolean).length} variable(s)</div>
                                        )}
                                    </div>
                                ))}

                                {/* Add/Edit Server Form */}
                                {showMcpForm && (
                                    <div className="bg-slate-900/60 rounded-xl border border-cyan-500/20 p-5 space-y-4 animate-fade-in">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-bold text-white">{editingMcpIndex !== null ? 'Edit MCP Server' : 'Add MCP Server'}</h4>
                                            <button onClick={() => setShowMcpForm(false)} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg transition-all"><X size={16} /></button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label htmlFor="mcp-name" className="text-xs font-bold text-slate-400">Name <span className="text-red-400">*</span></label>
                                                <input
                                                    id="mcp-name"
                                                    type="text"
                                                    value={mcpForm.name}
                                                    onChange={(e) => setMcpForm(f => ({ ...f, name: e.target.value }))}
                                                    placeholder="my-data-server"
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-cyan-500 outline-none text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label htmlFor="mcp-command" className="text-xs font-bold text-slate-400">Command <span className="text-red-400">*</span></label>
                                                <input
                                                    id="mcp-command"
                                                    type="text"
                                                    value={mcpForm.command}
                                                    onChange={(e) => setMcpForm(f => ({ ...f, command: e.target.value }))}
                                                    placeholder="npx"
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-cyan-500 outline-none text-sm font-mono"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label htmlFor="mcp-args" className="text-xs font-bold text-slate-400">Arguments <span className="text-slate-600">(space-separated)</span></label>
                                            <input
                                                id="mcp-args"
                                                type="text"
                                                value={mcpForm.args}
                                                onChange={(e) => setMcpForm(f => ({ ...f, args: e.target.value }))}
                                                placeholder="-y @my-org/mcp-server"
                                                className="w-full px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-cyan-500 outline-none text-sm font-mono"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label htmlFor="mcp-cwd" className="text-xs font-bold text-slate-400">Working Directory <span className="text-slate-600">(optional)</span></label>
                                            <input
                                                id="mcp-cwd"
                                                type="text"
                                                value={mcpForm.cwd}
                                                onChange={(e) => setMcpForm(f => ({ ...f, cwd: e.target.value }))}
                                                placeholder="C:\\Repositories\\MyProject"
                                                className="w-full px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-cyan-500 outline-none text-sm font-mono"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label htmlFor="mcp-env" className="text-xs font-bold text-slate-400">Environment Variables <span className="text-slate-600">(KEY=VALUE, one per line)</span></label>
                                            <textarea
                                                id="mcp-env"
                                                value={mcpForm.env}
                                                onChange={(e) => setMcpForm(f => ({ ...f, env: e.target.value }))}
                                                placeholder={"DATABASE_URL=https://...\nAPI_KEY=sk-..."}
                                                rows={3}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-cyan-500 outline-none text-sm font-mono resize-none"
                                            />
                                        </div>
                                        <div className="flex justify-end gap-2 pt-1">
                                            <button
                                                onClick={() => setShowMcpForm(false)}
                                                className="px-4 py-2 text-slate-500 hover:text-slate-300 font-semibold text-sm transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (editingMcpIndex !== null) {
                                                        setMcpServers(prev => prev.map((s, i) => i === editingMcpIndex ? { ...mcpForm } : s));
                                                    } else {
                                                        setMcpServers(prev => [...prev, { ...mcpForm }]);
                                                    }
                                                    setShowMcpForm(false);
                                                    setMcpForm(emptyMcpServer());
                                                    setEditingMcpIndex(null);
                                                }}
                                                disabled={!mcpForm.name.trim() || !mcpForm.command.trim()}
                                                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {editingMcpIndex !== null ? 'Update Server' : 'Add Server'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="p-3 rounded-xl text-xs bg-slate-800/30 border border-slate-700/20 text-slate-500 leading-relaxed">
                                    MCP servers launch as child processes when an investigation starts. Each server exposes tools that the agent can call. Examples: database query servers, monitoring APIs, custom CLI wrappers. See the <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">MCP specification</a> for details.
                                </div>
                            </div>

                            {/* Save Provider Config */}
                            <div className="flex items-center justify-between pt-2">
                                <div className="flex items-center gap-2">
                                    {providerSaveSuccess && (
                                        <span className="text-green-400 font-bold flex items-center animate-fade-in text-sm">
                                            <CheckCircle2 className="w-4 h-4 mr-1" /> Provider configuration saved!
                                        </span>
                                    )}
                                    {providerError && (
                                        <span className="text-red-400 font-bold flex items-center animate-fade-in text-sm">
                                            <AlertCircle className="w-4 h-4 mr-1" /> {providerError}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={handleSaveProviders}
                                    disabled={providerSaving}
                                    className={`px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all active:scale-95 flex items-center gap-2 ${providerSaving ? 'opacity-80 cursor-wait' : ''}`}
                                >
                                    {providerSaving ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Save className="w-4 h-4" />
                                    )}
                                    {providerSaving ? 'Saving...' : 'Save Connections'}
                                </button>
                            </div>
                        </div>
                        );
                    })()}

                    {activeTab === 'paths' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <FolderOpen className="text-amber-400" /> Paths
                                </h2>
                                <p className="text-slate-400">Where completed investigations are saved. Per-agent context (repo, knowledge base, working directory) is declared on each agent in <strong>Settings → Pipeline</strong> — leave those unset on built-in or pure-reasoning agents.</p>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-5">
                                {([
                                    { key: 'investigationsPath',  label: 'Investigations Storage', desc: 'Where completed investigation folders are written. Used by list, create, delete and export.', mode: 'directory' as const, icon: Archive },
                                ] as const).map(row => {
                                    const Icon = row.icon;
                                    const value = (config as any)[row.key] as string | undefined;
                                    return (
                                        <div key={row.key}>
                                            <label htmlFor={`settings-path-${row.key}`} className="text-sm font-bold text-slate-300 block mb-1">
                                                {row.label}
                                            </label>
                                            <p className="text-xs text-slate-500 mb-2">{row.desc}</p>
                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <Icon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                                    <input
                                                        id={`settings-path-${row.key}`}
                                                        type="text"
                                                        value={value || ''}
                                                        onChange={(e) => handleChange(row.key, e.target.value)}
                                                        placeholder="Path to directory"
                                                        className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 font-mono text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setBrowserMode(row.mode);
                                                        setPathsBrowserTarget(row.key);
                                                        setShowFileBrowser(true);
                                                    }}
                                                    className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-colors"
                                                    title="Browse for directory"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                    Browse
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="text-xs text-slate-500 border-t border-slate-700/40 pt-4">
                                    Changes take effect on save. Changing <span className="font-mono text-slate-400">Investigations Storage</span> reloads the dashboard from the new folder; in-flight investigations continue writing to the old location until they finish.
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'agent' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Cpu className="text-brand-400" /> Agent Behavior
                                </h2>
                                <p className="text-slate-400">Configure how the investigation agent operates and makes decisions.</p>
                            </div>

                            <div className="grid grid-cols-1 gap-8">
                                {/* Max Steps Slider */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label htmlFor="settings-max-steps" className="text-sm font-bold text-slate-300 block">Max Steps Limit</label>
                                        <span className={`text-xs font-mono px-2 py-1 rounded ${config.maxSteps === 0 ? 'bg-brand-500/15 text-brand-400 font-bold' : 'bg-slate-700 text-slate-300'}`}>
                                            {config.maxSteps === 0 ? 'Unlimited' : `${config.maxSteps} steps`}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] text-slate-500 font-bold w-6">∞</span>
                                        <input
                                            id="settings-max-steps"
                                            type="range"
                                            min="0"
                                            max="200"
                                            step="5"
                                            value={config.maxSteps ?? 50}
                                            onChange={(e) => handleChange('maxSteps', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                        <span className="text-[10px] text-slate-500 font-bold w-8">200</span>
                                    </div>
                                    <p className="text-xs text-slate-500">Controls the maximum number of reasoning steps before the agent pauses for safety. Set to <strong className="text-slate-400">∞</strong> for unlimited.</p>
                                </div>

                                {/* Max Concurrent Investigations */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label htmlFor="settings-max-concurrent" className="text-sm font-bold text-slate-300 block">Max Concurrent Investigations</label>
                                        <span className={`text-xs font-mono px-2 py-1 rounded ${(config.maxConcurrentInvestigations ?? 3) === 0 ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {(config.maxConcurrentInvestigations ?? 3) === 0 ? '∞ Unlimited' : config.maxConcurrentInvestigations ?? 3}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] text-slate-500 font-bold w-6">∞</span>
                                        <input
                                            id="settings-max-concurrent"
                                            type="range"
                                            min="0"
                                            max="10"
                                            step="1"
                                            value={config.maxConcurrentInvestigations ?? 3}
                                            onChange={(e) => handleChange('maxConcurrentInvestigations', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                        <span className="text-[10px] text-slate-500 font-bold w-4">10</span>
                                    </div>
                                    <p className="text-xs text-slate-500">Maximum number of investigations that can run simultaneously. Set to <strong className="text-slate-400">∞</strong> for unlimited. New investigations will be rejected if a numeric limit is reached. Default: 3.</p>
                                </div>

                                {/* Retrospective Timeout */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label htmlFor="settings-retro-timeout" className="text-sm font-bold text-slate-300 block">Retrospective Timeout</label>
                                        <span className="text-xs font-mono px-2 py-1 rounded bg-slate-700 text-slate-300">
                                            {config.retrospectTimeoutMinutes ?? 10} min
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <input
                                            id="settings-retro-timeout"
                                            type="range"
                                            min="1"
                                            max="30"
                                            step="1"
                                            value={config.retrospectTimeoutMinutes ?? 10}
                                            onChange={(e) => handleChange('retrospectTimeoutMinutes', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500">Maximum time allowed for retrospective analysis before timing out. Increase for large investigations. Default: 10 minutes.</p>
                                </div>

                                {/* Model Selection */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <label htmlFor="settings-model" className="text-sm font-bold text-slate-300 block">Model Selection</label>
                                    <select
                                        id="settings-model"
                                        value={config.model}
                                        onChange={(e) => handleChange('model', e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                    >
                                        {availableModels.length > 0 ? (
                                            availableModels.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))
                                        ) : (
                                            <option value="gpt-4-turbo">Loading models...</option>
                                        )}
                                    </select>
                                    <p className="text-xs text-slate-500">Select the LLM model to drive the investigation agent. Available models are fetched from the configured provider.</p>
                                </div>

                                {/* Recommendation Extraction Model */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <label htmlFor="settings-recommendation-model" className="text-sm font-bold text-slate-300 block">Recommendation Extraction Model</label>
                                    <select
                                        id="settings-recommendation-model"
                                        value={(config as any).recommendationModel || 'gpt-4o-mini'}
                                        onChange={(e) => handleChange('recommendationModel', e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                    >
                                        {availableModels.length > 0 ? (
                                            availableModels.map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))
                                        ) : (
                                            <option value="gpt-4o-mini">Loading models...</option>
                                        )}
                                    </select>
                                    <p className="text-xs text-slate-500">LLM model used to extract and classify recommendations from investigation reports. A smaller model works well for this structured extraction task. Default: <strong className="text-slate-400">gpt-4o-mini</strong>.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'pipeline' && (
                        <div className="space-y-8 animate-fade-in">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                        <GitBranch className="text-cyan-400" /> Multi-Agent Pipeline
                                    </h2>
                                    <p className="text-slate-400">
                                        Choose the default pipeline that will be <span className="text-slate-300 font-medium">automatically selected</span> when you create a new investigation.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingWorkflowId(null);
                                        setSaveWorkflowName('');
                                        setSaveWorkflowDesc('');
                                        setSaveWorkflowIcon('🔧');
                                        setEditingPipeline(null);
                                        setShowWorkflowEditor(true);
                                    }}
                                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white transition-colors shrink-0"
                                >
                                    <Plus className="w-4 h-4" />
                                    Create New Workflow
                                </button>
                            </div>

                            {/* ── Quick-select Default Pipeline ── */}
                            <div className="space-y-3">
                                {(() => {
                                    const searchLower = pipelineSearch.toLowerCase();
                                    const allItems: { type: 'preset' | 'saved' | 'none'; preset?: typeof PIPELINE_PRESETS[number]; wf?: SavedWorkflow }[] = [
                                        ...PIPELINE_PRESETS.filter(preset => preset.stages.every(s => builtinAgents.some(a => a.builtinType === s.builtinType)) && (preset.name.toLowerCase().includes(searchLower) || preset.description.toLowerCase().includes(searchLower))).map(preset => ({ type: 'preset' as const, preset })),
                                        ...savedWorkflows.filter(wf => wf.name.toLowerCase().includes(searchLower) || (wf.description || '').toLowerCase().includes(searchLower)).map(wf => ({ type: 'saved' as const, wf })),
                                        ...('none'.includes(searchLower) || !pipelineSearch ? [{ type: 'none' as const }] : []),
                                    ];
                                    const PAGE_SIZE = 6;
                                    const totalPages = Math.ceil(allItems.length / PAGE_SIZE);
                                    const pageItems = allItems.slice(pipelinePage * PAGE_SIZE, (pipelinePage + 1) * PAGE_SIZE);
                                    return (
                                        <>
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                                        Select Default Pipeline
                                    </h3>
                                    {totalPages > 1 && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setPipelinePage(p => Math.max(0, p - 1))}
                                                disabled={pipelinePage === 0}
                                                className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <ChevronLeft className="w-4 h-4 text-slate-400" />
                                            </button>
                                            <span className="text-xs text-slate-500 tabular-nums min-w-[2.5rem] text-center">
                                                {pipelinePage + 1}/{totalPages}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setPipelinePage(p => Math.min(totalPages - 1, p + 1))}
                                                disabled={pipelinePage >= totalPages - 1}
                                                className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <ChevronRight className="w-4 h-4 text-slate-400" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                                    <input
                                        type="text"
                                        value={pipelineSearch}
                                        onChange={e => { setPipelineSearch(e.target.value); setPipelinePage(0); }}
                                        placeholder="Search pipelines…"
                                        className="w-full pl-8 pr-3 py-1.5 bg-slate-900/60 border border-slate-700/40 rounded-lg text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 transition-colors"
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {pageItems.map((item) => {
                                        if (item.type === 'preset') {
                                            const preset = item.preset!;
                                            const isSelected = selectedPipelineSource === `preset:${preset.id}`;
                                        return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => {
                                                    const pipeline = buildPipelinePreset(preset.id, builtinAgents);
                                                    setPipelineConfig(pipeline);
                                                    setPipelineJson(JSON.stringify(pipeline, null, 2));
                                                    setSelectedPipelineSource(`preset:${preset.id}`);
                                                    setDirty(true);
                                                }}
                                                className={`text-left rounded-xl border p-4 transition-all ${
                                                    isSelected
                                                        ? 'bg-cyan-600/15 border-cyan-500/50 ring-2 ring-cyan-500/30'
                                                        : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600/60 hover:bg-slate-800/60'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 mb-2">
                                                    <span className="text-lg">{preset.icon}</span>
                                                    <span className="text-sm font-bold text-white">{preset.name}</span>
                                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400 ml-auto" />}
                                                </div>
                                                <p className="text-[11px] text-slate-500 leading-relaxed mb-2">{preset.description}</p>
                                                <div className="flex flex-wrap gap-0.5">
                                                    {preset.stages.map((s, i) => {
                                                        const agent = builtinAgents.find(a => a.builtinType === s.builtinType);
                                                        const agentColor = agent?.color || '#6b7280';
                                                        const agentTitle = agent?.name || s.builtinType;
                                                        const agentLabel = agent?.icon || agent?.name?.charAt(0) || '?';
                                                        return (
                                                            <span
                                                                key={i}
                                                                className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold"
                                                                style={{ backgroundColor: agentColor }}
                                                                title={agentTitle}
                                                            >
                                                                {agentLabel}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </button>
                                        );
                                        }
                                        if (item.type === 'saved') {
                                            const wf = item.wf!;
                                            const isSelected = selectedPipelineSource === `saved:${wf.id}`;
                                        return (
                                            <button
                                                key={wf.id}
                                                type="button"
                                                onClick={() => {
                                                    setPipelineConfig({ ...wf.pipeline, name: wf.name });
                                                    setPipelineJson(JSON.stringify(wf.pipeline, null, 2));
                                                    setSelectedPipelineSource(`saved:${wf.id}`);
                                                    setDirty(true);
                                                }}
                                                className={`text-left rounded-xl border p-4 transition-all ${
                                                    isSelected
                                                        ? 'bg-cyan-600/15 border-cyan-500/50 ring-2 ring-cyan-500/30'
                                                        : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600/60 hover:bg-slate-800/60'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 mb-2">
                                                    <span className="text-lg">{wf.icon || '🔧'}</span>
                                                    <span className="text-sm font-bold text-white">{wf.name}</span>
                                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400 ml-auto" />}
                                                </div>
                                                <p className="text-[11px] text-slate-500 leading-relaxed mb-2">{wf.description || `${wf.pipeline.stages.length} stages`}</p>
                                                <div className="flex flex-wrap gap-0.5">
                                                    {wf.pipeline.stages.map((stage, i) => (
                                                        <span
                                                            key={i}
                                                            className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold"
                                                            style={{ backgroundColor: stage.agent?.color || '#6b7280' }}
                                                            title={stage.agent?.name || `Stage ${i + 1}`}
                                                        >
                                                            {stage.agent?.icon || stage.agent?.name?.charAt(0) || (i + 1)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </button>
                                        );
                                        }
                                        // type === 'none'
                                        return (
                                    <button
                                        key="none"
                                        type="button"
                                        onClick={() => {
                                            setPipelineConfig(null);
                                            setPipelineJson('');
                                            setSelectedPipelineSource(null);
                                            setDirty(true);
                                        }}
                                        className={`text-left rounded-xl border-2 border-dashed p-4 transition-all ${
                                            selectedPipelineSource === null && !pipelineConfig
                                                ? 'bg-slate-800/60 border-slate-500/40 ring-2 ring-slate-500/20'
                                                : 'border-slate-700/40 hover:border-slate-600/60'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 mb-2">
                                            <X className="w-4 h-4 text-slate-500" />
                                            <span className="text-sm font-bold text-slate-400">None</span>
                                            {selectedPipelineSource === null && !pipelineConfig && <CheckCircle2 className="w-4 h-4 text-slate-400 ml-auto" />}
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-relaxed">No default pipeline. You'll choose one manually each time.</p>
                                    </button>
                                        );
                                    })}
                                </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* ── Selected Pipeline Preview ── */}
                            {pipelineConfig && pipelineConfig.stages.length > 0 && (
                                <div className="bg-slate-800/40 rounded-2xl border border-slate-700/40 p-5 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg">⚙️</span>
                                            <div>
                                                <h3 className="font-bold text-white text-lg">{pipelineConfig.name || 'Default Pipeline'}</h3>
                                                <p className="text-xs text-slate-500">{pipelineConfig.stages.length} stages &middot; Will be pre-selected in new investigations</p>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Read-only stage list */}
                                    <div className="space-y-0">
                                        {pipelineConfig.stages.map((stage, i) => {
                                            const agent = stage.agent;
                                            const color = agent?.color || '#6b7280';
                                            return (
                                                <div key={i}>
                                                    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/20">
                                                        <span className="text-[11px] text-slate-600 font-mono w-4 text-right shrink-0">{i + 1}</span>
                                                        <span
                                                            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] text-white font-bold shrink-0"
                                                            style={{ backgroundColor: color }}
                                                        >
                                                            {agent?.icon || agent?.name?.charAt(0) || (i + 1)}
                                                        </span>
                                                        <span className="text-sm font-semibold text-slate-200">{agent?.name || `Stage ${i + 1}`}</span>
                                                        <span className="text-[10px] text-slate-600">{agent?.source === 'builtin' ? `builtin · ${agent.builtinType}` : agent?.source || ''}</span>
                                                        {stage.canReject && (
                                                            <span className="text-[9px] bg-amber-600/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">can reject</span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => agent && setViewingAgent(agent)}
                                                            className="ml-auto p-1 rounded hover:bg-slate-600/40 text-slate-500 hover:text-slate-300 transition-colors"
                                                            title="View agent details"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    {i < pipelineConfig.stages.length - 1 && (
                                                        <div className="flex items-center justify-center py-0.5">
                                                            <div className="w-px h-3 bg-slate-700/60"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* ── Saved Workflows Management ── */}
                            {savedWorkflows.length > 0 && (() => {
                                const WF_PAGE_SIZE = 6;
                                const wfSearchLower = savedWfSearch.toLowerCase();
                                const filteredWfs = savedWfSearch
                                    ? savedWorkflows.filter(wf => wf.name.toLowerCase().includes(wfSearchLower) || (wf.description || '').toLowerCase().includes(wfSearchLower))
                                    : savedWorkflows;
                                const wfTotalPages = Math.ceil(filteredWfs.length / WF_PAGE_SIZE);
                                const safeWfPage = Math.min(savedWfPage, Math.max(0, wfTotalPages - 1));
                                const pageWfs = filteredWfs.slice(safeWfPage * WF_PAGE_SIZE, (safeWfPage + 1) * WF_PAGE_SIZE);
                                return (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                                            Manage Saved Workflows ({savedWfSearch ? `${filteredWfs.length} of ${savedWorkflows.length}` : savedWorkflows.length})
                                        </h3>
                                        {wfTotalPages > 1 && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setSavedWfPage(p => Math.max(0, p - 1))}
                                                    disabled={safeWfPage === 0}
                                                    className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    <ChevronLeft className="w-4 h-4 text-slate-400" />
                                                </button>
                                                <span className="text-xs text-slate-500 tabular-nums min-w-[2.5rem] text-center">
                                                    {safeWfPage + 1}/{wfTotalPages}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSavedWfPage(p => Math.min(wfTotalPages - 1, p + 1))}
                                                    disabled={safeWfPage >= wfTotalPages - 1}
                                                    className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    <ChevronRight className="w-4 h-4 text-slate-400" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                                        <input
                                            type="text"
                                            value={savedWfSearch}
                                            onChange={e => { setSavedWfSearch(e.target.value); setSavedWfPage(0); }}
                                            placeholder="Search saved workflows…"
                                            className="w-full pl-8 pr-3 py-1.5 bg-slate-900/60 border border-slate-700/40 rounded-lg text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 transition-colors"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {pageWfs.length === 0 && (
                                            <p className="text-xs text-slate-600 italic col-span-2 py-2">No workflows match &ldquo;{savedWfSearch}&rdquo;</p>
                                        )}
                                        {pageWfs.map(wf => (
                                            <div
                                                key={wf.id}
                                                className="bg-slate-800/40 rounded-xl border border-slate-700/40 p-4 hover:border-slate-600/60 transition-colors group"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-start gap-3 min-w-0">
                                                        <span className="text-xl shrink-0 mt-0.5">{wf.icon || '🔧'}</span>
                                                        <div className="min-w-0">
                                                            <h4 className="font-bold text-white text-sm truncate">{wf.name}</h4>
                                                            <p className="text-[11px] text-slate-500 truncate">{wf.description || `${wf.pipeline.stages.length} stages`}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingWorkflowId(wf.id);
                                                                setSaveWorkflowName(wf.name);
                                                                setSaveWorkflowDesc(wf.description || '');
                                                                setSaveWorkflowIcon(wf.icon || '🔧');
                                                                setEditingPipeline(wf.pipeline);
                                                                setShowWorkflowEditor(true);
                                                            }}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                                                            title="Edit workflow"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                try {
                                                                    await api.deleteSavedWorkflow(wf.id);
                                                                    setSavedWorkflows(savedWorkflows.filter(w => w.id !== wf.id));
                                                                    toast('success', 'Workflow deleted');
                                                                } catch {
                                                                    toast('error', 'Failed to delete workflow');
                                                                }
                                                            }}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                                                            title="Delete workflow"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* ── Workflow Editor Modal (Settings) ── */}
                    {showWorkflowEditor && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWorkflowEditor(false)}>
                            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
                                    <h3 className="text-lg font-bold text-white">
                                        {editingWorkflowId ? 'Edit Workflow' : 'Create New Workflow'}
                                    </h3>
                                    <button type="button" onClick={() => setShowWorkflowEditor(false)} className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                    <div className="grid grid-cols-[auto_1fr_1fr] gap-3 items-end">
                                        <div className="space-y-1 relative">
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Icon</label>
                                            <button
                                                type="button"
                                                onClick={() => setShowIconPicker(!showIconPicker)}
                                                className="w-11 h-10 flex items-center justify-center text-xl rounded-lg border border-slate-700 bg-slate-800/50 hover:border-slate-500 focus:ring-2 focus:ring-purple-500 outline-none transition-colors"
                                            >
                                                {saveWorkflowIcon}
                                            </button>
                                            {showIconPicker && (
                                                <div className="absolute top-full left-0 mt-1 z-10 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-2 grid grid-cols-5 gap-1 w-[180px]">
                                                    {['🔧','⚡','🔬','🚨','💚','📜','🔍','🛡️','🧠','🎯','📊','🔥','💎','🚀','⚙️','🧪','🔮','📡','🌐','🤖'].map(icon => (
                                                        <button
                                                            key={icon}
                                                            type="button"
                                                            onClick={() => { setSaveWorkflowIcon(icon); setShowIconPicker(false); }}
                                                            className={`w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-slate-700 transition-colors ${saveWorkflowIcon === icon ? 'bg-purple-600/30 ring-1 ring-purple-500' : ''}`}
                                                        >
                                                            {icon}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Name *</label>
                                            <input
                                                type="text"
                                                value={saveWorkflowName}
                                                onChange={e => setSaveWorkflowName(e.target.value)}
                                                placeholder="My Custom Workflow"
                                                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Description</label>
                                            <input
                                                type="text"
                                                value={saveWorkflowDesc}
                                                onChange={e => setSaveWorkflowDesc(e.target.value)}
                                                placeholder="Optional description..."
                                                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                        </div>
                                    </div>
                                    <PipelineBuilder
                                        value={editingPipeline}
                                        onChange={setEditingPipeline}
                                        builtinAgents={builtinAgents}
                                        availableModels={availableModels}
                                        label={saveWorkflowName.trim() || undefined}
                                    />
                                </div>
                                <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-700/50">
                                    <button
                                        type="button"
                                        onClick={() => setShowWorkflowEditor(false)}
                                        className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!saveWorkflowName.trim() || !editingPipeline || editingPipeline.stages.length === 0 || savingWorkflow}
                                        onClick={handleSaveWorkflow}
                                        className="px-5 py-2 rounded-lg text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                    >
                                        {savingWorkflow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        {editingWorkflowId ? 'Update Workflow' : 'Save Workflow'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {viewingAgent && (
                        <BuiltinDetailModal agent={viewingAgent} onClose={() => setViewingAgent(null)} />
                    )}

                    {activeTab === 'agents' && (
                        <AgentLibrary builtinAgents={builtinAgents} />
                    )}

                    {activeTab === 'appearance' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Layout className="text-pink-400" /> Appearance
                                </h2>
                                <p className="text-slate-400">Customize the look and feel of the dashboard.</p>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-200">Default Investigations View</h3>
                                    <p className="text-sm text-slate-500">How investigations are displayed when you open the dashboard.</p>
                                </div>
                                <div className="flex items-center bg-slate-800 rounded-xl p-1 gap-1 border border-slate-700/40">
                                    <button
                                        onClick={() => handleDefaultViewChange('grid')}
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            defaultView === 'grid' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                        }`}
                                    >
                                        <LayoutGrid className="w-4 h-4" /> Grid
                                    </button>
                                    <button
                                        onClick={() => handleDefaultViewChange('list')}
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            defaultView === 'list' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                        }`}
                                    >
                                        <List className="w-4 h-4" /> List
                                    </button>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-200">Default Sort Order</h3>
                                    <p className="text-sm text-slate-500">How investigations are sorted when you open the dashboard.</p>
                                </div>
                                <div className="flex items-center bg-slate-800 rounded-xl p-1 gap-1 border border-slate-700/40">
                                    {([['newest', 'Newest'], ['modified', 'Last Modified'], ['oldest', 'Oldest'], ['steps', 'Most Steps']] as const).map(([value, label]) => (
                                        <button
                                            key={value}
                                            onClick={() => handleDefaultSortOrderChange(value)}
                                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                                                defaultSortOrder === value ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-200">Default Page Size</h3>
                                    <p className="text-sm text-slate-500">Number of items shown per page on Investigations and Schedules.</p>
                                </div>
                                <div className="flex items-center bg-slate-800 rounded-xl p-1 gap-1 border border-slate-700/40">
                                    {[6, 12, 24, 48].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => handleChange('defaultPageSize', n)}
                                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                                                (config as any).defaultPageSize === n ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                            }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-200">Default Time Zone Mode</h3>
                                    <p className="text-sm text-slate-500">Whether custom time ranges default to UTC or local time.</p>
                                </div>
                                <div className="flex items-center bg-slate-800 rounded-xl p-1 gap-1 border border-slate-700/40">
                                    <button
                                        onClick={() => handleChange('defaultTimeZoneMode', 'utc')}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            (config as any).defaultTimeZoneMode === 'utc' || !(config as any).defaultTimeZoneMode ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                        }`}
                                    >
                                        UTC
                                    </button>
                                    <button
                                        onClick={() => handleChange('defaultTimeZoneMode', 'local')}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            (config as any).defaultTimeZoneMode === 'local' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                        }`}
                                    >
                                        Local
                                    </button>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-200">Auto-refresh Interval</h3>
                                    <p className="text-sm text-slate-500">How often the dashboard updates in seconds.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={config.autoRefreshInterval}
                                        onChange={(e) => handleChange('autoRefreshInterval', parseInt(e.target.value))}
                                        className="w-20 px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-200 text-center font-mono text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                                    />
                                    <span className="text-slate-500 text-sm">sec</span>
                                </div>
                            </div>

                            {/* Browser Notifications */}
                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-semibold text-slate-200 flex items-center gap-2"><Bell className="w-4 h-4 text-brand-400" /> Browser Notifications</h3>
                                        <p className="text-sm text-slate-500">Get notified when investigations finish, even if this tab is in the background.</p>
                                    </div>
                                    <button
                                        role="switch"
                                        aria-checked={notifEnabled}
                                        onClick={() => toggleNotifEnabled(!notifEnabled)}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-brand-500' : 'bg-slate-700'}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${notifEnabled ? 'translate-x-5' : ''}`} />
                                    </button>
                                </div>

                                {notifEnabled && (
                                    <div className="space-y-4 animate-fade-in pl-1">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-sm text-slate-300">
                                                <Volume2 className="w-4 h-4 text-slate-400" /> Sound
                                            </div>
                                            <button
                                                role="switch"
                                                aria-checked={notifSoundOn}
                                                onClick={() => toggleNotifSound(!notifSoundOn)}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${notifSoundOn ? 'bg-brand-500' : 'bg-slate-700'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${notifSoundOn ? 'translate-x-5' : ''}`} />
                                            </button>
                                        </div>

                                        <div>
                                            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notify on</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {ALL_NOTIF_EVENTS.map(evt => (
                                                    <button
                                                        key={evt.value}
                                                        onClick={() => toggleNotifEvent(evt.value)}
                                                        className={`px-3 py-2 rounded-lg text-sm font-bold transition-all text-left ${
                                                            notifEvents.includes(evt.value) ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300 border border-slate-700/40'
                                                        }`}
                                                    >
                                                        {evt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'schedules' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Calendar className="text-brand-400" /> Schedules
                                </h2>
                                <p className="text-slate-400">Configure limits, retention, and AI reporting for scheduled investigations.</p>
                            </div>

                            <div className="grid grid-cols-1 gap-8">
                                {/* Max Concurrent Scheduled Investigations */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label htmlFor="settings-max-concurrent-scheduled" className="text-sm font-bold text-slate-300 block">Max Concurrent Scheduled Investigations</label>
                                        <span className={`text-xs font-mono px-2 py-1 rounded ${(config.maxConcurrentScheduledInvestigations ?? 2) === 0 ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {(config.maxConcurrentScheduledInvestigations ?? 2) === 0 ? '∞ Unlimited' : config.maxConcurrentScheduledInvestigations ?? 2}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] text-slate-500 font-bold w-6">∞</span>
                                        <input
                                            id="settings-max-concurrent-scheduled"
                                            type="range"
                                            min="0"
                                            max="10"
                                            step="1"
                                            value={config.maxConcurrentScheduledInvestigations ?? 2}
                                            onChange={(e) => handleChange('maxConcurrentScheduledInvestigations', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                        <span className="text-[10px] text-slate-500 font-bold w-4">10</span>
                                    </div>
                                    <p className="text-xs text-slate-500">Maximum number of scheduled investigations that can run at the same time. Set to <strong className="text-slate-400">∞</strong> for unlimited. Default: 2.</p>
                                </div>

                                {/* Scheduled Investigation Retention */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label htmlFor="settings-scheduled-retention" className="text-sm font-bold text-slate-300 block">Scheduled Investigation Retention</label>
                                        <span className={`text-xs font-mono px-2 py-1 rounded ${(config.scheduledInvestigationRetentionCount ?? 10) === 0 ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {(config.scheduledInvestigationRetentionCount ?? 10) === 0 ? '∞ Keep all' : config.scheduledInvestigationRetentionCount ?? 10}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] text-slate-500 font-bold w-6">∞</span>
                                        <input
                                            id="settings-scheduled-retention"
                                            type="range"
                                            min="0"
                                            max="50"
                                            step="1"
                                            value={config.scheduledInvestigationRetentionCount ?? 10}
                                            onChange={(e) => handleChange('scheduledInvestigationRetentionCount', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                        <span className="text-[10px] text-slate-500 font-bold w-4">50</span>
                                    </div>
                                    <p className="text-xs text-slate-500">Maximum number of completed investigations to keep per schedule. Oldest are automatically deleted when the limit is exceeded. Set to <strong className="text-slate-400">∞</strong> to keep all. Default: 10.</p>
                                </div>

                                {/* Scheduled Report Model */}
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                    <label htmlFor="settings-scheduled-report-model" className="text-sm font-bold text-slate-300 block">Scheduled Report Model</label>
                                    <select
                                        id="settings-scheduled-report-model"
                                        value={config.scheduledReportModel || 'gpt-4o-mini'}
                                        onChange={(e) => handleChange('scheduledReportModel', e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                    >
                                        {availableModels.length > 0 ? (
                                            availableModels.map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))
                                        ) : (
                                            <option value="gpt-4o-mini">Loading models...</option>
                                        )}
                                    </select>
                                    <p className="text-xs text-slate-500">LLM model used for AI-generated executive reports on scheduled investigations. A smaller, faster model is recommended since this is a synthesis task. Default: <strong className="text-slate-400">gpt-4o-mini</strong>.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <BarChart3 className="text-brand-400" /> Analytics Widgets
                                </h2>
                                <p className="text-slate-400">Choose exactly <strong className="text-white">3 charts</strong> to display on the Dashboard analytics section.</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {WIDGET_REGISTRY.map(widget => {
                                    const isSelected = selectedWidgets.includes(widget.id);
                                    const selectionIndex = selectedWidgets.indexOf(widget.id);
                                    return (
                                        <button
                                            key={widget.id}
                                            onClick={() => toggleWidget(widget.id)}
                                            className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                                                isSelected
                                                    ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-500/10'
                                                    : 'border-slate-700/40 bg-slate-800/40 hover:border-slate-600/60 hover:bg-slate-800/60'
                                            }`}
                                        >
                                            {isSelected && (
                                                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-black">
                                                    {selectionIndex + 1}
                                                </div>
                                            )}
                                            <div className="font-bold text-sm text-white mb-1">{widget.name}</div>
                                            <div className="text-xs text-slate-400 leading-relaxed">{widget.description}</div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-center gap-4 pt-4 border-t border-white/[0.06]">
                                <div className="flex items-center gap-2 flex-1">
                                    {widgetSaveSuccess && (
                                        <span className="text-green-400 font-bold flex items-center animate-fade-in">
                                            <CheckCircle2 className="w-5 h-5 mr-1" /> Widgets Saved!
                                        </span>
                                    )}
                                    <span className="text-slate-500 text-xs">
                                        {selectedWidgets.length}/3 selected
                                        {selectedWidgets.length !== 3 && <span className="text-amber-400 ml-1">— select exactly 3</span>}
                                    </span>
                                </div>
                                <button
                                    className="px-4 py-2 text-slate-500 font-semibold hover:text-slate-300 transition-colors text-sm"
                                    onClick={handleResetWidgets}
                                >
                                    Reset to Default
                                </button>
                                <button
                                    onClick={handleSaveWidgets}
                                    disabled={selectedWidgets.length !== 3}
                                    className={`px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed`}
                                >
                                    <Save className="w-4 h-4" />
                                    Save Widgets
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                    <Monitor className="text-blue-400" /> System
                                </h2>
                                <p className="text-slate-400">Manage low-level system configurations.</p>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                <label htmlFor="settings-time-range" className="text-sm font-bold text-slate-300 block">Default Time Range</label>
                                <div className="relative">
                                    <select
                                        id="settings-time-range"
                                        value={config.defaultTimeRange}
                                        onChange={(e) => handleChange('defaultTimeRange', e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all appearance-none cursor-pointer"
                                    >
                                        {TIME_PRESETS.map((preset) => (
                                            <option key={preset.value} value={preset.value}>
                                                {preset.label}
                                            </option>
                                        ))}
                                    </select>
                                    <Activity className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6" /></svg>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                <div className="text-sm font-bold text-slate-300">Import / Export Settings</div>
                                <p className="text-xs text-slate-500">Export your settings to back them up or import them on another instance.</p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={async () => {
                                            try { await api.exportSettings(); } catch (e: any) { setError(e.message); }
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-bold transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                        Export
                                    </button>
                                    <label className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-bold transition-colors cursor-pointer">
                                        <Upload className="w-4 h-4" />
                                        Import
                                        <input
                                            type="file"
                                            accept=".json"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                try {
                                                    const text = await file.text();
                                                    const parsed = JSON.parse(text);
                                                    const result = await api.importSettings(parsed);
                                                    setConfig(result.config);
                                                    setDirty(false);
                                                    setSaveSuccess(true);
                                                    saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
                                                } catch (err: any) {
                                                    setError(err.message || 'Failed to import settings');
                                                }
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer Actions — hidden on tabs that have their own save UI */}
                {activeTab !== 'analytics' && activeTab !== 'connections' && activeTab !== 'agents' && (
                <div className="p-6 border-t border-white/[0.06] bg-slate-900/40 backdrop-blur-sm flex justify-between items-center gap-4">
                    <div className="flex items-center gap-2">
                        {saveSuccess && (
                            <span className="text-green-400 font-bold flex items-center animate-fade-in">
                                <CheckCircle2 className="w-5 h-5 mr-1" /> Settings Saved!
                            </span>
                        )}
                        {error && (
                            <span className="text-red-400 font-bold flex items-center animate-fade-in">
                                <AlertCircle className="w-5 h-5 mr-1" /> {error}
                            </span>
                        )}
                    </div>

                    <div className="flex gap-4">
                        <button
                            className="px-6 py-3 text-slate-500 font-semibold hover:text-slate-300 transition-colors disabled:opacity-50"
                            disabled={saving}
                            onClick={() => loadSettings()}
                        >
                            Reset
                        </button>
                        <button
                            id="save-btn"
                            onClick={handleSave}
                            disabled={saving || loading}
                            className={`px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all active:scale-95 flex items-center gap-2 ${saving ? 'opacity-80 cursor-wait' : ''}`}
                        >
                            {saving ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
                )}
            </div>

            {/* Paths tab File Browser - update top-level config path when file is selected */}
            {pathsBrowserTarget && (
                <FileBrowserModal
                    isOpen={showFileBrowser && pathsBrowserTarget !== null}
                    onClose={() => {
                        setShowFileBrowser(false);
                        setPathsBrowserTarget(null);
                    }}
                    onSelect={(selectedPath) => {
                        if (pathsBrowserTarget) {
                            handleChange(pathsBrowserTarget, selectedPath);
                        }
                        setShowFileBrowser(false);
                        setPathsBrowserTarget(null);
                    }}
                    mode={browserMode}
                    title="Select Directory"
                    initialPath={(config as any)[pathsBrowserTarget] as string | undefined}
                />
            )}
        </div>
    );
};
