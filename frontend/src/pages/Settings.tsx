import { useState, useEffect } from 'react';
import { Save, Cpu, Monitor, Layout, Activity, CheckCircle2, AlertCircle, FolderOpen, LayoutGrid, List, Package, Plus, Pencil, Trash2, X, GitBranch, FileText, Brain, Database, Terminal, Archive, Shield, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { api, type Product, type ProductValidation, type PathValidationResult } from '../api';
import { TIME_PRESETS } from '../constants';
import { FileBrowserModal } from '../components/FileBrowserModal';

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
        <div className={`group flex items-start gap-3 p-3 rounded-xl transition-all ${hasError ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-slate-50/80'}`}>
            <div className={`p-2 rounded-lg ${color} shrink-0`}>
                <Icon size={14} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
                    {validation && !validation.error && (
                        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                    )}
                    {validation?.error && (
                        <AlertCircle size={12} className="text-red-500 shrink-0" />
                    )}
                </div>
                <div 
                    className={`text-sm font-mono truncate cursor-pointer transition-colors ${hasError ? 'text-red-600' : 'text-slate-700 group-hover:text-brand-600'}`}
                    title={value || 'Not configured'}
                    onClick={copyToClipboard}
                >
                    {value || <span className="text-slate-300 italic font-sans">Not configured</span>}
                </div>
                {validation?.error && (
                    <div className="text-xs text-red-500 mt-1 font-medium">{validation.error}</div>
                )}
            </div>
            {value && (
                <button
                    onClick={copyToClipboard}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all"
                    title="Copy path"
                >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
            )}
        </div>
    );
};

