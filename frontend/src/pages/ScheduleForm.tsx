import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ScheduleDefinition } from '../types/schedule';
import type { Product } from '../types/product';
import { TIME_PRESETS, SCHEDULE_INTERVAL_PRESETS } from '../constants';
import {
    Clock, Command, AlertTriangle, ArrowRight, ArrowLeft, Sparkles, Zap,
    Target, CheckCircle2, AlertCircle, Calendar, Timer, Settings, Loader2, Package
} from 'lucide-react';

// ── Flexible timestamp parser (shared with NewInvestigation) ─────────

function parseFlexibleTimestamp(input: string): Date | null {
    if (!input || !input.trim()) return null;
    const trimmed = input.trim();

    let parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;

    const dashSlashFormat = trimmed.replace(
        /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
        (_, y, m, d, h, min, s) =>
            `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${s || '00'}`,
    );
    parsed = new Date(dashSlashFormat);
    if (!isNaN(parsed.getTime())) return parsed;

    const usFormatMatch = trimmed.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
    );
    if (usFormatMatch) {
        const [, month, day, year, hour, min, sec, ampm] = usFormatMatch;
        let h = parseInt(hour);
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
            if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
        }
        parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min), parseInt(sec || '0'));
        if (!isNaN(parsed.getTime())) return parsed;
    }

    if (/^\d{10,13}$/.test(trimmed)) {
        const ts = parseInt(trimmed);
        parsed = new Date(ts < 1e12 ? ts * 1000 : ts);
        if (!isNaN(parsed.getTime())) return parsed;
    }

    return null;
}

