import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Search, Command, Clock, AlertTriangle, ArrowRight, Sparkles, Zap, Target } from 'lucide-react';
import { TIME_PRESETS } from '../constants';

export const NewInvestigation = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [models, setModels] = useState<string[]>([]);

    // Time Range State
    const [timeMode, setTimeMode] = useState<'preset' | 'custom'>('preset');
    const [timePreset, setTimePreset] = useState('ago(1h)');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const [formData, setFormData] = useState({
        stamp: '',
        trackingId: '',
        issueType: '',
        query: '',
        model: 'gpt-4o'
    });

    useEffect(() => {
        // Load models and deduplicate
        api.listModels()
            .then(data => setModels(Array.from(new Set(data))))
            .catch(() => setModels(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']));

        // Load default model and time range from settings
        api.getSettings().then(settings => {
            if (settings.model) {
                setFormData(prev => ({ ...prev, model: settings.model }));
            }
            if (settings.defaultTimeRange) {
                setTimePreset(settings.defaultTimeRange);
            }
        }).catch(err => console.error("Failed to load settings:", err));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        // Construct effective time range
        let effectiveTimeRange = timePreset;
        if (timeMode === 'custom') {
            if (!customStart || !customEnd) {
                alert("Please select both start and end times for custom range.");
                setLoading(false);
                return;
            }
            if (new Date(customStart) >= new Date(customEnd)) {
                alert("Start time must be before end time.");
                setLoading(false);
                return;
            }
            const startISO = new Date(customStart).toISOString();
            const endISO = new Date(customEnd).toISOString();
            // Format as KQL-friendly range description
            effectiveTimeRange = `between(datetime(${startISO}) .. datetime(${endISO}))`;
        }

        try {
            const payload = {
                ...formData,
                timeRange: effectiveTimeRange
            };
            const result = await api.startInvestigation(payload);
            navigate(`/investigation/${result.id}`);
        } catch (error) {
            console.error('Failed to start:', error);
            alert('Failed to start investigation');
        } finally {
            setLoading(false);
        }
    };



    return (
        <div className="max-w-5xl mx-auto space-y-4 animate-fade-in pb-8">
            {/* Header */}
            <div className="text-center space-y-1">
                <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 dark:from-brand-400 dark:via-brand-300 dark:to-brand-200 drop-shadow-sm">
                    Initiate Investigation
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                    Launch a new AI-driven telemetry analysis session.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Section 1: Target Scope */}
                    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg text-brand-600 dark:text-brand-400">
                                    <Target className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Target Scope</h2>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Command className="w-3 h-3" /> Stamp Name
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. my-app-prd-eus2-01"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.stamp}
                                        onChange={(e) => setFormData({ ...formData, stamp: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <AlertTriangle className="w-3 h-3" /> Issue Type
                                    </label>
                                    <div className="relative">
                                        <select
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                            value={formData.issueType}
                                            onChange={(e) => setFormData({ ...formData, issueType: e.target.value })}
                                        >
                                            <option value="">Unknown / Discovery</option>
                                            <option value="latency">Latency / Performance</option>
                                            <option value="error">Error / Failure Rate</option>
                                            <option value="throttling">Throttling / Quota</option>
                                            <option value="data_loss">Data Loss / Inconsistency</option>
                                            <option value="availability">Availability / Downtime</option>
                                        </select>
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <ArrowRight className="w-4 h-4 rotate-90" />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Search className="w-3 h-3" /> Tracking ID (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Correlation ID, Request ID, or Incident GUID"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.trackingId}
                                        onChange={(e) => setFormData({ ...formData, trackingId: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Time Window */}
                    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Time Window</h2>
                                </div>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/50 p-1 rounded-lg flex gap-1 mb-2">
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('preset')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'preset'
                                        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                        }`}
                                >
                                    Quick Preset
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('custom')}
                                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${timeMode === 'custom'
                                        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                        }`}
                                >
                                    Custom Range
                                </button>
                            </div>

                            {timeMode === 'preset' ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {TIME_PRESETS.map((preset) => (
                                        <button
                                            key={preset.value}
                                            type="button"
                                            onClick={() => setTimePreset(preset.value)}
                                            className={`px-2 py-2 rounded-lg border text-xs font-bold transition-all ${timePreset === preset.value
                                                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-slate-900'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-300 hover:shadow-md'
                                                }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            Start Time (Local)
                                        </label>
                                        <input
                                            type="datetime-local"
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none transition-all shadow-sm"
                                            value={customStart}
                                            onChange={(e) => setCustomStart(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            End Time (Local)
                                        </label>
                                        <input
                                            type="datetime-local"
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none transition-all shadow-sm"
                                            value={customEnd}
                                            onChange={(e) => setCustomEnd(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Section 3: Agent Configuration (Full Width) */}
                <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-transparent"></div>
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Agent Configuration</h2>
                            </div>
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                <Zap className="w-3 h-3" /> Selected Model
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                >
                                    {models.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                    <ArrowRight className="w-4 h-4 rotate-90" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                Additional Context / Query
                            </label>
                            <textarea
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm shadow-sm"
                                placeholder="Describe the issue symptoms, specific errors observed, or any hypotheses you have..."
                                value={formData.query}
                                onChange={(e) => setFormData({ ...formData, query: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="pt-4 pb-0">
                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full group relative px-6 py-3 rounded-xl font-black text-white text-lg shadow-xl shadow-brand-500/30 transition-all transform hover:scale-[1.01] active:scale-95 overflow-hidden ring-4 ring-transparent hover:ring-brand-500/20 ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 hover:from-brand-500 hover:via-brand-400 hover:to-brand-300'
                            }`}
                    >
                        <div className="absolute inset-0 bg-white/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <span className="relative flex items-center justify-center gap-3">
                            {loading ? (
                                <>
                                    <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    Initializing Agent...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-6 h-6 animate-pulse" />
                                    Start Investigation
                                </>
                            )}
                        </span>
                    </button>
                    <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
                        By starting an investigation, you agree to the usage of AI for telemetry analysis.
                    </p>
                </div>
            </form>
        </div>
    );
};
