import { useState, useEffect } from 'react';
import { Save, Cpu, Monitor, Layout, Activity, CheckCircle2, AlertCircle, FolderOpen, LayoutGrid, List } from 'lucide-react';
import { api } from '../api';
import { TIME_PRESETS } from '../constants';
import { FileBrowserModal } from '../components/FileBrowserModal';

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
        model: 'gpt-4-turbo',
        repoRoot: '',
        systemPromptPath: '',
        retrospectPromptPath: '',
        knowledgeBasePath: '',
        workingDirectory: '',
        investigationsPath: ''
    });

    useEffect(() => {
        loadSettings();
        loadModels();
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

                                {/* Agent Paths */}
                                <div className="bg-white/50 p-6 rounded-2xl border border-white/60 shadow-sm space-y-4">
                                    <label className="text-sm font-bold text-slate-700 block">Agent Paths</label>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Repository Root</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.repoRoot || ''}
                                                    onChange={(e) => handleChange('repoRoot', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="/path/to/your/repo"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('repoRoot', 'directory')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse Directory"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">Root of the repository. All relative paths are resolved from here.</p>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">System Prompt Path</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.systemPromptPath || ''}
                                                    onChange={(e) => handleChange('systemPromptPath', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="/path/to/Agent.md"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('systemPromptPath', 'file')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse File"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Retrospective Prompt Path</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.retrospectPromptPath || ''}
                                                    onChange={(e) => handleChange('retrospectPromptPath', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="/path/to/RetrospectPrompt.md"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('retrospectPromptPath', 'file')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse File"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">Template file for the retrospective analysis prompt. Supports {'{{GOAL}}'}, {'{{STATUS}}'}, {'{{STAMP}}'}, {'{{ISSUE_TYPE}}'}, {'{{KNOWLEDGE_BASE_FILES}}'} placeholders.</p>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Knowledge Base Path</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.knowledgeBasePath || ''}
                                                    onChange={(e) => handleChange('knowledgeBasePath', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="docs/investigations"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('knowledgeBasePath', 'directory')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse Directory"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">Repo-relative path to the knowledge base directory (investigation guides). Used by the retrospective for doc discovery.</p>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Working Directory</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.workingDirectory || ''}
                                                    onChange={(e) => handleChange('workingDirectory', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="/path/to/working/directory"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('workingDirectory', 'directory')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse Directory"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">Tools and scripts will execute relative to this directory.</p>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Investigation Storage Path</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={config.investigationsPath || ''}
                                                    onChange={(e) => handleChange('investigationsPath', e.target.value)}
                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all font-mono text-xs"
                                                    placeholder="/path/to/investigations"
                                                />
                                                <button
                                                    onClick={() => openFileBrowser('investigationsPath', 'directory')}
                                                    className="px-3 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-600 rounded-lg border border-slate-200 transition-colors"
                                                    title="Browse Directory"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">Directory where investigation data and logs are stored.</p>
                                        </div>
                                    </div>
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

                {/* Footer Actions */}
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
            </div>

            <FileBrowserModal
                isOpen={showFileBrowser}
                onClose={() => setShowFileBrowser(false)}
                onSelect={handleFileSelect}
                mode={browserMode}
                title={browserMode === 'file' ? 'Select File' : 'Select Directory'}
                initialPath={browserTarget && config[browserTarget] ? config[browserTarget] as string : undefined}
            />
        </div>
    );
};
