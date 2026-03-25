import { useState, useEffect } from 'react';
import { Save, Cpu, Monitor, Layout, Activity, CheckCircle2, AlertCircle, FolderOpen, LayoutGrid, List, Package, Plus, Pencil, Trash2, X, GitBranch, FileText, Database, Terminal, Archive, ChevronDown, ChevronUp, Copy, Check, Search, Loader2, Sparkles, BookOpen, ClipboardCopy, BarChart3, Plug, Eye, EyeOff, Wrench, Download, Upload, Bell, Volume2 } from 'lucide-react';
import { WIDGET_REGISTRY, getSelectedWidgetIds, setSelectedWidgetIds, DEFAULT_WIDGET_IDS } from '../components/charts/widgetRegistry';
import { api, type Product, type ProductValidation, type PathValidationResult, type DiscoverResult } from '../api';
import { useToast } from '../components/Toast';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Tooltip } from '../components/Tooltip';
import { TIME_PRESETS } from '../constants';
import { FileBrowserModal } from '../components/FileBrowserModal';
import { useNotification, getNotifEnabled, setNotifEnabled, getNotifSound, setNotifSound, getNotifEvents, setNotifEvents, ALL_NOTIF_EVENTS, type NotifEvent } from '../hooks/useNotification';

// Path config item component
const PathItem = ({ icon: Icon, label, value, color, validation }: { icon: any; label: string; value: string; color: string; validation?: PathValidationResult | null }) => {
    const [copied, setCopied] = useState(false);
    const copyToClipboard = () => {
        if (value) {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Determine status: null = not configured (skip), validation error = red, ok = green
    const hasError = validation?.error;

    return (
        <div className={`group flex items-start gap-3 p-3 rounded-xl transition-all ${hasError ? 'bg-red-500/10 hover:bg-red-500/15' : 'hover:bg-slate-800/40'}`}>
            <div className={`p-2 rounded-lg ${color} shrink-0`}>
                <Icon size={14} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
                    {validation && !validation.error && (
                        <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                    )}
                    {validation?.error && (
                        <AlertCircle size={12} className="text-red-400 shrink-0" />
                    )}
                </div>
                <div 
                    className={`text-sm font-mono truncate cursor-pointer transition-colors ${hasError ? 'text-red-400' : 'text-slate-300 group-hover:text-brand-400'}`}
                    title={value || 'Not configured'}
                    onClick={copyToClipboard}
                >
                    {value || <span className="text-slate-600 italic font-sans">Not configured</span>}
                </div>
                {validation?.error && (
                    <div className="text-xs text-red-400 mt-1 font-medium">{validation.error}</div>
                )}
            </div>
            {value && (
                <button
                    onClick={copyToClipboard}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-all"
                    title="Copy path"
                >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
            )}
        </div>
    );
};

export const Settings = () => {
    const { confirm } = useToast();
    const [activeTab, setActiveTab] = useState('products');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
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

    // Products state
    const [products, setProducts] = useState<Product[]>([]);
    const [activeProductId, setActiveProductId] = useState<string>('');
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [productForm, setProductForm] = useState<Omit<Product, 'id'>>({
        name: '',
        repoRoot: '',
        systemPromptPath: '',
        knowledgeBasePath: '',
        workingDirectory: '',
        investigationsPath: ''
    });
    const [productBrowserTarget, setProductBrowserTarget] = useState<keyof Omit<Product, 'id' | 'name'> | null>(null);

    // Product validation state
    const [productValidations, setProductValidations] = useState<Record<string, ProductValidation>>({});
    // Modal-level validation after save
    const [modalValidation, setModalValidation] = useState<ProductValidation | null>(null);

    // Discover state
    const [discoverRepoRoot, setDiscoverRepoRoot] = useState('');
    const [discovering, setDiscovering] = useState(false);
    const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
    const [discoverError, setDiscoverError] = useState<string | null>(null);
    const [showDiscoverStep, setShowDiscoverStep] = useState(true);

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

    const toggleProductExpanded = (productId: string) => {
        setExpandedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    };

    const handleDiscover = async () => {
        if (!discoverRepoRoot.trim()) return;
        setDiscovering(true);
        setDiscoverError(null);
        setDiscoverResult(null);
        try {
            const result = await api.discoverProduct(discoverRepoRoot.trim());
            setDiscoverResult(result);
            // Auto-fill the product form with discovered values
            setProductForm(prev => ({
                ...prev,
                name: result.product.name || prev.name || '',
                repoRoot: result.product.repoRoot || discoverRepoRoot.trim(),
                systemPromptPath: result.product.systemPromptPath || prev.systemPromptPath || '',
                knowledgeBasePath: result.product.knowledgeBasePath || prev.knowledgeBasePath || '',
                workingDirectory: result.product.workingDirectory || prev.workingDirectory || '',
                investigationsPath: result.product.investigationsPath || prev.investigationsPath || '',
            }));
            setShowDiscoverStep(false);
        } catch (err: any) {
            setDiscoverError(err.message || 'Discovery failed');
        } finally {
            setDiscovering(false);
        }
    };

    const handleCloneProduct = async (productId: string) => {
        try {
            await api.cloneProduct(productId);
            await loadProducts();
        } catch (err: any) {
            setError(err.message || 'Failed to clone product');
        }
    };

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

    const [config, setConfig] = useState({
        maxConcurrentInvestigations: 3,
        maxSteps: 50,
        retrospectTimeoutMinutes: 10,
        autoRefreshInterval: 30,
        defaultTimeRange: 'ago(1h)',
        notifications: true,
        model: 'gpt-4-turbo',
        defaultView: 'grid' as 'grid' | 'list',
        defaultPageSize: 12
    });

    useEffect(() => {
        loadSettings();
        loadModels();
        loadProducts();
        loadProviders();
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

    const loadProducts = async () => {
        try {
            const productsList = await api.listProducts();
            setProducts(productsList);
            const active = await api.getActiveProduct();
            if (active) {
                setActiveProductId(active.id);
            }
            // Validate all products
            const validations: Record<string, ProductValidation> = {};
            await Promise.all(productsList.map(async (p) => {
                try {
                    validations[p.id] = await api.validateProduct(p.id);
                } catch {
                    // ignore validation failures
                }
            }));
            setProductValidations(validations);

            // Auto-expand products that have validation errors
            const errorProductIds = Object.entries(validations)
                .filter(([, v]) => !v.valid)
                .map(([id]) => id);
            if (errorProductIds.length > 0) {
                setExpandedProducts(prev => {
                    const next = new Set(prev);
                    errorProductIds.forEach(id => next.add(id));
                    return next;
                });
            }
        } catch (e) {
            console.error("Failed to load products:", e);
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
                    name: s.name || '',
                    command: s.command || '',
                    args: Array.isArray(s.args) ? s.args.join(' ') : (s.args || ''),
                    env: s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    cwd: s.cwd || '',
                })));
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
            });
            setSaveSuccess(true);
            setDirty(false);
            setTimeout(() => setSaveSuccess(false), 3000);
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
            setTimeout(() => setProviderSaveSuccess(false), 3000);
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

    const handleSaveWidgets = () => {
        setSelectedWidgetIds(selectedWidgets);
        setWidgetSaveSuccess(true);
        setTimeout(() => setWidgetSaveSuccess(false), 3000);
    };

    const handleResetWidgets = () => {
        setSelectedWidgets(DEFAULT_WIDGET_IDS);
    };

    const tabs = [
        { id: 'products', label: 'Products', icon: <Package size={18} /> },
        { id: 'connections', label: 'Connections', icon: <Plug size={18} /> },
        { id: 'agent', label: 'Agent Behavior', icon: <Cpu size={18} /> },
        { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
        { id: 'appearance', label: 'Appearance', icon: <Layout size={18} /> },
        { id: 'system', label: 'System', icon: <Monitor size={18} /> },
    ];

    return (
        <div className="max-w-6xl mx-auto min-h-[calc(100dvh-140px)] md:h-[calc(100dvh-140px)] flex flex-col md:flex-row gap-4 md:gap-8 animate-fade-in">
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

                    {activeTab === 'products' && (
                        <div className="space-y-8 animate-fade-in">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                                        <Package className="text-purple-400" /> Products
                                    </h2>
                                    <p className="text-slate-400">Configure investigation targets with their own paths and settings.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setEditingProduct(null);
                                        setProductForm({
                                            name: '',
                                            repoRoot: '',
                                            systemPromptPath: '',
                                            knowledgeBasePath: '',
                                            workingDirectory: '',
                                            investigationsPath: ''
                                        });
                                        setModalValidation(null);
                                        setDiscoverRepoRoot('');
                                        setDiscoverResult(null);
                                        setDiscoverError(null);
                                        setShowDiscoverStep(true);
                                        setShowProductModal(true);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all"
                                >
                                    <Plus size={18} /> Add Product
                                </button>
                            </div>

                            {/* Active Product Selector */}
                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/40 shadow-sm space-y-4">
                                <label htmlFor="settings-active-product" className="text-sm font-bold text-slate-300 block">Active Product</label>
                                <p className="text-xs text-slate-500">New investigations will use the paths from the selected product.</p>
                                <select
                                    id="settings-active-product"
                                    value={activeProductId}
                                    disabled={products.length === 0}
                                    onChange={async (e) => {
                                        try {
                                            await api.setActiveProduct(e.target.value);
                                            setActiveProductId(e.target.value);
                                        } catch (err) {
                                            console.error('Failed to set active product:', err);
                                        }
                                    }}
                                    className={`w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none ${products.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {products.length === 0 && (
                                        <option value="" disabled>No products configured</option>
                                    )}
                                    {products.map(p => (
                                        <option key={p.id} value={p.id} className="bg-slate-800 text-slate-200">{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Product List */}
                            <div className="space-y-4">
                                {products.map(product => {
                                    const isExpanded = expandedProducts.has(product.id);
                                    const isActive = product.id === activeProductId;
                                    const validation = productValidations[product.id];
                                    const errorCount = validation?.paths.filter(p => p.error).length ?? 0;
                                    const configuredCount = [
                                        product.repoRoot,
                                        product.systemPromptPath,
                                        product.knowledgeBasePath,
                                        product.workingDirectory,
                                        product.investigationsPath
                                    ].filter(Boolean).length;

                                    return (
                                        <div 
                                            key={product.id} 
                                            className={`bg-slate-800/40 rounded-2xl border shadow-sm overflow-hidden transition-all duration-300 ${
                                                errorCount > 0
                                                    ? 'border-red-500/30 ring-2 ring-red-500/10 shadow-red-500/5'
                                                    : isActive 
                                                        ? 'border-brand-500/30 ring-2 ring-brand-500/10 shadow-brand-500/5' 
                                                        : 'border-slate-700/40 hover:border-slate-600/60'
                                            }`}
                                        >
                                            {/* Header */}
                                            <div 
                                                className={`p-5 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-800/30' : 'hover:bg-slate-800/20'}`}
                                                onClick={() => toggleProductExpanded(product.id)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-3 rounded-xl ${isActive ? 'bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/30' : 'bg-gradient-to-br from-slate-400 to-slate-500'}`}>
                                                            <Package size={20} className="text-white" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="font-bold text-lg text-white">{product.name}</h3>
                                                                {isActive && (
                                                                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-full font-semibold shadow-sm">
                                                                        <CheckCircle2 size={12} /> Active
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs text-slate-500">
                                                                    {configuredCount}/5 paths configured
                                                                </span>
                                                                <div className="flex gap-0.5">
                                                                    {[...Array(5)].map((_, i) => (
                                                                        <div 
                                                                            key={i} 
                                                                            className={`w-1.5 h-1.5 rounded-full ${i < configuredCount ? 'bg-brand-500' : 'bg-slate-700'}`}
                                                                        />
                                                                    ))}
                                                                </div>
                                                                {errorCount > 0 && (
                                                                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-red-500/10 text-red-400 rounded-full font-semibold border border-red-500/20">
                                                                        <AlertCircle size={10} /> {errorCount} path {errorCount === 1 ? 'issue' : 'issues'}
                                                                    </span>
                                                                )}
                                                                {validation && errorCount === 0 && validation.paths.length > 0 && (
                                                                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full font-semibold border border-green-500/20">
                                                                        <CheckCircle2 size={10} /> All paths valid
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingProduct(product);
                                                                setProductForm({
                                                                    name: product.name,
                                                                    repoRoot: product.repoRoot,
                                                                    systemPromptPath: product.systemPromptPath,
                                                                    knowledgeBasePath: product.knowledgeBasePath,
                                                                    workingDirectory: product.workingDirectory,
                                                                    investigationsPath: product.investigationsPath
                                                                });
                                                                setModalValidation(productValidations[product.id] || null);
                                                                setShowProductModal(true);
                                                            }}
                                                            className="p-2.5 text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 rounded-xl transition-all"
                                                            title="Edit product"
                                                        >
                                                            <Pencil size={18} />
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                await handleCloneProduct(product.id);
                                                            }}
                                                            className="p-2.5 text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 rounded-xl transition-all"
                                                            title="Clone product"
                                                        >
                                                            <ClipboardCopy size={18} />
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (products.length <= 1) {
                                                                    setError('Cannot delete the last product');
                                                                    return;
                                                                }
                                                                const ok = await confirm({
                                                                    title: 'Delete Product',
                                                                    message: `This will permanently delete "${product.name}". This action cannot be undone.`,
                                                                    confirmLabel: 'Delete',
                                                                    variant: 'danger',
                                                                });
                                                                if (ok) {
                                                                    try {
                                                                        await api.deleteProduct(product.id);
                                                                        await loadProducts();
                                                                    } catch (err: any) {
                                                                        setError(err.message);
                                                                    }
                                                                }
                                                            }}
                                                            className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                                                            title="Delete product"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                        <div className={`p-2 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                            <ChevronDown size={20} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expandable Content */}
                                            <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                                <div className="px-5 pb-5 border-t border-slate-700/40">
                                                    {/* Path issues banner */}
                                                    {errorCount > 0 && (
                                                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                                                            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                                            <div className="text-sm text-red-300">
                                                                <span className="font-semibold">Investigations cannot start</span> until all path issues are resolved. Paths must be absolute and exist on disk.
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 pt-4">
                                                        {/* Repository & Storage */}
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-3 py-2">Repository & Storage</div>
                                                            <PathItem icon={GitBranch} label="Repository Root" value={product.repoRoot} color="bg-emerald-500" validation={validation?.paths.find(p => p.field === 'repoRoot')} />
                                                            <PathItem icon={Archive} label="Investigations Storage" value={product.investigationsPath} color="bg-amber-500" validation={validation?.paths.find(p => p.field === 'investigationsPath')} />
                                                            <PathItem icon={Terminal} label="Working Directory" value={product.workingDirectory} color="bg-slate-500" validation={validation?.paths.find(p => p.field === 'workingDirectory')} />
                                                        </div>
                                                        {/* Agent Configuration */}
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Agent Configuration</div>
                                                            <PathItem icon={FileText} label="System Prompt" value={product.systemPromptPath} color="bg-blue-500" validation={validation?.paths.find(p => p.field === 'systemPromptPath')} />
                                                            <PathItem icon={Database} label="Knowledge Base" value={product.knowledgeBasePath} color="bg-indigo-500" validation={validation?.paths.find(p => p.field === 'knowledgeBasePath')} />
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Quick Actions */}
                                                    {!isActive && (
                                                        <div className="mt-4 pt-4 border-t border-slate-700/40">
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        await api.setActiveProduct(product.id);
                                                                        setActiveProductId(product.id);
                                                                    } catch (err) {
                                                                        console.error('Failed to set active product:', err);
                                                                    }
                                                                }}
                                                                className="w-full py-3 px-4 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white rounded-xl font-semibold shadow-lg shadow-brand-500/20 transition-all flex items-center justify-center gap-2"
                                                            >
                                                                <CheckCircle2 size={18} /> Set as Active Product
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

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
                            </div>
                        </div>
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
                                                    setTimeout(() => setSaveSuccess(false), 3000);
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
                {activeTab !== 'products' && activeTab !== 'analytics' && activeTab !== 'connections' && (
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

            {/* Product Add/Edit Modal */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                    <div className="glass-card w-full max-w-2xl max-h-[90dvh] overflow-hidden">
                        <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                {editingProduct ? (
                                    <><Pencil size={20} className="text-brand-400" /> Edit Product</>
                                ) : (
                                    <><Plus size={20} className="text-brand-400" /> Add Product</>
                                )}
                            </h3>
                            <button
                                onClick={() => setShowProductModal(false)}
                                className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto max-h-[60dvh]">

                            {/* Modal-level error display */}
                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-sm font-semibold animate-fade-in">
                                    <AlertCircle size={16} /> {error}
                                </div>
                            )}

                            {/* Discover Step — only for new products */}
                            {!editingProduct && showDiscoverStep && (
                                <div className="space-y-4 animate-fade-in">
                                    <div className="p-4 bg-brand-500/5 border border-brand-500/20 rounded-xl space-y-3">
                                        <div className="flex items-center gap-2 text-brand-300 font-semibold text-sm">
                                            <Search size={16} />
                                            Quick Setup — Point to a repo and we'll auto-configure
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={discoverRepoRoot}
                                                onChange={(e) => {
                                                    setDiscoverRepoRoot(e.target.value);
                                                    setDiscoverError(null);
                                                }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
                                                className="flex-1 px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none font-mono text-sm"
                                                placeholder="C:\Repositories\MyProject or /home/user/myproject"
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => {
                                                    setProductBrowserTarget('repoRoot');
                                                    setBrowserMode('directory');
                                                    setShowFileBrowser(true);
                                                }}
                                                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl transition-all border border-slate-700/50"
                                                title="Browse for repository root"
                                            >
                                                <FolderOpen size={18} />
                                            </button>
                                            <button
                                                onClick={handleDiscover}
                                                disabled={discovering || !discoverRepoRoot.trim()}
                                                className="px-5 py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-brand-500/20"
                                            >
                                                {discovering ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <Search size={16} />
                                                )}
                                                Discover
                                            </button>
                                        </div>
                                        {discoverError && (
                                            <p className="text-xs text-red-400 flex items-center gap-1">
                                                <AlertCircle size={12} /> {discoverError}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 pt-1">
                                        <div className="flex-1 h-px bg-slate-700/40" />
                                        <span className="text-xs text-slate-500 font-medium">or configure manually</span>
                                        <div className="flex-1 h-px bg-slate-700/40" />
                                    </div>
                                    <button
                                        onClick={() => setShowDiscoverStep(false)}
                                        className="w-full py-2.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded-xl transition-all font-medium"
                                    >
                                        Skip — configure paths manually
                                    </button>
                                </div>
                            )}

                            {/* Form fields — shown when editing or after discover/skip */}
                            {(editingProduct || !showDiscoverStep) && (
                                <div className="space-y-4 animate-fade-in">
                                    {/* Source badge for discovered products */}
                                    {!editingProduct && discoverResult && discoverResult.source !== 'none' && (
                                        <div className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold ${
                                            discoverResult.source === 'manifest'
                                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                        }`}>
                                            {discoverResult.source === 'manifest' ? <Sparkles size={12} /> : <BookOpen size={12} />}
                                            {discoverResult.source === 'manifest' ? 'From .investigator.json' : 'Auto-discovered'}
                                        </div>
                                    )}

                                    <div>
                                        <label htmlFor="product-name" className="text-sm font-bold text-slate-300 block mb-2">Product Name</label>
                                        <input
                                            id="product-name"
                                            type="text"
                                            value={productForm.name}
                                            onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none"
                                            placeholder="e.g., MyService, DataPipeline"
                                        />
                                    </div>
                                    {/* Modal-level validation warning */}
                                    {modalValidation && !modalValidation.valid && (
                                        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                                            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                            <div className="text-sm text-red-300">
                                                <span className="font-semibold">Path issues detected.</span> Investigations cannot start until these are resolved. All paths must be absolute and exist on disk.
                                            </div>
                                        </div>
                                    )}
                                    {([
                                        { key: 'repoRoot', label: 'Repository Root', mode: 'directory' as const },
                                        { key: 'systemPromptPath', label: 'System Prompt Path', mode: 'file' as const },
                                        { key: 'knowledgeBasePath', label: 'Knowledge Base Path', mode: 'directory' as const },
                                        { key: 'workingDirectory', label: 'Working Directory', mode: 'directory' as const },
                                        { key: 'investigationsPath', label: 'Investigations Path', mode: 'directory' as const }
                                    ] as const).map(({ key, label, mode }) => {
                                        const pathError = modalValidation?.paths.find(p => p.field === key);
                                        const hasError = pathError?.error;
                                        return (
                                        <div key={key}>
                                            <label htmlFor={`product-${key}`} className="text-sm font-bold text-slate-300 block mb-2">{label}</label>
                                            <div className="flex gap-2">
                                                <input
                                                    id={`product-${key}`}
                                                    type="text"
                                                    value={productForm[key]}
                                                    onChange={(e) => {
                                                        setProductForm(prev => ({ ...prev, [key]: e.target.value }));
                                                        if (modalValidation) setModalValidation(null);
                                                    }}
                                                    className={`flex-1 px-4 py-3 rounded-xl border bg-slate-800/60 focus:ring-2 outline-none font-mono text-sm text-slate-200 transition-colors ${
                                                        hasError
                                                            ? 'border-red-500/40 focus:ring-red-500/30 bg-red-500/5'
                                                            : pathError && !hasError
                                                                ? 'border-green-500/40 focus:ring-green-500/30'
                                                                : 'border-slate-700/50 focus:ring-brand-500'
                                                    }`}
                                                    placeholder={`Path to ${label.toLowerCase()}`}
                                                />
                                                <button
                                                    onClick={() => {
                                                        setProductBrowserTarget(key);
                                                        setBrowserMode(mode);
                                                        setShowFileBrowser(true);
                                                    }}
                                                    className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl transition-all border border-slate-700/50"
                                                    title={`Browse for ${label.toLowerCase()}`}
                                                >
                                                    <FolderOpen size={18} />
                                                </button>
                                            </div>
                                            {hasError && (
                                                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                                    <AlertCircle size={12} /> {pathError.error}
                                                </p>
                                            )}
                                        </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer — show save buttons only when form is visible */}
                        {(editingProduct || !showDiscoverStep) && (
                        <div className="p-6 border-t border-white/[0.06] flex justify-end gap-3">
                            <button
                                onClick={() => setShowProductModal(false)}
                                className="px-6 py-3 text-slate-500 font-semibold hover:text-slate-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    if (!productForm.name.trim()) {
                                        setError('Product name is required');
                                        return;
                                    }
                                    try {
                                        let savedProductId: string;
                                        if (editingProduct) {
                                            const updated = await api.updateProduct(editingProduct.id, productForm);
                                            savedProductId = updated.id;
                                        } else {
                                            const created = await api.addProduct(productForm);
                                            savedProductId = created.id;
                                        }
                                        // Validate after save
                                        const validation = await api.validateProduct(savedProductId);
                                        setModalValidation(validation);
                                        // Reload products to refresh cards
                                        await loadProducts();
                                        if (validation.valid) {
                                            // All good, close modal
                                            setShowProductModal(false);
                                            setModalValidation(null);
                                        }
                                        // If not valid, keep modal open so user sees errors
                                    } catch (err: any) {
                                        setError(err.message);
                                    }
                                }}
                                className="px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all"
                            >
                                {editingProduct ? 'Save Changes' : 'Add Product'}
                            </button>
                        </div>
                        )}
                    </div>
                </div>
            )}

            {/* Product File Browser - update product form when file is selected */}
            {productBrowserTarget && (
                <FileBrowserModal
                    isOpen={showFileBrowser && productBrowserTarget !== null}
                    onClose={() => {
                        setShowFileBrowser(false);
                        setProductBrowserTarget(null);
                    }}
                    onSelect={(selectedPath) => {
                        if (productBrowserTarget) {
                            setProductForm(prev => ({ ...prev, [productBrowserTarget]: selectedPath }));
                            // Also update discover repo root input if browsing for repoRoot in discover step
                            if (productBrowserTarget === 'repoRoot' && showDiscoverStep) {
                                setDiscoverRepoRoot(selectedPath);
                            }
                        }
                        setShowFileBrowser(false);
                        setProductBrowserTarget(null);
                    }}
                    mode={browserMode}
                    title={browserMode === 'file' ? 'Select File' : 'Select Directory'}
                    initialPath={productBrowserTarget && productForm[productBrowserTarget] ? productForm[productBrowserTarget] : undefined}
                />
            )}
        </div>
    );
};
