import React, { useEffect, useState, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, BASE_URL, type Investigation, type Recommendation } from '../api';
import { useToast } from '../components/Toast';
import { Play, Pause, XCircle, Send, Terminal, Cpu, Activity, Clock, FileText, RefreshCw, Bot, User, AlertTriangle, MessageSquare, Sparkles, Copy, Check, X, ChevronDown, ChevronRight, FilePlus, FileEdit, Loader2, CheckCircle2, ArrowDownToLine, RotateCcw, WifiOff, Wifi, FolderOpen, Search, Share2, FileDown, Calendar, Tag, Plus, Wrench, Code, Trash2, StickyNote } from 'lucide-react';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ScrollToTop } from '../components/ScrollToTop';
import { useNotification } from '../hooks/useNotification';
import { useDocumentTitle, buildInvestigationTitle } from '../hooks/useDocumentTitle';
import { ProgressRing } from '../components/ProgressRing';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Format a raw time range string into a human-readable display */
function formatTimeRange(raw: string): string {
    // Pattern: between(datetime(...) .. datetime(...))
    const betweenMatch = raw.match(
        /between\s*\(\s*datetime\(([^)]+)\)\s*\.\.\s*datetime\(([^)]+)\)\s*\)/i
    );
    if (betweenMatch) {
        const start = new Date(betweenMatch[1]);
        const end = new Date(betweenMatch[2]);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const fmt = (d: Date) => d.toLocaleString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
            });
            // Calculate duration label
            const diffMs = end.getTime() - start.getTime();
            let durLabel = '';
            if (diffMs > 0) {
                const mins = Math.round(diffMs / 60000);
                if (mins < 60) durLabel = `${mins}m`;
                else if (mins < 1440) durLabel = `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h`;
                else durLabel = `${(mins / 1440).toFixed(1)}d`;
            }
            return `${fmt(start)}  \u2192  ${fmt(end)}${durLabel ? `  (${durLabel})` : ''}`;
        }
    }

    // Pattern: ago(Xh) / ago(Xm) / ago(Xd)
    const agoMatch = raw.match(/^ago\(([\d.]+)([hmd])\)$/i);
    if (agoMatch) {
        const val = parseFloat(agoMatch[1]);
        const unit = agoMatch[2].toLowerCase();
        const unitLabel = unit === 'h' ? 'hour' : unit === 'm' ? 'minute' : 'day';
        return `Last ${val} ${unitLabel}${val !== 1 ? 's' : ''}`;
    }

    return raw;
}


const DurationTimer = ({ startTime, status, pausedAt, totalPausedTime }: { startTime: string | number, status: string, pausedAt?: number, totalPausedTime?: number }) => {
    const [elapsed, setElapsed] = useState('');

    useEffect(() => {
        const update = () => {
            const start = new Date(startTime).getTime();
            // DurationTimer only renders when status === 'running'; simplified from paused-check
            const end = new Date().getTime();
            const paused = totalPausedTime || 0;
            const diff = Math.max(0, end - start - paused);

            const hours = Math.floor(diff / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);

            let str = '';
            if (hours > 0) str += `${hours}h `;
            if (minutes > 0 || hours > 0) str += `${minutes}m `;
            str += `${seconds}s`;

            setElapsed(str);
        };

        const interval = setInterval(update, 1000);
        update();

        return () => clearInterval(interval);
    }, [startTime, status, pausedAt, totalPausedTime]);

    return <span>{elapsed}</span>;
}



