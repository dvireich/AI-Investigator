import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { ScheduleDefinition, ScheduleHistoryEntry } from '../types/schedule';
import type { Product } from '../types/product';
import {
    Clock, Play, Pause, Plus, Trash2, Pencil, CheckCircle2, AlertTriangle,
    XCircle, Activity, RefreshCw, ChevronDown, ChevronRight, Server, Timer,
    ExternalLink
} from 'lucide-react';

// ── Verdict helpers ──────────────────────────────────────────────────────

type Verdict = 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';

const verdictConfig: Record<Verdict, { label: string; color: string; bg: string; icon: React.ReactNode; dot: string }> = {
    healthy:  { label: 'Healthy',  color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/20', icon: <CheckCircle2 className="w-4 h-4" />, dot: 'bg-emerald-400' },
    warning:  { label: 'Warning',  color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/20',   icon: <AlertTriangle className="w-4 h-4" />, dot: 'bg-amber-400' },
    critical: { label: 'Critical', color: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/20',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-400' },
    error:    { label: 'Error',    color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/15',       icon: <XCircle className="w-4 h-4" />, dot: 'bg-red-300' },
    unknown:  { label: 'Pending',  color: 'text-slate-400',   bg: 'bg-slate-500/15 border-slate-500/20',   icon: <Clock className="w-4 h-4" />, dot: 'bg-slate-400' },
};

// ── Component ────────────────────────────────────────────────────────────

export const Schedules = () => {
    const navigate = useNavigate();
    const [schedules, setSchedules] = useState<ScheduleDefinition[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [schedulerRunning, setSchedulerRunning] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [historyMap, setHistoryMap] = useState<Record<string, ScheduleHistoryEntry[]>>({});

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
        if (!confirm('Delete this schedule?')) return;
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
    const healthyCount = schedules.filter(s => s.lastVerdict === 'healthy').length;
    const warningCount = schedules.filter(s => s.lastVerdict === 'warning').length;
    const criticalCount = schedules.filter(s => s.lastVerdict === 'critical').length;

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

    const getNextRunIn = (iso?: string) => {
        if (!iso) return '';
        const ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'due now';
        const min = Math.ceil(ms / 60_000);
        if (min < 60) return `in ${min}m`;
        return `in ${Math.floor(min / 60)}h ${min % 60}m`;
    };

    const productName = (id?: string) => {
        if (!id) return '';
        return products.find(p => p.id === id)?.name || id;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Activity className="w-6 h-6 text-brand-400 animate-pulse" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight">Scheduled Investigations</h1>
                    <p className="text-sm text-slate-400 mt-1">Periodic health checks that auto-trigger agent investigations</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Scheduler toggle */}
                    <button
                        onClick={toggleScheduler}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                            schedulerRunning
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-slate-700/50 text-slate-400 border-slate-600 hover:bg-slate-600'
                        }`}
                    >
                        {schedulerRunning ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        {schedulerRunning ? 'Running' : 'Stopped'}
                    </button>
                    <button
                        onClick={() => navigate('/schedules/new')}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-bold transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        New Schedule
                    </button>
                </div>
            </div>

            {/* Stats bar */}
            {schedules.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Enabled" value={enabledCount} total={schedules.length} color="text-blue-400" />
                    <StatCard label="Healthy" value={healthyCount} color="text-emerald-400" />
                    <StatCard label="Warning" value={warningCount} color="text-amber-400" />
                    <StatCard label="Critical" value={criticalCount} color="text-red-400" />
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
                    {schedules.map(sched => {
                        const vc = verdictConfig[sched.lastVerdict || 'unknown'];
                        const isExpanded = expandedId === sched.id;
                        const hist = historyMap[sched.id] || [];

                        return (
                            <div key={sched.id} className={`bg-slate-900/60 rounded-2xl overflow-hidden ${
                                sched.lastVerdict === 'critical' || sched.lastVerdict === 'error'
                                    ? 'border-2 animate-flicker-red shadow-lg shadow-red-500/20'
                                    : 'border border-slate-800/50'
                            }`}>
                                {/* Main row */}
                                <div className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => toggleExpand(sched.id)}>
                                    {/* Expand arrow */}
                                    <div className="text-slate-500">
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </div>

                                    {/* Verdict dot */}
                                    <div className={`w-2.5 h-2.5 rounded-full ${vc.dot} ${sched.activeInvestigationId ? 'animate-pulse' : ''}`} />

                                    {/* Name + stamp */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white truncate">{sched.name}</span>
                                            {!sched.enabled && (
                                                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-700 text-slate-400 rounded">DISABLED</span>
                                            )}
                                            {sched.activeInvestigationId && (
                                                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/20 rounded">RUNNING</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                                            <span className="flex items-center gap-1"><Server className="w-3 h-3" />{sched.stamp}</span>
                                            <span className="flex items-center gap-1"><Timer className="w-3 h-3" />Every {sched.intervalMinutes}m</span>
                                            {sched.productId && <span className="text-slate-600">· {productName(sched.productId)}</span>}
                                        </div>
                                    </div>

                                    {/* Verdict badge */}
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${vc.bg} ${vc.color}`}>
                                        {vc.icon}
                                        {vc.label}
                                    </div>

                                    {/* Timing */}
                                    <div className="hidden sm:block text-right text-xs text-slate-500 w-24">
                                        <div>Last: {getRelativeTime(sched.lastRunAt)}</div>
                                        {sched.enabled && sched.nextRunAt && (
                                            <div className="text-slate-600">Next: {getNextRunIn(sched.nextRunAt)}</div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
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

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div className="border-t border-slate-800/50 px-4 py-3 bg-slate-950/30 space-y-3">
                                        {/* Query */}
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Query</div>
                                            <p className="text-xs text-slate-300 bg-slate-800/50 rounded-lg p-3 whitespace-pre-wrap font-mono">{sched.query}</p>
                                        </div>

                                        {/* Config row */}
                                        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                                            <span>Time range: <span className="text-slate-300">{sched.timeRange || 'ago(1h)'}</span></span>
                                            <span>Max steps: <span className="text-slate-300">{sched.maxSteps || 20}</span></span>
                                            {sched.issueType && <span>Issue type: <span className="text-slate-300">{sched.issueType}</span></span>}
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
                                                <div className="flex gap-1 flex-wrap">
                                                    {hist.slice(-50).map((entry, i) => {
                                                        const evc = verdictConfig[entry.verdict];
                                                        return (
                                                            <Link
                                                                key={i}
                                                                to={`/investigation/${entry.investigationId}`}
                                                                title={`${new Date(entry.timestamp).toLocaleString()} — ${evc.label}${entry.summary ? `: ${entry.summary.substring(0, 100)}` : ''}`}
                                                                className={`w-3 h-3 rounded-sm ${evc.dot} opacity-80 hover:opacity-100 transition-opacity`}
                                                            />
                                                        );
                                                    })}
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