function toDateTimeLocalValue(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateDisplay(date: Date): string {
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

// ── Component ────────────────────────────────────────────────────────────

export const ScheduleForm = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;

    // Form state
    const [name, setName] = useState('');
    const [stamp, setStamp] = useState('');
    const [query, setQuery] = useState('');
    const [intervalMinutes, setIntervalMinutes] = useState(15);
    const [issueType, setIssueType] = useState('');

    // Time range
    const [timeMode, setTimeMode] = useState<'preset' | 'custom'>('preset');
    const [timePreset, setTimePreset] = useState('ago(1h)');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [startTimeText, setStartTimeText] = useState('');
    const [endTimeText, setEndTimeText] = useState('');
    const [startTimeValid, setStartTimeValid] = useState<boolean | null>(null);
    const [endTimeValid, setEndTimeValid] = useState<boolean | null>(null);

    // Data
    const [products, setProducts] = useState<Product[]>([]);
    const [productId, setProductId] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingData, setLoadingData] = useState(true);
    const [error, setError] = useState('');

    const startPickerRef = useRef<HTMLInputElement>(null);
    const endPickerRef = useRef<HTMLInputElement>(null);

    // Load products, models, and schedule (if editing)
    useEffect(() => {
        const load = async () => {
            try {
                const [prods, modelList] = await Promise.all([
                    api.listProducts(),
                    api.listModels(),
                ]);
                setProducts(prods);
                setModels(modelList);
                if (modelList.length > 0) setSelectedModel(modelList[0]);

                if (id) {
                    const schedules = await api.getSchedules();
                    const sched = schedules.find(s => s.id === id);
                    if (sched) {
                        setName(sched.name);
                        setStamp(sched.stamp);
                        setQuery(sched.query);
                        setIntervalMinutes(sched.intervalMinutes);
                        setProductId(sched.productId || '');
                        setIssueType(sched.issueType || '');

                        // Determine if the stored timeRange is a preset or custom
                        const isPreset = TIME_PRESETS.some(p => p.value === sched.timeRange);
                        if (isPreset) {
                            setTimeMode('preset');
                            setTimePreset(sched.timeRange || 'ago(1h)');
                        } else if (sched.timeRange) {
                            setTimeMode('preset');
                            setTimePreset(sched.timeRange);
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to load data:', err);
            } finally {
                setLoadingData(false);
            }
        };
        load();
    }, [id]);

    // Time parsing handlers (matching NewInvestigation)
    const handleStartTimeChange = (text: string) => {
        setStartTimeText(text);
        if (!text.trim()) {
            setStartTimeValid(null);
            setCustomStart('');
            return;
        }
        const parsed = parseFlexibleTimestamp(text);
        if (parsed) {
            setStartTimeValid(true);
            setCustomStart(toDateTimeLocalValue(parsed));
        } else {
            setStartTimeValid(false);
        }
    };

    const handleEndTimeChange = (text: string) => {
        setEndTimeText(text);
        if (!text.trim()) {
            setEndTimeValid(null);
            setCustomEnd('');
            return;
        }
        const parsed = parseFlexibleTimestamp(text);
        if (parsed) {
            setEndTimeValid(true);
            setCustomEnd(toDateTimeLocalValue(parsed));
        } else {
            setEndTimeValid(false);
        }
    };

    const handleStartPickerChange = (val: string) => {
        setCustomStart(val);
        if (val) {
            const d = new Date(val);
            setStartTimeText(formatDateDisplay(d));
            setStartTimeValid(true);
        }
    };

    const handleEndPickerChange = (val: string) => {
        setCustomEnd(val);
        if (val) {
            const d = new Date(val);
            setEndTimeText(formatDateDisplay(d));
            setEndTimeValid(true);
        }
    };

    // Compute the final timeRange value
    const getTimeRange = (): string => {
        if (timeMode === 'preset') return timePreset;
        if (customStart && customEnd) {
            return `${customStart}|${customEnd}`;
        }
        return 'ago(1h)';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !stamp.trim() || !query.trim()) {
            setError('Name, stamp, and query are required');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const data: Partial<ScheduleDefinition> = {
                name: name.trim(),
                stamp: stamp.trim(),
                query: query.trim(),
                intervalMinutes,
                productId: productId || undefined,
                timeRange: getTimeRange(),
                issueType: issueType || undefined,
            };
            if (isEdit) {
                await api.updateSchedule(id!, data);
            } else {
                await api.createSchedule(data);
            }
            navigate('/schedules');
        } catch (err: any) {
            setError(err.message || 'Failed to save schedule');
        } finally {
            setLoading(false);
        }
    };

    if (loadingData) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Header */}
            <div className="text-center space-y-2 pt-2">
                <h1 className="text-3xl font-black text-white tracking-tight">
                    {isEdit ? 'Edit Schedule' : 'Create Schedule'}
                </h1>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                    {isEdit
                        ? 'Update the configuration for this scheduled investigation'
                        : 'Set up a periodic automated investigation for your stamp'}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Product Selector — same position as NewInvestigation */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative">
                    <div className="p-4">
                        {products.length > 0 && (
                            <div className="flex items-center gap-3">
                                <Package className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-semibold text-slate-400">Product</span>
                                <select
                                    value={productId}
                                    onChange={(e) => setProductId(e.target.value)}
                                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                >
                                    <option value="">Default</option>
                                    {products.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Two-column grid: Target Scope + Time Window */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Section 1: Target Scope */}
                    <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-brand-900/30 rounded-lg text-brand-400">
                                    <Target className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Target Scope</h2>
                                </div>
                            </div>

                            <div className="space-y-3">
                                {/* Schedule Name */}
                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Sparkles className="w-3 h-3" /> Schedule Name
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. EUS2P-01 Health Check"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none text-sm shadow-sm"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </div>

                                {/* Stamp Name */}
                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Command className="w-3 h-3" /> Stamp Name
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. oi-tds-prd-eus2p-01"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={stamp}
                                        onChange={(e) => setStamp(e.target.value)}
                                    />
                                </div>

                                {/* Issue Type */}
                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <AlertTriangle className="w-3 h-3" /> Issue Type
                                    </label>
                                    <div className="relative">
                                        <select
                                            className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                            value={issueType}
                                            onChange={(e) => setIssueType(e.target.value)}
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
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Time Window */}
                    <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Time Window</h2>
                                </div>
                            </div>

                            <div className="bg-slate-800/50 p-1 rounded-lg flex gap-1 mb-2">
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('preset')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'preset'
                                        ? 'bg-slate-700 text-brand-400 shadow-sm ring-1 ring-white/10'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    Quick Preset
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('custom')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'custom'
                                        ? 'bg-slate-700 text-brand-400 shadow-sm ring-1 ring-white/10'
                                        : 'text-slate-400 hover:text-slate-200'
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
                                                ? 'bg-brand-900/20 border-brand-800 text-brand-300 ring-2 ring-brand-500 ring-offset-2 ring-offset-slate-900'
                                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-brand-300 hover:shadow-md'
                                            }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-4 animate-fade-in">
                                    {/* Start Time */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            Start Time (Local)
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 14:30, Mar 15 2024 2:30 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-slate-800 text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    startTimeValid === false
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-900/20'
                                                        : startTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-700 focus:ring-brand-500'
                                                }`}
                                                value={startTimeText}
                                                onChange={(e) => handleStartTimeChange(e.target.value)}
                                            />
                                            <input
                                                ref={startPickerRef}
                                                type="datetime-local"
                                                className="sr-only"
                                                value={customStart}
                                                onChange={(e) => handleStartPickerChange(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => startPickerRef.current?.showPicker()}
                                                className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                                title="Pick from calendar"
                                            >
                                                <Calendar className="w-5 h-5" />
                                            </button>
                                        </div>
                                        {startTimeValid === false && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> Invalid format. Try: YYYY-MM-DD HH:MM or MM/DD/YYYY HH:MM AM/PM
                                            </p>
                                        )}
                                        {startTimeValid === true && customStart && (
                                            <p className="text-xs text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatDateDisplay(new Date(customStart))}
                                            </p>
                                        )}
                                    </div>

                                    {/* End Time */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            End Time (Local)
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 16:00, Mar 15 2024 4:00 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-slate-800 text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    endTimeValid === false
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-900/20'
                                                        : endTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-700 focus:ring-brand-500'
                                                }`}
                                                value={endTimeText}
                                                onChange={(e) => handleEndTimeChange(e.target.value)}
                                            />
                                            <input
                                                ref={endPickerRef}
                                                type="datetime-local"
                                                className="sr-only"
                                                value={customEnd}
                                                onChange={(e) => handleEndPickerChange(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => endPickerRef.current?.showPicker()}
                                                className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                                title="Pick from calendar"
                                            >
                                                <Calendar className="w-5 h-5" />
                                            </button>
                                        </div>
                                        {endTimeValid === false && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> Invalid format. Try: YYYY-MM-DD HH:MM or MM/DD/YYYY HH:MM AM/PM
                                            </p>
                                        )}
                                        {endTimeValid === true && customEnd && (
                                            <p className="text-xs text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatDateDisplay(new Date(customEnd))}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Section 3: Schedule Configuration (Full Width) */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-transparent"></div>
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-emerald-900/30 rounded-lg text-emerald-400">
                                <Settings className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Schedule Configuration</h2>
                            </div>
                        </div>

                        {/* Interval presets */}
                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-emerald-500 transition-colors">
                                <Timer className="w-3 h-3" /> Run Interval
                            </label>
                            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                                {SCHEDULE_INTERVAL_PRESETS.map((preset) => (
                                    <button
                                        key={preset.value}
                                        type="button"
                                        onClick={() => setIntervalMinutes(preset.value)}
                                        className={`px-2 py-2 rounded-lg border text-xs font-bold transition-all ${intervalMinutes === preset.value
                                            ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300 ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-900'
                                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-300 hover:shadow-md'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>


                    </div>
                </div>

                {/* Section 4: Agent Configuration (Full Width) */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-transparent"></div>
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Agent Configuration</h2>
                            </div>
                        </div>

                        {/* Model selector */}
                        {models.length > 0 && (
                            <div className="space-y-2 group/input">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                    <Zap className="w-3 h-3" /> Selected Model
                                </label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
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
                        )}

                        {/* Investigation Query */}
                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                Investigation Query
                            </label>
                            <textarea
                                required
                                rows={4}
                                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm shadow-sm resize-none font-mono text-xs"
                                placeholder="Check this stamp for latency issues, batching fallback, and high dequeue count. Report a verdict."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* Footer Actions */}
                <div className="pt-4 pb-0 flex items-center gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/schedules')}
                        className="flex items-center gap-2 px-5 py-3 rounded-xl text-slate-400 hover:text-white text-sm font-bold transition-colors hover:bg-white/5"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className={`flex-1 group relative px-6 py-3 rounded-xl font-black text-white text-lg shadow-xl shadow-brand-500/30 transition-all transform hover:scale-[1.01] active:scale-95 overflow-hidden ring-4 ring-transparent hover:ring-brand-500/20 ${
                            loading
                                ? 'bg-slate-700 cursor-not-allowed'
                                : 'bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 hover:from-brand-500 hover:via-brand-400 hover:to-brand-300'
                        }`}
                    >
                        <div className="absolute inset-0 bg-white/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <span className="relative flex items-center justify-center gap-3">
                            {loading ? (
                                <>
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-6 h-6 animate-pulse" />
                                    {isEdit ? 'Update Schedule' : 'Create Schedule'}
                                </>
                            )}
                        </span>
                    </button>
                </div>
            </form>
        </div>
    );
};
