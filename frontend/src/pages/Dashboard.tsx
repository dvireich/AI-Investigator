import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Investigation } from '../api';
import { Play, Pause, Activity, CheckCircle2, XCircle, Clock, Search, FileText, ChevronRight, Timer, BookOpen, Pencil, Server, Trash2, Ban } from 'lucide-react';

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

export const Dashboard = () => {
    const [investigations, setInvestigations] = useState<Investigation[]>([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'aborted'>('all');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = () => api.listInvestigations().then(setInvestigations).catch(console.error);
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, []);

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

    const filtered = investigations
        .filter(inv => filter === 'all' || inv.status === filter)
        .filter(inv => {
            if (!search) return true;
            const s = search.toLowerCase();
            return (
                (inv.title || '').toLowerCase().includes(s) ||
                (inv.query || '').toLowerCase().includes(s) ||
                (inv.stamp || '').toLowerCase().includes(s) ||
                (inv.issueType || '').toLowerCase().includes(s) ||
                inv.id.toLowerCase().includes(s) ||
                inv.thoughts.some(t => typeof t === 'string' && t.toLowerCase().includes(s))
            );
        });

    // Sort: Running first, then by date descending
    const sorted = [...filtered].sort((a, b) => {
        const aActive = a.status === 'running' || a.status === 'paused';
        const bActive = b.status === 'running' || b.status === 'paused';

        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;

        // If both active or both inactive, sort by ID/Date descending
        // Assuming ID is somewhat time-based or we have a timestamp?
        // Let's use string comparison of ID as proxy if no timestamp, or just order by index if list is time-ordered
        return b.id.localeCompare(a.id);
    });

    // Stats
    const activeCount = investigations.filter(i => i.status === 'running' || i.status === 'paused').length;
    const completedCount = investigations.filter(i => i.status === 'completed').length;
    const failedCount = investigations.filter(i => i.status === 'failed').length;
    const abortedCount = investigations.filter(i => i.status === 'aborted').length;

    const getTag = (inv: Investigation) => {
        if (inv.issueType) return `#${inv.issueType}`;
        if (inv.trackingId) return `#${inv.trackingId}`;
        return `#${inv.id.slice(-6)}`;
    };

    const getLaunchTime = (inv: Investigation) => {
        if (isNaN(Number(inv.id))) return 'Legacy';
        return new Date(Number(inv.id)).toLocaleString();
    };

    const getLastThought = (inv: Investigation) => {
        if (!inv.thoughts || inv.thoughts.length === 0) return "Starting investigation...";
        const last = inv.thoughts[inv.thoughts.length - 1];
        if (typeof last === 'string') return last;
        return JSON.stringify(last);
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            {/* Header & Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-1 bg-gradient-to-br from-brand-600 to-brand-700 rounded-3xl p-6 text-white shadow-xl shadow-brand-500/20 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
                    <h2 className="text-brand-100 text-sm font-medium uppercase tracking-wider mb-1">Active</h2>
                    <div className="text-4xl font-black mb-2">{activeCount}</div>
                    <div className="text-brand-200 text-xs">Investigations running</div>
                </div>
                <div className="md:col-span-1 bg-white rounded-3xl p-6 shadow-lg border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-slate-500 text-sm font-bold uppercase tracking-wider">Completed</h2>
                        <CheckCircle2 className="text-emerald-500 w-5 h-5" />
                    </div>
                    <div className="text-3xl font-bold text-slate-800">{completedCount}</div>
                </div>
                <div className="md:col-span-1 bg-white rounded-3xl p-6 shadow-lg border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-slate-500 text-sm font-bold uppercase tracking-wider">Failed</h2>
                        <XCircle className="text-red-500 w-5 h-5" />
                    </div>
                    <div className="text-3xl font-bold text-slate-800">{failedCount}</div>
                </div>
                <div className="md:col-span-1 flex flex-col justify-center gap-3">
                    <Link to="/new" className="w-full h-full flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white rounded-3xl shadow-xl transition-all group overflow-hidden relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12 group-hover:animate-shine"></div>
                        <span className="flex items-center font-bold text-lg">
                            <Play className="w-5 h-5 mr-2 fill-current" /> Start New
                        </span>
                    </Link>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white/50 backdrop-blur-md p-2 rounded-2xl border border-white/60 shadow-sm sticky top-20 z-10 transition-all">
                <div className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-brand-500 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search investigations..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white border-none rounded-xl text-sm font-medium shadow-sm focus:ring-2 focus:ring-brand-500/50 placeholder:text-slate-400"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center bg-white p-1 rounded-xl shadow-sm">
                    {['all', 'running', 'completed', 'failed', 'aborted'].map((s) => (
                        <button
                            key={s}
                            onClick={() => setFilter(s as any)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-bold capitalize transition-all ${filter === s ? 'bg-slate-900 text-white shadow-md transform scale-105' : 'text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {sorted.map((inv) => {
                    const isPaused = inv.status === 'paused';
                    const isCompleted = inv.status === 'completed';
                    const isFailed = inv.status === 'failed';
                    const isAborted = inv.status === 'aborted';
                    const isRunning = inv.status === 'running';
                    const hasRetro = !!(inv.retrospect && (inv.retrospect.messages.length > 0 || inv.retrospect.proposals.length > 0));
                    const isRetroCompleted = !!(inv.retrospect?.completed);
                    const retroProposalCount = inv.retrospect?.proposals?.length || 0;

                    return (
                        <Link key={inv.id} to={`/investigation/${inv.id}`} className={`group relative transition-all duration-300 ${isPaused || isCompleted || isRunning ? 'scale-[1.02] z-10' : ''}`}>
                            <div className={`absolute inset-0 bg-gradient-to-r ${hasRetro && !isRetroCompleted ? 'from-purple-500 to-violet-500' : isRunning ? 'from-brand-500 to-blue-500' : isCompleted ? 'from-emerald-500 to-teal-500' : isFailed ? 'from-red-500 to-rose-500' : 'from-brand-500 to-purple-500'} rounded-3xl blur opacity-0 group-hover:opacity-20 transition-opacity duration-500`}></div>

                            <div className={`relative rounded-3xl p-6 shadow-xl transition-all h-full flex flex-col ${isRunning
                                ? 'bg-blue-50/50 border-2 border-blue-400 shadow-blue-200/50 ring-4 ring-blue-100/50'
                                : isPaused
                                    ? 'bg-amber-50 border-2 border-amber-400 shadow-amber-200/50 ring-4 ring-amber-100/50'
                                    : isCompleted && hasRetro && !isRetroCompleted
                                        ? 'bg-purple-50/50 border-2 border-purple-400 shadow-purple-200/50 ring-4 ring-purple-100/50'
                                        : isCompleted
                                            ? 'bg-emerald-50/50 border-2 border-emerald-400 shadow-emerald-200/50 ring-4 ring-emerald-100/50'
                                            : isFailed
                                                ? 'bg-red-50/50 border border-red-200 hover:border-red-300 shadow-red-200/50'
                                                : 'bg-white border border-slate-100 hover:border-brand-200 shadow-slate-200/50'
                                }`}>

                                <div className="flex justify-between items-start mb-4">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${inv.status === 'running' ? 'bg-brand-50 text-brand-600' :
                                        inv.status === 'paused' ? 'bg-amber-100 text-amber-600' :
                                            inv.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                                                inv.status === 'failed' ? 'bg-red-100 text-red-600' :
                                                    inv.status === 'aborted' ? 'bg-slate-200 text-slate-500' : 'bg-slate-50 text-slate-500'
                                        }`}>
                                        {inv.status === 'running' ? <Activity className="w-6 h-6 animate-pulse" /> :
                                            inv.status === 'paused' ? <Pause className="w-6 h-6 fill-current animate-pulse" /> :
                                                inv.status === 'completed' ? <CheckCircle2 className="w-6 h-6" /> :
                                                    inv.status === 'failed' ? <XCircle className="w-6 h-6" /> :
                                                        inv.status === 'aborted' ? <Ban className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-xs font-bold font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded-lg max-w-[120px] truncate" title={getTag(inv)}>
                                            {getTag(inv)}
                                        </span>
                                        {inv.stamp && (
                                            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg max-w-[160px] truncate flex items-center gap-1" title={inv.stamp}>
                                                <Server className="w-3 h-3 shrink-0" />{inv.stamp}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-1 mb-2">
                                    {editingId === inv.id ? (
                                        <input
                                            autoFocus
                                            className="flex-1 text-lg font-bold text-slate-800 leading-tight bg-white border border-brand-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-400"
                                            value={editingTitle}
                                            onChange={(e) => setEditingTitle(e.target.value)}
                                            onBlur={() => saveTitle(inv.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveTitle(inv.id);
                                                if (e.key === 'Escape') setEditingId(null);
                                            }}
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        />
                                    ) : (
                                        <>
                                            <h3 className="flex-1 text-lg font-bold text-slate-800 line-clamp-2 leading-tight group-hover:text-brand-600 transition-colors">
                                                {inv.title || inv.query || inv.id.replace(/-/g, ' ')}
                                            </h3>
                                            <button
                                                onClick={(e) => startEditing(e, inv)}
                                                className="mt-0.5 p-1 rounded-lg text-slate-300 hover:text-brand-500 hover:bg-brand-50 transition-all opacity-0 group-hover:opacity-100"
                                                title="Edit title"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            {!isRunning && (
                                                <button
                                                    onClick={(e) => confirmDelete(e, inv.id)}
                                                    className="mt-0.5 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                                                    title="Delete investigation"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>

                                {isPaused && (
                                    <div className="mb-3 flex items-center justify-between bg-amber-100/80 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 font-bold text-xs uppercase tracking-wider animate-pulse">
                                        <div className="flex items-center">
                                            <Pause className="w-4 h-4 mr-2 fill-current" />
                                            Investigation Paused
                                        </div>
                                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
                                    </div>
                                )}

                                {isCompleted && (
                                    <div className="mb-3 flex items-center justify-between bg-emerald-100/80 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                                        <div className="flex items-center">
                                            <CheckCircle2 className="w-4 h-4 mr-2" />
                                            Investigation Completed
                                        </div>
                                    </div>
                                )}

                                {hasRetro && (
                                    <div className={`mb-3 flex items-center justify-between rounded-lg px-3 py-2 font-bold text-xs uppercase tracking-wider ${
                                        isRetroCompleted
                                            ? 'bg-emerald-100/80 border border-emerald-200 text-emerald-700'
                                            : 'bg-purple-100/80 border border-purple-200 text-purple-700'
                                    }`}>
                                        <div className="flex items-center">
                                            {isRetroCompleted
                                                ? <><CheckCircle2 className="w-4 h-4 mr-2" />Retro Complete</>
                                                : <><BookOpen className="w-4 h-4 mr-2" />Retrospective Active</>}
                                        </div>
                                        {retroProposalCount > 0 && !isRetroCompleted && (
                                            <span className="bg-purple-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                                                {retroProposalCount}
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="flex-1">
                                    {inv.status === 'running' && (
                                        <div className="mb-2 flex items-center text-xs font-bold text-brand-600 uppercase tracking-widest bg-brand-50 w-fit px-2 py-1 rounded">
                                            <Activity className="w-3 h-3 mr-1 animate-spin" />
                                            In Progress
                                        </div>
                                    )}
                                    <p className="text-sm text-slate-500 line-clamp-3 mb-4">
                                        {getLastThought(inv)}
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-slate-100 flex flex-col gap-2 text-xs text-slate-400 font-medium">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center" title="Launch Time">
                                            <Clock className="w-3.5 h-3.5 mr-1.5" />
                                            {getLaunchTime(inv)}
                                        </div>
                                        {(inv.status === 'running' || inv.status === 'paused') && !isNaN(Number(inv.id)) && (
                                            <div className={`flex items-center font-bold px-2 py-0.5 rounded-full ${isPaused ? 'bg-amber-100 text-amber-600' : 'bg-brand-50 text-brand-600'
                                                }`}>
                                                <Timer className="w-3 h-3 mr-1" />
                                                <DurationTimer startTime={Number(inv.id)} pausedAt={inv.pausedAt} totalPausedTime={inv.totalPausedTime} />
                                            </div>
                                        )}
                                        {isCompleted && !isNaN(Number(inv.id)) && (
                                            <div className="flex items-center font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">
                                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                                Finished
                                            </div>
                                        )}
                                        {hasRetro && (
                                            <div className={`flex items-center font-bold px-2 py-0.5 rounded-full ${isRetroCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-purple-100 text-purple-600'}`}>
                                                {isRetroCompleted
                                                    ? <><CheckCircle2 className="w-3 h-3 mr-1" />Retro Done</>
                                                    : <><BookOpen className="w-3 h-3 mr-1" />Retro{retroProposalCount > 0 ? ` (${retroProposalCount})` : ''}</>}
                                            </div>
                                        )}
                                    </div>

                                    <div className={`flex justify-end items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${hasRetro && !isRetroCompleted ? 'text-purple-600' : isPaused ? 'text-amber-600' : isCompleted ? 'text-emerald-600' : isFailed ? 'text-red-600' : 'text-brand-600'
                                        }`}>
                                        {isPaused ? 'Resume Investigation' : isCompleted ? 'View Report' : 'Open Investigation'} <ChevronRight className="w-4 h-4 ml-1" />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>

            {sorted.length === 0 && (
                <div className="text-center py-20">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                        <Search className="w-6 h-6 text-slate-400" />
                    </div>
                    {investigations.length === 0 ? (
                        <>
                            <h3 className="text-slate-900 font-bold mb-1">No investigations yet</h3>
                            <p className="text-slate-500 text-sm">Start your first investigation to get going.</p>
                            <Link to="/new" className="mt-4 inline-flex items-center px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors">
                                <Play className="w-4 h-4 mr-2 fill-current" /> Start New
                            </Link>
                        </>
                    ) : (
                        <>
                            <h3 className="text-slate-900 font-bold mb-1">No matching investigations</h3>
                            <p className="text-slate-500 text-sm">Try adjusting your search or filters.</p>
                        </>
                    )}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deletingId && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setDeletingId(null)}>
                    <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <Trash2 className="w-5 h-5 text-red-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">Delete Investigation</h3>
                        </div>
                        <p className="text-sm text-slate-600 mb-6">This will permanently delete this investigation and all its data. This action cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setDeletingId(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                            <button onClick={executeDelete} className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