export const Settings = () => {
    const [activeTab, setActiveTab] = useState('agent');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [defaultView, setDefaultView] = useState<'grid' | 'list'>(
        () => (localStorage.getItem('inv-view') as 'grid' | 'list') ?? 'grid'
    );

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
        retrospectPromptPath: '',
        knowledgeBasePath: '',
        workingDirectory: '',
        investigationsPath: '',
        icmScriptsPath: ''
    });
    const [productBrowserTarget, setProductBrowserTarget] = useState<keyof Omit<Product, 'id' | 'name'> | null>(null);

    // Product validation state
    const [productValidations, setProductValidations] = useState<Record<string, ProductValidation>>({});
    // Modal-level validation after save
    const [modalValidation, setModalValidation] = useState<ProductValidation | null>(null);

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

    const handleDefaultViewChange = (mode: 'grid' | 'list') => {
        setDefaultView(mode);
        localStorage.setItem('inv-view', mode);
    };

    // File Browser State
    const [showFileBrowser, setShowFileBrowser] = useState(false);
    const [browserMode, setBrowserMode] = useState<'file' | 'directory'>('file');
    const [browserTarget, setBrowserTarget] = useState<keyof typeof config | null>(null);

    const [config, setConfig] = useState({
        theme: 'light',
        maxConcurrentInvestigations: 3,
        maxSteps: 50,
        retrospectTimeoutMinutes: 10,
        autoRefreshInterval: 30,
        defaultTimeRange: 'ago(1h)',
        notifications: true,
        model: 'gpt-4-turbo'
    });

    useEffect(() => {
        loadSettings();
        loadModels();
        loadProducts();
    }, []);

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
        } catch (err) {
            console.error("Failed to load settings:", err);
            setError("Failed to load settings from server.");
        } finally {
            setLoading(false);
        }
    };

    const openFileBrowser = (target: keyof typeof config, mode: 'file' | 'directory') => {
        setBrowserTarget(target);
        setBrowserMode(mode);
        setShowFileBrowser(true);
    };

    const handleFileSelect = (path: string) => {
        if (browserTarget) {
            handleChange(browserTarget, path);
        }
        setShowFileBrowser(false);
    };

    const handleChange = (key: string, value: any) => {
        // Protect against NaN from cleared numeric inputs
        if (typeof value === 'number' && isNaN(value)) return;
        setConfig(prev => ({ ...prev, [key]: value }));
        // Reset success message on change
        if (saveSuccess) setSaveSuccess(false);
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            await api.saveSettings(config);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            console.error("Failed to save settings:", err);
            setError(err.message || "Failed to save settings.");
        } finally {
            setSaving(false);
        }
    };

    const tabs = [
        { id: 'products', label: 'Products', icon: <Package size={18} /> },
        { id: 'agent', label: 'Agent Behavior', icon: <Cpu size={18} /> },
        { id: 'appearance', label: 'Appearance', icon: <Layout size={18} /> },
        { id: 'system', label: 'System', icon: <Monitor size={18} /> },
    ];

    return (
        <div className="max-w-6xl mx-auto h-[calc(100vh-140px)] flex gap-8 animate-fade-in">
            {/* Sidebar Navigation */}
            <div className="w-64 shrink-0 space-y-2">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight mb-8 px-4">Settings</h1>

                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center space-x-3 px-6 py-4 rounded-xl transition-all font-semibold text-sm ${activeTab === tab.id
                            ? 'bg-white shadow-lg text-brand-600 ring-1 ring-black/5'
                            : 'text-slate-500 hover:bg-white/50 hover:text-slate-700'
                            }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 overflow-hidden flex flex-col relative">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent pointer-events-none" />

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-10 space-y-10 relative z-10 custom-scrollbar">

                    {activeTab === 'products' && (
                        <div className="space-y-8 animate-fade-in">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                                        <Package className="text-purple-500" /> Products
                                    </h2>
                                    <p className="text-slate-500">Configure investigation targets with their own paths and settings.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setEditingProduct(null);
                                        setProductForm({
                                            name: '',
                                            repoRoot: '',
                                            systemPromptPath: '',
                                            retrospectPromptPath: '',
                                            knowledgeBasePath: '',
                                            workingDirectory: '',
                                            investigationsPath: '',
                                            icmScriptsPath: ''
                                        });
                                        setModalValidation(null);
                                        setShowProductModal(true);
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-lg shadow-brand-500/20 transition-all"
                                >
                                    <Plus size={18} /> Add Product
                                </button>
                            </div>

                            {/* Active Product Selector */}
                            <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                <label className="text-sm font-bold text-slate-700 block">Active Product</label>
                                <p className="text-xs text-slate-400">New investigations will use the paths from the selected product.</p>
                                <select
                                    value={activeProductId}
                                    onChange={async (e) => {
                                        try {
                                            await api.setActiveProduct(e.target.value);
                                            setActiveProductId(e.target.value);
                                        } catch (err) {
                                            console.error('Failed to set active product:', err);
                                        }
                                    }}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 outline-none"
                                >
                                    {products.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
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
                                        product.retrospectPromptPath,
                                        product.knowledgeBasePath,
                                        product.workingDirectory,
                                        product.investigationsPath,
                                        product.icmScriptsPath
                                    ].filter(Boolean).length;

                                    return (
                                        <div 
                                            key={product.id} 
                                            className={`bg-gradient-to-br from-white/80 to-white/40 rounded-2xl border shadow-sm overflow-hidden transition-all duration-300 ${
                                                errorCount > 0
                                                    ? 'border-red-300 ring-2 ring-red-100 shadow-red-100/50'
                                                    : isActive 
                                                        ? 'border-brand-300 ring-2 ring-brand-100 shadow-brand-100/50' 
                                                        : 'border-slate-200/60 hover:border-slate-300'
                                            }`}
                                        >
                                            {/* Header */}
                                            <div 
                                                className={`p-5 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50/30'}`}
                                                onClick={() => toggleProductExpanded(product.id)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-3 rounded-xl ${isActive ? 'bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/30' : 'bg-gradient-to-br from-slate-400 to-slate-500'}`}>
                                                            <Package size={20} className="text-white" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="font-bold text-lg text-slate-800">{product.name}</h3>
                                                                {isActive && (
                                                                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-full font-semibold shadow-sm">
                                                                        <CheckCircle2 size={12} /> Active
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs text-slate-400">
                                                                    {configuredCount}/7 paths configured
                                                                </span>
                                                                <div className="flex gap-0.5">
                                                                    {[...Array(7)].map((_, i) => (
                                                                        <div 
                                                                            key={i} 
                                                                            className={`w-1.5 h-1.5 rounded-full ${i < configuredCount ? 'bg-brand-500' : 'bg-slate-200'}`}
                                                                        />
                                                                    ))}
                                                                </div>
                                                                {errorCount > 0 && (
                                                                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">
                                                                        <AlertCircle size={10} /> {errorCount} path {errorCount === 1 ? 'issue' : 'issues'}
                                                                    </span>
                                                                )}
                                                                {validation && errorCount === 0 && validation.paths.length > 0 && (
                                                                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded-full font-semibold">
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
                                                                    retrospectPromptPath: product.retrospectPromptPath,
                                                                    knowledgeBasePath: product.knowledgeBasePath,
                                                                    workingDirectory: product.workingDirectory,
                                                                    investigationsPath: product.investigationsPath,
                                                                    icmScriptsPath: product.icmScriptsPath
                                                                });
                                                                setModalValidation(productValidations[product.id] || null);
                                                                setShowProductModal(true);
                                                            }}
                                                            className="p-2.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"
                                                            title="Edit product"
                                                        >
                                                            <Pencil size={18} />
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (products.length <= 1) {
                                                                    setError('Cannot delete the last product');
                                                                    return;
                                                                }
                                                                if (confirm(`Delete "${product.name}"?`)) {
                                                                    try {
                                                                        await api.deleteProduct(product.id);
                                                                        await loadProducts();
                                                                    } catch (err: any) {
                                                                        setError(err.message);
                                                                    }
                                                                }
                                                            }}
                                                            className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
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
                                                <div className="px-5 pb-5 border-t border-slate-100">
                                                    {/* Path issues banner */}
                                                    {errorCount > 0 && (
                                                        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                                                            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                                                            <div className="text-sm text-red-700">
                                                                <span className="font-semibold">Investigations cannot start</span> until all path issues are resolved. Paths must be absolute and exist on disk.
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 pt-4">
                                                        {/* Repository & Storage */}
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Repository & Storage</div>
                                                            <PathItem icon={GitBranch} label="Repository Root" value={product.repoRoot} color="bg-emerald-500" validation={validation?.paths.find(p => p.field === 'repoRoot')} />
                                                            <PathItem icon={Archive} label="Investigations Storage" value={product.investigationsPath} color="bg-amber-500" validation={validation?.paths.find(p => p.field === 'investigationsPath')} />
                                                            <PathItem icon={Terminal} label="Working Directory" value={product.workingDirectory} color="bg-slate-500" validation={validation?.paths.find(p => p.field === 'workingDirectory')} />
                                                        </div>
                                                        {/* Agent Configuration */}
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Agent Configuration</div>
                                                            <PathItem icon={FileText} label="System Prompt" value={product.systemPromptPath} color="bg-blue-500" validation={validation?.paths.find(p => p.field === 'systemPromptPath')} />
                                                            <PathItem icon={Brain} label="Retrospective Prompt" value={product.retrospectPromptPath} color="bg-purple-500" validation={validation?.paths.find(p => p.field === 'retrospectPromptPath')} />
                                                            <PathItem icon={Database} label="Knowledge Base" value={product.knowledgeBasePath} color="bg-indigo-500" validation={validation?.paths.find(p => p.field === 'knowledgeBasePath')} />
                                                            <PathItem icon={Shield} label="ICM Scripts" value={product.icmScriptsPath} color="bg-rose-500" validation={validation?.paths.find(p => p.field === 'icmScriptsPath')} />
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Quick Actions */}
                                                    {!isActive && (
                                                        <div className="mt-4 pt-4 border-t border-slate-100">
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

                    {activeTab === 'agent' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <Cpu className="text-brand-500" /> Agent Behavior
                                </h2>
                                <p className="text-slate-500">Configure how the investigation agent operates and makes decisions.</p>
                            </div>

                            <div className="grid grid-cols-1 gap-8">
                                {/* Max Steps Slider */}
                                <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm font-bold text-slate-700 block">Max Steps Limit</label>
                                        <span className={`text-xs font-mono px-2 py-1 rounded ${config.maxSteps === 0 ? 'bg-brand-100 text-brand-700 font-bold' : 'bg-slate-200 text-slate-600'}`}>
                                            {config.maxSteps === 0 ? 'Unlimited' : `${config.maxSteps} steps`}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            step="5"
                                            value={config.maxSteps ?? 50}
                                            onChange={(e) => handleChange('maxSteps', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                        <div className="text-xs text-slate-400 whitespace-nowrap">
                                            {config.maxSteps === 0 ? 'Drag right to set limit' : 'Drag left to 0 for unlimited'}
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400">Controls the maximum number of reasoning steps before the agent pauses for safety. Set to 0 for no limit.</p>
                                </div>

                                {/* Retrospective Timeout */}
                                <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm font-bold text-slate-700 block">Retrospective Timeout</label>
                                        <span className="text-xs font-mono px-2 py-1 rounded bg-slate-200 text-slate-600">
                                            {config.retrospectTimeoutMinutes ?? 10} min
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="1"
                                            max="30"
                                            step="1"
                                            value={config.retrospectTimeoutMinutes ?? 10}
                                            onChange={(e) => handleChange('retrospectTimeoutMinutes', parseInt(e.target.value))}
                                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-400">Maximum time allowed for retrospective analysis before timing out. Increase for large investigations. Default: 10 minutes.</p>
                                </div>

                                {/* Model Selection */}
                                <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                    <label className="text-sm font-bold text-slate-700 block">Model Selection</label>
                                    <select
                                        value={config.model}
                                        onChange={(e) => handleChange('model', e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                                    >
                                        {availableModels.length > 0 ? (
                                            availableModels.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))
                                        ) : (
                                            <option value="gpt-4-turbo">Loading models...</option>
                                        )}
                                    </select>
                                    <p className="text-xs text-slate-400">Select the LLM to drive the investigation agent. List fetched from Copilot.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <Layout className="text-pink-500" /> Appearance
                                </h2>
                                <p className="text-slate-500">Customize the look and feel of the dashboard.</p>
                            </div>

                            <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-700">Default Investigations View</h3>
                                    <p className="text-sm text-slate-400">How investigations are displayed when you open the dashboard.</p>
                                </div>
                                <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
                                    <button
                                        onClick={() => handleDefaultViewChange('grid')}
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            defaultView === 'grid' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                    >
                                        <LayoutGrid className="w-4 h-4" /> Grid
                                    </button>
                                    <button
                                        onClick={() => handleDefaultViewChange('list')}
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                            defaultView === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                    >
                                        <List className="w-4 h-4" /> List
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-slate-700">Auto-refresh Interval</h3>
                                    <p className="text-sm text-slate-400">How often the dashboard updates in seconds.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={config.autoRefreshInterval}
                                        onChange={(e) => handleChange('autoRefreshInterval', parseInt(e.target.value))}
                                        className="w-20 px-3 py-2 rounded-lg border border-slate-200 text-center font-mono text-sm"
                                    />
                                    <span className="text-slate-400 text-sm">sec</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="space-y-8 animate-fade-in">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <Monitor className="text-blue-500" /> System
                                </h2>
                                <p className="text-slate-500">Manage low-level system configurations.</p>
                            </div>

                            <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                <label className="text-sm font-bold text-slate-700 block">Default Time Range KQL</label>
                                <div className="relative">
                                    <select
                                        value={config.defaultTimeRange}
                                        onChange={(e) => handleChange('defaultTimeRange', e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all appearance-none cursor-pointer"
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
                        </div>
                    )}

                </div>

                {/* Footer Actions — hidden on Products tab (products save through their own modal) */}
                {activeTab !== 'products' && (
                <div className="p-6 border-t border-white/50 bg-white/40 backdrop-blur-sm flex justify-between items-center gap-4">
                    <div className="flex items-center gap-2">
                        {saveSuccess && (
                            <span className="text-green-600 font-bold flex items-center animate-fade-in">
                                <CheckCircle2 className="w-5 h-5 mr-1" /> Settings Saved!
                            </span>
                        )}
                        {error && (
                            <span className="text-red-500 font-bold flex items-center animate-fade-in">
                                <AlertCircle className="w-5 h-5 mr-1" /> {error}
                            </span>
                        )}
                    </div>

                    <div className="flex gap-4">
                        <button
                            className="px-6 py-3 text-slate-500 font-semibold hover:text-slate-700 transition-colors disabled:opacity-50"
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

            <FileBrowserModal
                isOpen={showFileBrowser}
                onClose={() => setShowFileBrowser(false)}
                onSelect={handleFileSelect}
                mode={browserMode}
                title={browserMode === 'file' ? 'Select File' : 'Select Directory'}
                initialPath={browserTarget && config[browserTarget] ? config[browserTarget] as string : undefined}
            />

            {/* Product Add/Edit Modal */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-slate-800">
                                {editingProduct ? 'Edit Product' : 'Add Product'}
                            </h3>
                            <button
                                onClick={() => setShowProductModal(false)}
                                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
                            <div>
                                <label className="text-sm font-bold text-slate-700 block mb-2">Product Name</label>
                                <input
                                    type="text"
                                    value={productForm.name}
                                    onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                                    placeholder="e.g., Teleduct, MyService"
                                />
                            </div>
                            {/* Modal-level validation warning */}
                            {modalValidation && !modalValidation.valid && (
                                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                                    <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                                    <div className="text-sm text-red-700">
                                        <span className="font-semibold">Path issues detected.</span> Investigations cannot start until these are resolved. All paths must be absolute and exist on disk.
                                    </div>
                                </div>
                            )}
                            {([
                                { key: 'repoRoot', label: 'Repository Root', mode: 'directory' as const },
                                { key: 'systemPromptPath', label: 'System Prompt Path', mode: 'file' as const },
                                { key: 'retrospectPromptPath', label: 'Retrospect Prompt Path', mode: 'file' as const },
                                { key: 'knowledgeBasePath', label: 'Knowledge Base Path', mode: 'directory' as const },
                                { key: 'workingDirectory', label: 'Working Directory', mode: 'directory' as const },
                                { key: 'investigationsPath', label: 'Investigations Path', mode: 'directory' as const },
                                { key: 'icmScriptsPath', label: 'ICM Scripts Path', mode: 'directory' as const }
                            ] as const).map(({ key, label, mode }) => {
                                const pathError = modalValidation?.paths.find(p => p.field === key);
                                const hasError = pathError?.error;
                                return (
                                <div key={key}>
                                    <label className="text-sm font-bold text-slate-700 block mb-2">{label}</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={productForm[key]}
                                            onChange={(e) => {
                                                setProductForm(prev => ({ ...prev, [key]: e.target.value }));
                                                if (modalValidation) setModalValidation(null);
                                            }}
                                            className={`flex-1 px-4 py-3 rounded-xl border bg-white focus:ring-2 outline-none font-mono text-sm transition-colors ${
                                                hasError
                                                    ? 'border-red-400 focus:ring-red-300 bg-red-50/50'
                                                    : pathError && !hasError
                                                        ? 'border-green-400 focus:ring-green-300'
                                                        : 'border-slate-200 focus:ring-brand-500'
                                            }`}
                                            placeholder={`Path to ${label.toLowerCase()}`}
                                        />
                                        <button
                                            onClick={() => {
                                                setProductBrowserTarget(key);
                                                setBrowserMode(mode);
                                                setShowFileBrowser(true);
                                            }}
                                            className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all"
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
                        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowProductModal(false)}
                                className="px-6 py-3 text-slate-500 font-semibold hover:text-slate-700 transition-colors"
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
                    onSelect={(path) => {
                        if (productBrowserTarget) {
                            setProductForm(prev => ({ ...prev, [productBrowserTarget]: path }));
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