const ActionResult = ({ result, truncated, onExpand, loading }: { result: string | any, truncated?: boolean, onExpand?: () => void, loading?: boolean }) => {
    const [expanded, setExpanded] = useState(false);
    const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    // If truncated by backend
    if (truncated) {
        return (
            <div className="mt-2 text-slate-400/80 text-xs">
                <div className="uppercase tracking-wider text-[10px] text-emerald-600/80 font-bold mb-1 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1"><Terminal className="w-3 h-3" /> Tool Output (Preview)</div>
                    <button
                        onClick={onExpand}
                        disabled={loading}
                        className="text-brand-500 hover:underline text-[10px] flex items-center"
                    >
                        {loading && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                        Load Full Output
                    </button>
                </div>
                <div className="max-h-40 overflow-hidden bg-slate-950 rounded-lg border border-slate-800 p-3 custom-scrollbar opacity-80 relative">
                    <div className="prose prose-invert prose-xs max-w-none">
                        <pre className="font-mono text-xs whitespace-pre-wrap">{content}</pre>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none"></div>
                </div>
            </div>
        );
    }

    const isLong = content.length > 2000;
    const displayContent = expanded || !isLong ? content : content.substring(0, 2000) + "\n\n... (Output truncated)";

    return (
        <div className="mt-2 text-slate-400/80 text-xs">
            <div className="uppercase tracking-wider text-[10px] text-emerald-600/80 font-bold mb-1 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1"><Terminal className="w-3 h-3" /> Tool Output</div>
                {isLong && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-brand-500 hover:underline text-[10px]"
                    >
                        {expanded ? "Show Less" : `Show All (${Math.round(content.length / 1024)}KB)`}
                    </button>
                )}
            </div>
            <div className={`overflow-y-auto bg-slate-950 rounded-lg border border-slate-800 p-3 custom-scrollbar ${expanded ? 'max-h-[800px]' : 'max-h-80'}`}>
                <div className="prose prose-invert prose-xs max-w-none prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-800">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {displayContent}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
};


const StepItem = React.memo(({ thought, action, index, id }: { thought: any, action: any, index: number, id: string }) => {
    const { toast } = useToast();
    const [fullThought, setFullThought] = useState<any>(null);
    const [fullActionResult, setFullActionResult] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Check truncation flags
    const isThoughtTruncated = thought._truncated && !fullThought;
    const isActionTruncated = action?.result && action._truncated_result && !fullActionResult;

    const displayThought = fullThought || thought;
    const displayAction = { ...action, result: fullActionResult || action?.result };
    const thoughtContent = typeof displayThought === 'string' ? displayThought : (displayThought.content || JSON.stringify(displayThought, null, 2));

    const fetchFull = async () => {
        setLoading(true);
        try {
            const data = await api.getStepDetails(id, index);
            setFullThought(data.thought);
            if (data.action?.result) setFullActionResult(data.action.result);
        } catch (e) {
            console.error(e);
            toast('error', 'Failed to load details');
        } finally {
            setLoading(false);
        }
    };

    const isSystemMessage = typeof thoughtContent === 'string' && thoughtContent.startsWith('System:');
    const isUserMessage = typeof thoughtContent === 'string' && thoughtContent.startsWith('User Intervention:');
    const isContestMessage = typeof thoughtContent === 'string' && thoughtContent.startsWith('Report Contested:');
    const isObservation = typeof thoughtContent === 'string' && thoughtContent.startsWith('Observation:');

    if (isSystemMessage) {
        return (
            <div className="flex justify-center my-6 animate-fade-in px-3 sm:px-8">
                <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm text-slate-400 text-xs px-4 py-1.5 rounded-full shadow-sm flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80"></div>
                    <span className="font-medium">{thoughtContent.replace('System: ', '')}</span>
                </div>
            </div>
        );
    }

    // New: Render "Log" type thoughts (Gray, small, less important)
    const isLog = (thought as any).type === 'log';
    if (isLog) {
        return (
            <div className="flex justify-start my-1 animate-fade-in px-3 pl-4 sm:px-8 sm:pl-12 opacity-60 hover:opacity-100 transition-opacity">
                <div className="text-[10px] font-mono text-slate-500 flex items-center gap-2 border-l-2 border-slate-800 pl-2">
                    <Terminal className="w-3 h-3" />
                    <span>{thoughtContent}</span>
                </div>
            </div>
        );
    }

    if (isUserMessage) {
        return (
            <div className="flex justify-end my-4 animate-fade-in pl-4 sm:pl-12 group items-end gap-2">
                <div className="bg-brand-500/10 border border-brand-500/20 text-brand-100 rounded-2xl rounded-tr-none p-3 sm:p-4 shadow-sm max-w-[85%] relative">
                    <div className="text-[10px] text-brand-400 font-bold mb-1 uppercase tracking-wider flex items-center justify-end gap-1 opacity-70">
                        User Intervention
                    </div>
                    <div className="prose prose-invert prose-sm text-brand-50 max-w-none">
                        {thoughtContent.replace('User Intervention: ', '').replace(/\(SYSTEM NOTE:.*\)/s, '').trim()}
                    </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-brand-500/10">
                    <User className="w-4 h-4 text-brand-400" />
                </div>
            </div>
        );
    }

    if (isContestMessage) {
        return (
            <div className="flex justify-end my-4 animate-fade-in pl-4 sm:pl-12 group items-end gap-2">
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-100 rounded-2xl rounded-tr-none p-3 sm:p-4 shadow-sm max-w-[85%] relative">
                    <div className="text-[10px] text-amber-400 font-bold mb-1 uppercase tracking-wider flex items-center justify-end gap-1 opacity-70">
                        <RotateCcw className="w-3 h-3" />
                        Report Contested
                    </div>
                    <div className="prose prose-invert prose-sm text-amber-50 max-w-none">
                        {thoughtContent.replace('Report Contested: ', '').trim()}
                    </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-amber-500/10">
                    <User className="w-4 h-4 text-amber-400" />
                </div>
            </div>
        );
    }

    // Hide the full LLM context message for contested reports (only for the agent, not the user)
    if (typeof thoughtContent === 'string' && thoughtContent.startsWith('CONTESTED REPORT (attempt')) {
        return null;
    }

    // Check for Azure Auth Error — only show the auth prompt when the error
    // is specifically "Azure Authentication Required", not when the message
    // is a generic "tools unavailable" message that happens to contain the old error text.
    // Note: AzureAuthPrompt has been removed; this is now a no-op for backward compatibility
    // with old investigation states that may contain this text.

    if (isObservation) {
        return (
            <div className="flex justify-start my-2 animate-fade-in pr-4 group pl-2">
                <div className="bg-slate-950 border-l-2 border-slate-700 text-slate-400 p-3 shadow-inner w-full font-mono text-xs overflow-x-auto relative">
                    <div className="text-[10px] text-slate-500 font-bold mb-1 uppercase tracking-wider flex items-center gap-2 opacity-70">
                        Input/Output Log
                    </div>
                    <div className="whitespace-pre-wrap opacity-90 text-slate-300">
                        {thoughtContent.replace('Observation: ', '')}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 my-4 animate-slide-in-bottom">
            {/* 1. Agent Thought Bubble */}
            {thoughtContent && (
                <div className="flex justify-start pr-3 sm:pr-12 group items-end gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/10">
                        <Bot className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="bg-slate-800 border border-slate-700 text-slate-300 rounded-2xl rounded-tl-none p-4 shadow-sm max-w-[95%] relative">
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {thoughtContent}
                            </ReactMarkdown>
                        </div>

                        {isThoughtTruncated && (
                            <button onClick={fetchFull} disabled={loading} className="text-xs text-brand-400 hover:text-brand-300 hover:underline mt-2 flex items-center font-medium transition-colors">
                                {loading && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                                Read More...
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* 2. Action Execution Card (Separate) */}
            {action && (
                <div className="flex justify-start pl-3 pr-2 sm:pl-10 sm:pr-4 animate-expand-in">
                    <div className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-0 overflow-hidden shadow-sm">
                        {/* Header */}
                        <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="bg-emerald-500/10 p-1 rounded text-emerald-400">
                                    <Cpu className="w-3.5 h-3.5" />
                                </div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Executing Tool</span>
                                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{action.tool}</span>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-3 space-y-3">
                            <div className="bg-slate-950 rounded-lg p-3 text-xs text-slate-400 overflow-x-auto font-mono border border-slate-800">
                                {JSON.stringify(action.args, null, 2)}
                            </div>

                            {action.result && (
                                <ActionResult
                                    result={displayAction.result}
                                    truncated={isActionTruncated}
                                    onExpand={fetchFull}
                                    loading={loading}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}); // End of StepItem memo

const ModelSelector = ({ currentModel, availableModels, onSelect }: { currentModel: string, availableModels: string[], onSelect: (model: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const models = availableModels.length > 0 ? availableModels : ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-200 transition-all shadow-sm group"
            >
                <span className="truncate mr-2">{currentModel}</span>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full min-w-0 sm:min-w-[180px] max-w-[calc(100vw-2rem)] bg-slate-800 rounded-lg shadow-xl border border-slate-700 py-1 animate-in fade-in zoom-in-95 duration-100 origin-top-right right-0">
                    <div className="px-3 py-2 border-b border-slate-700 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                        Select Model
                    </div>
                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {models.map(model => (
                            <button
                                key={model}
                                onClick={() => {
                                    onSelect(model);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-700/50 transition-colors ${currentModel === model ? 'text-brand-400 font-bold bg-brand-500/10' : 'text-slate-300'}`}
                            >
                                {model}
                                {currentModel === model && <div className="w-1.5 h-1.5 rounded-full bg-brand-500"></div>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const InterventionInput = ({ onSend, status }: { onSend: (msg: string) => void, status: string }) => {
    const [msg, setMsg] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (msg.trim()) {
            onSend(msg);
            setMsg('');
        }
    };

    return (
        <div className={`rounded-xl p-1 shadow-lg border flex items-center gap-2 transition-all ${status === 'running' ? 'bg-slate-900 border-slate-700 focus-within:border-brand-500/50' : 'bg-slate-900/50 border-slate-800 opacity-60'}`}>
            <div className="pl-3 pr-1">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${status === 'running' ? 'bg-brand-500/10 text-brand-500' : 'bg-slate-800 text-slate-600'}`}>
                    <User className="w-3.5 h-3.5" />
                </div>
            </div>
            {status === 'running' ? (
                <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
                    <input
                        type="text"
                        className="flex-1 px-2 py-2 bg-transparent border-0 focus:ring-0 text-slate-200 placeholder:text-slate-600 font-medium text-sm"
                        placeholder="Provide feedback or instructions..."
                        value={msg}
                        onChange={(e) => setMsg(e.target.value)}
                    />
                    <button
                        type="submit"
                        className={`p-1.5 mr-1 rounded-lg transition-all ${!msg.trim() ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-500 text-white'}`}
                    >
                        <Send className="w-3.5 h-3.5" />
                    </button>
                </form>
            ) : (
                <div className="flex-1 px-2 py-2">
                    <span className="text-sm text-slate-500 italic">Session paused.</span>
                </div>
            )}
        </div>
    );
};

/** Extracted contest form — isolates keystroke re-renders from the heavy parent component */
const ContestForm = React.memo(({ onContest, actingAction, disabled }: { onContest: (feedback: string) => Promise<void>; actingAction: string | null; disabled?: boolean }) => {
    const [showForm, setShowForm] = useState(false);
    const [feedback, setFeedback] = useState('');

    const handleSubmit = async () => {
        await onContest(feedback.trim());
        setFeedback('');
        setShowForm(false);
    };

    if (!showForm) {
        return (
            <button
                onClick={() => setShowForm(true)}
                disabled={disabled}
                title={disabled ? 'Cannot contest while implementation is running' : undefined}
                className="group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 overflow-hidden text-amber-200/90 hover:text-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
                {/* Animated gradient border */}
                <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/25 via-orange-500/25 to-amber-500/25 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <span className="absolute inset-[1px] rounded-[11px] bg-slate-900/90 backdrop-blur-sm" />
                {/* Subtle border */}
                <span className="absolute inset-0 rounded-xl border border-amber-500/20 group-hover:border-amber-400/40 transition-colors duration-300" />
                {/* Content */}
                <span className="relative flex items-center gap-2.5">
                    <RotateCcw className="w-4 h-4 text-amber-400 group-hover:rotate-[-45deg] transition-transform duration-500 ease-out" />
                    Contest Report
                </span>
            </button>
        );
    }

    return (
        <div className="w-full basis-full p-5 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <span className="font-bold text-amber-200 text-sm">Contest This Report</span>
                </div>
                <button
                    onClick={() => { setShowForm(false); setFeedback(''); }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-all"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
            <textarea
                autoFocus
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="Explain what's wrong with this report or what the investigation should explore further..."
                className="w-full h-20 px-3.5 py-2.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-slate-200 placeholder-slate-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
            />
            <div className="flex items-center justify-end gap-3">
                <button
                    onClick={() => { setShowForm(false); setFeedback(''); }}
                    className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800/50 transition-all"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!feedback.trim() || actingAction === 'contest'}
                    className="group relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 overflow-hidden text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-600/30 to-orange-600/30 group-hover:from-amber-600/50 group-hover:to-orange-600/50 transition-all duration-300" />
                    <span className="absolute inset-[1px] rounded-[11px] bg-slate-900/80" />
                    <span className="absolute inset-0 rounded-xl border border-amber-500/30 group-hover:border-amber-400/50 transition-colors duration-300" />
                    <span className="relative flex items-center gap-2">
                        {actingAction === 'contest' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                        {actingAction === 'contest' ? 'Contesting...' : 'Contest & Resume'}
                    </span>
                </button>
            </div>
        </div>
    );
});

/* Isolated editable-title component.
   Uses an uncontrolled editing pattern: while the user is typing, parent
   re-renders (from WebSocket-driven fetchInvestigation) are completely ignored
   because all editing state is local and we skip memo comparison during editing. */
function implProposalStatusClass(status: string): string {
    if (status === 'applied') return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
    if (status === 'approved') return 'bg-sky-500/15 text-sky-400 border border-sky-500/20';
    if (status === 'rejected') return 'bg-red-500/15 text-red-400 border border-red-500/20';
    return 'bg-amber-500/15 text-amber-400 border border-amber-500/20';
}

export const InvestigationDetail = () => {
    const { toast } = useToast();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [investigation, setInvestigation] = useState<Investigation | null>(null);
    // Removed interventionMsg state to prevent re-renders
    const [showQueryModal, setShowQueryModal] = useState(false);
    const [actingAction, setActingAction] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<'live' | 'report' | 'retrospect' | 'notes'>('live');
    const [isRetrospectThinking, setIsRetrospectThinking] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
    const [applyingProposals, setApplyingProposals] = useState(false);
    const analysisTriggeredRef = useRef(false);
    const [retroToolActivity, setRetroToolActivity] = useState<string | null>(null);
    const [pendingInterventions, setPendingInterventions] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
    const [wsConnected, setWsConnected] = useState(true);
    const [wsJustReconnected, setWsJustReconnected] = useState(false);
    const hadDisconnectRef = useRef(false);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const retrospectEndRef = useRef<HTMLDivElement>(null);
    const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [exporting, setExporting] = useState<'share' | 'pdf' | null>(null);
    const [tagInput, setTagInput] = useState('');
    const [addingTag, setAddingTag] = useState(false);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const [showImplModal, setShowImplModal] = useState(false);
    const [implRecommendations, setImplRecommendations] = useState<Recommendation[]>([]);
    const [implSelected, setImplSelected] = useState<Set<string>>(new Set());
    const [implLoading, setImplLoading] = useState(false);
    const [implRunning, setImplRunning] = useState(false);
    const implStartedAtRef = useRef<number>(0);
    const [thoughtSearch, setThoughtSearch] = useState('');
    const deferredThoughtSearch = useDeferredValue(thoughtSearch);
    const { notify: browserNotify } = useNotification();
    const prevStatusRef = useRef<string | null>(null);
    const [justCompleted, setJustCompleted] = useState(false);
    const completedTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const [maxSteps, setMaxSteps] = useState<number>(0);
    const [notFound, setNotFound] = useState(false);
    const notesRef = useRef<HTMLTextAreaElement>(null);
    const [notesSaving, setNotesSaving] = useState(false);
    const [notesSaved, setNotesSaved] = useState(false);
    const notesSavedTimer = useRef<ReturnType<typeof setTimeout>>();
    const notesInitialized = useRef(false);

    // Memoized thought filtering to avoid re-filtering on every render
    const filteredThoughts = useMemo(() => {
        if (!investigation) return [];
        if (!deferredThoughtSearch) return investigation.thoughts;
        const q = deferredThoughtSearch.toLowerCase();
        return investigation.thoughts.filter((t: any) => {
            const content = typeof t === 'string' ? t : (t?.content || '');
            return content.toLowerCase().includes(q);
        });
    }, [investigation?.thoughts, deferredThoughtSearch]);

    // Dynamic tab title
    useDocumentTitle(
        investigation ? buildInvestigationTitle(investigation.status, investigation.title || investigation.query) : null
    );

    // Track status transitions for browser notifications + celebration
    useEffect(() => {
        if (!investigation) return;
        const prev = prevStatusRef.current;
        if (prev && prev !== investigation.status) {
            const name = investigation.title || investigation.query || investigation.id;
            if (investigation.status === 'completed') {
                browserNotify('Investigation Completed', `${name} finished successfully.`, 'completed');
                setJustCompleted(true);
                completedTimerRef.current = setTimeout(() => setJustCompleted(false), 1500);
            }
            if (investigation.status === 'failed') browserNotify('Investigation Failed', `${name} encountered an error.`, 'failed');
            if (investigation.status === 'paused') browserNotify('Investigation Paused', `${name} has been paused.`, 'paused');
        }
        prevStatusRef.current = investigation.status;
        return () => { clearTimeout(completedTimerRef.current); };
    }, [investigation?.status, investigation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        api.listModels()
            .then(models => setAvailableModels(Array.from(new Set(models))))
            .catch(err => console.error("Failed to load models", err));
    }, []);

    const filteredLogs = useMemo(() => {
        if (!investigation?.logs) return [];
        // Show all logs, just slice the last 100 to avoid performance issues
        return investigation.logs.slice(-100);
    }, [investigation?.logs]);

    const stepColors = useMemo(() => {
        switch (investigation?.status) {
            case 'running': return { ring: 'text-brand-400', bar: 'bg-brand-500', barAnimate: 'animate-pulse', label: 'text-brand-400', circleBorder: 'border-brand-500/30', circleBg: 'bg-brand-500/10' };
            case 'paused': return { ring: 'text-amber-400', bar: 'bg-amber-500', barAnimate: '', label: 'text-amber-400', circleBorder: 'border-amber-500/30', circleBg: 'bg-amber-500/10' };
            case 'completed': return { ring: 'text-emerald-400', bar: 'bg-emerald-500', barAnimate: '', label: 'text-emerald-400', circleBorder: 'border-emerald-500/30', circleBg: 'bg-emerald-500/10' };
            case 'failed': return { ring: 'text-red-400', bar: 'bg-red-500', barAnimate: '', label: 'text-red-400', circleBorder: 'border-red-500/30', circleBg: 'bg-red-500/10' };
            default: return { ring: 'text-slate-400', bar: 'bg-slate-500', barAnimate: '', label: 'text-slate-400', circleBorder: 'border-slate-500/30', circleBg: 'bg-slate-500/10' };
        }
    }, [investigation?.status]);

    const showTokenAlert = useMemo(() => {
        if (!investigation) return false;
        // Check if last thought was a token alert
        const lastThought = investigation.thoughts[investigation.thoughts.length - 1];
        if (!lastThought) return false;

        const content = typeof lastThought === 'string' ? lastThought : (lastThought as any).content;
        return content && (content.includes('Token limit exceeded') || content.includes('System Alert: Token limit'));
    }, [investigation?.thoughts]);

    const fetchInvestigation = async () => {
        try {
            const data = await api.getInvestigation(id!);
            setInvestigation(data);

            // Reconcile pending interventions: remove any that now appear in thoughts
            if (data.thoughts && data.thoughts.length > 0) {
                setPendingInterventions(prev => {
                    if (prev.length === 0) return prev;
                    return prev.filter(pending => {
                        // Check if any thought contains this pending message text
                        return !data.thoughts.some((t: any) => {
                            const content = typeof t === 'string' ? t : (t.content || '');
                            return content.startsWith('User Intervention:') && content.includes(pending.text);
                        });
                    });
                });
            }
        } catch (err: any) {
            console.error(err);
            // If investigation not found, show friendly message
            if (err.message === 'Not found' || err.status === 404) {
                console.log('Investigation not found (may have been cleaned up by retention policy)');
                setNotFound(true);
            }
        }
    };

    useEffect(() => {
        fetchInvestigation();
        api.getSettings().then((s: any) => {
            if (typeof s.maxSteps === 'number') setMaxSteps(s.maxSteps);
        }).catch(() => {});
    }, [id, navigate]);

    // Pre-load recommendations when investigation completes (already extracted by backend)
    useEffect(() => {
        if (!investigation || !id) return;
        if (investigation.status !== 'completed') {
            // Clear stale recommendations when investigation is no longer completed (e.g. after contest)
            if (implRecommendations.length > 0) setImplRecommendations([]);
            return;
        }
        api.getRecommendations(id).then(recs => {
            if (recs.length > 0) setImplRecommendations(recs);
        }).catch(() => {}); // best-effort
    }, [investigation?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

    // WebSocket logic with auto-reconnect
    useEffect(() => {
        let ws: WebSocket | null = null;
        let reconnectTimeout: any;
        let reconnectAttempts = 0;
        let intentionallyClosed = false;
        const MAX_RECONNECT_DELAY = 30_000; // 30s cap

        const connect = () => {
            // When BASE_URL is empty (relative /api), derive WebSocket URL from page origin
            const wsBase = BASE_URL
                ? BASE_URL.replace(/^http/, 'ws')
                : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
            ws = new WebSocket(`${wsBase}/ws?id=${id}`);

            ws.onopen = () => {
                console.log('Connected to WebSocket');
                reconnectAttempts = 0;
                setWsConnected(true);
                // Show brief "reconnected" overlay if this was a reconnect
                if (hadDisconnectRef.current) {
                    setWsJustReconnected(true);
                    reconnectTimerRef.current = setTimeout(() => setWsJustReconnected(false), 2000);
                    hadDisconnectRef.current = false;
                }
                // Fetch latest state on connection to ensure we didn't miss anything
                fetchInvestigation();
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'thought' || message.type === 'action' || message.type === 'status' || message.type === 'log' || message.type === 'retrospect' || message.type === 'retrospect-proposal') {
                        // Debounce: schedule a fetch, cancelling any pending one
                        if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
                        fetchDebounceRef.current = setTimeout(() => fetchInvestigation(), 300);
                    }
                    if (message.type === 'retrospect-tool-activity' && message.data) {
                        setRetroToolActivity(message.data.description || message.data.tool);
                    }
                    // Clear tool activity when we get a full retrospect update (means a cycle completed)
                    if (message.type === 'retrospect') {
                        setRetroToolActivity(null);
                    }
                } catch (e) {
                    console.error("WebSocket message error:", e);
                }
            };

            ws.onerror = (e) => {
                console.error("WebSocket error:", e);
            };

            ws.onclose = () => {
                console.log("WebSocket disconnected");
                setWsConnected(false);
                hadDisconnectRef.current = true;
                if (!intentionallyClosed) {
                    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
                    reconnectAttempts++;
                    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
                    reconnectTimeout = setTimeout(connect, delay);
                }
            };
        };

        connect();

        return () => {
            intentionallyClosed = true;
            if (ws) {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
            }
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
            clearTimeout(reconnectTimerRef.current);
        };
    }, [id]);

    // Reconnect WebSocket and refresh data when tab regains focus
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchInvestigation();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [investigation?.thoughts.length, pendingInterventions.length]);  // Also scroll when pending messages are added

    // Cleanup stale pending interventions (safety net: remove after 2 minutes)
    useEffect(() => {
        if (pendingInterventions.length === 0) return;
        const interval = setInterval(() => {
            const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
            setPendingInterventions(prev => {
                const filtered = prev.filter(p => p.timestamp > twoMinutesAgo);
                return filtered.length === prev.length ? prev : filtered;
            });
        }, 10_000);
        return () => clearInterval(interval);
    }, [pendingInterventions.length]);


    // Auto-scroll retrospect chat
    useEffect(() => {
        if (retrospectEndRef.current) {
            retrospectEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [investigation?.retrospect?.messages.length, activeTab]);

    // Auto-switch away from report/retrospect tabs when investigation is contested
    // (finalReport cleared → report tab disabled, status back to running → retrospect tab hidden)
    useEffect(() => {
        if (!investigation) return;
        if (activeTab === 'report' && !investigation.finalReport) {
            setActiveTab('live');
        }
        if (activeTab === 'retrospect' && !['completed', 'failed', 'aborted'].includes(investigation.status)) {
            setActiveTab('live');
        }
        // Reset retrospective analysis trigger so it can fire again after contest
        if (investigation.status === 'running') {
            analysisTriggeredRef.current = false;
        }
    }, [investigation?.finalReport, investigation?.status, activeTab]);

    // Sync notes textarea from investigation data (only on first load)
    useEffect(() => {
        if (investigation && !notesInitialized.current && notesRef.current) {
            notesRef.current.value = investigation.userNotes || '';
            notesInitialized.current = true;
        }
    }, [investigation]);

    // Auto-trigger retrospective analysis when tab is first opened
    // Uses useRef instead of useState so the guard survives React StrictMode's
    // mount → cleanup → remount cycle and prevents duplicate API calls.
    useEffect(() => {
        let mounted = true;
        if (
            activeTab === 'retrospect' &&
            investigation &&
            ['completed', 'failed', 'aborted'].includes(investigation.status) &&
            !investigation.retrospect?.analysisComplete &&
            !isAnalyzing &&
            !analysisTriggeredRef.current
        ) {
            analysisTriggeredRef.current = true;
            setIsAnalyzing(true);
            api.analyzeRetrospect(investigation.id)
                .then(() => { if (mounted) fetchInvestigation(); })
                .catch(err => {
                    // 409 means analysis is already running on the server (e.g. user navigated away
                    // and back while it was in progress). Keep isAnalyzing=true so the spinner stays
                    // visible — WS events / the analysisComplete useEffect will clear it when done.
                    const isAlreadyRunning = err.message.includes('currently being processed');
                    if (!isAlreadyRunning) {
                        console.error('Auto-analysis failed:', err);
                        if (mounted) { setIsAnalyzing(false); setRetroToolActivity(null); }
                    }
                });
        }
        return () => { mounted = false; };
    }, [activeTab, investigation?.id, investigation?.status, investigation?.retrospect?.analysisComplete]);

    // Clear the local isAnalyzing spinner as soon as the server confirms analysis is done.
    // This is the primary cleanup path when the 409 "already running" branch keeps isAnalyzing=true
    // while the actual run completes asynchronously via WS / state polling.
    useEffect(() => {
        if (investigation?.retrospect?.analysisComplete) {
            setIsAnalyzing(false);
        }
    }, [investigation?.retrospect?.analysisComplete]);

    // Detect when implementation agent finishes (message with "Implementation complete" or error)
    useEffect(() => {
        if (!implRunning || !investigation?.retrospect?.messages) return;
        const msgs = investigation.retrospect.messages;
        const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
        const implTerminals = ['Implementation complete', 'Implementation was cancelled', 'Error during implementation'];
        if (lastAssistant && implTerminals.some(t => lastAssistant.content.includes(t))) {
            setImplRunning(false);
        }
    }, [implRunning, investigation?.retrospect?.messages]);

    // Sync implRunning from server state so navigating away and back restores the spinner
    useEffect(() => {
        if (investigation?.implementationRunning && !implRunning) {
            setImplRunning(true);
            implStartedAtRef.current = Date.now();
        } else if (investigation && !investigation.implementationRunning && implRunning) {
            // Grace period: don't clear within 5s of starting (avoids race with stale fetch)
            const elapsed = Date.now() - implStartedAtRef.current;
            if (elapsed > 5000) {
                setImplRunning(false);
            }
        }
    }, [investigation?.implementationRunning]); // eslint-disable-line react-hooks/exhaustive-deps

    // Helper to update proposal status
    const handleProposalAction = useCallback(async (proposalId: string, status: 'approved' | 'rejected') => {
        try {
            await api.updateProposal(investigation!.id, proposalId, status);
            await fetchInvestigation();
        } catch (err: any) {
            toast('error', 'Failed to update proposal: ' + err.message);
        }
    }, [investigation?.id]);

    // Helper to apply all approved proposals
    const handleApplyProposals = useCallback(async () => {
        setApplyingProposals(true);
        try {
            const result = await api.applyProposals(investigation!.id);
            await fetchInvestigation();
            if (result.errors?.length > 0) {
                toast('warning', `Applied ${result.applied.length} changes. Errors:\n${result.errors.join('\n')}`);
            }
        } catch (err: any) {
            toast('error', 'Failed to apply proposals: ' + err.message);
        } finally {
            setApplyingProposals(false);
        }
    }, [investigation?.id]);

    const handleOpenImplModal = useCallback(async () => {
        setShowImplModal(true);
        // Use pre-loaded recommendations if available, otherwise fetch
        if (implRecommendations.length > 0) {
            setImplSelected(new Set(implRecommendations.filter(r => r.priority === 'P0' && r.category !== 'operational').map(r => r.id)));
            return;
        }
        setImplLoading(true);
        try {
            const recs = await api.getRecommendations(investigation!.id);
            setImplRecommendations(recs);
            setImplSelected(new Set(recs.filter(r => r.priority === 'P0' && r.category !== 'operational').map(r => r.id)));
        } catch (err: any) {
            toast('error', 'Failed to parse recommendations: ' + err.message);
            setShowImplModal(false);
        } finally {
            setImplLoading(false);
        }
    }, [investigation?.id, implRecommendations]);

    const handleStartImplementation = useCallback(async () => {
        setShowImplModal(false);
        setImplRunning(true);
        implStartedAtRef.current = Date.now();
        try {
            await api.implementRecommendations(investigation!.id, Array.from(implSelected));
            toast('success', 'Implementation agent started. Proposals will appear as they are generated.');
        } catch (err: any) {
            toast('error', 'Failed to start implementation: ' + err.message);
            setImplRunning(false);
        }
    }, [investigation?.id, implSelected]);

    const handleAction = async (action: string, message?: string) => {
        setActingAction(action);
        try {
            await api.sendAction(id!, action, message);
            await new Promise(r => setTimeout(r, 500));
            await fetchInvestigation();
        } catch (e: any) {
            toast('error', `Action failed: ${e.message}`);
        } finally {
            setActingAction(null);
        }
    };

    const handleContest = useCallback(async (feedback: string) => {
        setActingAction('contest');
        try {
            await api.sendAction(id!, 'contest', feedback);
            setActiveTab('live');
            await new Promise(r => setTimeout(r, 500));
            await fetchInvestigation();
            // Scroll to bottom of live session after tab switch + data refresh
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
        } catch (e: any) {
            toast('error', `Action failed: ${e.message}`);
        } finally {
            setActingAction(null);
        }
    }, [id]);

    const saveNotes = useCallback(async () => {
        if (!id || !notesRef.current) return;
        const notes = notesRef.current.value;
        setNotesSaving(true);
        try {
            await api.updateNotes(id, notes);
            setNotesSaved(true);
            clearTimeout(notesSavedTimer.current);
            notesSavedTimer.current = setTimeout(() => setNotesSaved(false), 2000);
        } catch (e: any) {
            toast('error', 'Failed to save notes: ' + e.message);
        } finally {
            setNotesSaving(false);
        }
    }, [id, toast]);

    const handleIntervention = async (msg: string) => {
        if (id && msg.trim()) {
            // Optimistic UI: show the message as pending immediately
            const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            setPendingInterventions(prev => [...prev, { id: pendingId, text: msg.trim(), timestamp: Date.now() }]);
            try {
                await api.sendAction(id, 'intervene', msg);
            } catch (e) {
                console.error('Intervention failed:', e);
                // Remove the pending intervention on failure
                setPendingInterventions(prev => prev.filter(p => p.id !== pendingId));
            }
        }
    };

    if (notFound) return (
        <div className="fixed top-14 sm:top-16 inset-x-0 bottom-0 flex items-center justify-center px-4">
            <div className="text-center space-y-4 max-w-md">
                <div className="inline-flex p-4 bg-slate-800/60 rounded-2xl border border-slate-700/40 mb-2">
                    <Trash2 className="w-10 h-10 text-slate-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-300">Investigation Not Available</h2>
                <p className="text-sm text-slate-400">This investigation may have been automatically cleaned up by the retention policy, or it was deleted.</p>
                <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                        onClick={() => navigate('/')}
                        className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold transition-colors"
                    >
                        Go to Dashboard
                    </button>
                    <button
                        onClick={() => navigate('/schedules')}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold transition-colors"
                    >
                        View Schedules
                    </button>
                </div>
            </div>
        </div>
    );

    if (!investigation) return (
        <div className="fixed top-14 sm:top-16 inset-x-0 bottom-0 px-3 sm:px-6 md:px-8 pt-2 sm:pt-4 pb-2 z-0">
        <div className="h-full overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 max-w-[1600px] mx-auto animate-pulse">
            {/* Sidebar skeleton */}
            <div className="lg:col-span-4 xl:col-span-3 space-y-4">
                <div className="glass-card p-5 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-700/60" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-24 rounded bg-slate-700/60" />
                            <div className="h-3 w-16 rounded bg-slate-800/60" />
                        </div>
                    </div>
                    <div className="space-y-3 pt-2">
                        {[1,2,3,4].map(i => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="h-3 w-20 rounded bg-slate-800/60" />
                                <div className="h-3 w-28 rounded bg-slate-800/40" />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2">
                    {[1,2,3].map(i => <div key={i} className="flex-1 h-10 rounded-xl bg-slate-800/40" />)}
                </div>
            </div>
            {/* Main area skeleton */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-3">
                <div className="glass-card p-4 space-y-3">
                    <div className="h-4 w-48 rounded bg-slate-700/60" />
                    <div className="space-y-2">
                        <div className="h-3 w-full rounded bg-slate-800/40" />
                        <div className="h-3 w-5/6 rounded bg-slate-800/40" />
                        <div className="h-3 w-4/6 rounded bg-slate-800/40" />
                    </div>
                </div>
                <div className="glass-card p-4 space-y-3">
                    <div className="h-4 w-32 rounded bg-slate-700/60" />
                    <div className="space-y-2">
                        <div className="h-3 w-full rounded bg-slate-800/40" />
                        <div className="h-3 w-3/4 rounded bg-slate-800/40" />
                    </div>
                </div>
            </div>
        </div>
        </div>
    );

    const isActive = investigation.status === 'running' || investigation.status === 'paused';

    return (
        <div className="fixed top-14 sm:top-16 inset-x-0 bottom-0 pt-2 sm:pt-4 pb-2 px-3 sm:px-6 md:px-8 z-0 flex flex-col">
        <div className="max-w-[1600px] mx-auto w-full shrink-0">
            <Breadcrumbs
                crumbs={[{ label: 'Dashboard', to: '/' }, { label: investigation?.title || 'Investigation' }]}
                onEditLabel={async (newTitle) => {
                    try {
                        await api.updateTitle(investigation.id, newTitle);
                        await fetchInvestigation();
                    } catch (err) {
                        console.error('Failed to update title', err);
                    }
                }}
            />
        </div>
        <div className="flex-1 min-h-0 max-w-[1600px] mx-auto w-full overflow-hidden grid grid-cols-1 lg:grid-cols-12 grid-rows-[auto_1fr] lg:grid-rows-1 gap-1 lg:gap-6">

            {/* Connection Lost / Reconnecting Overlay */}
            {(!wsConnected || wsJustReconnected) && (
                <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500 ${
                    wsJustReconnected ? 'reconnect-overlay-exit' : 'reconnect-overlay-enter'
                }`}>
                    {/* Frosted glass backdrop */}
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />

                    {/* Content card */}
                    <div className="relative z-10 flex flex-col items-center gap-6 px-12 py-10 bg-slate-800/80 border border-slate-700/50 rounded-3xl shadow-2xl max-w-md">
                        {wsJustReconnected ? (
                            <>
                                <div className="relative w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center reconnect-success-pop">
                                    <Wifi className="w-10 h-10 text-green-400" />
                                    <div className="absolute inset-0 rounded-full border-2 border-green-400/40 animate-ping" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-xl font-bold text-green-400">Reconnected</h3>
                                    <p className="text-slate-400 text-sm mt-1">Connection restored. Syncing latest state&hellip;</p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="relative w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center">
                                    <WifiOff className="w-10 h-10 text-amber-400 reconnect-icon-pulse" />
                                    {/* Rotating ring */}
                                    <svg className="absolute inset-0 w-20 h-20 reconnect-spinner" viewBox="0 0 80 80">
                                        <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(251,191,36,0.2)" strokeWidth="3" />
                                        <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(251,191,36,0.7)" strokeWidth="3"
                                            strokeDasharray="60 170" strokeLinecap="round" />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <h3 className="text-xl font-bold text-white">Connection Lost</h3>
                                    <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                                        Reconnecting to the server automatically&hellip;<br />
                                        <span className="text-slate-500 text-xs">The investigation may have been paused due to a server restart.</span>
                                    </p>
                                </div>
                                {/* Animated dots */}
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-amber-400 reconnect-dot" style={{ animationDelay: '0s' }} />
                                    <div className="w-2 h-2 rounded-full bg-amber-400 reconnect-dot" style={{ animationDelay: '0.2s' }} />
                                    <div className="w-2 h-2 rounded-full bg-amber-400 reconnect-dot" style={{ animationDelay: '0.4s' }} />
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Sidebar: Status & Info */}
            <div className="lg:col-span-3 flex flex-col gap-1 lg:gap-4 min-h-0">
                {/* Status Card */}
                <div className="bg-slate-900/60 backdrop-blur-xl rounded-xl lg:rounded-3xl p-1.5 lg:p-6 shadow-2xl border border-white/[0.06] relative overflow-hidden group shrink-0">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                    {/* Mobile: horizontal row | Desktop: vertical centered */}
                    <div className="flex items-center gap-2 lg:gap-3 lg:flex-col lg:items-center lg:justify-center lg:mb-8">
                        <div className={`relative w-7 h-7 lg:w-20 lg:h-20 rounded-full flex items-center justify-center shrink-0 lg:mb-4 transition-all duration-500 ${justCompleted ? 'animate-celebrate' : ''} ${
                            investigation.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 ring-2 lg:ring-4 ring-emerald-500/20' :
                            investigation.status === 'running' ? 'bg-green-500/20 text-green-400 ring-2 lg:ring-4 ring-green-500/20' :
                            investigation.status === 'paused' ? 'bg-amber-500/20 text-amber-400 ring-2 lg:ring-4 ring-amber-500/20' :
                            investigation.status === 'failed' ? 'bg-red-500/20 text-red-400 ring-2 lg:ring-4 ring-red-500/20' :
                            investigation.status === 'aborted' ? 'bg-orange-500/20 text-orange-400 ring-2 lg:ring-4 ring-orange-500/20' :
                                'bg-slate-800 text-slate-400 ring-2 lg:ring-4 ring-slate-700/30'
                            }`}>
                            {investigation.status === 'running' && <div className="absolute inset-0 rounded-full border-2 lg:border-4 border-green-500/30 animate-ping"></div>}
                            {investigation.status === 'completed' && <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30"></div>}
                            {justCompleted && <div className="absolute inset-0 rounded-full border-4 border-emerald-400/50 animate-ping"></div>}
                            <Activity className={`w-3.5 h-3.5 lg:w-8 lg:h-8 ${investigation.status === 'running' ? 'animate-pulse' : ''}`} />
                        </div>

                        <div className="flex-1 min-w-0 lg:text-center">
                            <h2 className="text-sm lg:text-2xl font-black text-slate-100 tracking-tight capitalize leading-tight">{investigation.status}</h2>
                            <p className="text-slate-500 text-[10px] lg:text-sm font-medium truncate lg:whitespace-normal">
                                <span className="lg:hidden">
                                    {investigation.target || 'Investigation'}
                                    {investigation.timeRange && (
                                        <span className="text-slate-600 ml-1">· {investigation.timeRange}</span>
                                    )}
                                    {investigation.model && (
                                        <span className="text-slate-600 ml-1">· {investigation.model}</span>
                                    )}
                                    {investigation.category && (
                                        <span className="text-slate-600 ml-1">· {investigation.category}</span>
                                    )}
                                    {investigation.status === 'running' && (
                                        <span className="text-slate-400 ml-1">
                                            · <DurationTimer
                                                startTime={Number(investigation.id)}
                                                status={investigation.status}
                                                pausedAt={investigation.pausedAt}
                                                totalPausedTime={investigation.totalPausedTime}
                                            />
                                        </span>
                                    )}
                                </span>
                                <span className="hidden lg:inline">Investigation Status</span>
                            </p>
                        </div>

                        {/* Mobile: compact icon-only action buttons */}
                        <div className="flex items-center gap-1.5 lg:hidden">
                            {investigation.status === 'running' && (
                                <button
                                    onClick={() => handleAction('pause')}
                                    disabled={actingAction !== null}
                                    className="p-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 disabled:bg-slate-800 disabled:border-slate-700 disabled:cursor-not-allowed text-amber-300 transition-all"
                                >
                                    {actingAction === 'pause' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4 fill-current" />}
                                </button>
                            )}
                            {investigation.status === 'paused' && (
                                <button
                                    onClick={() => handleAction('resume')}
                                    disabled={actingAction !== null}
                                    className="p-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:bg-slate-800 disabled:border-slate-700 disabled:cursor-not-allowed text-emerald-300 transition-all"
                                >
                                    {actingAction === 'resume' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                                </button>
                            )}
                            {isActive && (
                                <button
                                    onClick={() => handleAction('abort')}
                                    disabled={actingAction !== null}
                                    className="p-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {actingAction === 'abort' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                </button>
                            )}
                            {investigation.status !== 'running' && (
                                <button
                                    onClick={async () => { setExporting('share'); try { await api.exportInvestigation(investigation.id); } catch (e) { console.error('Export failed:', e); } finally { setExporting(null); } }}
                                    disabled={exporting !== null}
                                    className="p-2 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/20 hover:bg-sky-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    title="Share investigation (export JSON)"
                                >
                                    {exporting === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                                </button>
                            )}
                            {investigation.status !== 'running' && investigation.finalReport && (
                                <button
                                    onClick={async () => { setExporting('pdf'); try { await api.exportPdf(investigation.id); } catch (e) { console.error('PDF export failed:', e); } finally { setExporting(null); } }}
                                    disabled={exporting !== null}
                                    className="p-2 rounded-xl bg-violet-500/15 text-violet-400 border border-violet-500/20 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    title="Export report as PDF"
                                >
                                    {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                                </button>
                            )}
                        </div>

                        {/* Mobile expand/collapse toggle */}
                        <button
                            onClick={() => setMobileSidebarExpanded(!mobileSidebarExpanded)}
                            className="lg:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
                        >
                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${mobileSidebarExpanded ? 'rotate-180' : ''}`} />
                        </button>
                    </div>

                    {/* Desktop: full-width action buttons (unchanged) */}
                    <div className="hidden lg:block space-y-4">
                        {investigation.status === 'running' && (
                            <button
                                onClick={() => handleAction('pause')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 disabled:bg-slate-800 disabled:border-slate-700 disabled:cursor-not-allowed text-amber-300 font-bold rounded-2xl transition-all shadow-lg shadow-amber-500/10 transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                {actingAction === 'pause' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <Pause className="w-5 h-5 mr-3 fill-current" />}
                                {actingAction === 'pause' ? 'Pausing...' : 'Pause'}
                            </button>
                        )}
                        {investigation.status === 'paused' && (
                            <button
                                onClick={() => handleAction('resume')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:bg-slate-800 disabled:border-slate-700 disabled:cursor-not-allowed text-emerald-300 font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/10 transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                {actingAction === 'resume' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <Play className="w-5 h-5 mr-3 fill-current" />}
                                {actingAction === 'resume' ? 'Resuming...' : 'Resume'}
                            </button>
                        )}
                        {isActive && (
                            <button
                                onClick={() => handleAction('abort')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-red-500/10 text-red-400 font-bold rounded-2xl border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                {actingAction === 'abort' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <XCircle className="w-5 h-5 mr-3" />}
                                {actingAction === 'abort' ? 'Aborting...' : 'Abort'}
                            </button>
                        )}
                        {investigation.status !== 'running' && (
                            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                                <button
                                    onClick={() => { setExporting('share'); api.exportInvestigation(investigation.id).catch(e => console.error('Export failed:', e)).finally(() => setExporting(null)); }}
                                    disabled={exporting !== null}
                                    className="w-full group/btn flex items-center justify-center px-6 py-3 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 hover:border-sky-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sky-400 font-bold rounded-2xl transition-all shadow-sm"
                                >
                                    {exporting === 'share' ? <Loader2 className="w-5 h-5 mr-3 animate-spin" /> : <Share2 className="w-5 h-5 mr-3" />}
                                    {exporting === 'share' ? 'Exporting...' : 'Share'}
                                </button>
                                {investigation.finalReport && (
                                    <button
                                        onClick={() => { setExporting('pdf'); api.exportPdf(investigation.id).catch(e => console.error('PDF export failed:', e)).finally(() => setExporting(null)); }}
                                        disabled={exporting !== null}
                                        className="w-full group/btn flex items-center justify-center px-6 py-3 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 hover:border-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-violet-400 font-bold rounded-2xl transition-all shadow-sm"
                                    >
                                        {exporting === 'pdf' ? <Loader2 className="w-5 h-5 mr-3 animate-spin" /> : <FileDown className="w-5 h-5 mr-3" />}
                                        {exporting === 'pdf' ? 'Generating PDF...' : 'Export PDF'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Info Card — collapsible on mobile, always visible on desktop */}
                <div className={`${mobileSidebarExpanded ? 'block max-h-[40vh] overflow-y-auto scrollbar-hidden' : 'hidden'} lg:block lg:flex-1 lg:min-h-0 lg:overflow-y-auto scrollbar-hidden bg-slate-900/50 backdrop-blur-md rounded-2xl p-5 shadow-lg border border-white/[0.06] text-sm`}>
                    {/* Tags */}
                    <div className="mb-4 pb-4 border-b border-white/[0.06]">
                        <span className="block text-slate-500 text-xs font-bold uppercase tracking-wider mb-1.5">Tags</span>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {(investigation.tags || []).map((tag) => (
                                <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-300 text-xs font-medium border border-brand-500/20 group/tag"
                                >
                                    <Tag className="w-3 h-3" />
                                    {tag}
                                    <button
                                        onClick={async () => {
                                            const newTags = investigation.tags!.filter(t => t !== tag);
                                            try {
                                                await api.updateTags(investigation.id, newTags);
                                                fetchInvestigation();
                                            } catch (err) {
                                                console.error('Failed to remove tag', err);
                                            }
                                        }}
                                        className="ml-0.5 p-0.5 rounded-full hover:bg-red-500/30 hover:text-red-300 transition-colors opacity-0 group-hover/tag:opacity-100"
                                        title={`Remove tag "${tag}"`}
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </span>
                            ))}
                            {(investigation.tags || []).length === 0 && !addingTag && (
                                <span className="text-slate-600 text-xs italic">No tags</span>
                            )}
                        </div>
                        {addingTag ? (
                            <div className="flex items-center gap-1.5">
                                <input
                                    ref={tagInputRef}
                                    type="text"
                                    className="flex-1 px-2 py-1 rounded-lg border border-brand-500/40 bg-slate-800/60 text-xs text-slate-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all"
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && tagInput.trim()) {
                                            const newTags = [...new Set([...(investigation.tags || []), tagInput.trim()])];
                                            try {
                                                await api.updateTags(investigation.id, newTags);
                                                setTagInput('');
                                                fetchInvestigation();
                                            } catch (err) {
                                                console.error('Failed to add tag', err);
                                            }
                                        }
                                        if (e.key === 'Escape') {
                                            setAddingTag(false);
                                            setTagInput('');
                                        }
                                    }}
                                    placeholder="Type tag and press Enter"
                                    autoFocus
                                />
                                <button
                                    onClick={() => { setAddingTag(false); setTagInput(''); }}
                                    className="p-1 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                    title="Cancel"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => { setAddingTag(true); setTimeout(() => tagInputRef.current?.focus(), 50); }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                                Add tag
                            </button>
                        )}
                    </div>

                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Details</h3>
                    <div className="space-y-2">
                        {investigation.status === 'running' && (
                            <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-brand-500 animate-pulse shrink-0" />
                                <span className="text-slate-500 text-xs">Duration</span>
                                <span className="font-medium text-slate-200 text-xs ml-auto">
                                    <DurationTimer
                                        startTime={Number(investigation.id)}
                                        status={investigation.status}
                                        pausedAt={investigation.pausedAt}
                                        totalPausedTime={investigation.totalPausedTime}
                                    />
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-slate-500 text-xs">Started</span>
                            <span className="font-medium text-slate-200 text-xs ml-auto">{isNaN(Number(investigation.id)) ? 'Legacy' : new Date(parseInt(investigation.id)).toLocaleString()}</span>
                        </div>
                        {investigation.target && (
                            <div className="flex items-center gap-2">
                                <div className="w-3.5 h-3.5 flex items-center justify-center rounded bg-blue-500/20 text-blue-400 font-bold text-[9px] shrink-0">S</div>
                                <span className="text-slate-500 text-xs">Target</span>
                                <span className="font-medium text-slate-200 text-xs ml-auto truncate max-w-[60%] text-right">{investigation.target}</span>
                            </div>
                        )}
                        {investigation.timeRange && (
                            <div className="flex items-center gap-2">
                                <div className="w-3.5 h-3.5 flex items-center justify-center rounded bg-purple-500/20 text-purple-400 font-bold text-[9px] shrink-0">T</div>
                                <span className="text-slate-500 text-xs">Time Range</span>
                                <span className="font-medium text-slate-200 text-xs ml-auto" title={investigation.timeRange}>{formatTimeRange(investigation.timeRange)}</span>
                            </div>
                        )}
                        {investigation.query && (
                            <div className="flex items-center gap-2">
                                <div className="w-3.5 h-3.5 flex items-center justify-center rounded bg-slate-700 text-slate-400 font-bold text-[9px] shrink-0">Q</div>
                                <span className="text-slate-500 text-xs">Query</span>
                                <button
                                    onClick={() => setShowQueryModal(true)}
                                    className="text-[11px] text-brand-400 font-bold hover:underline flex items-center ml-auto border border-brand-500/20 bg-brand-500/10 px-1.5 py-0.5 rounded transition-colors hover:bg-brand-500/20"
                                >
                                    <FileText className="w-3 h-3 mr-1" /> View
                                </button>
                            </div>
                        )}
                        {/* Source indicator */}
                        {investigation.source === 'scheduled' && (
                            <div className="flex items-center gap-2">
                                <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                <span className="text-slate-500 text-xs">Source</span>
                                <button
                                    onClick={() => navigate('/schedules')}
                                    className="font-medium text-blue-400 hover:text-blue-300 transition-colors text-xs ml-auto"
                                >
                                    Scheduled
                                </button>
                            </div>
                        )}
                        {investigation.createdBy && (
                            <div className="flex items-center gap-2">
                                <User className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span className="text-slate-500 text-xs">Created By</span>
                                <span className="font-medium text-slate-200 text-xs ml-auto">{investigation.createdBy}</span>
                            </div>
                        )}
                        {/* System ID & Storage Path - collapsible */}
                        <details className="group/details">
                            <summary className="flex items-center gap-2 cursor-pointer text-slate-600 hover:text-slate-400 transition-colors text-[11px] font-medium select-none list-none [&::-webkit-details-marker]:hidden">
                                <ChevronDown className="w-3 h-3 transition-transform group-open/details:rotate-180" />
                                More details
                            </summary>
                            <div className="mt-2 space-y-2 pl-5">
                                <div className="flex items-start gap-2">
                                    <div className="w-3.5 h-3.5 flex items-center justify-center rounded bg-slate-700 text-slate-400 font-bold text-[9px] shrink-0 mt-0.5">#</div>
                                    <div className="min-w-0 flex-1">
                                        <span className="block text-slate-500 text-[10px]">System ID</span>
                                        <span className="font-mono text-[11px] text-slate-300 select-all">{investigation.id}</span>
                                    </div>
                                </div>
                                {investigation.storagePath && (
                                    <div className="flex items-start gap-2">
                                        <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0 flex-1">
                                            <span className="block text-slate-500 text-[10px]">Storage Path</span>
                                            <span className="font-mono text-[10px] text-slate-400 break-all select-all" title={investigation.storagePath}>{investigation.storagePath}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </details>
                    </div>

                    {/* Model selector — separated for visual weight */}
                    {(() => {
                        const displayModel = investigation.model || investigation.logs?.find(l => typeof l === 'string' && l.includes('Calling LLM ('))?.match(/Calling LLM \(([^)]+)\)/)?.[1];
                        if (!displayModel) return null;
                        return (
                            <div className="flex items-start group/model mt-4 pt-3 border-t border-white/[0.06]">
                                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center mr-2.5 shrink-0 border border-indigo-500/20 group-hover/model:bg-indigo-500/20 group-hover/model:scale-105 transition-all">
                                    <Cpu className="w-3.5 h-3.5" />
                                </div>
                                <div className="w-full min-w-0">
                                    <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">Model</span>
                                    <ModelSelector
                                            currentModel={displayModel}
                                            availableModels={availableModels}
                                            onSelect={async (model) => {
                                                try {
                                                    await api.updateModel(investigation!.id, model);
                                                    fetchInvestigation();
                                                } catch (err: any) {
                                                    toast('error', 'Failed to change model: ' + err.message);
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })()}
                </div>

            </div>

            {/* Main Area: Unified Window Structure */}
            <div className="lg:col-span-9 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-700 ring-1 ring-slate-800 min-h-0 relative">

                    {/* Window Header (Banner) — hidden on mobile, sidebar compact bar has status info */}
                    <div className="hidden lg:flex bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 items-center justify-between border-b border-slate-800 shrink-0 z-10">
                        <div className="flex-1 flex items-center">
                            {investigation.thoughts.length > 0 && (
                                <div className="flex items-center gap-2">
                                    {maxSteps > 0 ? (
                                        <ProgressRing
                                            current={investigation.thoughts.length}
                                            max={maxSteps}
                                            size={28}
                                            strokeWidth={2.5}
                                            ringColorClass={stepColors.ring}
                                        />
                                    ) : (
                                        <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full border ${stepColors.circleBorder} ${stepColors.circleBg}`}>
                                            <span className={`text-xs font-bold ${stepColors.label}`}>{investigation.thoughts.length}</span>
                                        </div>
                                    )}
                                    <span className="text-xs text-slate-400 font-medium">
                                        {maxSteps > 0 ? `/ ${maxSteps} ` : ''}steps
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
                                <Bot className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-100 leading-tight">Investigation Agent</span>
                            </div>
                        </div>
                        <div className="flex-1 flex justify-end">
                            <div className="flex space-x-2 opacity-50 hover:opacity-100 transition-opacity">
                                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                            </div>
                        </div>
                    </div>

                    {/* Integrated Tab Bar (Below Banner) */}
                    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-800/50 border border-slate-700/50 w-full shrink-0">
                        <button
                            onClick={() => setActiveTab('live')}
                            className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-3 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${activeTab === 'live' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'}`}
                        >
                            <Terminal className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Live Session</span><span className="sm:hidden">Live</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('report')}
                            disabled={!investigation.finalReport}
                            className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-3 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${activeTab === 'report' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'} ${!investigation.finalReport ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                            <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Final Report</span><span className="sm:hidden">Report</span>
                            {investigation.finalReport && <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 ml-1.5 animate-pulse"></span>}
                        </button>
                        <button
                            onClick={() => setActiveTab('notes')}
                            className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-3 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${activeTab === 'notes' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'}`}
                        >
                            <StickyNote className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Notes</span><span className="sm:hidden">Notes</span>
                            {investigation.userNotes && <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500 ml-1.5"></span>}
                        </button>
                        {['completed', 'failed', 'aborted'].includes(investigation.status) && (
                            <button
                                onClick={() => setActiveTab('retrospect' as any)}
                                className={`flex-1 px-2 sm:px-4 py-1.5 sm:py-3 rounded-md text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${activeTab === 'retrospect' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'}`}
                            >
                                <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Retrospect</span><span className="sm:hidden">Retro</span>
                            </button>
                        )}
                    </div>
                    {/* Content Views */}
                    <div className="flex-1 relative overflow-hidden bg-slate-900">

                        {/* VIEW 1: Live Live Session (Terminal) */}
                        <div className={`absolute inset-0 flex flex-col bg-slate-900 ${activeTab === 'live' ? 'z-10' : 'hidden'}`}>

                            {/* Token Alert */}
                            {showTokenAlert && (
                                <div className="bg-red-900/20 border-b border-red-500/30 p-2 shrink-0">
                                    <div className="flex items-center justify-between px-2">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                                            <span className="text-xs text-red-200 font-medium">Context Limit Exceeded</span>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const btn = document.getElementById('btn-summarize');
                                                if (btn) btn.innerText = '...';
                                                try {
                                                    await api.compactInvestigation(investigation!.id);
                                                    window.location.reload();
                                                } catch (e: any) { toast('error', 'Failed: ' + e.message); }
                                            }}
                                            id="btn-summarize"
                                            className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold rounded border border-red-500/30"
                                        >
                                            Summarize
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Thought Search Bar */}
                            <div className="px-2 sm:px-3 py-2 border-b border-slate-700/60 shrink-0 bg-slate-850/40">
                                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600/50 focus-within:border-brand-400/60 focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:bg-slate-800 transition-all duration-200 shadow-sm">
                                    <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                    <input
                                        type="text"
                                        value={thoughtSearch}
                                        onChange={(e) => setThoughtSearch(e.target.value)}
                                        placeholder="Search thoughts..."
                                        className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none min-w-0"
                                    />
                                    {thoughtSearch && (
                                        <>
                                            <span className="text-[11px] text-slate-300 font-mono whitespace-nowrap bg-brand-500/15 text-brand-300 px-2 py-0.5 rounded-md border border-brand-500/20">
                                                {filteredThoughts.length}/{investigation.thoughts.length}
                                            </span>
                                            <button onClick={() => setThoughtSearch('')} className="text-slate-400 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-700/60">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Chat History */}
                            <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-3 sm:space-y-4 font-mono text-sm leading-relaxed custom-scrollbar bg-slate-900">
                                {/* Init Logs */}
                                <div className="pb-2 space-y-0.5">
                                    {filteredLogs.map((log, i) => (
                                        <div key={`sys-${i}`} className="text-slate-600 text-[11px] font-mono opacity-60 hover:opacity-100 transition-opacity">
                                            {log}
                                        </div>
                                    ))}
                                </div>

                                {filteredThoughts.map((thought, i) => (
                                    <StepItem
                                        key={`step-${i}-${typeof thought === 'string' ? thought.substring(0, 30) : (thought?.content || '').substring(0, 30)}`}
                                        thought={thought}
                                        action={investigation.actions[i]}
                                        index={i}
                                        id={id!}
                                    />
                                ))}

                                {/* Pending intervention messages (optimistic UI) */}
                                {pendingInterventions.map((pending) => (
                                    <div key={pending.id} className="flex justify-end my-4 animate-fade-in pl-12 group items-end gap-2">
                                        <div className="bg-brand-500/5 border border-brand-500/15 border-dashed text-brand-100/70 rounded-2xl rounded-tr-none p-4 shadow-sm max-w-[85%] relative">
                                            <div className="text-[10px] text-brand-400/60 font-bold mb-1 uppercase tracking-wider flex items-center justify-end gap-1.5">
                                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                Sending
                                            </div>
                                            <div className="prose prose-invert prose-sm text-brand-50/60 max-w-none">
                                                {pending.text}
                                            </div>
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-brand-500/10 border border-brand-500/20 border-dashed flex items-center justify-center shrink-0 shadow-lg shadow-brand-500/5 animate-pulse">
                                            <User className="w-4 h-4 text-brand-400/50" />
                                        </div>
                                    </div>
                                ))}

                                {investigation.status === 'running' && (
                                    <div className="flex justify-start my-4 pr-12 items-end gap-2">
                                        <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                            <Bot className="w-3 h-3 text-emerald-400 animate-pulse" />
                                        </div>
                                        <div className="px-3 py-2 bg-slate-800/50 rounded-lg rounded-tl-none border border-slate-700/50 flex items-center gap-2">
                                            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Thinking</span>
                                            <div className="flex items-center gap-1">
                                                <div className="w-1 h-1 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                <div className="w-1 h-1 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                <div className="w-1 h-1 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={logsEndRef} className="h-px" />
                            </div>

                            {/* Input Area */}
                            <div className="p-2 border-t border-slate-800 bg-slate-950/30 backdrop-blur-sm z-20">
                                <InterventionInput onSend={handleIntervention} status={investigation.status} />
                            </div>
                        </div>

                        {/* VIEW 2: Final Report */}
                        <div className={`absolute inset-0 z-20 flex flex-col ${activeTab === 'report' ? 'z-20' : 'hidden'}`}>
                            {investigation.finalReport && (
                                <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950">
                                    <div className="max-w-4xl mx-auto my-8 lg:my-12 bg-slate-900/80 shadow-2xl shadow-black/30 rounded-xl border border-slate-700/50 overflow-hidden backdrop-blur-sm">

                                        {/* Report Header */}
                                        <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-4 sm:px-8 sm:py-6 flex items-start justify-between">
                                            <div>
                                                <h1 className="text-2xl font-bold text-slate-100 mb-2">Investigation Report</h1>
                                                <div className="flex items-center gap-4 text-sm text-slate-400">
                                                    <span className="flex items-center gap-1.5">
                                                        <Clock className="w-4 h-4" />
                                                        {(() => {
                                                        // Derive date from investigation ID (timestamp)
                                                        const ts = Number(investigation.id);
                                                        const d = !isNaN(ts) && ts > 1e12 ? new Date(ts) : new Date();
                                                        return d.toLocaleDateString();
                                                    })()}
                                                    </span>
                                                    <span className="flex items-center gap-1.5">
                                                        <Bot className="w-4 h-4" />
                                                        Generated by Agent
                                                    </span>
                                                </div>
                                            </div>
                                            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${investigation.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                investigation.status === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                    'bg-slate-700 text-slate-400 border border-slate-600'
                                                }`}>
                                                {investigation.status}
                                            </div>
                                        </div>

                                        {/* Report Content */}
                                        <div className="p-3 sm:p-8 lg:p-12 overflow-hidden">
                                            <div className="prose prose-invert max-w-none 
                                                prose-headings:font-bold prose-headings:text-slate-100 
                                                prose-h1:text-3xl prose-h1:mb-6 prose-h1:pb-4 prose-h1:border-b prose-h1:border-slate-700/50
                                                prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:text-brand-400
                                                prose-h3:text-lg prose-h3:mt-6
                                                prose-p:text-slate-300 prose-p:leading-relaxed
                                                prose-a:text-brand-400 prose-a:font-medium hover:prose-a:text-brand-300
                                                prose-strong:text-slate-200
                                                prose-code:text-brand-400 prose-code:bg-brand-500/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                                prose-pre:bg-slate-950 prose-pre:text-slate-300 prose-pre:rounded-xl prose-pre:shadow-lg prose-pre:border prose-pre:border-slate-800
                                                prose-pre:overflow-x-auto
                                                prose-li:text-slate-300
                                                prose-img:rounded-xl prose-img:shadow-md
                                                prose-blockquote:border-l-4 prose-blockquote:border-brand-500 prose-blockquote:bg-brand-500/5 prose-blockquote:px-6 prose-blockquote:py-2 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-slate-300
                                                prose-table:border-collapse prose-th:bg-slate-800/50 prose-th:text-slate-200 prose-th:border prose-th:border-slate-700 prose-th:px-3 prose-th:py-2
                                                prose-td:border prose-td:border-slate-700/50 prose-td:px-3 prose-td:py-2 prose-td:text-slate-300
                                            ">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        table: ({ children, ...props }) => (
                                                            <div className="overflow-x-auto -mx-1 px-1 my-4 rounded-lg border border-slate-700/50">
                                                                <table {...props} className="min-w-full whitespace-nowrap">{children}</table>
                                                            </div>
                                                        ),
                                                        pre: ({ children, ...props }) => (
                                                            <pre {...props} className="overflow-x-auto bg-slate-950 text-slate-300 rounded-xl shadow-lg border border-slate-800 p-4">{children}</pre>
                                                        ),
                                                    }}
                                                >
                                                    {investigation.finalReport}
                                                </ReactMarkdown>
                                            </div>
                                        </div>

                                        {/* Report Footer */}
                                        <div className="bg-slate-800/40 border-t border-slate-700/50 px-4 py-3 sm:px-8 sm:py-4 text-center">
                                            <p className="text-xs text-slate-500 font-medium">
                                                CONFIDENTIAL • Generated automatically by AI Investigation Agent
                                                {investigation.contestCount ? ` • Contested ${investigation.contestCount} time${investigation.contestCount > 1 ? 's' : ''}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Premium Action Bar */}
                            {investigation.finalReport && investigation.status === 'completed' && (
                                <div className="shrink-0 relative overflow-hidden">
                                    {/* Background: subtle mesh gradient with glass effect */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900" />
                                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_40%,rgba(245,158,11,0.04),transparent),radial-gradient(ellipse_80%_50%_at_80%_60%,rgba(56,189,248,0.04),transparent)]" />
                                    {/* Top edge glow line */}
                                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-slate-500/30 to-transparent" />

                                    {/* Proposed Code Changes Section */}
                                    {(() => {
                                        const implProposals = (investigation.retrospect?.proposals || []).filter(p => p.source === 'implementation');
                                        const implMessages = (investigation.retrospect?.messages || []).filter(m => m.role === 'user' && m.content.includes('[Implementation]'));
                                        const implCompleted = !implRunning && implMessages.length > 0;
                                        if (implProposals.length === 0 && !implRunning && !implCompleted) return null;
                                        const implApprovedCount = implProposals.filter(p => p.status === 'approved').length;
                                        return (
                                            <div className="relative border-b border-white/[0.06]">
                                                <div className="px-5 py-3 flex items-center justify-between">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-6 h-6 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                                                            <Code className="w-3.5 h-3.5 text-sky-400" />
                                                        </div>
                                                        <span className="text-sm font-bold text-slate-200">Proposed Code Changes</span>
                                                        {implProposals.length > 0 && (
                                                            <span className="bg-sky-500/15 text-sky-300 text-[11px] font-bold px-2 py-0.5 rounded-full border border-sky-500/20">
                                                                {implProposals.length}
                                                            </span>
                                                        )}
                                                        {implRunning && <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />}
                                                    </div>
                                                    {implApprovedCount > 0 && (
                                                        <button
                                                            onClick={handleApplyProposals}
                                                            disabled={applyingProposals}
                                                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm shadow-emerald-900/30"
                                                        >
                                                            {applyingProposals ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                                                            Apply {implApprovedCount}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="px-5 pb-3 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                                    {implProposals.map(proposal => (
                                                        <div key={proposal.id} className="bg-slate-800/40 rounded-xl border border-white/[0.06] overflow-hidden backdrop-blur-sm">
                                                            <button
                                                                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
                                                                onClick={() => setExpandedProposal(expandedProposal === proposal.id ? null : proposal.id)}
                                                            >
                                                                {proposal.type === 'create' ? <FilePlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <FileEdit className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                                                                <span className="text-xs text-slate-300 truncate flex-1 font-medium">{proposal.filePath}</span>
                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${implProposalStatusClass(proposal.status)}`}>{proposal.status}</span>
                                                                {expandedProposal === proposal.id ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                                                            </button>
                                                            {expandedProposal === proposal.id && (
                                                                <div className="border-t border-white/[0.06]">
                                                                    <div className="px-3.5 py-2.5 text-xs text-slate-400">{proposal.description}</div>
                                                                    <pre className="px-3.5 py-2.5 text-[11px] text-slate-400 bg-black/20 max-h-48 overflow-auto custom-scrollbar whitespace-pre-wrap">
                                                                        {(proposal.content || '').substring(0, 2000)}
                                                                        {(proposal.content || '').length > 2000 && '\n... [truncated]'}
                                                                    </pre>
                                                                    {proposal.status === 'pending' && (
                                                                        <div className="flex items-center gap-2 p-2.5 border-t border-white/[0.06]">
                                                                            <button onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'approved'); }} className="flex-1 flex items-center justify-center gap-1 bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 text-xs font-bold py-1.5 rounded-lg border border-emerald-500/20 hover:border-emerald-500/40 transition-all">
                                                                                <Check className="w-3 h-3" /> Approve
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'rejected'); }} className="flex-1 flex items-center justify-center gap-1 bg-red-600/15 hover:bg-red-600/30 text-red-400 text-xs font-bold py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 transition-all">
                                                                                <X className="w-3 h-3" /> Reject
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                    {proposal.status === 'approved' && (
                                                                        <div className="flex items-center gap-2 p-2.5 border-t border-white/[0.06]">
                                                                            <button onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'rejected'); }} className="flex-1 flex items-center justify-center gap-1 bg-slate-700/20 hover:bg-red-600/15 text-slate-400 hover:text-red-400 text-xs font-bold py-1.5 rounded-lg border border-white/[0.06] hover:border-red-500/30 transition-all">
                                                                                <X className="w-3 h-3" /> Undo
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {implRunning && implProposals.length === 0 && (
                                                        <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-slate-500">
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500/60" />
                                                            Analyzing codebase and generating proposals...
                                                        </div>
                                                    )}
                                                    {implRunning && implProposals.length > 0 && (
                                                        <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-sky-400/70 border-t border-white/[0.04]">
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                            Agent is still scanning for more changes...
                                                        </div>
                                                    )}
                                                    {!implRunning && implCompleted && implProposals.length === 0 && (
                                                        <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-slate-400">
                                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500/70 shrink-0" />
                                                            Implementation completed — no code changes were proposed. The agent may need more context or the recommendation requires manual implementation.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Action Buttons Bar */}
                                    <div className="relative px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                                        <ContestForm onContest={handleContest} actingAction={actingAction} disabled={implRunning} />
                                        <button
                                            onClick={handleOpenImplModal}
                                            disabled={implRunning}
                                            className="group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 overflow-hidden text-sky-200/90 hover:text-sky-100 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                        >
                                            {/* Animated gradient border */}
                                            <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-sky-500/25 via-indigo-500/25 to-sky-500/25 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                            <span className="absolute inset-[1px] rounded-[11px] bg-slate-900/90 backdrop-blur-sm" />
                                            {/* Subtle border */}
                                            <span className="absolute inset-0 rounded-xl border border-sky-500/20 group-hover:border-sky-400/40 transition-colors duration-300" />
                                            {/* Glow on hover */}
                                            <span className="absolute inset-0 rounded-xl shadow-[0_0_15px_-3px] shadow-sky-500/0 group-hover:shadow-sky-500/15 transition-shadow duration-500" />
                                            {/* Content */}
                                            <span className="relative flex items-center gap-2.5">
                                                {implRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4 text-sky-400 group-hover:rotate-[-20deg] transition-transform duration-500 ease-out" />}
                                                {implRunning ? 'Implementing...' : 'Implement Recommendations'}
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* VIEW 3: Retrospective — Split Layout (Chat + Proposals) */}
                        <div className={`absolute inset-0 bg-slate-950 z-20 flex flex-col lg:flex-row ${activeTab === 'retrospect' ? 'z-20' : 'hidden'}`}>
                            
                            {/* LEFT: Chat Panel (60%) */}
                            <div className="flex-[3] flex flex-col border-b lg:border-b-0 lg:border-r border-slate-800 min-w-0 min-h-[50dvh] lg:min-h-0">
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                                    
                                    {/* Header */}
                                    <div className="text-center py-6">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 border ${investigation.retrospect?.completed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-purple-500/10 border-purple-500/20'}`}>
                                            {investigation.retrospect?.completed
                                                ? <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                                                : <Sparkles className="w-6 h-6 text-purple-400" />}
                                        </div>
                                        <h3 className="text-slate-200 font-bold">Knowledge Improvement</h3>
                                        {investigation.retrospect?.completed ? (
                                            <div className="mt-2 inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-500/20">
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                Retrospective Complete
                                            </div>
                                        ) : (
                                            <p className="text-slate-500 text-sm max-w-sm mx-auto mt-2">
                                                The agent analyzes the investigation, reads the knowledge base, and proposes file changes to improve future investigations.
                                            </p>
                                        )}
                                    </div>

                                    {/* Auto-analysis loading state */}
                                    {isAnalyzing && !investigation.retrospect?.messages.length && (
                                        <div className="flex gap-3 items-start justify-start animate-fade-in pl-2">
                                            <div className="w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0 mt-1">
                                                <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                                            </div>
                                            <div className="bg-slate-800 text-slate-300 border border-slate-700 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
                                                <div className="text-sm font-medium">Analyzing investigation...</div>
                                                <div className="text-xs text-slate-500 mt-1">Reading knowledge base files and cross-referencing with investigation transcript</div>
                                                <button
                                                    onClick={async () => {
                                                        try { await api.abortRetrospect(investigation.id); } catch {}
                                                        setIsAnalyzing(false);
                                                        setRetroToolActivity(null);
                                                    }}
                                                    className="mt-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                                                >
                                                    <XCircle className="w-3.5 h-3.5" /> Cancel Analysis
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Messages */}
                                    {investigation.retrospect?.messages.map((msg, i) => {
                                        // Tool-call row: agent activity card with avatar on every row
                                        if (msg.role === 'tool-call') {
                                            const tn = msg.toolName;
                                            const toolIcon = tn === 'read_file'
                                                ? <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                                : tn === 'list_dir'
                                                ? <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                                : tn === 'propose_change'
                                                ? <FileEdit className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                : (tn === 'grep_search' || tn === 'semantic_search' || tn === 'search_code')
                                                ? <Search className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                                : <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
                                            const borderCls = tn === 'propose_change' ? 'border-l-emerald-500/50'
                                                : tn === 'list_dir' ? 'border-l-amber-500/30'
                                                : (tn === 'grep_search' || tn === 'semantic_search' || tn === 'search_code') ? 'border-l-indigo-500/30'
                                                : 'border-l-sky-500/20';
                                            return (
                                                <div key={i} className="flex items-start gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
                                                        <Sparkles className="w-4 h-4 text-purple-400" />
                                                    </div>
                                                    <div className={`flex-1 flex items-start gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/30 border-l-2 ${borderCls}`}>
                                                        <div className="mt-0.5 shrink-0">{toolIcon}</div>
                                                        <span className="text-xs text-slate-400 leading-snug">{msg.content}</span>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // Tool-result row: collapsible, indented to align with tool-call content
                                        if (msg.role === 'tool-result') {
                                            return (
                                                <div key={i} className="flex items-start gap-3">
                                                    <div className="w-8 shrink-0" />
                                                    <details className="group flex-1 pl-3">
                                                        <summary className={`text-[11px] cursor-pointer select-none list-none flex items-center gap-1 ${msg.isError ? 'text-red-400/80' : 'text-slate-600 hover:text-slate-400'}`}>
                                                            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform shrink-0" />
                                                            {msg.isError ? 'Error returned' : `${msg.content.length} chars returned`}
                                                        </summary>
                                                        <pre className="mt-1 text-[11px] text-slate-500 font-mono whitespace-pre-wrap break-all bg-slate-800/50 rounded p-2 max-h-48 overflow-y-auto">{msg.content}</pre>
                                                    </details>
                                                </div>
                                            );
                                        }

                                        // User / assistant messages
                                        return (
                                            <div key={i} className={`flex gap-3 items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                {msg.role === 'assistant' && (
                                                    <div className="w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0 mt-1">
                                                        <Sparkles className="w-4 h-4 text-purple-400" />
                                                    </div>
                                                )}
                                                <div className={`min-w-0 ${msg.role === 'user' ? 'max-w-[80%]' : 'flex-1'} rounded-2xl p-4 ${msg.role === 'user'
                                                    ? 'bg-purple-600 text-white rounded-tr-none'
                                                    : 'bg-slate-800/80 text-slate-200 border border-slate-700 rounded-tl-none'
                                                    }`}>
                                                    <div className="prose prose-invert prose-sm max-w-none break-words">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {msg.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                                {msg.role === 'user' && (
                                                    <div className="w-8 h-8 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center shrink-0 mt-1">
                                                        <User className="w-4 h-4 text-purple-400" />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* Analysis complete indicator — success */}
                                    {investigation.retrospect?.analysisComplete && !investigation.retrospect?.analysisFailed && !isAnalyzing && !isRetrospectThinking && (investigation.retrospect?.messages?.length || 0) > 0 && (
                                        <div className="flex gap-3 justify-start pl-2">
                                            <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            </div>
                                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl rounded-tl-none px-4 py-2.5 text-sm text-emerald-300 font-medium">
                                                {(() => {
                                                    const cnt = investigation.retrospect?.proposals?.length ?? 0;
                                                    return `Analysis finished ${cnt > 0 ? `— ${cnt} proposed change${cnt === 1 ? '' : 's'} ready for review` : '— no changes proposed'}`;
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    {/* Analysis complete indicator — failed */}
                                    {investigation.retrospect?.analysisComplete && investigation.retrospect?.analysisFailed && !isAnalyzing && !isRetrospectThinking && (
                                        <div className="flex gap-3 justify-start pl-2">
                                            <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-1">
                                                <AlertTriangle className="w-4 h-4 text-red-400" />
                                            </div>
                                            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl rounded-tl-none px-4 py-2.5 text-sm text-red-300 font-medium">
                                                Analysis failed — click <strong>Re-run Analysis</strong> below to retry
                                            </div>
                                        </div>
                                    )}

                                    {/* Thinking indicator */}
                                    {(isRetrospectThinking || (isAnalyzing && (investigation.retrospect?.messages.length || 0) > 0)) && (
                                        <div className="flex gap-3 justify-start animate-fade-in pl-2">
                                            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1 shadow-sm">
                                                <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                                            </div>
                                            <div className="bg-slate-800 text-slate-400 border border-slate-700 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                                    </div>
                                                    <span className="text-xs font-bold uppercase tracking-wider text-purple-300/70">
                                                        {isAnalyzing ? 'Analyzing & Reading Files' : 'Thinking'}
                                                    </span>
                                                </div>
                                                {retroToolActivity && (
                                                    <div className="mt-1.5 text-xs text-slate-500 font-mono truncate max-w-[300px]">
                                                        {retroToolActivity}
                                                    </div>
                                                )}
                                                <button
                                                    onClick={async () => {
                                                        try { await api.abortRetrospect(investigation.id); } catch {}
                                                        setIsAnalyzing(false);
                                                        setIsRetrospectThinking(false);
                                                        setRetroToolActivity(null);
                                                    }}
                                                    className="mt-2 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                                                >
                                                    <XCircle className="w-3.5 h-3.5" /> Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={retrospectEndRef} />
                                </div>

                                {/* Chat Input */}
                                <div className="p-4 border-t border-slate-800 bg-slate-900">
                                    {investigation.retrospect?.completed ? (
                                        <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-2">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                            <span>Retrospective complete. Click <strong className="text-slate-300">Reopen</strong> to continue.</span>
                                        </div>
                                    ) : (
                                    <div className="flex flex-col gap-2">
                                        {/* Resume Analysis button — shown when analysis finished (success, error, or limit) and not currently running */}
                                        {investigation.retrospect?.analysisComplete && !isAnalyzing && !isRetrospectThinking && (
                                            <button
                                                onClick={async () => {
                                                    setIsAnalyzing(true);
                                                    try {
                                                        await api.analyzeRetrospect(investigation.id, true);
                                                        await fetchInvestigation();
                                                    } catch (err: any) {
                                                        console.error('Resume analysis failed:', err);
                                                    } finally {
                                                        setIsAnalyzing(false);
                                                        setRetroToolActivity(null);
                                                    }
                                                }}
                                                className={`flex items-center justify-center gap-2 border text-sm font-medium py-2 px-4 rounded-xl transition-all ${
                                                    investigation.retrospect?.analysisFailed
                                                        ? 'bg-red-600/20 hover:bg-red-600/30 border-red-500/40 text-red-300'
                                                        : 'bg-purple-600/20 hover:bg-purple-600/30 border-purple-500/30 text-purple-300'
                                                }`}
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                {investigation.retrospect?.analysisFailed ? 'Retry Analysis' : 'Re-run Analysis'}
                                            </button>
                                        )}
                                        <form
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            const input = (e.target as any).message;
                                            const msg = input.value.trim();
                                            if (!msg) return;
                                            try {
                                                const val = input.value.trim();
                                                input.value = '';
                                                setIsRetrospectThinking(true);
                                                await api.sendRetrospectMessage(investigation.id, val);
                                                await fetchInvestigation();
                                            } catch (err: any) {
                                                toast('error', err.message);
                                            } finally {
                                                setIsRetrospectThinking(false);
                                                setRetroToolActivity(null);
                                            }
                                        }}
                                        className="flex gap-2"
                                    >
                                        <input
                                            name="message"
                                            type="text"
                                            placeholder="Ask about the investigation or request more changes..."
                                            className="flex-1 bg-slate-800 border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all placeholder:text-slate-500"
                                        />
                                        <button
                                            type="submit"
                                            disabled={isRetrospectThinking || isAnalyzing}
                                            className="bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white p-3 rounded-xl transition-all shadow-lg shadow-purple-500/20"
                                        >
                                            <Send className="w-5 h-5" />
                                        </button>
                                    </form>
                                    </div>
                                    )}
                                </div>
                            </div>

                            {/* RIGHT: Proposals Panel (40%) */}
                            <div className="flex-[2] flex flex-col bg-slate-900/50 min-w-0 min-h-[40dvh] lg:min-h-0">
                                {/* Proposals Header */}
                                <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2">
                                        <FileEdit className="w-4 h-4 text-purple-400" />
                                        <span className="text-sm font-bold text-slate-200">Proposed Changes</span>
                                        {(investigation.retrospect?.proposals?.length || 0) > 0 && (
                                            <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">
                                                {investigation.retrospect?.proposals?.length}
                                            </span>
                                        )}
                                    </div>
                                    {(() => {
                                        const proposals = investigation.retrospect?.proposals || [];
                                        const approvedCount = proposals.filter(p => p.status === 'approved').length;
                                        const isRetroCompleted = investigation.retrospect?.completed;
                                        return (
                                            <div className="flex items-center gap-2">
                                                {approvedCount > 0 && (
                                                    <button
                                                        onClick={handleApplyProposals}
                                                        disabled={applyingProposals}
                                                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                                                    >
                                                        {applyingProposals ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                                                        Apply {approvedCount}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            await api.completeRetrospect(investigation.id, !isRetroCompleted);
                                                            await fetchInvestigation();
                                                        } catch (err: any) { toast('error', err.message); }
                                                    }}
                                                    className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                                                        isRetroCompleted
                                                            ? 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600'
                                                            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                                                    }`}
                                                    title={isRetroCompleted ? 'Reopen retrospective for more analysis' : 'Mark retrospective as complete'}
                                                >
                                                    {isRetroCompleted ? <RotateCcw className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                                                    {isRetroCompleted ? 'Reopen' : 'Complete'}
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Proposals List */}
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    {(!investigation.retrospect?.proposals || investigation.retrospect.proposals.length === 0) ? (
                                        <div className="flex flex-col items-center justify-center h-full text-center p-6">
                                            <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center mb-3 border border-slate-700">
                                                <FileText className="w-5 h-5 text-slate-600" />
                                            </div>
                                            <p className="text-slate-500 text-sm">
                                                {isAnalyzing ? 'Analysis in progress...' : 'No proposals yet'}
                                            </p>
                                            <p className="text-slate-600 text-xs mt-1">
                                                {isAnalyzing ? 'The agent is reading knowledge base files and identifying improvements' : 'Proposals will appear here as the agent identifies improvements'}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="p-3 space-y-2">
                                            {investigation.retrospect.proposals.map((proposal) => (
                                                <div key={proposal.id} className={`rounded-xl border transition-all ${
                                                    proposal.status === 'applied' ? 'bg-emerald-950/30 border-emerald-700/30' :
                                                    proposal.status === 'approved' ? 'bg-emerald-950/20 border-emerald-700/20' :
                                                    proposal.status === 'rejected' ? 'bg-red-950/20 border-red-700/20 opacity-60' :
                                                    'bg-slate-800/50 border-slate-700/50'
                                                }`}>
                                                    {/* Proposal Header */}
                                                    <div 
                                                        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-800/30 rounded-t-xl transition-colors"
                                                        onClick={() => setExpandedProposal(expandedProposal === proposal.id ? null : proposal.id)}
                                                    >
                                                        <div className="shrink-0 mt-0.5">
                                                            {expandedProposal === proposal.id ? 
                                                                <ChevronDown className="w-4 h-4 text-slate-500" /> : 
                                                                <ChevronRight className="w-4 h-4 text-slate-500" />
                                                            }
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                {proposal.type === 'create' ? (
                                                                    <FilePlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                                ) : (
                                                                    <FileEdit className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                                                )}
                                                                <span className="text-xs font-mono text-slate-400 truncate">
                                                                    {proposal.filePath}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-slate-300 line-clamp-2">{proposal.description}</p>
                                                        </div>
                                                        {/* Status Badge */}
                                                        <div className="shrink-0">
                                                            {proposal.status === 'applied' && (
                                                                <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold">
                                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                                                                </span>
                                                            )}
                                                            {proposal.status === 'approved' && (
                                                                <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold">
                                                                    <Check className="w-3.5 h-3.5" /> Approved
                                                                </span>
                                                            )}
                                                            {proposal.status === 'rejected' && (
                                                                <span className="flex items-center gap-1 text-red-400 text-xs font-bold">
                                                                    <X className="w-3.5 h-3.5" /> Rejected
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Expanded: Content Preview + Actions */}
                                                    {expandedProposal === proposal.id && (
                                                        <div className="border-t border-slate-700/50">
                                                            {/* Content diff area */}
                                                            <div className="p-3 max-h-96 overflow-y-auto custom-scrollbar">
                                                                {proposal.type === 'edit' && proposal.originalContent ? (
                                                                    <div className="space-y-2">
                                                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Diff Preview</div>
                                                                        <div className="bg-slate-900 rounded-lg text-xs font-mono leading-relaxed max-h-80 overflow-y-auto custom-scrollbar">
                                                                            {(() => {
                                                                                const origLines = proposal.originalContent!.split('\n');
                                                                                const newLines = proposal.content.split('\n');
                                                                                // Simple patience-like diff: LCS on line level
                                                                                const m = origLines.length, n = newLines.length;
                                                                                // dp[i][j] = LCS length of origLines[0..i-1], newLines[0..j-1]
                                                                                // Use 1-D rolling array to keep memory reasonable
                                                                                const lcs: number[][] = Array.from({ length: Math.min(m, 400) + 1 }, () => new Array(Math.min(n, 400) + 1).fill(0));
                                                                                const om = Math.min(m, 400), on_ = Math.min(n, 400);
                                                                                for (let i = 1; i <= om; i++) for (let j = 1; j <= on_; j++)
                                                                                    lcs[i][j] = origLines[i-1] === newLines[j-1] ? lcs[i-1][j-1] + 1 : Math.max(lcs[i-1][j], lcs[i][j-1]);
                                                                                // Backtrack
                                                                                const hunks: Array<{t:'same'|'del'|'add', l:string}> = [];
                                                                                let i = om, j = on_;
                                                                                while (i > 0 || j > 0) {
                                                                                    if (i > 0 && j > 0 && origLines[i-1] === newLines[j-1]) { hunks.push({t:'same',l:origLines[i-1]}); i--; j--; }
                                                                                    else if (j > 0 && (i === 0 || lcs[i][j-1] >= lcs[i-1][j])) { hunks.push({t:'add',l:newLines[j-1]}); j--; }
                                                                                    else { hunks.push({t:'del',l:origLines[i-1]}); i--; }
                                                                                }
                                                                                hunks.reverse();
                                                                                // Render with context (3 lines around changes)
                                                                                const CONTEXT = 3;
                                                                                const changed = hunks.map((h,idx) => h.t !== 'same' ? idx : -1).filter(x => x >= 0);
                                                                                if (changed.length === 0) return <div className="p-3 text-slate-500">No line-level differences detected.</div>;
                                                                                const shown = new Set<number>();
                                                                                changed.forEach(ci => { for (let k = Math.max(0,ci-CONTEXT); k <= Math.min(hunks.length-1,ci+CONTEXT); k++) shown.add(k); });
                                                                                const rows: JSX.Element[] = [];
                                                                                let prevIdx = -1;
                                                                                Array.from(shown).sort((a,b)=>a-b).forEach((idx) => {
                                                                                    if (prevIdx !== -1 && idx > prevIdx + 1) rows.push(<div key={`gap-${idx}`} className="px-3 py-0.5 text-slate-600 select-none">@@ ... @@</div>);
                                                                                    const h = hunks[idx];
                                                                                    rows.push(
                                                                                        <div key={idx} className={`px-3 py-px whitespace-pre-wrap break-all ${h.t==='add'?'bg-emerald-950/60 text-emerald-300':h.t==='del'?'bg-red-950/60 text-red-300':'text-slate-500'}`}>
                                                                                            <span className="select-none mr-2 opacity-50">{h.t==='add'?'+':h.t==='del'?'-':' '}</span>{h.l}
                                                                                        </div>
                                                                                    );
                                                                                    prevIdx = idx;
                                                                                });
                                                                                return <div>{rows}</div>;
                                                                            })()}
                                                                        </div>
                                                                        <div className="text-[11px] text-slate-600 font-mono">
                                                                            {proposal.originalContent.split('\n').length} -&gt; {proposal.content.split('\n').length} lines
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        <div className="text-xs font-bold text-emerald-500 uppercase tracking-wider">New File Preview</div>
                                                                        <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-300 leading-relaxed max-h-64 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all">
                                                                            {proposal.content.substring(0, 2000)}
                                                                            {proposal.content.length > 2000 && `\n\n... [${(proposal.content.length - 2000).toLocaleString()} more chars]`}
                                                                        </pre>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Action Buttons */}
                                                            {proposal.status === 'pending' && (
                                                                <div className="flex items-center gap-2 p-3 border-t border-slate-700/50">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'approved'); }}
                                                                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-bold py-2 rounded-lg border border-emerald-600/30 transition-all"
                                                                    >
                                                                        <Check className="w-3.5 h-3.5" /> Approve
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'rejected'); }}
                                                                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-bold py-2 rounded-lg border border-red-600/30 transition-all"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" /> Reject
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {proposal.status === 'approved' && (
                                                                <div className="flex items-center gap-2 p-3 border-t border-slate-700/50">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'rejected'); }}
                                                                        className="flex-1 flex items-center justify-center gap-1.5 bg-slate-700/30 hover:bg-red-600/20 text-slate-400 hover:text-red-400 text-xs font-bold py-2 rounded-lg border border-slate-700/30 transition-all"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" /> Undo Approval
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {proposal.status === 'rejected' && (
                                                                <div className="flex items-center gap-2 p-3 border-t border-slate-700/50">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleProposalAction(proposal.id, 'approved'); }}
                                                                        className="flex-1 flex items-center justify-center gap-1.5 bg-slate-700/30 hover:bg-emerald-600/20 text-slate-400 hover:text-emerald-400 text-xs font-bold py-2 rounded-lg border border-slate-700/30 transition-all"
                                                                    >
                                                                        <Check className="w-3.5 h-3.5" /> Approve Instead
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* VIEW 4: User Notes */}
                        <div className={`absolute inset-0 z-20 flex flex-col ${activeTab === 'notes' ? 'z-20' : 'hidden'}`}>
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950">
                                <div className="max-w-3xl mx-auto my-8 lg:my-12 bg-slate-900/80 shadow-2xl shadow-black/30 rounded-xl border border-slate-700/50 overflow-hidden backdrop-blur-sm">
                                    <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 py-4 sm:px-8 sm:py-5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                                                <StickyNote className="w-5 h-5 text-amber-400" />
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-bold text-slate-100">Notes</h2>
                                                <p className="text-xs text-slate-500">Personal notes for this investigation</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {notesSaved && (
                                                <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium animate-fade-in">
                                                    <Check className="w-3.5 h-3.5" /> Saved
                                                </span>
                                            )}
                                            <button
                                                onClick={saveNotes}
                                                disabled={notesSaving}
                                                className="flex items-center gap-1.5 bg-amber-600/20 hover:bg-amber-600/30 disabled:bg-slate-700/50 text-amber-300 disabled:text-slate-500 text-xs font-bold px-4 py-2 rounded-lg border border-amber-600/30 disabled:border-slate-700/30 transition-all"
                                            >
                                                {notesSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5" />}
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 sm:p-8">
                                        <textarea
                                            ref={notesRef}
                                            defaultValue={investigation.userNotes || ''}
                                            onKeyDown={(e) => {
                                                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                                    e.preventDefault();
                                                    saveNotes();
                                                }
                                            }}
                                            placeholder="Add your notes here... (Ctrl+S to save)"
                                            className="w-full min-h-[400px] bg-slate-950/50 border border-slate-700/50 rounded-lg p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 resize-y font-mono leading-relaxed custom-scrollbar"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
                {
                    showQueryModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowQueryModal(false)}>
                            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80dvh] flex flex-col overflow-hidden ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
                                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                                    <h3 className="font-bold text-slate-200 flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
                                            <FileText className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <span className="block text-sm">Investigation Query</span>
                                            <span className="block text-[10px] text-slate-500 font-mono uppercase tracking-wider">{investigation?.id}</span>
                                        </div>
                                    </h3>
                                    <button onClick={() => setShowQueryModal(false)} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800"><XCircle className="w-5 h-5" /></button>
                                </div>

                                <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                                    {/* Metadata Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold text-xs border border-blue-500/20">S</div>
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Target</span>
                                                <div className="font-mono text-sm text-blue-300 font-medium">
                                                    {investigation?.target || <span className="text-slate-600 italic">Not specified</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 font-bold text-xs border border-purple-500/20">T</div>
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Time Range</span>
                                                <div className="font-mono text-sm text-purple-300 font-medium" title={investigation?.timeRange}>
                                                    {investigation?.timeRange ? formatTimeRange(investigation.timeRange) : <span className="text-slate-600 italic">Not specified</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Query Content */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                                <Terminal className="w-3 h-3" /> Query / Context
                                            </span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(investigation!.query!);
                                                    // Optional: Show toast or feedback
                                                }}
                                                className="text-[10px] flex items-center gap-1 text-slate-500 hover:text-brand-400 transition-colors"
                                            >
                                                <Copy className="w-3 h-3" /> Copy
                                            </button>
                                        </div>
                                        <div className="relative group">
                                            <div className="absolute inset-0 bg-indigo-500/5 rounded-xl blur-xl pointer-events-none"></div>
                                            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 relative overflow-hidden group-hover:border-slate-700 transition-colors">
                                                <pre className="font-mono text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                                                    {investigation?.query}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                                    <button
                                        onClick={() => setShowQueryModal(false)}
                                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-bold transition-all border border-slate-700 shadow-lg hover:shadow-xl hover:border-slate-600"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Recommendation Selection Modal */}
                {showImplModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowImplModal(false)}>
                        <div className="bg-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-4 border-b border-slate-700/50 flex items-center gap-3">
                                <Wrench className="w-5 h-5 text-sky-400" />
                                <h3 className="text-lg font-bold text-slate-100">Implement Recommendations</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                                {implLoading ? (
                                    <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Parsing recommendations...</span>
                                    </div>
                                ) : implRecommendations.length === 0 ? (
                                    <div className="text-center py-12 text-slate-500">
                                        No recommendations found in the report.
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm text-slate-400 mb-4">Select recommendations to implement. A coding agent will analyze the codebase and propose changes.</p>
                                        {(['P0', 'P1', 'P2', 'P3'] as const).map(priority => {
                                            const group = implRecommendations.filter(r => r.priority === priority);
                                            if (group.length === 0) return null;
                                            const colorMap = { P0: 'text-red-400 bg-red-500/10 border-red-500/20', P1: 'text-orange-400 bg-orange-500/10 border-orange-500/20', P2: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', P3: 'text-sky-400 bg-sky-500/10 border-sky-500/20' };
                                            return (
                                                <div key={priority} className="mb-4">
                                                    <div className={`inline-block text-xs font-bold px-2 py-0.5 rounded border mb-2 ${colorMap[priority]}`}>{priority}</div>
                                                    <div className="space-y-2">
                                                        {group.map(rec => rec.category === 'operational' ? (
                                                            <div key={rec.id} className="flex items-start gap-3 p-3 rounded-lg border bg-slate-800/20 border-slate-700/15 opacity-60">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm font-semibold text-slate-400 line-through decoration-slate-600">{rec.title}</span>
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap" title="Operational — cannot be implemented as code">
                                                                            OPS
                                                                        </span>
                                                                    </div>
                                                                    {rec.description && <div className="text-xs text-slate-500 mt-1">{rec.description}</div>}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <label key={rec.id} className="flex items-start gap-3 p-3 rounded-lg border bg-slate-800/50 border-slate-700/30 hover:border-slate-600/50 cursor-pointer transition-all">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={implSelected.has(rec.id)}
                                                                    onChange={() => {
                                                                        const next = new Set(implSelected);
                                                                        if (next.has(rec.id)) next.delete(rec.id); else next.add(rec.id);
                                                                        setImplSelected(next);
                                                                    }}
                                                                    className="mt-0.5 rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500 focus:ring-offset-0"
                                                                />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm font-semibold text-slate-200">{rec.title}</span>
                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap" title="Code change — can be implemented by the coding agent">
                                                                            CODE
                                                                        </span>
                                                                    </div>
                                                                    {rec.description && <div className="text-xs text-slate-400 mt-1">{rec.description}</div>}
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                            <div className="px-6 py-4 border-t border-slate-700/50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setShowImplModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                                        Cancel
                                    </button>
                                    {implRecommendations.length > 0 && (
                                        <button
                                            onClick={async () => {
                                                setImplLoading(true);
                                                try {
                                                    const recs = await api.reclassifyRecommendations(investigation!.id);
                                                    setImplRecommendations(recs);
                                                    setImplSelected(new Set(recs.filter(r => r.priority === 'P0' && r.category !== 'operational').map(r => r.id)));
                                                } catch (err: any) {
                                                    toast('error', 'Failed to re-classify: ' + err.message);
                                                } finally {
                                                    setImplLoading(false);
                                                }
                                            }}
                                            disabled={implLoading}
                                            className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 border border-slate-700/50 hover:border-slate-600 rounded-lg transition-all"
                                            title="Re-analyze recommendations with the LLM to fix misclassifications"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            Re-classify
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={handleStartImplementation}
                                    disabled={implSelected.size === 0 || implLoading}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    Generate Implementation ({implSelected.size})
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
        <ScrollToTop />
        </div>
    );
};
