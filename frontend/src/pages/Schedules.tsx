import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { TIME_PRESETS } from '../constants';
import type { ScheduleDefinition, ScheduleHistoryEntry } from '../types/schedule';
import type { Product } from '../types/product';
import {
    Clock, Play, Pause, Plus, Trash2, Pencil, CheckCircle2, AlertTriangle,
    XCircle, Activity, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, Server, Timer,
    ExternalLink, Eye, EyeOff, Loader2, Check, X, Cpu, Calendar
} from 'lucide-react';
import { Pagination, DEFAULT_PAGE_SIZE } from '../components/Pagination';

// ── Verdict helpers ──────────────────────────────────────────────────────

type Verdict = 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown' | 'running';

const verdictConfig: Record<Verdict, { label: string; color: string; bg: string; icon: React.ReactNode; dot: string }> = {
    healthy:   { label: 'Healthy',   color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/20', icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-emerald-400' },
    completed: { label: 'Completed', color: 'text-sky-400',     bg: 'bg-sky-500/15 border-sky-500/20',       icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-sky-400' },
    warning:   { label: 'Warning',   color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/20',   icon: <AlertTriangle className="w-4 h-4" />, dot: 'bg-amber-400' },
    critical:  { label: 'Critical',  color: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/20',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-400' },
    error:    { label: 'Error',    color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/15',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-300' },
    paused:   { label: 'Paused',   color: 'text-orange-400',  bg: 'bg-orange-500/15 border-orange-500/20', icon: <Pause className="w-4 h-4" />, dot: 'bg-orange-400' },
    running:  { label: 'Running',  color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/20',     icon: <Loader2 className="w-4 h-4 animate-spin" />, dot: 'bg-blue-400' },
    unknown:  { label: 'Pending',  color: 'text-slate-400',   bg: 'bg-slate-500/15 border-slate-500/20',   icon: <Clock className="w-4 h-4" />, dot: 'bg-slate-400' },
};

// ── Component ────────────────────────────────────────────────────────────

export const Schedules = () => {
    const { confirm } = useToast();
    const navigate = useNavigate();
    const [schedules, setSchedules] = useState<ScheduleDefinition[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [schedulerRunning, setSchedulerRunning] = useState(false);
    const [defaultMaxSteps, setDefaultMaxSteps] = useState(20);
    const [defaultModel, setDefaultModel] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [queryVisibleId, setQueryVisibleId] = useState<string | null>(null);
    const [historyMap, setHistoryMap] = useState<Record<string, ScheduleHistoryEntry[]>>({});
    const [models, setModels] = useState<string[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editFields, setEditFields] = useState<{ model?: string; target?: string; timeRange?: string; category?: string }>({});
    const [timeRangePopupId, setTimeRangePopupId] = useState<string | null>(null);
    const timeRangePopupRef = useRef<HTMLDivElement>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(
        () => Number(localStorage.getItem('sched-page-size')) || DEFAULT_PAGE_SIZE
    );

    // Close time range popup on outside click
    useEffect(() => {
        if (!timeRangePopupId) return;
        const handler = (e: MouseEvent) => {
            if (timeRangePopupRef.current && !timeRangePopupRef.current.contains(e.target as Node)) {
                setTimeRangePopupId(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [timeRangePopupId]);

    const refresh = useCallback(async () => {
        try {
            const [scheds, status] = await Promise.all([
                api.getSchedules(),
                api.getSchedulerStatus(),
            ]);
            setSchedules(scheds);
            setSchedulerRunning(status.running);
        } catch (err) {
            console.error('Failed to load schedules:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
        api.listProducts().then(setProducts).catch(() => {});
        api.listModels().then(list => setModels(Array.from(new Set(list)))).catch(() => {});
        api.getSettings().then((s: any) => {
            if (s?.scheduledInvestigationMaxSteps) setDefaultMaxSteps(s.scheduledInvestigationMaxSteps);
            if (s?.model) setDefaultModel(s.model);
            if (!localStorage.getItem('sched-page-size') && typeof s?.defaultPageSize === 'number' && s.defaultPageSize > 0) {
                setPageSize(s.defaultPageSize);
                localStorage.setItem('sched-page-size', String(s.defaultPageSize));
            }
        }).catch(() => {});
        const interval = setInterval(refresh, 15_000);
        return () => clearInterval(interval);
    }, [refresh]);

    const loadHistory = async (id: string) => {
        try {
            const entries = await api.getScheduleHistory(id, 100);
            setHistoryMap(prev => ({ ...prev, [id]: entries }));
        } catch { /* ignore */ }
    };

    const toggleExpand = (id: string) => {
        if (expandedId === id) {
            setExpandedId(null);
        } else {
            setExpandedId(id);
            if (!historyMap[id]) loadHistory(id);
        }
    };

    const handleDelete = async (id: string) => {
        const ok = await confirm({
            title: 'Delete Schedule',
            message: 'This will permanently delete this schedule and all its history. Any active investigation will be aborted.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        await api.deleteSchedule(id);
        refresh();
    };

    const handleToggleEnabled = async (sched: ScheduleDefinition) => {
        if (sched.enabled) {
            await api.disableSchedule(sched.id);
        } else {
            await api.enableSchedule(sched.id);
        }
        refresh();
    };

    const handleRunNow = async (id: string) => {
        await api.runScheduleNow(id);
        refresh();
    };

    const startEditing = (sched: ScheduleDefinition) => {
        setEditingId(sched.id);
        setEditFields({ model: sched.model || '', target: sched.target, timeRange: sched.timeRange || 'ago(1h)', category: sched.category || '' });
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditFields({});
        setTimeRangePopupId(null);
    };

    const saveEditing = async (id: string) => {
        try {
            await api.updateSchedule(id, editFields);
            setEditingId(null);
            setEditFields({});
            refresh();
        } catch (err) {
            console.error('Failed to update schedule:', err);
        }
    };

    const toggleScheduler = async () => {
        if (schedulerRunning) {
            await api.stopScheduler();
        } else {
            await api.startScheduler();
        }
        refresh();
    };

    // Stat counts
    const enabledCount = schedules.filter(s => s.enabled).length;
    const okCount = schedules.filter(s => s.lastVerdict === 'healthy' || s.lastVerdict === 'completed').length;
    const warningCount = schedules.filter(s => s.lastVerdict === 'warning' || s.lastVerdict === 'paused').length;
    const issueCount = schedules.filter(s => s.lastVerdict === 'critical' || s.lastVerdict === 'error').length;

    // Pagination
    const totalPages = Math.max(1, Math.ceil(schedules.length / pageSize));
    useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
    const paginatedSchedules = useMemo(() => schedules.slice((currentPage - 1) * pageSize, currentPage * pageSize), [schedules, currentPage, pageSize]);

    const getRelativeTime = (iso?: string) => {
        if (!iso) return 'Never';
        const ms = Date.now() - new Date(iso).getTime();
        const min = Math.floor(ms / 60_000);
        if (min < 1) return 'just now';
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        return `${Math.floor(hr / 24)}d ago`;
    };

    const getNextRunIn = (iso: string) => {
        const ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'due now';
        const min = Math.ceil(ms / 60_000);
        if (min < 60) return `in ${min}m`;
        return `in ${Math.floor(min / 60)}h ${min % 60}m`;
    };

    const productName = (id: string) => {
        return products.find(p => p.id === id)?.name || id;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Activity className="w-6 h-6 text-brand-400 animate-pulse" />
            </div>
        );
    }

    const topDock = createPortal(
        <div className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-2.5 py-2 rounded-b-2xl bg-slate-900/80 backdrop-blur-xl border-b border-x border-white/[0.06] shadow-lg shadow-black/20 max-w-[calc(100vw-1rem)]">
            <button
                onClick={toggleScheduler}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-all whitespace-nowrap ${
                    schedulerRunning
                        ? 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 hover:border-emerald-500/30'
                        : 'text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] hover:border-white/[0.12]'
                }`}
            >
                {schedulerRunning
                    ? <><Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Stop Scheduler</>
                    : <><Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Start Scheduler</>}
            </button>
            <Link
                to="/schedules/new"
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-brand-600 hover:bg-brand-500 shadow-lg shadow-brand-500/20 hover:shadow-brand-500/30 transition-all whitespace-nowrap"
            >
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                New Schedule
            </Link>
        </div>,
        document.body
    );

    return (
        <div className="space-y-6 animate-fade-in">
            {topDock}

            {/* Header */}
            <div>
                <h1 className="text-2xl font-black text-white tracking-tight">Scheduled Investigations</h1>
                <p className="text-sm text-slate-400 mt-1">Periodic automated investigations that run on a schedule</p>
            </div>

            {/* Stats bar */}
            {schedules.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Enabled" value={enabledCount} total={schedules.length} color="text-blue-400" />
                    <StatCard label="OK" value={okCount} color="text-emerald-400" />
                    <StatCard label="Warning" value={warningCount} color="text-amber-400" />
                    <StatCard label="Issues" value={issueCount} color="text-red-400" />
                </div>
            )}

            {/* Schedule list */}
            {schedules.length === 0 ? (
                <div className="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800/50">
                    <Clock className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-white mb-1">No schedules yet</h3>
                    <p className="text-sm text-slate-400 mb-4">Create a schedule to periodically run investigations on your stamps</p>
                    <button
                        onClick={() => navigate('/schedules/new')}
                        className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-bold transition-colors"
                    >
                        Create Schedule
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {paginatedSchedules.map(sched => {
                        const effectiveVerdict: Verdict = sched.activeInvestigationId ? 'running' : (sched.lastVerdict || 'unknown') as Verdict;
                        const vc = verdictConfig[effectiveVerdict];
                        const isExpanded = expandedId === sched.id;
                        const hist = historyMap[sched.id] || [];

                        return (
                            <div key={sched.id} className={`bg-slate-900/60 rounded-2xl overflow-hidden ${
                                sched.lastVerdict === 'critical' || sched.lastVerdict === 'error'
                                    ? 'border-2 animate-flicker-red shadow-lg shadow-red-500/20'
                                    : 'border border-slate-800/50'
                            }`}>
                                {/* Main row */}
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 sm:py-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => toggleExpand(sched.id)}>
                                    {/* Top line: arrow + dot + name + badge */}
                                    <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                                        {/* Expand arrow */}
                                        <div className="text-slate-500 shrink-0">
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </div>

                                        {/* Verdict dot */}
                                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${vc.dot} ${sched.activeInvestigationId ? 'animate-pulse' : ''}`} />

                                        {/* Name + stamp */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-white truncate">{sched.name}</span>
                                                {!sched.enabled && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-700 text-slate-400 rounded">DISABLED</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                                                <span className="flex items-center gap-1"><Server className="w-3 h-3" />{sched.target}</span>
                                                <span className="flex items-center gap-1"><Timer className="w-3 h-3" />Every {sched.intervalMinutes}m</span>
                                                {sched.productId && <span className="text-slate-600">· {productName(sched.productId)}</span>}
                                            </div>
                                        </div>

                                        {/* Verdict badge */}
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shrink-0 ${vc.bg} ${vc.color}`}>
                                            {vc.icon}
                                            <span className="hidden xs:inline sm:inline">{vc.label}</span>
                                        </div>
                                    </div>

                                    {/* Bottom line on mobile: timing + actions */}
                                    <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4 pl-8 sm:pl-0">
                                        {/* Timing */}
                                        <div className="text-xs text-slate-500 sm:text-right sm:w-24">
                                            <div>Last: {getRelativeTime(sched.lastRunAt)}</div>
                                            {sched.enabled && sched.nextRunAt && (
                                                <div className="text-slate-600">Next: {getNextRunIn(sched.nextRunAt)}</div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleRunNow(sched.id)} title="Run now" className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                                <Play className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => handleToggleEnabled(sched)} title={sched.enabled ? 'Disable' : 'Enable'} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                                {sched.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                            </button>
                                            <button onClick={() => navigate(`/schedules/${sched.id}/edit`)} title="Edit" className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => handleDelete(sched.id)} title="Delete" className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div className="border-t border-slate-800/50 px-3 sm:px-4 py-3 bg-slate-950/30 space-y-3">
                                        {/* Query */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Query</div>
                                                <button
                                                    onClick={() => setQueryVisibleId(queryVisibleId === sched.id ? null : sched.id)}
                                                    className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                                                >
                                                    {queryVisibleId === sched.id
                                                        ? <><EyeOff className="w-3 h-3" /> Hide</>
                                                        : <><Eye className="w-3 h-3" /> View</>
                                                    }
                                                </button>
                                            </div>
                                            {queryVisibleId === sched.id ? (
                                                <p className="text-xs text-slate-300 bg-slate-800/50 rounded-lg p-3 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{sched.query}</p>
                                            ) : (
                                                <p className="text-xs text-slate-400 bg-slate-800/50 rounded-lg px-3 py-2 truncate font-mono">{sched.query}</p>
                                            )}
                                        </div>

                                        {/* Configuration */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Configuration</div>
                                                {editingId === sched.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <button onClick={() => saveEditing(sched.id)} className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                                                            <Check className="w-3 h-3" /> Save
                                                        </button>
                                                        <button onClick={cancelEditing} className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors ml-2">
                                                            <X className="w-3 h-3" /> Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => startEditing(sched)} className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors">
                                                        <Pencil className="w-3 h-3" /> Edit
                                                    </button>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {/* Stamp */}
                                                <div className="bg-slate-800/40 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Server className="w-3 h-3" /> Stamp</div>
                                                    {editingId === sched.id ? (
                                                        <input
                                                            type="text"
                                                            value={editFields.target || ''}
                                                            onChange={e => setEditFields(prev => ({ ...prev, target: e.target.value }))}
                                                            className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500/50"
                                                        />
                                                    ) : (
                                                        <div className="text-xs text-slate-300 truncate">{sched.target}</div>
                                                    )}
                                                </div>
                                                {/* Time Range */}
                                                <div className="bg-slate-800/40 rounded-lg px-3 py-2 relative">
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Calendar className="w-3 h-3" /> Time Range</div>
                                                    {editingId === sched.id ? (
                                                        <div className="relative">
                                                            <button
                                                                type="button"
                                                                onClick={() => setTimeRangePopupId(prev => prev === sched.id ? null : sched.id)}
                                                                className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-slate-200 text-left hover:border-brand-500/50 transition-colors flex items-center justify-between"
                                                            >
                                                                <span>{TIME_PRESETS.find(p => p.value === editFields.timeRange)?.label || editFields.timeRange}</span>
                                                                <ChevronDown className="w-3 h-3 text-slate-500" />
                                                            </button>
                                                            {timeRangePopupId === sched.id && (
                                                                <div ref={timeRangePopupRef} className="absolute z-50 top-full left-0 mt-1 w-56 bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto">
                                                                    {TIME_PRESETS.map(p => (
                                                                        <button
                                                                            key={p.value}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setEditFields(prev => ({ ...prev, timeRange: p.value }));
                                                                                setTimeRangePopupId(null);
                                                                            }}
                                                                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700/50 transition-colors ${
                                                                                editFields.timeRange === p.value ? 'text-brand-400 bg-brand-500/10' : 'text-slate-300'
                                                                            }`}
                                                                        >
                                                                            {p.label} <span className="text-slate-500 ml-1">{p.value}</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-slate-300">{sched.timeRange || 'ago(1h)'}</div>
                                                    )}
                                                </div>
                                                {/* Model */}
                                                <div className="bg-slate-800/40 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Cpu className="w-3 h-3" /> Model</div>
                                                    {editingId === sched.id ? (
                                                        models.length > 0 ? (
                                                            <select
                                                                value={editFields.model || ''}
                                                                onChange={e => setEditFields(prev => ({ ...prev, model: e.target.value }))}
                                                                className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500/50"
                                                            >
                                                                <option value="">Default</option>
                                                                {models.map(m => <option key={m} value={m}>{m}</option>)}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={editFields.model || ''}
                                                                onChange={e => setEditFields(prev => ({ ...prev, model: e.target.value }))}
                                                                className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500/50"
                                                            />
                                                        )
                                                    ) : (
                                                        <div className="text-xs text-slate-300">{sched.model || defaultModel || 'Default'}</div>
                                                    )}
                                                </div>
                                                {/* Issue Type */}
                                                {(sched.category || editingId === sched.id) && (
                                                    <div className="bg-slate-800/40 rounded-lg px-3 py-2">
                                                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Activity className="w-3 h-3" /> Issue Type</div>
                                                        {editingId === sched.id ? (
                                                            <select
                                                                value={editFields.category || ''}
                                                                onChange={e => setEditFields(prev => ({ ...prev, category: e.target.value }))}
                                                                className="w-full bg-slate-900/60 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500/50"
                                                            >
                                                                <option value="">Unknown / Discovery</option>
                                                                <option value="latency">Latency / Performance</option>
                                                                <option value="error">Error / Failure Rate</option>
                                                                <option value="throttling">Throttling / Quota</option>
                                                                <option value="data_loss">Data Loss / Inconsistency</option>
                                                                <option value="availability">Availability / Downtime</option>
                                                            </select>
                                                        ) : (
                                                            <div className="text-xs text-slate-300">{sched.category}</div>
                                                        )}
                                                    </div>
                                                )}
                                                {/* Product */}
                                                {sched.productId && (
                                                    <div className="bg-slate-800/40 rounded-lg px-3 py-2">
                                                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Activity className="w-3 h-3" /> Product</div>
                                                        <div className="text-xs text-slate-300">{productName(sched.productId)}</div>
                                                    </div>
                                                )}
                                                {/* Interval */}
                                                <div className="bg-slate-800/40 rounded-lg px-3 py-2">
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Timer className="w-3 h-3" /> Interval</div>
                                                    <div className="text-xs text-slate-300">Every {sched.intervalMinutes}m</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Latest investigation link */}
                                        {sched.lastInvestigationId && (
                                            <Link
                                                to={`/investigation/${sched.lastInvestigationId}`}
                                                className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                View latest investigation
                                            </Link>
                                        )}

                                        {/* History */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">History</div>
                                                <button onClick={() => loadHistory(sched.id)} className="text-slate-600 hover:text-slate-400">
                                                    <RefreshCw className="w-3 h-3" />
                                                </button>
                                            </div>
                                            {hist.length === 0 ? (
                                                <p className="text-xs text-slate-600">No history yet</p>
                                            ) : (
                                                <div className="space-y-1">
                                                    {/* Compact dot summary */}
                                                    <div className="flex gap-1 flex-wrap items-center">
                                                        {hist.slice(-50).map((entry, i) => {
                                                            const evc = verdictConfig[entry.verdict];
                                                            return (
                                                                <Link
                                                                    key={i}
                                                                    to={`/investigation/${entry.investigationId}`}
                                                                    title={`${new Date(entry.timestamp).toLocaleString()} — ${evc.label}${entry.summary ? `: ${entry.summary.substring(0, 100)}` : ''}`}
                                                                    className={`w-3.5 h-3.5 rounded-sm ${evc.dot} opacity-80 hover:opacity-100 hover:scale-125 transition-all`}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Detailed list of recent entries */}
                                                    <div className="space-y-0.5 mt-2">
                                                        {hist.slice(-5).reverse().map((entry, i) => {
                                                            const evc = verdictConfig[entry.verdict];
                                                            return (
                                                                <Link
                                                                    key={i}
                                                                    to={`/investigation/${entry.investigationId}`}
                                                                    className="flex items-start sm:items-center gap-2 text-xs hover:bg-slate-800/50 rounded-md px-2 py-1.5 sm:py-1 transition-colors group flex-wrap sm:flex-nowrap"
                                                                >
                                                                    <span className={`w-2 h-2 rounded-full shrink-0 ${evc.dot}`} />
                                                                    <span className={`font-semibold ${evc.color}`}>{evc.label}</span>
                                                                    <span className="text-slate-600">{new Date(entry.timestamp).toLocaleString()}</span>
                                                                    {entry.summary && (
                                                                        <span className="text-slate-500 truncate flex-1">{entry.summary.substring(0, 80)}</span>
                                                                    )}
                                                                    <ExternalLink className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                                                </Link>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {schedules.length > 0 && (
                <Pagination
                    totalItems={schedules.length}
                    currentPage={currentPage}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => {
                        setPageSize(size);
                        localStorage.setItem('sched-page-size', String(size));
                    }}
                    noun="schedules"
                />
            )}

        </div>
    );
};

// ── Stat card ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, total, color }: { label: string; value: number; total?: number; color: string }) => (
    <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl px-4 py-3">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
        <div className={`text-2xl font-black ${color}`}>
            {value}
            {total !== undefined && <span className="text-sm text-slate-600 font-medium">/{total}</span>}
        </div>
    </div>
);


