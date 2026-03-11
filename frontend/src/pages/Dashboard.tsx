import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Investigation } from '../api';
import { Play, Pause, Activity, CheckCircle2, XCircle, Clock, Search, FileText, ChevronRight, Timer, Pencil, Server, Trash2, Ban, LayoutGrid, Sparkles, List, ArrowDownUp, TrendingUp, Copy, CheckCheck, X, Pin, AlertTriangle, ShieldAlert, Package, BarChart3, ChevronDown, RotateCcw, RefreshCw } from 'lucide-react';
import { InvestigationTrend } from '../components/charts/InvestigationTrend';
import { IssueTypeDonut } from '../components/charts/IssueTypeDonut';
import { DurationDistribution } from '../components/charts/DurationDistribution';

/** Mini 5-segment step depth bar */
const StepBar = ({ count, color }: { count: number; color: string }) => {
    const filled = Math.min(5, Math.round((count / 20) * 5));
    return (
        <div className="flex items-center gap-0.5" title={`${count} steps`}>
            {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i < filled ? color : 'bg-slate-700'} ${i < filled ? 'w-3' : 'w-2'}`} />
            ))}
        </div>
    );
};

const DurationTimer = ({ startTime, pausedAt, totalPausedTime }: { startTime: number; pausedAt?: number; totalPausedTime?: number }) => {
    const [duration, setDuration] = useState('');

    useEffect(() => {
        const update = () => {
            const end = pausedAt || Date.now();
            const diff = Math.floor((end - startTime - (totalPausedTime || 0)) / 1000);
            const clamped = Math.max(0, diff);

            const hours = Math.floor(clamped / 3600);
            const minutes = Math.floor((clamped % 3600) / 60);
            const seconds = clamped % 60;

            if (hours > 0) {
                setDuration(`${hours}h ${minutes}m ${seconds}s`);
            } else if (minutes > 0) {
                setDuration(`${minutes}m ${seconds}s`);
            } else {
                setDuration(`${seconds}s`);
            }
        };
        update();
        const interval = pausedAt ? undefined : setInterval(update, 1000);
        return () => { if (interval) clearInterval(interval); };
    }, [startTime, pausedAt, totalPausedTime]);

    return <span className="font-mono">{duration}</span>;
};

/** Animated count-up from 0 to target - plays once on first non-zero value */
const useCountUp = (target: number, duration = 700) => {
    const [display, setDisplay] = useState(0);
    const seenNonZero = useRef(false);
    const rafRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (seenNonZero.current) {
            // Post-animation: schedule update via rAF to avoid synchronous setState in effect
            rafRef.current = requestAnimationFrame(() => setDisplay(target));
            return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
        }
        if (target === 0) return;
        seenNonZero.current = true;
        let start: number | null = null;
        const step = (ts: number) => {
            if (start === null) start = ts;
            const p = Math.min((ts - start) / duration, 1);
            setDisplay(Math.round(p * target));
            if (p < 1) rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
        return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
    }, [target, duration]);
    return display;
};

/** Shorten a timeRange string for compact display */
const formatTimeRange = (tr: string): string => {
    if (!tr) return '';
    const ago = tr.match(/ago\((\d+)([smhd])\)/);
    if (ago) { const units: Record<string, string> = { s: 's', m: 'm', h: 'h', d: 'd' }; return `last ${ago[1]}${units[ago[2]] ?? ago[2]}`; }
    const between = tr.match(/between\(datetime\((.+?)\)\s*\.\.\s*datetime\((.+?)\)\)/);
    if (between) {
        const fmt = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
        return `${fmt(between[1])} - ${fmt(between[2])}`;
    }
    return tr.length > 24 ? tr.slice(0, 24) + '...' : tr;
};

/** Highlights the first occurrence of `term` inside `text` */
const Highlight = ({ text, term }: { text: string; term: string }) => {
    if (!term || !text) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return <>{text}</>;
    return (
        <>
            {text.slice(0, idx)}
            <mark className="bg-brand-500/20 text-brand-300 rounded px-0.5 not-italic font-bold">{text.slice(idx, idx + term.length)}</mark>
            {text.slice(idx + term.length)}
        </>
    );
};

type Toast = { key: number; invId: string; invTitle: string; type: 'completed' | 'failed' };
let _toastKey = 0;

// Module-level storage for stale detection so it persists across navigation.
// If this were inside a useRef, it would reset every time the Dashboard
// unmounts (e.g. user clicks into an investigation and comes back), causing
// every running investigation to appear non-stale for another 5 minutes.
const _thoughtActivity: Record<string, { count: number; seenAt: number }> = {};

export const Dashboard = () => {
    const [investigations, setInvestigations] = useState<Investigation[]>([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'>('all');
    const [productFilter, setProductFilter] = useState<string>('all');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
        (localStorage.getItem('inv-view') as 'grid' | 'list') ?? 'grid'
    );
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'steps'>('newest');
    const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [copiedTrackingId, setCopiedTrackingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [pinnedIds, setPinnedIds] = useState<Set<string>>(
        () => new Set(JSON.parse(localStorage.getItem('inv-pinned') || '[]'))
    );
    const prevStatusRef = useRef<Record<string, string>>({});
    const lastThoughtActivityRef = useRef(_thoughtActivity);
    const searchRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [groupByStamp, setGroupByStamp] = useState(false);
    const [resumingAll, setResumingAll] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [showAnalytics, setShowAnalytics] = useState<boolean>(
        () => localStorage.getItem('inv-analytics') !== 'false'
    );

    const toggleAnalytics = () => {
        setShowAnalytics(prev => {
            localStorage.setItem('inv-analytics', String(!prev));
            return !prev;
        });
    };

    const handleResumeAll = async () => {
        setResumingAll(true);
        try {
            const result = await api.resumeAll();
            // Optimistically update resumed investigations to 'running'
            if (result.ids.length > 0) {
                const resumedSet = new Set(result.ids);
                setInvestigations(prev => prev.map(inv =>
                    resumedSet.has(inv.id) ? { ...inv, status: 'running' as Investigation['status'] } : inv
                ));
            }
            if (result.skipped > 0) {
                console.log(`Resume-all: ${result.resumed} resumed, ${result.skipped} skipped (concurrency limit)`);
            }
        } catch (err) {
            console.error('Resume all failed:', err);
        } finally {
            setResumingAll(false);
        }
    };

    const handleRestartServer = async () => {
        if (!confirm('Restart the server? All running investigations will be paused and can be resumed after restart.')) return;
        setRestarting(true);
        try {
            await api.restartServer();
        } catch {
            // Expected — server shuts down, connection drops
        }
        // Poll until server comes back
        const pollInterval = setInterval(async () => {
            try {
                await api.listInvestigations();
                clearInterval(pollInterval);
                setRestarting(false);
                // Refresh investigation list after restart
                const data = await api.listInvestigations();
                setInvestigations(data);
            } catch {
                // Server still down, keep polling
            }
        }, 1000);
        // Safety timeout — stop polling after 30s
        setTimeout(() => {
            clearInterval(pollInterval);
            setRestarting(false);
        }, 30000);
    };

    const dismissToast = (key: number) => setToasts(t => t.filter(x => x.key !== key));

    const addToast = (inv: Investigation, type: Toast['type']) => {
        const t: Toast = { key: ++_toastKey, invId: inv.id, invTitle: inv.title || inv.query || `#${inv.id}`, type };
        setToasts(prev => [...prev.slice(-4), t]); // keep at most 5
        setTimeout(() => dismissToast(t.key), 7000);
    };

    useEffect(() => {
        const fetchData = () => api.listInvestigations().then(data => {
            const prev = prevStatusRef.current;
            const lta  = lastThoughtActivityRef.current;
            data.forEach(inv => {
                // Toast on status change
                const was = prev[inv.id];
                if (was && was !== inv.status) {
                    if (inv.status === 'completed') addToast(inv, 'completed');
                    if (inv.status === 'failed')    addToast(inv, 'failed');
                }
                prev[inv.id] = inv.status;
                // Stale detection: use actual thoughtCount from API (list endpoint
                // only returns the last thought for preview, so .length is always 0|1)
                const count = inv.thoughtCount ?? inv.thoughts?.length ?? 0;
                if (!lta[inv.id] || lta[inv.id].count !== count) {
                    lta[inv.id] = { count, seenAt: Date.now() };
                }
            });
            setInvestigations(data);
            setLoading(false);
        }).catch(console.error);
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAction = async (e: React.MouseEvent, invId: string, action: string) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await api.sendAction(invId, action);
            // Optimistically update status for immediate UI feedback
            setInvestigations(prev => prev.map(inv => {
                if (inv.id !== invId) return inv;
                const next = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : action === 'abort' ? 'aborted' : inv.status;
                return { ...inv, status: next as Investigation['status'], ...(action === 'pause' ? { pausedAt: Date.now() } : {}) };
            }));
        } catch (err) { console.error('Action failed:', err); }
    };

    const copyTrackingId = async (e: React.MouseEvent, trackingId: string) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(trackingId);
            setCopiedTrackingId(trackingId);
            setTimeout(() => setCopiedTrackingId(null), 2000);
        } catch { /* clipboard unavailable */ }
    };

    const startEditing = (e: React.MouseEvent, inv: Investigation) => {
        e.preventDefault();
        e.stopPropagation();
        setEditingId(inv.id);
        setEditingTitle(inv.title || inv.query || '');
    };

    const saveTitle = async (invId: string) => {
        const trimmed = editingTitle.trim();
        if (trimmed) {
            try {
                await api.updateTitle(invId, trimmed);
                setInvestigations(prev => prev.map(inv =>
                    inv.id === invId ? { ...inv, title: trimmed } : inv
                ));
            } catch (e) {
                console.error('Failed to update title:', e);
            }
        }
        setEditingId(null);
    };

    const confirmDelete = (e: React.MouseEvent, invId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDeletingId(invId);
    };

    const executeDelete = async () => {
        if (!deletingId) return;
        try {
            await api.deleteInvestigation(deletingId);
            setInvestigations(prev => prev.filter(inv => inv.id !== deletingId));
        } catch (e) {
            console.error('Failed to delete investigation:', e);
        }
        setDeletingId(null);
    };

    const togglePin = (e: React.MouseEvent, invId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setPinnedIds(prev => {
            const next = new Set(prev);
            if (next.has(invId)) next.delete(invId); else next.add(invId);
            localStorage.setItem('inv-pinned', JSON.stringify([...next]));
            return next;
        });
    };

    // Get unique products from investigations
    const uniqueProducts = Array.from(
        new Map(
            investigations
                .filter(inv => inv.productId && inv.productName)
                .map(inv => [inv.productId!, { id: inv.productId!, name: inv.productName! }])
        ).values()
    ).sort((a, b) => a.name.localeCompare(b.name));

    const filtered = investigations
        .filter(inv => filter === 'all' || inv.status === filter)
        .filter(inv => productFilter === 'all' || inv.productId === productFilter)
        .filter(inv => {
            if (!search) return true;
            const s = search.toLowerCase();
            return (
                (inv.title || '').toLowerCase().includes(s) ||
                (inv.query || '').toLowerCase().includes(s) ||
                (inv.stamp || '').toLowerCase().includes(s) ||
                (inv.issueType || '').toLowerCase().includes(s) ||
                (inv.incidentId || '').toLowerCase().includes(s) ||
                (inv.productName || '').toLowerCase().includes(s) ||
                inv.id.toLowerCase().includes(s) ||
                inv.thoughts.some(t => typeof t === 'string' && t.toLowerCase().includes(s))
            );
        });

    // Sort: Pinned first, then Running/Paused, then by selected order
    const sorted = [...filtered].sort((a, b) => {
        const aPinned = pinnedIds.has(a.id);
        const bPinned = pinnedIds.has(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        const aActive = a.status === 'running' || a.status === 'paused';
        const bActive = b.status === 'running' || b.status === 'paused';
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        if (sortOrder === 'oldest') return a.id.localeCompare(b.id);
        if (sortOrder === 'steps') return (b.thoughts?.length ?? 0) - (a.thoughts?.length ?? 0);
        return b.id.localeCompare(a.id); // newest
    });

    // Refs so the keyboard handler always sees the latest values without re-registering
    const sortedRef = useRef(sorted);
    const focusedIdxRef = useRef(focusedIdx);
    sortedRef.current = sorted;
    focusedIdxRef.current = focusedIdx;

    // Keyboard shortcuts: '/' = search, j/k = navigate cards, Enter = open focused
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const inInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
            if (e.key === '/' && !inInput) { e.preventDefault(); searchRef.current?.focus(); return; }
            if (inInput) return;
            const s = sortedRef.current;
            const fi = focusedIdxRef.current;
            if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(prev => prev === null ? 0 : Math.min(prev + 1, s.length - 1)); }
            if (e.key === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); setFocusedIdx(prev => prev === null ? 0 : Math.max(prev - 1, 0)); }
            if (e.key === 'Escape') { setFocusedIdx(null); setShowShortcuts(false); }
            if (e.key === 'Enter' && fi !== null && s[fi]) navigate(`/investigation/${s[fi].id}`);
            if (e.key === 'd' && fi !== null && s[fi] && s[fi].status !== 'running' && s[fi].status !== 'paused') setDeletingId(s[fi].id);
            if (e.key === '?') setShowShortcuts(prev => !prev);
            if (e.key === 'g') { setViewMode('grid'); localStorage.setItem('inv-view', 'grid'); }
            if (e.key === 'l') { setViewMode('list'); localStorage.setItem('inv-view', 'list'); }
            if (e.key === 'n') navigate('/new');
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [navigate]);

    // Stats
    const activeCount = investigations.filter(i => i.status === 'running' || i.status === 'paused').length;
    const completedCount = investigations.filter(i => i.status === 'completed').length;
    const failedCount = investigations.filter(i => i.status === 'failed').length;
    const abortedCount = investigations.filter(i => i.status === 'aborted').length;
    const successRateValue = investigations.length > 0
        ? Math.round(completedCount / Math.max(1, completedCount + failedCount + abortedCount) * 100) : 0;

    // Animated count-up values for stat tiles (animate on first load)
    const activeDisplay    = useCountUp(activeCount);
    const completedDisplay = useCountUp(completedCount);
    const failedDisplay    = useCountUp(failedCount);
    const successDisplay   = useCountUp(successRateValue);

    const getLaunchTime = (inv: Investigation) => {
        if (isNaN(Number(inv.id))) return 'Legacy';
        return new Date(Number(inv.id)).toLocaleString();
    };

    const getDateGroup = (inv: Investigation): string => {
        if (isNaN(Number(inv.id))) return 'Older';
        const d = Number(inv.id);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const yestStart  = new Date(todayStart.getTime() - 86400000);
        const weekStart  = new Date(todayStart.getTime() - 6 * 86400000);
        if (d >= todayStart.getTime()) return 'Today';
        if (d >= yestStart.getTime())  return 'Yesterday';
        if (d >= weekStart.getTime())  return 'This week';
        return 'Older';
    };
    void getLaunchTime; // used in title attributes

    const getRelativeTime = (inv: Investigation) => {
        if (isNaN(Number(inv.id))) return 'Legacy';
        const ms = Date.now() - Number(inv.id);
        const sec = Math.floor(ms / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const days = Math.floor(hr / 24);
        if (days < 30) return `${days}d ago`;
        return new Date(Number(inv.id)).toLocaleDateString();
    };

    const getLastThought = (inv: Investigation) => {
        if (!inv.thoughts || inv.thoughts.length === 0) return "Starting investigation...";
        const last = inv.thoughts[inv.thoughts.length - 1];
        if (typeof last === 'string') return last;
        return JSON.stringify(last);
    };

    const pausedCount = investigations.filter(i => i.status === 'paused').length;
    const statusFilters: { key: typeof filter; label: string; count: number; color: string }[] = [
        { key: 'all',       label: 'All',       count: investigations.length,                                           color: 'text-slate-400' },
        { key: 'running',   label: 'Running',   count: investigations.filter(i => i.status === 'running').length,       color: 'text-blue-400' },
        { key: 'paused',    label: 'Paused',    count: pausedCount,                                                     color: 'text-amber-400' },
        { key: 'completed', label: 'Completed', count: completedCount,                                                  color: 'text-emerald-400' },
        { key: 'failed',    label: 'Failed',    count: failedCount,                                                     color: 'text-red-400' },
        { key: 'aborted',   label: 'Aborted',   count: abortedCount,                                                    color: 'text-slate-500' },
    ];

    const toggleView = (mode: 'grid' | 'list') => {
        setViewMode(mode);
        localStorage.setItem('inv-view', mode);
    };

    type StatusConfig = { label: string; icon: React.ReactNode; chip: string; accent: string; dot: string };
    const getStatusConfig = (inv: Investigation): StatusConfig => {
        const hasRetro = !!(inv.retrospect);
        const isRetroCompleted = !!(inv.retrospect?.completed);
        if (inv.status === 'running')
            return { label: 'Running',      icon: <Activity className="w-3 h-3 animate-pulse" />,   chip: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',    accent: 'border-l-blue-500',    dot: 'bg-blue-400' };
        if (inv.status === 'paused')
            return { label: 'Paused',       icon: <Pause className="w-3 h-3 fill-current" />,        chip: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',  accent: 'border-l-amber-500',   dot: 'bg-amber-400' };
        if (inv.status === 'completed' && hasRetro && !isRetroCompleted)
            return { label: 'Retrospective',icon: <Sparkles className="w-3 h-3" />,                  chip: 'bg-purple-500/15 text-purple-400 border border-purple-500/20',accent: 'border-l-purple-500',  dot: 'bg-purple-400' };
        if (inv.status === 'completed')
            return { label: isRetroCompleted ? 'Retro Done' : 'Completed', icon: <CheckCircle2 className="w-3 h-3" />, chip: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20', accent: 'border-l-emerald-500', dot: 'bg-emerald-400' };
        if (inv.status === 'failed')
            return { label: 'Failed',       icon: <XCircle className="w-3 h-3" />,                   chip: 'bg-red-500/15 text-red-400 border border-red-500/20',      accent: 'border-l-red-500',     dot: 'bg-red-400' };
        return     { label: 'Aborted',      icon: <Ban className="w-3 h-3" />,                        chip: 'bg-slate-500/15 text-slate-400 border border-slate-500/20',  accent: 'border-l-slate-600',   dot: 'bg-slate-500' };
    };

    const emptyStateConfig: Record<typeof filter, { icon: React.ReactNode; title: string; body: string }> = {
        all:       { icon: <LayoutGrid className="w-7 h-7 text-slate-500" />,  title: 'No investigations yet',          body: 'Start your first investigation to get going.' },
        running:   { icon: <Activity className="w-7 h-7 text-blue-400" />,    title: 'Nothing running',                body: 'All quiet - start a new investigation to see it here.' },
        paused:    { icon: <Pause className="w-7 h-7 text-amber-400" />,      title: 'No paused investigations',       body: 'Paused investigations will appear here.' },
        completed: { icon: <CheckCircle2 className="w-7 h-7 text-emerald-400" />, title: 'No completions yet',        body: 'Finished investigations will appear here.' },
        failed:    { icon: <XCircle className="w-7 h-7 text-red-400" />,      title: 'No failures',                   body: "That's a good sign. No failed investigations here." },
        aborted:   { icon: <Ban className="w-7 h-7 text-slate-500" />,        title: 'No aborted investigations',     body: 'Nothing was stopped early.' },
    };

    return (
        <div className="space-y-4 md:space-y-6 animate-fade-in pb-12">

            {/* Toast notifications */}
            {toasts.length > 0 && (
                <div className="fixed top-4 right-3 sm:right-4 z-50 flex flex-col gap-2 pointer-events-none">
                    {toasts.map(t => (
                        <div key={t.key} className={`pointer-events-auto flex items-center gap-3 px-3 sm:px-4 py-3 rounded-2xl shadow-xl border text-sm font-semibold animate-fade-in w-[calc(100vw-1.5rem)] sm:w-auto sm:min-w-[280px] max-w-sm backdrop-blur-xl ${
                            t.type === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'
                        }`}>
                            {t.type === 'completed'
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-wider opacity-60 mb-0.5">
                                    {t.type === 'completed' ? 'Investigation complete' : 'Investigation failed'}
                                </div>
                                <div className="truncate">{t.invTitle}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => navigate(`/investigation/${t.invId}`)} className={`text-[11px] font-bold px-2 py-1 rounded-lg transition-colors ${
                                    t.type === 'completed' ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300' : 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
                                }`}>View</button>
                                <button onClick={() => dismissToast(t.key)} className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <LayoutGrid className="w-5 h-5 text-brand-400" />
                        <span className="text-xs font-bold uppercase tracking-widest text-brand-400">Dashboard</span>
                    </div>
                    <h1 className="text-3xl font-black text-white leading-tight">Investigations</h1>
                    <p className="text-slate-400 text-sm mt-1">Monitor, review, and manage all active and past investigations.</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-wrap w-full sm:w-auto">
                    {/* Resume All — visible when there are paused investigations */}
                    {pausedCount > 0 && (
                        <button
                            onClick={handleResumeAll}
                            disabled={resumingAll}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:py-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/20 font-bold rounded-xl shadow-sm transition-all duration-200 group whitespace-nowrap disabled:opacity-50 text-sm sm:text-base"
                        >
                            {resumingAll
                                ? <RefreshCw className="w-4 h-4 animate-spin" />
                                : <RotateCcw className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                            Resume All ({pausedCount})
                        </button>
                    )}
                    {/* Server Restart */}
                    <button
                        onClick={handleRestartServer}
                        disabled={restarting}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold rounded-xl shadow-sm transition-all duration-200 group whitespace-nowrap disabled:opacity-50 text-sm sm:text-base"
                        title="Restart the backend server"
                    >
                        {restarting
                            ? <RefreshCw className="w-4 h-4 animate-spin" />
                            : <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />}
                        {restarting ? 'Restarting...' : 'Restart Server'}
                    </button>
                    <Link
                        to="/new"
                        className="inline-flex items-center justify-center gap-2 px-5 py-2 sm:py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 transition-all duration-200 group whitespace-nowrap text-sm sm:text-base"
                    >
                        <Play className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
                        Start New Investigation
                    </Link>
                </div>
            </div>

            {/* Stats Strip - tiles are clickable to filter */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <button onClick={() => { setFilter('all'); setFocusedIdx(null); }} className="col-span-2 sm:col-span-1 text-left bg-gradient-to-br from-brand-600 to-brand-800 rounded-xl sm:rounded-2xl p-3 sm:p-5 text-white shadow-lg shadow-brand-500/20 relative overflow-hidden hover:from-brand-500 hover:to-brand-700 transition-all">
                    <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-xl" />
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-3">
                        <Activity className="w-4 h-4 text-brand-200" />
                        <span className="text-brand-200 text-xs font-semibold uppercase tracking-wider">Active</span>
                        {activeCount > 0 && <span className="ml-auto w-2 h-2 rounded-full bg-white animate-ping" />}
                    </div>
                    <div className="text-3xl sm:text-4xl font-black tabular-nums">{activeDisplay}</div>
                    <div className="text-brand-300 text-xs mt-1">Running now</div>
                </button>
                <button onClick={() => { setFilter('completed'); setFocusedIdx(null); }} className="text-left glass-card-interactive rounded-xl sm:rounded-2xl p-3 sm:p-5 group">
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Done</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-slate-100 tabular-nums">{completedDisplay}</div>
                    {investigations.length > 0 && (
                        <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.round(completedCount / investigations.length * 100)}%` }} />
                        </div>
                    )}
                </button>
                <button onClick={() => { setFilter('failed'); setFocusedIdx(null); }} className="text-left glass-card-interactive rounded-xl sm:rounded-2xl p-3 sm:p-5 group">
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-3">
                        <XCircle className={`w-4 h-4 ${failedCount > 0 ? 'text-red-400' : 'text-slate-600'}`} />
                        <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Failed</span>
                        {failedCount > 0 && <span className="ml-auto w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
                    </div>
                    <div className={`text-2xl sm:text-3xl font-black tabular-nums ${failedCount > 0 ? 'text-red-400' : 'text-slate-100'}`}>{failedDisplay}</div>
                    <div className="text-slate-500 text-xs mt-1">{failedCount > 0 ? 'Need review' : 'All clear'}</div>
                </button>
                <button onClick={() => { setFilter('completed'); setFocusedIdx(null); }} className="text-left glass-card-interactive rounded-xl sm:rounded-2xl p-3 sm:p-5">
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-3">
                        <TrendingUp className={`w-4 h-4 ${successRateValue >= 80 ? 'text-emerald-400' : 'text-slate-500'}`} />
                        <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Success rate</span>
                    </div>
                    <div className={`text-2xl sm:text-3xl font-black tabular-nums ${successRateValue >= 80 ? 'text-emerald-400' : 'text-slate-100'}`}>
                        {investigations.length > 0 ? `${successDisplay}%` : '--'}
                    </div>
                    <div className="text-slate-500 text-xs mt-1">
                        {completedCount + failedCount + abortedCount} resolved
                    </div>
                </button>
            </div>

            {/* Analytics Toggle */}
            {investigations.length > 0 && (
                <button
                    onClick={toggleAnalytics}
                    className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors group"
                >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Analytics
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showAnalytics ? 'rotate-180' : ''}`} />
                </button>
            )}

            {/* Analytics Section */}
            {investigations.length > 0 && (
                <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 transition-all duration-300 ease-in-out origin-top ${showAnalytics ? 'max-h-[500px] opacity-100 scale-y-100' : 'max-h-0 opacity-0 scale-y-95 overflow-hidden pointer-events-none'}`}>
                    <div className="glass-card p-4 chart-enter">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">14-Day Trend</div>
                        <div className="h-36">
                            <InvestigationTrend investigations={investigations} />
                        </div>
                    </div>
                    <div className="glass-card p-4 chart-enter">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Issue Types</div>
                        <div className="h-36">
                            <IssueTypeDonut investigations={investigations} />
                        </div>
                    </div>
                    <div className="glass-card p-4 chart-enter">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Duration Distribution</div>
                        <div className="h-36">
                            <DurationDistribution investigations={investigations} />
                        </div>
                    </div>
                </div>
            )}

            {/* Filters & Search */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center sticky top-16 z-10 bg-surface/80 backdrop-blur-xl py-2 -mx-4 px-4 border-b border-white/[0.04]">
                {/* Search */}
                <div className="relative flex-1 max-w-xs group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 group-focus-within:text-brand-400 transition-colors" />
                    <input
                        ref={searchRef}
                        type="text"
                        placeholder="Search..."
                        className="w-full pl-9 pr-8 py-2 bg-slate-900/60 border border-slate-700/50 rounded-xl text-sm font-medium text-slate-200 shadow-sm focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/40 placeholder:text-slate-500 outline-none transition-all"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {!search && (
                        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-md pointer-events-none border border-slate-700">/</kbd>
                    )}
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold">x</button>
                    )}
                </div>

                {/* Status tabs */}
                <div className="flex items-center gap-0.5 bg-slate-900/60 border border-slate-700/50 rounded-xl p-1 shadow-sm overflow-x-auto shrink-0">
                    {statusFilters.map(({ key, label, count, color }) => (
                        <button
                            key={key}
                            onClick={() => setFilter(key)}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                                filter === key ? 'bg-brand-500/15 text-brand-300 border border-brand-500/20 shadow-sm' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300 border border-transparent'
                            }`}
                        >
                            {label}
                            {count > 0 && (
                                <span className={`text-[10px] font-black px-1 rounded ${filter === key ? 'text-brand-400' : color}`}>{count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Sort & View */}
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {/* Product filter */}
                    {uniqueProducts.length > 0 && (
                        <div className="relative">
                            <select
                                value={productFilter}
                                onChange={(e) => setProductFilter(e.target.value)}
                                className={`appearance-none pl-7 pr-6 py-2 border rounded-xl text-xs font-bold shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/40 hover:border-slate-600 transition-all ${
                                    productFilter !== 'all' 
                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                        : 'bg-slate-900/60 border-slate-700/50 text-slate-400'
                                }`}
                            >
                                <option value="all">All Products</option>
                                {uniqueProducts.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <Package className={`absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${
                                productFilter !== 'all' ? 'text-purple-500' : 'text-slate-400'
                            }`} />
                        </div>
                    )}
                    <div className="relative">
                        <select
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                            className="appearance-none pl-7 pr-6 py-2 bg-slate-900/60 border border-slate-700/50 rounded-xl text-xs font-bold text-slate-400 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/40 hover:border-slate-600 transition-all"
                        >
                            <option value="newest">Newest</option>
                            <option value="oldest">Oldest</option>
                            <option value="steps">Most steps</option>
                        </select>
                        <ArrowDownUp className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    </div>
                    <div className="flex items-center bg-slate-900/60 border border-slate-700/50 rounded-xl p-1 shadow-sm">
                        <button
                            onClick={() => toggleView('grid')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-brand-500/20 text-brand-300' : 'text-slate-500 hover:bg-slate-800'}`}
                            title="Grid view"
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => toggleView('list')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-brand-500/20 text-brand-300' : 'text-slate-500 hover:bg-slate-800'}`}
                            title="List view"
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    {/* Group-by-stamp toggle: only relevant in list view */}
                    {viewMode === 'list' && (
                        <button
                            onClick={() => setGroupByStamp(s => !s)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-sm ${
                                groupByStamp
                                    ? 'bg-brand-500/20 text-brand-300 border-brand-500/20'
                                    : 'bg-slate-900/60 text-slate-500 hover:text-slate-300 hover:bg-slate-800 border-slate-700/50'
                            }`}
                            title="Group by stamp"
                        >
                            <Server className="w-3.5 h-3.5" />
                            Stamp
                        </button>
                    )}
                    <button
                        onClick={() => setShowShortcuts(s => !s)}
                        className={`p-1.5 rounded-xl text-xs font-black transition-all border shadow-sm ${
                            showShortcuts ? 'bg-brand-500/20 text-brand-300 border-brand-500/20' : 'bg-slate-900/60 text-slate-500 hover:text-slate-300 hover:bg-slate-800 border-slate-700/50'
                        }`}
                        title="Keyboard shortcuts (?)"
                    >?</button>
                </div>
            </div>

            {/* Results count */}
            {(search || filter !== 'all' || productFilter !== 'all') && sorted.length > 0 && (
                <p className="text-xs text-slate-500 font-medium flex items-center gap-2">
                    <span>{sorted.length} {sorted.length === 1 ? 'investigation' : 'investigations'}</span>
                    {search && <><span>matching</span> <span className="font-bold text-slate-300">"{search}"</span></>}
                    {productFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full font-bold">
                            <Package className="w-3 h-3" />
                            {uniqueProducts.find(p => p.id === productFilter)?.name}
                            <button 
                                onClick={() => setProductFilter('all')} 
                                className="ml-0.5 hover:text-purple-300"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}
                </p>
            )}

            {/* Skeleton - first load only */}
            {loading && investigations.length === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="glass-card p-5 space-y-3 animate-pulse">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-800 shrink-0" />
                                <div className="flex-1 space-y-2 pt-1">
                                    <div className="h-3 bg-slate-800 rounded-full w-3/4" />
                                    <div className="h-2.5 bg-slate-800 rounded-full w-1/2" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="h-2.5 bg-slate-800 rounded-full" />
                                <div className="h-2.5 bg-slate-800 rounded-full w-5/6" />
                                <div className="h-2.5 bg-slate-800 rounded-full w-4/6" />
                            </div>
                            <div className="pt-3 border-t border-slate-800 flex justify-between">
                                <div className="h-2 bg-slate-800 rounded-full w-16" />
                                <div className="h-2 bg-slate-800 rounded-full w-20" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Grid view */}
            {viewMode === 'grid' && sorted.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in">
                    {sorted.map((inv, sortedGridIdx) => {
                        const isPaused = inv.status === 'paused';
                        const isCompleted = inv.status === 'completed';
                        const isFailed = inv.status === 'failed';
                        const isAborted = inv.status === 'aborted';
                        const isRunning = inv.status === 'running';
                        const isRetroCompleted = !!(inv.retrospect?.completed);
                        const retroProposalCount = inv.retrospect?.proposals?.length || 0;
                        const sc = getStatusConfig(inv);
                        const staleEntry = lastThoughtActivityRef.current[inv.id];
                        const isStale = isRunning && !!staleEntry && (Date.now() - staleEntry.seenAt > 5 * 60 * 1000);
                        const isPinned = pinnedIds.has(inv.id);

                        const iconClass = isRunning ? 'bg-blue-500/15 text-blue-400'
                            : isPaused ? 'bg-amber-500/15 text-amber-400'
                            : isCompleted ? 'bg-emerald-500/15 text-emerald-400'
                            : isFailed ? 'bg-red-500/15 text-red-400'
                            : 'bg-slate-800 text-slate-500';

                        return (
                            <Link key={inv.id} to={`/investigation/${inv.id}`} className="group relative block animate-fade-in opacity-0" style={{ animationDelay: `${Math.min(sortedGridIdx * 50, 300)}ms`, animationFillMode: 'forwards' }} tabIndex={0}>
                                <div className={`relative bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-l-4 ${sc.accent} shadow-lg shadow-black/10 hover:shadow-xl hover:shadow-black/20 transition-all duration-200 h-full flex flex-col overflow-hidden hover:-translate-y-0.5 hover:bg-slate-900/60 ${focusedIdx === sortedGridIdx ? 'border-brand-400 ring-2 ring-brand-300/30' : 'border-white/[0.06]'}`}>
                                    {isRunning && (
                                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent [background-size:200%_100%] animate-shimmer" />
                                    )}
                                    <div className="p-5 flex flex-col flex-1 gap-3">
                                        {/* Header */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
                                                {isRunning      ? <Activity className="w-5 h-5 animate-pulse" />
                                                : isPaused      ? <Pause className="w-5 h-5 fill-current" />
                                                : isCompleted   ? <CheckCircle2 className="w-5 h-5" />
                                                : isFailed      ? <XCircle className="w-5 h-5" />
                                                : isAborted     ? <Ban className="w-5 h-5" />
                                                :                 <FileText className="w-5 h-5" />}
                                            </div>
                                            <div className="flex flex-col items-end gap-1 min-w-0">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${sc.chip}`}>
                                                    {sc.icon} {sc.label}
                                                    {retroProposalCount > 0 && !isRetroCompleted && (
                                                        <span className="bg-purple-600 text-white text-[9px] font-black px-1 rounded-full min-w-[14px] text-center ml-0.5">
                                                            {retroProposalCount}
                                                        </span>
                                                    )}
                                                </span>
                                                {isStale && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                                        <AlertTriangle className="w-2.5 h-2.5" />Stale
                                                    </span>
                                                )}
                                                {inv.stamp && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded-lg max-w-[160px] truncate border border-slate-700/30" title={inv.stamp}>
                                                        <Server className="w-2.5 h-2.5 shrink-0" />{inv.stamp}
                                                    </span>
                                                )}
                                                {inv.incidentId && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-lg border border-orange-500/20" title={`IcM Incident ${inv.incidentId}`}>
                                                        <ShieldAlert className="w-2.5 h-2.5 shrink-0" />ICM
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Title */}
                                        <div className="flex items-start gap-1">
                                            {editingId === inv.id ? (
                                                <input autoFocus
                                                    className="flex-1 text-base font-bold text-slate-100 leading-tight bg-slate-800 border border-brand-500/40 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-400"
                                                    value={editingTitle}
                                                    onChange={(e) => setEditingTitle(e.target.value)}
                                                    onBlur={() => saveTitle(inv.id)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(inv.id); if (e.key === 'Escape') setEditingId(null); }}
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                />
                                            ) : (
                                                <>
                                                    <h3 className="flex-1 text-base font-bold text-slate-200 line-clamp-2 leading-snug group-hover:text-brand-400 transition-colors">
                                                        {search
                                                            ? <Highlight text={inv.title || inv.query || inv.id.replace(/-/g, ' ')} term={search} />
                                                            : (inv.title || inv.query || inv.id.replace(/-/g, ' '))}
                                                    </h3>
                                                    <button onClick={(e) => togglePin(e, inv.id)}
                                                        className={`mt-0.5 p-1 rounded-lg transition-all ${isPinned ? 'text-yellow-400 opacity-100' : 'text-slate-600 hover:text-yellow-400 hover:bg-yellow-500/10 opacity-0 group-hover:opacity-100'}`}
                                                        title={isPinned ? 'Unpin' : 'Pin to top'}>
                                                        <Pin className={`w-3 h-3 transition-transform duration-200 ${isPinned ? 'rotate-0' : 'rotate-45'}`} />
                                                    </button>
                                                    <button onClick={(e) => startEditing(e, inv)} className="mt-0.5 p-1 rounded-lg text-slate-600 hover:text-brand-400 hover:bg-brand-500/10 transition-all opacity-0 group-hover:opacity-100" title="Edit title">
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                    {!isRunning && (
                                                        <button onClick={(e) => confirmDelete(e, inv.id)} className="mt-0.5 p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100" title="Delete">
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        {/* Body */}
                                        <div className="flex-1 space-y-2">
                                            <div className="flex flex-wrap gap-1.5">
                                                {inv.productName && (
                                                    <span 
                                                        className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full cursor-pointer hover:bg-purple-500/20 transition-colors"
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProductFilter(inv.productId!); }}
                                                        title={`Filter by ${inv.productName}`}
                                                    >
                                                        <Package className="w-2.5 h-2.5" />
                                                        {inv.productName}
                                                    </span>
                                                )}
                                                {inv.issueType && (
                                                    <span className="inline-block text-[10px] font-mono font-bold text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-500/20">#{inv.issueType}</span>
                                                )}
                                            </div>
                                            {(inv.timeRange || inv.trackingId) && (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {inv.timeRange && (
                                                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800/60 border border-slate-700/30 px-1.5 py-0.5 rounded-md" title={inv.timeRange}>
                                                            {formatTimeRange(inv.timeRange)}
                                                        </span>
                                                    )}
                                                    {inv.trackingId && (
                                                        <button onClick={(e) => copyTrackingId(e, inv.trackingId!)} title={`Copy TrackingId: ${inv.trackingId}`}
                                                            className="inline-flex items-center gap-1 text-[10px] font-mono text-brand-400 bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/20 px-1.5 py-0.5 rounded-md transition-colors">
                                                            {copiedTrackingId === inv.trackingId ? <CheckCheck className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                                            {inv.trackingId.slice(0, 8)}...
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            <p className={`text-xs line-clamp-3 leading-relaxed ${isFailed ? 'text-red-400/90' : 'text-slate-500'}`}>
                                                {search ? <Highlight text={getLastThought(inv)} term={search} /> : getLastThought(inv)}
                                            </p>
                                        </div>
                                        {/* Footer */}
                                        <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-500 font-medium">
                                            <div className="flex items-center gap-3">
                                                <span className="flex items-center gap-1" title={getLaunchTime(inv)}>
                                                    <Clock className="w-3 h-3" />{getRelativeTime(inv)}
                                                </span>
                                                {(inv.thoughtCount ?? inv.thoughts?.length ?? 0) > 0 && (
                                                    <StepBar count={inv.thoughtCount ?? inv.thoughts.length}
                                                        color={isRunning ? 'bg-blue-400' : isPaused ? 'bg-amber-400' : isCompleted ? 'bg-emerald-400' : isFailed ? 'bg-red-400' : 'bg-slate-400'} />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(isRunning || isPaused) && !isNaN(Number(inv.id)) && (
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isPaused ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                        <Timer className="w-2.5 h-2.5" />
                                                        <DurationTimer startTime={Number(inv.id)} pausedAt={inv.pausedAt} totalPausedTime={inv.totalPausedTime} />
                                                    </span>
                                                )}
                                                {/* Inline pause/resume for active cards */}
                                                {(isRunning || isPaused) && (
                                                    <button
                                                        onClick={(e) => handleAction(e, inv.id, isPaused ? 'resume' : 'pause')}
                                                        title={isPaused ? 'Resume' : 'Pause'}
                                                        className={`p-1 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${isPaused ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-amber-400 hover:bg-amber-500/10'}`}>
                                                        {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                                                    </button>
                                                )}
                                                <span className={`inline-flex items-center gap-0.5 font-bold transition-all opacity-0 group-hover:opacity-100 ${isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-brand-400'}`}>
                                                    {isPaused ? 'View' : isCompleted ? 'View Report' : isFailed ? 'View' : 'Open'}
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* List view */}
            {viewMode === 'list' && sorted.length > 0 && (() => {
                type Group = { label: string; items: typeof sorted };
                const groups: Group[] = [];

                if (groupByStamp) {
                    // Group by stamp value, ungrouped items under 'No stamp'
                    const map: Record<string, typeof sorted> = {};
                    sorted.forEach(inv => {
                        const key = inv.stamp || 'No stamp';
                        (map[key] ??= []).push(inv);
                    });
                    Object.keys(map).sort((a, b) =>
                        a === 'No stamp' ? 1 : b === 'No stamp' ? -1 : a.localeCompare(b)
                    ).forEach(key => groups.push({ label: key, items: map[key] }));
                } else {
                    // Build date-grouped sections (only when sort=newest/oldest and no search)
                    const useGroups = sortOrder !== 'steps' && !search;
                    if (useGroups) {
                        const order = ['Today', 'Yesterday', 'This week', 'Older'];
                        const map: Record<string, typeof sorted> = {};
                        sorted.forEach(inv => {
                            const g = (inv.status === 'running' || inv.status === 'paused') ? 'Today' : getDateGroup(inv);
                            (map[g] ??= []).push(inv);
                        });
                        order.forEach(g => { if (map[g]?.length) groups.push({ label: g, items: map[g] }); });
                    } else {
                        groups.push({ label: '', items: sorted });
                    }
                }

                let globalIdx = 0;
                return (
                    <div className="glass-card overflow-hidden">
                        {groups.map(({ label, items }, gi) => (
                            <div key={gi}>
                                {label && (
                                    <div className="px-4 py-2 bg-slate-800/40 border-b border-white/[0.04] flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                                        <span className="text-[10px] text-slate-600 font-medium">{items.length}</span>
                                    </div>
                                )}
                                <div className="divide-y divide-white/[0.04]">
                                    {items.map((inv) => {
                                        const myIdx = globalIdx++;
                                        const isPaused = inv.status === 'paused';
                                        const isCompleted = inv.status === 'completed';
                                        const isFailed = inv.status === 'failed';
                                        const isRunning = inv.status === 'running';
                                        const isRetroCompleted = !!(inv.retrospect?.completed);
                                        const retroProposalCount = inv.retrospect?.proposals?.length || 0;
                                        const sc = getStatusConfig(inv);
                                        const isFocused = focusedIdx === myIdx;
                                        const listStaleEntry = lastThoughtActivityRef.current[inv.id];
                                        const isStale = isRunning && !!listStaleEntry && (Date.now() - listStaleEntry.seenAt > 5 * 60 * 1000);

                                        return (
                                            <Link key={inv.id} to={`/investigation/${inv.id}`}
                                                style={{ animationDelay: `${Math.min(myIdx * 30, 300)}ms` }}
                                                className={`group flex items-center gap-3 px-4 py-3 transition-colors relative overflow-hidden animate-fade-in ${isFocused ? 'bg-brand-500/10' : 'hover:bg-slate-800/50'}`}>
                                                {/* Left accent */}
                                                <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${sc.dot}`} />

                                                {/* Status icon */}
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isRunning ? 'bg-blue-500/15 text-blue-400' : isPaused ? 'bg-amber-500/15 text-amber-400'
                                                    : isCompleted ? 'bg-emerald-500/15 text-emerald-400' : isFailed ? 'bg-red-500/15 text-red-400'
                                                    : 'bg-slate-800 text-slate-500'}`}>
                                                    {isRunning    ? <Activity className="w-3.5 h-3.5 animate-pulse" />
                                                    : isPaused    ? <Pause className="w-3.5 h-3.5 fill-current" />
                                                    : isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" />
                                                    : isFailed    ? <XCircle className="w-3.5 h-3.5" />
                                                    :               <Ban className="w-3.5 h-3.5" />}
                                                </div>

                                                {/* Title */}
                                                <div className="flex-1 min-w-0">
                                                    {editingId === inv.id ? (
                                                        <input autoFocus
                                                            className="w-full text-sm font-bold text-slate-100 bg-slate-800 border border-brand-500/40 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-brand-400"
                                                            value={editingTitle}
                                                            onChange={(e) => setEditingTitle(e.target.value)}
                                                            onBlur={() => saveTitle(inv.id)}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(inv.id); if (e.key === 'Escape') setEditingId(null); }}
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                        />
                                                    ) : (
                                                        <span className="text-sm font-semibold text-slate-200 truncate block group-hover:text-brand-400 transition-colors">
                                                            {search
                                                                ? <Highlight text={inv.title || inv.query || inv.id} term={search} />
                                                                : (inv.title || inv.query || inv.id)}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Tags & meta */}
                                                <div className="hidden sm:flex items-center gap-2 shrink-0">
                                                    {inv.productName && (
                                                        <span 
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-purple-500/20 transition-colors"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProductFilter(inv.productId!); }}
                                                            title={`Filter by ${inv.productName}`}
                                                        >
                                                            <Package className="w-2.5 h-2.5" />
                                                            {inv.productName}
                                                        </span>
                                                    )}
                                                    {inv.issueType && (
                                                        <span className="text-[10px] font-mono font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded-full border border-brand-500/20">#{inv.issueType}</span>
                                                    )}
                                                    {inv.timeRange && (
                                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-800/60 border border-slate-700/30 px-1.5 py-0.5 rounded-md" title={inv.timeRange}>
                                                            {formatTimeRange(inv.timeRange)}
                                                        </span>
                                                    )}
                                                    {inv.trackingId && (
                                                        <button onClick={(e) => copyTrackingId(e, inv.trackingId!)} title={`Copy TrackingId: ${inv.trackingId}`}
                                                            className="inline-flex items-center gap-1 text-[10px] font-mono text-brand-400 bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/20 px-1.5 py-0.5 rounded-md transition-colors">
                                                            {copiedTrackingId === inv.trackingId ? <CheckCheck className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                                            {inv.trackingId.slice(0, 8)}...
                                                        </button>
                                                    )}
                                                    {inv.stamp && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded-lg max-w-[120px] truncate border border-slate-700/30">
                                                            <Server className="w-2.5 h-2.5 shrink-0" />{inv.stamp}
                                                        </span>
                                                    )}
                                                    {inv.incidentId && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-lg border border-orange-500/20" title={`IcM Incident ${inv.incidentId}`}>
                                                            <ShieldAlert className="w-2.5 h-2.5 shrink-0" />ICM
                                                        </span>
                                                    )}
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${sc.chip}`}>
                                                        {sc.icon}{sc.label}
                                                        {retroProposalCount > 0 && !isRetroCompleted && (
                                                            <span className="bg-purple-600 text-white text-[9px] font-black px-1 rounded-full ml-0.5">{retroProposalCount}</span>
                                                        )}
                                                    </span>
                                                    {isStale && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                                            <AlertTriangle className="w-2.5 h-2.5" />Stale
                                                        </span>
                                                    )}
                                                    {(inv.thoughtCount ?? inv.thoughts?.length ?? 0) > 0 && (
                                                        <StepBar count={inv.thoughtCount ?? inv.thoughts.length} color={isRunning ? 'bg-blue-400' : isCompleted ? 'bg-emerald-400' : isFailed ? 'bg-red-400' : 'bg-slate-400'} />
                                                    )}
                                                    {(isRunning || isPaused) && !isNaN(Number(inv.id)) && (
                                                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isPaused ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                            <Timer className="w-3 h-3" />
                                                            <DurationTimer startTime={Number(inv.id)} pausedAt={inv.pausedAt} totalPausedTime={inv.totalPausedTime} />
                                                        </span>
                                                    )}
                                                    <span className="text-[11px] text-slate-500 font-medium w-16 text-right shrink-0" title={getLaunchTime(inv)}>{getRelativeTime(inv)}</span>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    <button onClick={(e) => togglePin(e, inv.id)}
                                                        className={`p-1.5 rounded-lg transition-all ${pinnedIds.has(inv.id) ? 'text-yellow-400 !opacity-100' : 'text-slate-500 hover:text-yellow-400 hover:bg-yellow-500/10'}`}
                                                        title={pinnedIds.has(inv.id) ? 'Unpin' : 'Pin to top'}>
                                                        <Pin className={`w-3.5 h-3.5 transition-transform duration-200 ${pinnedIds.has(inv.id) ? 'rotate-0' : 'rotate-45'}`} />
                                                    </button>
                                                    {(isRunning || isPaused) && (
                                                        <button onClick={(e) => handleAction(e, inv.id, isPaused ? 'resume' : 'pause')}
                                                            className={`p-1.5 rounded-lg transition-all ${isPaused ? 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'}`}
                                                            title={isPaused ? 'Resume' : 'Pause'}>
                                                            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                                                        </button>
                                                    )}
                                                    <button onClick={(e) => startEditing(e, inv)} className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-all" title="Edit title">
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    {!isRunning && (
                                                        <button onClick={(e) => confirmDelete(e, inv.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Delete">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <ChevronRight className={`w-4 h-4 ml-1 transition-colors ${isFocused ? 'text-brand-400' : 'text-slate-600 group-hover:text-brand-400'}`} />
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })()}

            {sorted.length === 0 && (() => {
                const es = search
                    ? { icon: <Search className="w-7 h-7 text-slate-400" />, title: 'No matching investigations', body: `No results for "${search}". Try different keywords.` }
                    : emptyStateConfig[filter];
                const isEmpty = investigations.length === 0;
                return (
                    <div className="text-center py-24">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/40 mb-5">{es.icon}</div>
                        <h3 className="text-white font-bold text-lg mb-1">{es.title}</h3>
                        <p className="text-slate-400 text-sm mb-5">{es.body}</p>
                        {isEmpty && (
                            <Link to="/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors shadow-lg shadow-brand-500/20">
                                <Play className="w-4 h-4 fill-current" /> Start New Investigation
                            </Link>
                        )}
                        {search && (
                            <button onClick={() => setSearch('')} className="text-sm font-bold text-brand-400 hover:underline">Clear search</button>
                        )}
                    </div>
                );
            })()}

            {/* Keyboard shortcuts overlay */}
            {showShortcuts && (
                <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-5 w-[calc(100vw-1.5rem)] sm:w-60">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm font-bold">Keyboard shortcuts</span>
                            <button onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-white text-[11px] font-bold bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded-md transition-colors">Esc</button>
                        </div>
                        <div className="space-y-2.5">
                            {([
                                ['/', 'Focus search'],
                                ['j / Down', 'Next card'],
                                ['k / Up', 'Prev card'],
                                ['Enter', 'Open focused'],
                                ['d', 'Delete focused'],
                                ['g', 'Switch to grid'],
                                ['l', 'Switch to list'],
                                ['n', 'New investigation'],
                                ['?', 'Toggle this panel'],
                                ['Esc', 'Clear / close'],
                            ] as [string, string][]).map(([key, label]) => (
                                <div key={key} className="flex items-center justify-between gap-3">
                                    <span className="text-slate-400 text-xs">{label}</span>
                                    <kbd className="text-[10px] font-bold bg-slate-800 px-1.5 py-0.5 rounded-md font-mono shrink-0 text-slate-200">{key}</kbd>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deletingId && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setDeletingId(null)}>
                    <div className="glass-card p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center border border-red-500/20">
                                <Trash2 className="w-5 h-5 text-red-400" />
                            </div>
                            <h3 className="text-base font-bold text-white">Delete Investigation</h3>
                        </div>
                        <p className="text-sm text-slate-400 mb-6 leading-relaxed">This will permanently delete this investigation and all its data. This action cannot be undone.</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setDeletingId(null)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:bg-slate-800 rounded-xl transition-colors">Cancel</button>
                            <button onClick={executeDelete} className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors shadow-lg shadow-red-500/20">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
