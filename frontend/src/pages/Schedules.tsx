import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { TIME_PRESETS } from '../constants';
import type { ScheduleDefinition, ScheduleHistoryEntry, ScheduleReport } from '../types/schedule';
import type { Product } from '../types/product';
import {
    Clock, Play, Pause, Plus, Trash2, Pencil, CheckCircle2, AlertTriangle,
    XCircle, Activity, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, Server, Timer,
    ExternalLink, Eye, EyeOff, Loader2, Check, X, Cpu, Calendar, Search, Copy,
    Zap, Shield, TrendingUp, TrendingDown, Minus, Sparkles, BarChart3, FileText, Power
} from 'lucide-react';
import { Pagination, DEFAULT_PAGE_SIZE } from '../components/Pagination';
import { useCountUp } from '../hooks/useCountUp';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Verdict helpers ──────────────────────────────────────────────────────

type Verdict = 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown' | 'running';

const verdictConfig: Record<Verdict, { label: string; color: string; bg: string; icon: React.ReactNode; dot: string; glow: string; border: string; gradient: string; ring: string }> = {
    healthy:   { label: 'Healthy',   color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/20', icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10', border: 'border-l-emerald-500', gradient: 'from-emerald-500/8 via-transparent to-transparent', ring: 'ring-emerald-500/20' },
    completed: { label: 'Completed', color: 'text-sky-400',     bg: 'bg-sky-500/15 border-sky-500/20',       icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-sky-400', glow: 'shadow-sky-500/10', border: 'border-l-sky-500', gradient: 'from-sky-500/8 via-transparent to-transparent', ring: 'ring-sky-500/20' },
    warning:   { label: 'Warning',   color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/20',   icon: <AlertTriangle className="w-4 h-4" />, dot: 'bg-amber-400', glow: 'shadow-amber-500/10', border: 'border-l-amber-500', gradient: 'from-amber-500/8 via-transparent to-transparent', ring: 'ring-amber-500/20' },
    critical:  { label: 'Critical',  color: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/20',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-400', glow: 'shadow-red-500/20', border: 'border-l-red-500', gradient: 'from-red-500/10 via-transparent to-transparent', ring: 'ring-red-500/25' },
    error:    { label: 'Error',    color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/15',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-300', glow: 'shadow-red-500/15', border: 'border-l-red-400', gradient: 'from-red-500/8 via-transparent to-transparent', ring: 'ring-red-500/20' },
    paused:   { label: 'Paused',   color: 'text-orange-400',  bg: 'bg-orange-500/15 border-orange-500/20', icon: <Pause className="w-4 h-4" />, dot: 'bg-orange-400', glow: 'shadow-orange-500/10', border: 'border-l-orange-500', gradient: 'from-orange-500/8 via-transparent to-transparent', ring: 'ring-orange-500/20' },
    running:  { label: 'Running',  color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/20',     icon: <Loader2 className="w-4 h-4 animate-spin" />, dot: 'bg-blue-400', glow: 'shadow-blue-500/15', border: 'border-l-blue-500', gradient: 'from-blue-500/10 via-transparent to-transparent', ring: 'ring-blue-500/25' },
    unknown:  { label: 'Pending',  color: 'text-slate-400',   bg: 'bg-slate-500/15 border-slate-500/20',   icon: <Clock className="w-4 h-4" />, dot: 'bg-slate-400', glow: '', border: 'border-l-slate-600', gradient: 'from-slate-500/5 via-transparent to-transparent', ring: '' },
};

// ── Component ────────────────────────────────────────────────────────────

export const Schedules = () => {
    const { confirm } = useToast();
    const navigate = useNavigate();
    const [schedules, setSchedules] = useState<ScheduleDefinition[]>([]);
    const [schedulesTotalCount, setSchedulesTotalCount] = useState(0);
    const [schedulesTotalPages, setSchedulesTotalPages] = useState(1);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [schedulerRunning, setSchedulerRunning] = useState(false);
    const [defaultMaxSteps, setDefaultMaxSteps] = useState(20);
    const [defaultModel, setDefaultModel] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [queryVisibleId, setQueryVisibleId] = useState<string | null>(null);
    const [historyMap, setHistoryMap] = useState<Record<string, ScheduleHistoryEntry[]>>({});
    const [reportMap, setReportMap] = useState<Record<string, ScheduleReport>>({});
    const [executiveModalId, setExecutiveModalId] = useState<string | null>(null);
    const [regeneratingReport, setRegeneratingReport] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editFields, setEditFields] = useState<{ model?: string; target?: string; timeRange?: string; category?: string }>({});
    const [timeRangePopupId, setTimeRangePopupId] = useState<string | null>(null);
    const [scheduleSearch, setScheduleSearch] = useState('');
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
            const [schedsResponse, status] = await Promise.all([
                api.getSchedules({ page: currentPage, pageSize }),
                api.getSchedulerStatus(),
            ]);
            setSchedules(schedsResponse.items);
            setSchedulesTotalCount(schedsResponse.totalCount);
            setSchedulesTotalPages(schedsResponse.totalPages);
            setCurrentPage(schedsResponse.page);
            setSchedulerRunning(status.running);
        } catch (err) {
            console.error('Failed to load schedules:', err);
        } finally {
            setLoading(false);
        }
    }, [currentPage, pageSize]);

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

    const loadHistory = useCallback(async (id: string) => {
        try {
            const entries = await api.getScheduleHistory(id, 100);
            setHistoryMap(prev => ({ ...prev, [id]: entries }));
        } catch { /* ignore */ }
    }, []);

    const loadReport = useCallback(async (id: string) => {
        try {
            const report = await api.getScheduleReport(id);
            setReportMap(prev => ({ ...prev, [id]: report }));
        } catch { /* ignore */ }
    }, []);

    // Auto-refresh history for the expanded card on same 15s cadence
    useEffect(() => {
        if (!expandedId) return;
        loadHistory(expandedId);
        loadReport(expandedId);
        const interval = setInterval(() => {
            loadHistory(expandedId);
            loadReport(expandedId);
        }, 15_000);
        return () => clearInterval(interval);
    }, [expandedId, loadHistory, loadReport]);

    const toggleExpand = (id: string) => {
        if (expandedId === id) {
            setExpandedId(null);
        } else {
            setExpandedId(id);
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
        if (expandedId === id) setExpandedId(null);
        await refresh();
        if (expandedId && expandedId !== id) loadHistory(expandedId);
    };

    const handleToggleEnabled = async (sched: ScheduleDefinition) => {
        if (sched.enabled) {
            await api.disableSchedule(sched.id);
        } else {
            await api.enableSchedule(sched.id);
        }
        await refresh();
        if (expandedId) loadHistory(expandedId);
    };

    const handleRunNow = async (id: string) => {
        await api.runScheduleNow(id);
        await refresh();
        if (expandedId) loadHistory(expandedId);
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
            await refresh();
            if (expandedId) loadHistory(expandedId);
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
        await refresh();
        if (expandedId) loadHistory(expandedId);
    };

    const handleClone = async (sched: ScheduleDefinition) => {
        try {
            await api.createSchedule({
                name: `${sched.name} (copy)`,
                target: sched.target,
                query: sched.query,
                intervalMinutes: sched.intervalMinutes,
                productId: sched.productId,
                model: sched.model,
                maxSteps: sched.maxSteps,
                timeRange: sched.timeRange,
                category: sched.category,
                enabled: false,
            });
            refresh();
        } catch (err) {
            console.error('Failed to clone schedule:', err);
        }
    };

    const filteredSchedules = useMemo(() => {
        if (!scheduleSearch) return schedules;
        const q = scheduleSearch.toLowerCase();
        return schedules.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.target.toLowerCase().includes(q) ||
            (s.query && s.query.toLowerCase().includes(q))
        );
    }, [schedules, scheduleSearch]);

    // Stat counts (computed from current page — acceptable for schedules which are typically small)
    const enabledCount = schedules.filter(s => s.enabled).length;
    const okCount = schedules.filter(s => s.lastVerdict === 'healthy' || s.lastVerdict === 'completed').length;
    const warningCount = schedules.filter(s => s.lastVerdict === 'warning' || s.lastVerdict === 'paused').length;
    const issueCount = schedules.filter(s => s.lastVerdict === 'critical' || s.lastVerdict === 'error').length;

    // Pagination — server provides the page, no client-side slicing needed

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
            {/* Live status indicator */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                schedulerRunning
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-slate-500 bg-slate-800/50'
            }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${schedulerRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                {schedulerRunning ? 'Live' : 'Off'}
            </div>
            <div className="w-px h-6 bg-slate-700/50" />
            <button
                onClick={toggleScheduler}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-all whitespace-nowrap ${
                    schedulerRunning
                        ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 hover:border-amber-500/30'
                        : 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 hover:border-emerald-500/30'
                }`}
            >
                {schedulerRunning
                    ? <><Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Stop</>
                    : <><Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Start</>}
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
                <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-white via-white to-slate-400 bg-clip-text text-transparent flex items-center gap-2.5">
                    <span>Scheduled Investigations</span>
                </h1>
                <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                    Periodic automated investigations running on your schedule
                    {schedulerRunning && schedulesTotalCount > 0 && (
                        <span className="ml-2 text-emerald-400/80 font-medium">
                            · {enabledCount} active schedule{enabledCount !== 1 ? 's' : ''} running
                        </span>
                    )}
                </p>
            </div>

            {/* Stats bar */}
            {schedulesTotalCount > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <StatCard label="Enabled" value={enabledCount} total={schedulesTotalCount} color="text-blue-400" icon={<Zap className="w-4 h-4 text-blue-500/60" />} accent="bg-blue-500" />
                    <StatCard label="OK" value={okCount} color="text-emerald-400" icon={<Shield className="w-4 h-4 text-emerald-500/60" />} accent="bg-emerald-500" />
                    <StatCard label="Warning" value={warningCount} color="text-amber-400" icon={<AlertTriangle className="w-4 h-4 text-amber-500/60" />} accent="bg-amber-500" />
                    <StatCard label="Issues" value={issueCount} color="text-red-400" icon={<XCircle className="w-4 h-4 text-red-500/60" />} accent="bg-red-500" />
                </div>
            )}

            {/* Schedule list */}
            {schedulesTotalCount === 0 ? (
                <div className="text-center py-24 bg-slate-900/40 rounded-2xl border border-slate-800/50 relative overflow-hidden">
                    {/* Decorative gradient */}
                    <div className="absolute inset-0 bg-gradient-to-b from-brand-500/[0.04] via-transparent to-transparent pointer-events-none" />
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.04),transparent_70%)] pointer-events-none" />
                    <div className="relative">
                        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700/40 flex items-center justify-center shadow-lg shadow-black/20">
                            <Sparkles className="w-9 h-9 text-brand-400/70" />
                        </div>
                        <h3 className="text-xl font-black text-white mb-2">No schedules yet</h3>
                        <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto leading-relaxed">
                            Create your first schedule to run automated investigations on a cadence.
                            Get continuous health monitoring across your stamps.
                        </p>
                        <button
                            onClick={() => navigate('/schedules/new')}
                            className="px-7 py-3.5 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Create Schedule</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {/* Search */}
                    <div className="relative group">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none group-focus-within:text-brand-400 transition-colors" />
                        <input
                            type="text"
                            value={scheduleSearch}
                            onChange={(e) => setScheduleSearch(e.target.value)}
                            placeholder="Search by name, stamp, or query..."
                            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-slate-700/50 bg-slate-900/60 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/30 focus:bg-slate-900/80 outline-none transition-all backdrop-blur-sm"
                        />
                        {scheduleSearch && (
                            <button onClick={() => setScheduleSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    {filteredSchedules.map((sched, idx) => {
                        const effectiveVerdict: Verdict = sched.activeInvestigationId ? 'running' : (sched.lastVerdict || 'unknown') as Verdict;
                        const vc = verdictConfig[effectiveVerdict];
                        const isExpanded = expandedId === sched.id;
                        const hist = historyMap[sched.id] || [];

                        return (
                            <div key={sched.id} className={`group/card relative rounded-2xl overflow-hidden border border-slate-800/50 border-l-[3px] ${vc.border} transition-all duration-300 animate-fade-in hover:border-slate-700/60 ${
                                vc.glow ? `shadow-md ${vc.glow}` : 'shadow-sm shadow-black/10 hover:shadow-lg hover:shadow-black/20'
                            }`}
                                style={{ animationDelay: `${Math.min(idx * 40, 200)}ms`, animationFillMode: 'forwards' }}
                            >
                                {/* Subtle gradient overlay from verdict color */}
                                <div className={`absolute inset-0 bg-gradient-to-r ${vc.gradient} pointer-events-none`} />
                                {/* Hover reveal gradient */}
                                <div className="absolute inset-0 bg-gradient-to-r from-white/[0.015] via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none" />
                                {/* Active indicator bar */}
                                {sched.activeInvestigationId && (
                                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
                                )}

                                {/* Main row */}
                                <div className="relative flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3.5 sm:py-4 cursor-pointer transition-colors" onClick={() => toggleExpand(sched.id)}>
                                    {/* Top line: arrow + dot + name + badge */}
                                    <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                                        {/* Expand arrow */}
                                        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : ''} text-slate-500 group-hover/card:text-slate-400`}>
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </div>

                                        {/* Verdict icon badge */}
                                        <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${vc.bg} ${sched.activeInvestigationId ? vc.ring + ' ring-2' : ''}`}>
                                            <span className={vc.color}>{vc.icon}</span>
                                            {sched.activeInvestigationId && (
                                                <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${vc.dot} animate-pulse ring-2 ring-slate-900`} />
                                            )}
                                        </div>

                                        {/* Name + stamp */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-white truncate group-hover/card:text-brand-300 transition-colors">{sched.name}</span>
                                                {!sched.enabled && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-700/60 text-slate-500 rounded uppercase tracking-wide">Disabled</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                                                <span className="flex items-center gap-1"><Server className="w-3 h-3" />{sched.target}</span>
                                                <span className="flex items-center gap-1"><Timer className="w-3 h-3" />Every {sched.intervalMinutes}m</span>
                                                {(sched.historyCount ?? 0) > 0 && (
                                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{sched.historyCount} run{sched.historyCount !== 1 ? 's' : ''}</span>
                                                )}
                                                {sched.productId && <span className="text-slate-600">· {productName(sched.productId)}</span>}
                                            </div>
                                        </div>

                                        {/* Verdict badge — pill style */}
                                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border shrink-0 ${vc.bg} ${vc.color} backdrop-blur-sm`}>
                                            {vc.icon}
                                            <span className="hidden xs:inline sm:inline">{vc.label}</span>
                                        </div>
                                    </div>

                                    {/* Bottom line on mobile: timing + actions */}
                                    <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4 pl-8 sm:pl-0">
                                        {/* Timing */}
                                        <div className="text-xs text-slate-500 sm:text-right sm:w-28">
                                            <div className="flex items-center gap-1 sm:justify-end">
                                                <Clock className="w-3 h-3 text-slate-600 hidden sm:block" />
                                                {getRelativeTime(sched.lastRunAt)}
                                            </div>
                                            {sched.enabled && sched.nextRunAt && (
                                                <div className="text-slate-600 mt-0.5">Next: {getNextRunIn(sched.nextRunAt)}</div>
                                            )}
                                        </div>

                                        {/* Actions — glass pill */}
                                        <div className="flex items-center gap-0.5 shrink-0 bg-slate-800/40 rounded-xl p-0.5 border border-slate-700/30 backdrop-blur-sm opacity-70 group-hover/card:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleRunNow(sched.id)} title="Run now" className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-all">
                                                <Play className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => handleToggleEnabled(sched)} title={sched.enabled ? 'Disable' : 'Enable'} className={`p-1.5 rounded-lg transition-all ${sched.enabled ? 'text-emerald-400 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'}`}>
                                                <Power className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => navigate(`/schedules/${sched.id}/edit`)} title="Edit" className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => handleClone(sched)} title="Clone" className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all">
                                                <Copy className="w-3.5 h-3.5" />
                                            </button>
                                            <div className="w-px h-4 bg-slate-700/40 mx-0.5" />
                                            <button onClick={() => handleDelete(sched.id)} title="Delete" className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div className="relative border-t border-slate-800/50 px-3 sm:px-5 py-5 bg-gradient-to-b from-slate-950/50 to-slate-900/30 space-y-5">
                                        {/* Query */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1.5">
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
                                                <p className="text-xs text-slate-300 bg-slate-800/50 rounded-xl p-3.5 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto border border-slate-700/30">{sched.query}</p>
                                            ) : (
                                                <p className="text-xs text-slate-400 bg-slate-800/40 rounded-xl px-3.5 py-2.5 truncate font-mono border border-slate-700/20">{sched.query}</p>
                                            )}
                                        </div>

                                        {/* Configuration */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-2.5">
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
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                                {/* Stamp */}
                                                <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
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
                                                <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20 relative">
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
                                                <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
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
                                                    <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
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
                                                    <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Activity className="w-3 h-3" /> Product</div>
                                                        <div className="text-xs text-slate-300">{productName(sched.productId)}</div>
                                                    </div>
                                                )}
                                                {/* Interval */}
                                                <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mb-0.5"><Timer className="w-3 h-3" /> Interval</div>
                                                    <div className="text-xs text-slate-300">Every {sched.intervalMinutes}m</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Latest investigation link */}
                                        {sched.lastInvestigationId && (
                                            <Link
                                                to={`/investigation/${sched.lastInvestigationId}`}
                                                className="inline-flex items-center gap-2 text-xs text-brand-400 hover:text-brand-300 transition-all bg-brand-500/5 hover:bg-brand-500/10 px-4 py-2 rounded-xl border border-brand-500/10 hover:border-brand-500/20 hover:shadow-sm shadow-brand-500/5 group/link"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5 group-hover/link:translate-x-0.5 transition-transform" />
                                                <span className="font-medium">View latest investigation</span>
                                            </Link>
                                        )}

                                        {/* Aggregated report */}
                                        {(() => {
                                            const report = reportMap[sched.id];
                                            if (!report || report.totalRuns === 0) return null;
                                            const trendIcon = report.trend === 'improving'
                                                ? <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                                                : report.trend === 'degrading'
                                                    ? <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                                                    : <Minus className="w-3.5 h-3.5 text-slate-500" />;
                                            const trendLabel = report.trend === 'improving' ? 'Improving' : report.trend === 'degrading' ? 'Degrading' : 'Stable';
                                            const trendColor = report.trend === 'improving' ? 'text-emerald-400' : report.trend === 'degrading' ? 'text-red-400' : 'text-slate-400';

                                            // Build ordered verdict bars
                                            const verdictOrder: Verdict[] = ['healthy', 'completed', 'warning', 'paused', 'error', 'critical', 'unknown'];
                                            const activeVerdicts = verdictOrder.filter(v => (report.verdictBreakdown[v] || 0) > 0);

                                            return (
                                                <div>
                                                    {/* Executive Summary — prominent CTA */}
                                                    <button
                                                        onClick={async () => {
                                                            setExecutiveModalId(sched.id);
                                                            setRegeneratingReport(true);
                                                            try {
                                                                const freshReport = await api.getScheduleReport(sched.id, true);
                                                                setReportMap(prev => ({ ...prev, [sched.id]: freshReport }));
                                                            } catch { /* ignore */ }
                                                            setRegeneratingReport(false);
                                                        }}
                                                        className="w-full mb-3 group/exec flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-brand-500/10 to-brand-400/5 border border-brand-500/20 hover:border-brand-500/40 hover:from-brand-500/15 hover:to-brand-400/10 transition-all"
                                                    >
                                                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500/15 text-brand-400 group-hover/exec:bg-brand-500/25 transition-colors">
                                                            <Sparkles className="w-4 h-4" />
                                                        </div>
                                                        <div className="flex-1 text-left">
                                                            <div className="text-xs font-bold text-slate-200 group-hover/exec:text-white transition-colors">Executive Summary</div>
                                                            <div className="text-[10px] text-slate-500">AI-generated insights &amp; recommendations</div>
                                                        </div>
                                                        <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover/exec:text-brand-400 transition-colors" />
                                                    </button>

                                                    <div className="flex items-center gap-2 mb-2.5">
                                                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                                            <BarChart3 className="w-3 h-3" /> Report
                                                        </div>
                                                    </div>
                                                    {/* Stats row */}
                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                                                        <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                            <div className="text-[10px] text-slate-500 mb-0.5">Total Runs</div>
                                                            <div className="text-lg font-black text-white tabular-nums">{report.totalRuns}</div>
                                                        </div>
                                                        <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                            <div className="text-[10px] text-slate-500 mb-0.5">Success Rate</div>
                                                            <div className={`text-lg font-black tabular-nums ${report.successRate >= 80 ? 'text-emerald-400' : report.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                                                {report.successRate}%
                                                            </div>
                                                        </div>
                                                        <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                            <div className="text-[10px] text-slate-500 mb-0.5">Trend</div>
                                                            <div className={`text-sm font-bold flex items-center gap-1.5 ${trendColor}`}>
                                                                {trendIcon} {trendLabel}
                                                            </div>
                                                        </div>
                                                        <div className="bg-slate-800/30 rounded-xl px-3 py-2.5 border border-slate-700/20">
                                                            <div className="text-[10px] text-slate-500 mb-0.5">Period</div>
                                                            <div className="text-xs text-slate-300">
                                                                {report.firstRunAt ? new Date(report.firstRunAt).toLocaleDateString() : '—'}
                                                                {' → '}
                                                                {report.lastRunAt ? new Date(report.lastRunAt).toLocaleDateString() : '—'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {/* Verdict breakdown chart */}
                                                    {activeVerdicts.length > 0 && (
                                                        <div className="mb-3 bg-slate-800/30 rounded-xl p-3 border border-slate-700/20">
                                                            <div className="flex items-end gap-1.5" style={{ height: 48 }}>
                                                                {activeVerdicts.map(v => {
                                                                    const count = report.verdictBreakdown[v];
                                                                    const maxCount = Math.max(...activeVerdicts.map(av => report.verdictBreakdown[av]));
                                                                    const heightPct = (count / maxCount) * 100;
                                                                    const evc = verdictConfig[v];
                                                                    return (
                                                                        <div key={v} className="flex-1 flex flex-col items-center gap-0.5" title={`${evc.label}: ${count}`}>
                                                                            <span className="text-[9px] font-bold text-slate-300 tabular-nums">{count}</span>
                                                                            <div className="w-full flex items-end" style={{ height: 32 }}>
                                                                                <div
                                                                                    className={`w-full rounded-t ${evc.dot} transition-all duration-300`}
                                                                                    style={{ height: `${Math.max(heightPct, 8)}%` }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            <div className="flex gap-1.5 mt-1.5">
                                                                {activeVerdicts.map(v => {
                                                                    const evc = verdictConfig[v];
                                                                    return (
                                                                        <div key={v} className="flex-1 text-center">
                                                                            <span className="text-[9px] text-slate-500 leading-none">{evc.label}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* History */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-2.5">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">History</div>
                                                <button onClick={() => loadHistory(sched.id)} className="text-slate-600 hover:text-slate-400 transition-colors">
                                                    <RefreshCw className="w-3 h-3" />
                                                </button>
                                            </div>
                                            {hist.length === 0 ? (
                                                <p className="text-xs text-slate-600 italic">No history yet</p>
                                            ) : (
                                                <div className="space-y-2.5">
                                                    {/* Compact dot summary — mini heatmap */}
                                                    <div className="flex gap-[3px] flex-wrap items-center bg-slate-800/30 rounded-xl p-2.5 border border-slate-700/20">
                                                        {hist.slice(-50).map((entry, i) => {
                                                            const evc = verdictConfig[entry.verdict];
                                                            return (
                                                                <Link
                                                                    key={i}
                                                                    to={`/investigation/${entry.investigationId}`}
                                                                    title={`${new Date(entry.timestamp).toLocaleString()} — ${evc.label}${entry.summary ? `: ${entry.summary.substring(0, 100)}` : ''}`}
                                                                    className={`w-3 h-3 rounded-[3px] ${evc.dot} opacity-70 hover:opacity-100 hover:scale-150 transition-all duration-150`}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Detailed list of recent entries */}
                                                    <div className="space-y-1 mt-2.5">
                                                        {hist.slice(-5).reverse().map((entry, i) => {
                                                            const evc = verdictConfig[entry.verdict];
                                                            return (
                                                                <Link
                                                                    key={i}
                                                                    to={`/investigation/${entry.investigationId}`}
                                                                    className="flex items-start sm:items-center gap-2.5 text-xs hover:bg-slate-800/50 rounded-xl px-3 py-2.5 sm:py-2 transition-all group/entry flex-wrap sm:flex-nowrap border border-transparent hover:border-slate-700/30 hover:shadow-sm"
                                                                >
                                                                    <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 sm:mt-0 ${evc.dot}`} />
                                                                    <span className={`font-semibold ${evc.color} min-w-[70px]`}>{evc.label}</span>
                                                                    <span className="text-slate-600 tabular-nums">{new Date(entry.timestamp).toLocaleString()}</span>
                                                                    {entry.summary && (
                                                                        <span className="text-slate-500 truncate flex-1">{entry.summary.substring(0, 80)}</span>
                                                                    )}
                                                                    <ExternalLink className="w-3 h-3 text-slate-600 opacity-0 group-hover/entry:opacity-100 transition-opacity shrink-0" />
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
            {schedulesTotalCount > 0 && (
                <Pagination
                    totalItems={schedulesTotalCount}
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

            {/* Executive Summary Modal */}
            {executiveModalId && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => { setExecutiveModalId(null); setRegeneratingReport(false); }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Executive Summary"
                >
                    <div
                        className="relative bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/30">
                            <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Executive Summary
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        setRegeneratingReport(true);
                                        try {
                                            const report = await api.getScheduleReport(executiveModalId!, true);
                                            setReportMap(prev => ({ ...prev, [executiveModalId!]: report }));
                                        } catch { /* ignore */ }
                                        setRegeneratingReport(false);
                                    }}
                                    disabled={regeneratingReport}
                                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Regenerate report using AI"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Regenerate
                                </button>
                                <button
                                    onClick={() => { setExecutiveModalId(null); setRegeneratingReport(false); }}
                                    className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800/50"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-5 prose prose-sm prose-invert max-w-none
                            prose-headings:text-slate-200 prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
                            prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                            prose-p:text-slate-400 prose-p:text-sm prose-p:leading-relaxed prose-p:my-2
                            prose-strong:text-slate-300
                            prose-table:text-sm prose-th:text-slate-400 prose-th:font-semibold prose-th:px-3 prose-th:py-1.5
                            prose-td:text-slate-400 prose-td:px-3 prose-td:py-1.5
                            prose-hr:border-slate-700/30 prose-hr:my-4
                            prose-blockquote:border-l-slate-600 prose-blockquote:text-slate-400 prose-blockquote:text-sm prose-blockquote:my-3
                            prose-em:text-slate-500
                            scrollbar-hidden"
                        >
                            {regeneratingReport ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                                    <p className="text-sm text-slate-500">Generating AI report...</p>
                                </div>
                            ) : reportMap[executiveModalId]?.executiveSummary ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {reportMap[executiveModalId]!.executiveSummary!}
                                </ReactMarkdown>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <p className="text-sm text-slate-500">No executive summary available.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}

        </div>
    );
};

// ── Stat card ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, total, color, icon, accent }: { label: string; value: number; total?: number; color: string; icon?: React.ReactNode; accent?: string }) => {
    const animValue = useCountUp(value);
    const animTotal = useCountUp(total ?? 0);

    return (
        <div className="bg-slate-900/60 border border-slate-800/50 rounded-xl px-4 py-3.5 relative overflow-hidden group hover:bg-slate-900/80 hover:border-slate-700/50 transition-all duration-200 hover:shadow-md hover:shadow-black/10">
            {/* Accent bar at top */}
            {accent && <div className={`absolute top-0 left-0 right-0 h-[2px] ${accent} opacity-40 group-hover:opacity-70 transition-opacity`} />}
            {/* Subtle background glow */}
            {accent && <div className={`absolute -top-8 -right-8 w-20 h-20 ${accent} opacity-[0.03] rounded-full blur-2xl group-hover:opacity-[0.06] transition-opacity`} />}
            <div className="relative flex items-center justify-between">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
                {icon && <div className="opacity-60 group-hover:opacity-90 transition-opacity">{icon}</div>}
            </div>
            <div className={`relative text-2xl font-black ${color} tabular-nums mt-0.5`}>
                {animValue}
                {total !== undefined && <span className="text-sm text-slate-600 font-medium">/{animTotal}</span>}
            </div>
        </div>
    );
};


