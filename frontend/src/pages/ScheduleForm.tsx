import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Tooltip } from '../components/Tooltip';
import type { SavedQuery } from '../api';
import type { ScheduleDefinition } from '../types/schedule';
import type { Product } from '../types/product';
import { TIME_PRESETS, SCHEDULE_INTERVAL_PRESETS } from '../constants';
import {
    Clock, Command, AlertTriangle, ArrowRight, ArrowLeft, Sparkles, Zap,
    Target, CheckCircle2, AlertCircle, Calendar, Timer, Settings, Loader2, Package,
    BookOpen, Save, Trash2, ChevronDown, X, Check, Pencil
} from 'lucide-react';

// ── Flexible timestamp parser (shared with NewInvestigation) ─────────

function parseFlexibleTimestamp(input: string): Date | null {
    const trimmed = input.trim();

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;

    // Format: "03/15/2024 2:30 PM" or "3/15/2024 14:30"
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
        const usParsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min), parseInt(sec || '0'));
        if (!isNaN(usParsed.getTime())) return usParsed;
    }

    if (/^\d{10,13}$/.test(trimmed)) {
        const ts = parseInt(trimmed);
        const tsParsed = new Date(ts < 1e12 ? ts * 1000 : ts);
        if (!isNaN(tsParsed.getTime())) return tsParsed;
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
    const { toast } = useToast();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;

    // Form state
    const [name, setName] = useState('');
    const [target, setTarget] = useState('');
    const [query, setQuery] = useState('');
    const [intervalMinutes, setIntervalMinutes] = useState(15);
    const [category, setCategory] = useState('');

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
    const [loadingData, setLoadingData] = useState(!!id); // only block render when editing (need to populate form)
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);

    const startPickerRef = useRef<HTMLInputElement>(null);
    const endPickerRef = useRef<HTMLInputElement>(null);

    // Warn before navigating away with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    // Query Bank state
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [loadedQueryId, setLoadedQueryId] = useState<string | null>(null);
    const [queryBankOpen, setQueryBankOpen] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saveQueryName, setSaveQueryName] = useState('');
    const [savingQuery, setSavingQuery] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const queryBankRef = useRef<HTMLDivElement>(null);

    // Load products, models, and schedule (if editing)
    useEffect(() => {
        // Fire independent calls in parallel — no blocking spinner for new schedules
        api.listProducts()
            .then(prods => setProducts(prods))
            .catch(err => console.error('Failed to load products:', err));

        api.listModels()
            .then(modelList => {
                setModels(Array.from(new Set(modelList)));
            })
            .catch(err => console.error('Failed to load models:', err));

        // Set defaults from settings (only for new schedules)
        if (!id) {
            api.getSettings()
                .then(settings => {
                    if (settings.model) setSelectedModel(settings.model);
                    if (settings.defaultTimeRange) setTimePreset(settings.defaultTimeRange);
                })
                .catch(err => console.error('Failed to load settings defaults:', err));
        }

        // Load saved queries (query bank)
        api.getSavedQueries()
            .then(queries => setSavedQueries(queries))
            .catch(err => console.error('Failed to load saved queries:', err));

        // If editing, load the schedule to populate form
        if (id) {
            api.getSchedules()
                .then(schedules => {
                    const sched = schedules.find(s => s.id === id);
                    if (sched) {
                        setName(sched.name);
                        setTarget(sched.target);
                        setQuery(sched.query);
                        setIntervalMinutes(sched.intervalMinutes);
                        setProductId(sched.productId || '');
                        setCategory(sched.category || '');
                        if (sched.model) setSelectedModel(sched.model);

                        // Determine if the stored timeRange is a preset or custom
                        const isPreset = TIME_PRESETS.some(p => p.value === sched.timeRange);
                        if (isPreset) {
                            setTimeMode('preset');
                            setTimePreset(sched.timeRange);
                        } else if (sched.timeRange) {
                            setTimeMode('preset');
                            setTimePreset(sched.timeRange);
                        }
                    }
                })
                .catch(err => console.error('Failed to load schedule:', err))
                .finally(() => setLoadingData(false));
        }
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
        if (!name.trim() || !target.trim() || !query.trim()) {
            setError('Name, target, and query are required');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const data: Partial<ScheduleDefinition> = {
                name: name.trim(),
                target: target.trim(),
                query: query.trim(),
                intervalMinutes,
                productId: productId || undefined,
                model: selectedModel || undefined,
                timeRange: getTimeRange(),
                category: category || undefined,
            };
            if (isEdit) {
                await api.updateSchedule(id!, data);
            } else {
                await api.createSchedule(data);
            }
            setDirty(false);
            navigate('/schedules');
        } catch (err: any) {
            setError(err.message || 'Failed to save schedule');
        } finally {
            setLoading(false);
        }
    };

    // Close query bank dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (queryBankRef.current && !queryBankRef.current.contains(e.target as Node)) {
                setQueryBankOpen(false);
            }
        };
        if (queryBankOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [queryBankOpen]);

    if (loadingData) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            </div>
        );
    }

    // ── Query Bank Handlers ───────────────────────────────────────────────

    const loadSavedQuery = (sq: SavedQuery) => {
        if (sq.target) setTarget(sq.target);
        if (sq.query) setQuery(sq.query);
        if (sq.category) setCategory(sq.category);
        if (sq.productId) setProductId(sq.productId);
        if (sq.model) setSelectedModel(sq.model);
        if (sq.intervalMinutes) setIntervalMinutes(sq.intervalMinutes);
        if (sq.timeMode === 'custom') {
            setTimeMode('custom');
            const match = sq.timeRange?.match(/datetime\(([^)]+)\)\s*\.\.\s*datetime\(([^)]+)\)/);
            if (match) {
                const startDate = new Date(match[1]);
                const endDate = new Date(match[2]);
                setCustomStart(toDateTimeLocalValue(startDate));
                setCustomEnd(toDateTimeLocalValue(endDate));
                setStartTimeText(formatDateDisplay(startDate));
                setEndTimeText(formatDateDisplay(endDate));
                setStartTimeValid(true);
                setEndTimeValid(true);
            }
        } else {
            setTimeMode('preset');
            if (sq.timeRange) setTimePreset(sq.timeRange);
        }
        setLoadedQueryId(sq.id);
        setQueryBankOpen(false);
    };

    const handleSaveToBank = async () => {
        const qName = saveQueryName.trim();
        setSavingQuery(true);
        try {
            let effectiveTimeRange = timePreset;
            let effectiveTimeMode: 'preset' | 'custom' = 'preset';
            if (timeMode === 'custom' && customStart && customEnd) {
                const startISO = new Date(customStart).toISOString();
                const endISO = new Date(customEnd).toISOString();
                effectiveTimeRange = `between(datetime(${startISO}) .. datetime(${endISO}))`;
                effectiveTimeMode = 'custom';
            }
            const payload = {
                name: qName,
                target: target || undefined,
                query: query || undefined,
                category: category || undefined,
                timeRange: effectiveTimeRange,
                timeMode: effectiveTimeMode,
                model: selectedModel || undefined,
                productId: productId || undefined,
                intervalMinutes: intervalMinutes,
            };
            let saved: SavedQuery;
            if (loadedQueryId) {
                saved = await api.updateSavedQuery(loadedQueryId, payload);
                setSavedQueries(prev => prev.map(q => q.id === saved.id ? saved : q));
            } else {
                saved = await api.createSavedQuery(payload);
                setSavedQueries(prev => [...prev, saved]);
            }
            setLoadedQueryId(saved.id);
            setSaveSuccess(saved.name);
            setShowSaveDialog(false);
            setSaveQueryName('');
            setTimeout(() => setSaveSuccess(null), 2500);
        } catch (err) {
            console.error('Failed to save query:', err);
            toast('error', 'Failed to save query to bank');
        } finally {
            setSavingQuery(false);
        }
    };

    const handleDeleteSavedQuery = async (qId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.deleteSavedQuery(qId);
            setSavedQueries(prev => prev.filter(q => q.id !== qId));
            if (loadedQueryId === qId) setLoadedQueryId(null);
        } catch (err) {
            console.error('Failed to delete saved query:', err);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Breadcrumbs */}
            <Breadcrumbs crumbs={[
                { label: 'Dashboard', to: '/' },
                { label: 'Schedules', to: '/schedules' },
                { label: isEdit ? 'Edit Schedule' : 'New Schedule' },
            ]} />

            {/* Header */}
            <div className="text-center space-y-2 pt-2">
                <h1 className="text-3xl font-black text-white tracking-tight">
                    {isEdit ? 'Edit Schedule' : 'Create Schedule'}
                </h1>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                    {isEdit
                        ? 'Update the configuration for this scheduled investigation'
                        : 'Set up a periodic automated investigation for your target'}
                </p>
            </div>

            {/* Query Bank + Product side by side */}
            <div className="flex gap-4 items-stretch relative z-10">
            {/* Query Bank Bar */}
            <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] flex-1">
                <div className="px-4 py-3 flex items-center gap-3">
                    <div className="flex items-center gap-2 text-slate-400">
                        <BookOpen className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Query Bank</span>
                    </div>

                    {/* Load dropdown */}
                    <div className="relative flex-1" ref={queryBankRef}>
                        <button
                            type="button"
                            onClick={() => setQueryBankOpen(!queryBankOpen)}
                            className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg border text-sm transition-all outline-none ${
                                loadedQueryId
                                    ? 'border-brand-500/40 bg-brand-900/20 text-brand-300'
                                    : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                            }`}
                        >
                            <span className="truncate">
                                {loadedQueryId
                                    ? savedQueries.find(q => q.id === loadedQueryId)?.name || 'Loaded query'
                                    : savedQueries.length > 0
                                        ? `Select a saved query (${savedQueries.length})`
                                        : 'No saved queries yet'
                                }
                            </span>
                            <ChevronDown className={`w-4 h-4 shrink-0 ml-2 transition-transform ${queryBankOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Dropdown */}
                        {queryBankOpen && (
                            <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto animate-fade-in">
                                {savedQueries.length === 0 ? (
                                    <div className="px-4 py-3 text-center">
                                        <p className="text-sm text-slate-500">No saved queries yet</p>
                                        <p className="text-xs text-slate-600 mt-1">Fill out the form below, then click <strong className="text-slate-400">Save</strong> to store it as a reusable template.</p>
                                    </div>
                                ) : (
                                    savedQueries.map(sq => (
                                        <div
                                            key={sq.id}
                                            onClick={() => loadSavedQuery(sq)}
                                            className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors hover:bg-slate-700/60 group ${
                                                loadedQueryId === sq.id ? 'bg-brand-900/20' : ''
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
                                                    {sq.name}
                                                    {loadedQueryId === sq.id && <Check className="w-3.5 h-3.5 text-brand-400" />}
                                                </div>
                                                <div className="text-[11px] text-slate-400 truncate">
                                                    {[sq.target, sq.category, sq.timeRange].filter(Boolean).join(' \u00b7 ') || 'No details'}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteSavedQuery(sq.id, e)}
                                                className="p-1 rounded-md opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all"
                                                title="Delete saved query"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Clear loaded query */}
                    {loadedQueryId && (
                        <button
                            type="button"
                            onClick={() => setLoadedQueryId(null)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
                            title="Clear loaded query"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save button */}
                    <div className="relative">
                        {saveSuccess ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-900/20 border border-green-500/30 text-green-400 text-xs font-bold animate-fade-in">
                                <Check className="w-3.5 h-3.5" />
                                Saved
                            </div>
                        ) : showSaveDialog ? (
                            <div className="flex items-center gap-2 animate-fade-in">
                                <input
                                    type="text"
                                    placeholder={loadedQueryId ? savedQueries.find(q => q.id === loadedQueryId)?.name || 'Query name' : 'Query name'}
                                    className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 w-48"
                                    value={saveQueryName}
                                    onChange={(e) => setSaveQueryName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveToBank(); } if (e.key === 'Escape') setShowSaveDialog(false); }}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={handleSaveToBank}
                                    disabled={savingQuery || !saveQueryName.trim()}
                                    className="p-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    title="Confirm save"
                                >
                                    {savingQuery ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setShowSaveDialog(false); setSaveQueryName(''); }}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    if (loadedQueryId) {
                                        const existing = savedQueries.find(q => q.id === loadedQueryId);
                                        setSaveQueryName(existing?.name || '');
                                    }
                                    setShowSaveDialog(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-300 hover:text-white hover:border-slate-600 text-xs font-bold transition-all"
                                title={loadedQueryId ? 'Update saved query with current form values' : 'Save current form (target, Category, time range, query, model) as a reusable template'}
                            >
                                {loadedQueryId ? <Pencil className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                                {loadedQueryId ? 'Update' : 'Save'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Product Selector */}
            {products.length > 0 && (
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] flex items-center px-4 py-3 gap-3">
                    <Package className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 shrink-0">Product</span>
                    <select
                        value={productId}
                        onChange={(e) => setProductId(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all min-w-[180px]"
                    >
                        <option value="">Default</option>
                        {products.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}
            </div>

            <form onSubmit={handleSubmit} onChange={() => setDirty(true)} className="space-y-4">
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
                                    <label htmlFor="sched-name" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Sparkles className="w-3 h-3" /> Schedule Name <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        id="sched-name"
                                        type="text"
                                        required
                                        placeholder="e.g. EUS2P-01 Health Check"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none text-sm shadow-sm"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </div>

                                {/* target Name */}
                                <div className="space-y-2 group/input">
                                    <label htmlFor="sched-target" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Command className="w-3 h-3" /> Target Name <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        id="sched-target"
                                        type="text"
                                        required
                                        placeholder="e.g. my-service-prod-01"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={target}
                                        onChange={(e) => setTarget(e.target.value)}
                                    />
                                </div>

                                {/* Category */}
                                <div className="space-y-2 group/input">
                                    <label htmlFor="sched-category" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <AlertTriangle className="w-3 h-3" /> Category
                                    </label>
                                    <div className="relative">
                                        <select
                                            id="sched-category"
                                            className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value)}
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
                            <label htmlFor="sched-query" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                Investigation Query <span className="text-red-400">*</span>
                            </label>
                            <textarea
                                id="sched-query"
                                required
                                rows={4}
                                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm shadow-sm resize-none font-mono text-xs"
                                placeholder="Check this target for latency issues, batching fallback, and high dequeue count. Report a verdict."
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
