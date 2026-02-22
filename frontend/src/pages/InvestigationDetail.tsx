import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, BASE_URL, type Investigation } from '../api';
import { Play, Pause, XCircle, Send, Terminal, Cpu, Activity, Clock, FileText, RefreshCw, Bot, User, AlertTriangle, MessageSquare, Sparkles, Copy, Check, X, ChevronDown, ChevronRight, FilePlus, FileEdit, Loader2, CheckCircle2, ArrowDownToLine, RotateCcw, WifiOff, Wifi } from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Format a raw KQL time range into a human-readable string */
function formatTimeRange(raw: string): string {
    if (!raw) return raw;

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
            const end = (status === 'paused' && pausedAt) ? pausedAt : new Date().getTime();
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
            alert("Failed to load details");
        } finally {
            setLoading(false);
        }
    };

    const isSystemMessage = typeof thoughtContent === 'string' && thoughtContent.startsWith('System:');
    const isUserMessage = typeof thoughtContent === 'string' && thoughtContent.startsWith('User Intervention:');
    const isObservation = typeof thoughtContent === 'string' && thoughtContent.startsWith('Observation:');

    if (isSystemMessage) {
        return (
            <div className="flex justify-center my-6 animate-fade-in px-8">
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
            <div className="flex justify-start my-1 animate-fade-in px-8 pl-12 opacity-60 hover:opacity-100 transition-opacity">
                <div className="text-[10px] font-mono text-slate-500 flex items-center gap-2 border-l-2 border-slate-800 pl-2">
                    <Terminal className="w-3 h-3" />
                    <span>{thoughtContent}</span>
                </div>
            </div>
        );
    }

    if (isUserMessage) {
        return (
            <div className="flex justify-end my-4 animate-fade-in pl-12 group items-end gap-2">
                <div className="bg-brand-500/10 border border-brand-500/20 text-brand-100 rounded-2xl rounded-tr-none p-4 shadow-sm max-w-[85%] relative">
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

    // Check for Azure Auth Error
    if (typeof thoughtContent === 'string' && (thoughtContent.includes("Azure Authentication Required") || thoughtContent.includes("Please log in"))) {
        return (
            <div className="flex justify-center my-6 animate-fade-in px-8">
                <div className="bg-blue-500/10 border border-blue-500/20 backdrop-blur-sm text-blue-200 text-xs px-6 py-4 rounded-xl shadow-sm flex flex-col items-center gap-3 max-w-md text-center">
                    <div className="flex items-center gap-2 font-bold text-blue-100">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Azure Authentication Required</span>
                    </div>
                    <p className="opacity-80">The agent cannot connect to Kusto because you are not logged in to Azure.</p>
                    <button
                        onClick={async () => {
                            try {
                                await api.startLogin();
                                alert("Login process started. Please check your browser or terminal.");
                            } catch (e: any) {
                                alert("Failed to start login: " + e.message);
                            }
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-blue-500/20"
                    >
                        Login to Azure via Browser
                    </button>
                </div>
            </div>
        );
    }

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
        <div className="flex flex-col gap-2 my-4 animate-fade-in">
            {/* 1. Agent Thought Bubble */}
            {thoughtContent && (
                <div className="flex justify-start pr-12 group items-end gap-2">
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
                <div className="flex justify-start pl-10 pr-4 animate-fade-in">
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
                className="w-full flex items-center justify-between bg-white/50 hover:bg-white/80 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 transition-all shadow-sm group"
            >
                <span className="truncate mr-2">{currentModel}</span>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full min-w-[180px] bg-white rounded-lg shadow-xl border border-slate-100 py-1 animate-in fade-in zoom-in-95 duration-100 origin-top-right right-0">
                    <div className="px-3 py-2 border-b border-slate-50 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
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
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors ${currentModel === model ? 'text-brand-600 font-bold bg-brand-50/50' : 'text-slate-600'}`}
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

export const InvestigationDetail = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [investigation, setInvestigation] = useState<Investigation | null>(null);
    // Removed interventionMsg state to prevent re-renders
    const [showQueryModal, setShowQueryModal] = useState(false);
    const [actingAction, setActingAction] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<'live' | 'report' | 'retrospect'>('live');
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

    const showTokenAlert = useMemo(() => {
        if (!investigation) return false;
        // Check if last thought was a token alert
        const lastThought = investigation.thoughts[investigation.thoughts.length - 1];
        if (!lastThought) return false;

        const content = typeof lastThought === 'string' ? lastThought : (lastThought as any).content;
        return content && (content.includes('Token limit exceeded') || content.includes('System Alert: Token limit'));
    }, [investigation?.thoughts]);

    const fetchInvestigation = async () => {
        if (!id) return;
        try {
            const data = await api.getInvestigation(id);
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
            // If investigation not found, redirect to home page
            if (err.message === 'Not found' || err.status === 404) {
                console.log('Investigation not found, redirecting to home...');
                navigate('/', { replace: true });
            }
        }
    };

    useEffect(() => {
        if (!id) return;
        fetchInvestigation();
    }, [id, navigate]);

    // WebSocket logic with auto-reconnect
    useEffect(() => {
        if (!id) return;

        let ws: WebSocket | null = null;
        let reconnectTimeout: any;
        let reconnectAttempts = 0;
        let intentionallyClosed = false;
        const MAX_RECONNECT_DELAY = 30_000; // 30s cap

        const connect = () => {
            const wsBase = BASE_URL.replace(/^http/, 'ws');
            ws = new WebSocket(`${wsBase}/ws?id=${id}`);

            ws.onopen = () => {
                console.log('Connected to WebSocket');
                reconnectAttempts = 0;
                setWsConnected(true);
                // Show brief "reconnected" overlay if this was a reconnect
                if (hadDisconnectRef.current) {
                    setWsJustReconnected(true);
                    setTimeout(() => setWsJustReconnected(false), 2000);
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
        };
    }, [id]);

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
                .then(() => mounted ? fetchInvestigation() : undefined)
                .catch(err => console.error('Auto-analysis failed:', err))
                .finally(() => { if (mounted) { setIsAnalyzing(false); setRetroToolActivity(null); } });
        }
        return () => { mounted = false; };
    }, [activeTab, investigation?.id, investigation?.status, investigation?.retrospect?.analysisComplete]);

    // Helper to update proposal status
    const handleProposalAction = useCallback(async (proposalId: string, status: 'approved' | 'rejected') => {
        if (!investigation) return;
        try {
            await api.updateProposal(investigation.id, proposalId, status);
            await fetchInvestigation();
        } catch (err: any) {
            alert('Failed to update proposal: ' + err.message);
        }
    }, [investigation?.id]);

    // Helper to apply all approved proposals
    const handleApplyProposals = useCallback(async () => {
        if (!investigation) return;
        setApplyingProposals(true);
        try {
            const result = await api.applyProposals(investigation.id);
            await fetchInvestigation();
            if (result.errors?.length > 0) {
                alert(`Applied ${result.applied.length} changes. Errors:\n${result.errors.join('\n')}`);
            }
        } catch (err: any) {
            alert('Failed to apply proposals: ' + err.message);
        } finally {
            setApplyingProposals(false);
        }
    }, [investigation?.id]);

    const handleAction = async (action: string) => {
        if (!id) return;
        setActingAction(action);
        try {
            await api.sendAction(id, action);
            await new Promise(r => setTimeout(r, 500));
            await fetchInvestigation();
        } catch (e: any) {
            alert(`Action failed: ${e.message}`);
        } finally {
            setActingAction(null);
        }
    };

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

    if (!investigation) return <div className="flex justify-center items-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500"></div></div>;

    const isActive = investigation.status === 'running' || investigation.status === 'paused';

    return (
        <div className="h-[calc(100vh-7rem)] overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 pb-2">

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
            <div className="lg:col-span-3 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                {/* Status Card */}
                <div className="bg-gradient-to-br from-white/90 to-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/60 relative overflow-hidden group shrink-0">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                    <div className="flex flex-col items-center justify-center mb-8">
                        <div className={`relative w-20 h-20 rounded-full flex items-center justify-center mb-4 transition-all duration-500 ${investigation.status === 'running' ? 'bg-green-100 text-green-600 ring-4 ring-green-50' :
                            investigation.status === 'paused' ? 'bg-amber-100 text-amber-600 ring-4 ring-amber-50' :
                                investigation.status === 'failed' ? 'bg-red-100 text-red-600 ring-4 ring-red-50' :
                                    'bg-slate-100 text-slate-400 ring-4 ring-slate-50'
                            }`}>
                            {investigation.status === 'running' && <div className="absolute inset-0 rounded-full border-4 border-green-500/20 animate-ping"></div>}
                            <Activity className={`w-8 h-8 ${investigation.status === 'running' ? 'animate-pulse' : ''}`} />
                        </div>

                        <h2 className="text-2xl font-black text-slate-800 tracking-tight capitalize">{investigation.status}</h2>
                        <p className="text-slate-500 text-sm font-medium">Investigation Status</p>
                    </div>

                    <div className="space-y-4">
                        {investigation.status === 'running' && (
                            <button
                                onClick={() => handleAction('pause')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-amber-500/30 transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                {actingAction === 'pause' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <Pause className="w-5 h-5 mr-3 fill-current" />}
                                {actingAction === 'pause' ? 'Pausing...' : 'Pause'}
                            </button>
                        )}
                        {investigation.status === 'paused' && (
                            <button
                                onClick={() => handleAction('resume')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/30 transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                {actingAction === 'resume' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <Play className="w-5 h-5 mr-3 fill-current" />}
                                {actingAction === 'resume' ? 'Resuming...' : 'Resume'}
                            </button>
                        )}
                        {isActive && (
                            <button
                                onClick={() => handleAction('abort')}
                                disabled={actingAction !== null}
                                className="w-full group/btn flex items-center justify-center px-6 py-4 bg-white text-red-500 font-bold rounded-2xl border-2 border-red-100 hover:bg-red-50 hover:border-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                {actingAction === 'abort' ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <XCircle className="w-5 h-5 mr-3" />}
                                {actingAction === 'abort' ? 'Aborting...' : 'Abort'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Info Card */}
                <div className="bg-white/60 backdrop-blur-md rounded-2xl p-5 shadow-lg border border-white/50 text-sm shrink-0">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Details</h3>
                    <div className="space-y-3">
                        {investigation.status === 'running' && (
                            <div className="flex items-start">
                                <div className="w-4 h-4 flex items-center justify-center mr-2 mt-0.5">
                                    <Clock className="w-4 h-4 text-brand-500 animate-pulse" />
                                </div>
                                <div>
                                    <span className="block text-slate-500 text-xs">Duration</span>
                                    <span className="font-medium text-slate-700">
                                        <DurationTimer
                                            startTime={Number(investigation.id)}
                                            status={investigation.status}
                                            pausedAt={investigation.pausedAt}
                                            totalPausedTime={investigation.totalPausedTime}
                                        />
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="flex items-start">
                            <Clock className="w-4 h-4 text-slate-400 mr-2 mt-0.5" />
                            <div>
                                <span className="block text-slate-500 text-xs">Started</span>
                                <span className="font-medium text-slate-700">{isNaN(Number(investigation.id)) ? 'Legacy' : new Date(parseInt(investigation.id)).toLocaleString()}</span>
                            </div>
                        </div>
                        {investigation.stamp && (
                            <div className="flex items-start">
                                <div className="w-4 h-4 flex items-center justify-center mr-2 mt-0.5 rounded bg-blue-100 text-blue-600 font-bold text-[10px]">S</div>
                                <div>
                                    <span className="block text-slate-500 text-xs">Stamp</span>
                                    <span className="font-medium text-slate-700">{investigation.stamp}</span>
                                </div>
                            </div>
                        )}
                        {investigation.timeRange && (
                            <div className="flex items-start">
                                <div className="w-4 h-4 flex items-center justify-center mr-2 mt-0.5 rounded bg-purple-100 text-purple-600 font-bold text-[10px]">T</div>
                                <div>
                                    <span className="block text-slate-500 text-xs">Time Range</span>
                                    <span className="font-medium text-slate-700" title={investigation.timeRange}>{formatTimeRange(investigation.timeRange)}</span>
                                </div>
                            </div>
                        )}
                        {investigation.query && (
                            <div className="flex items-start">
                                <div className="w-4 h-4 flex items-center justify-center mr-2 mt-0.5 rounded bg-slate-200 text-slate-600 font-bold text-[10px]">Q</div>
                                <div className="min-w-0 flex-1">
                                    <span className="block text-slate-500 text-xs">Query</span>
                                    <button
                                        onClick={() => setShowQueryModal(true)}
                                        className="text-xs text-brand-600 font-bold hover:underline flex items-center mt-1 border border-brand-100 bg-brand-50 px-2 py-1 rounded transition-colors hover:bg-brand-100"
                                    >
                                        <FileText className="w-3 h-3 mr-1" /> View Full Query
                                    </button>
                                </div>
                            </div>
                        )}
                        {investigation.model && (
                            <div className="flex items-start group/model">
                                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mr-3 shrink-0 border border-indigo-100 group-hover/model:bg-indigo-100 group-hover/model:scale-105 transition-all">
                                    <Cpu className="w-4 h-4" />
                                </div>
                                <div className="w-full min-w-0">
                                    <span className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">Model</span>
                                    <ModelSelector
                                        currentModel={investigation.model}
                                        availableModels={availableModels}
                                        onSelect={async (model) => {
                                            if (!investigation) return;
                                            try {
                                                await api.updateModel(investigation.id, model);
                                                fetchInvestigation();
                                            } catch (err: any) {
                                                alert("Failed to change model: " + err.message);
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Main Area: Unified Window Structure */}
            <div className="lg:col-span-9 flex flex-col h-full overflow-hidden">
                <div className="flex-1 bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-700 ring-1 ring-slate-800 min-h-0 relative">

                    {/* Window Header (Banner) */}
                    <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-800 shrink-0 z-10">
                        <div className="flex-1"></div>
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
                                <Bot className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-100 leading-tight">Investigation Agent</span>
                            </div>
                        </div>
                        <div className="flex-1 flex justify-end">
                            <div className="flex space-x-2 opacity-50 hovered:opacity-100 transition-opacity">
                                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                            </div>
                        </div>
                    </div>

                    {/* Integrated Tab Bar (Below Banner) */}
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-800/50 border border-slate-700/50 w-full">
                        <button
                            onClick={() => setActiveTab('live')}
                            className={`flex-1 px-4 py-3 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'live' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'}`}
                        >
                            <Terminal className="w-4 h-4" /> Live Session
                        </button>
                        <button
                            onClick={() => setActiveTab('report')}
                            disabled={!investigation.finalReport}
                            className={`flex-1 px-4 py-3 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'report' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'} ${!investigation.finalReport ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                            <FileText className="w-4 h-4" /> Final Report
                            {investigation.finalReport && <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 ml-1.5 animate-pulse"></span>}
                        </button>
                        {['completed', 'failed', 'aborted'].includes(investigation.status) && (
                            <button
                                onClick={() => setActiveTab('retrospect' as any)}
                                className={`flex-1 px-4 py-3 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'retrospect' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30'}`}
                            >
                                <MessageSquare className="w-4 h-4" /> Retrospect
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
                                                if (!investigation) return;
                                                const btn = document.getElementById('btn-summarize');
                                                if (btn) btn.innerText = '...';
                                                try {
                                                    await api.compactInvestigation(investigation.id);
                                                    window.location.reload();
                                                } catch (e: any) { alert("Failed: " + e.message); }
                                            }}
                                            id="btn-summarize"
                                            className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold rounded border border-red-500/30"
                                        >
                                            Summarize
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Chat History */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm leading-relaxed custom-scrollbar bg-slate-900">
                                {/* Init Logs */}
                                <div className="pb-2 space-y-0.5">
                                    {filteredLogs.map((log, i) => (
                                        <div key={`sys-${i}`} className="text-slate-600 text-[11px] font-mono opacity-60 hover:opacity-100 transition-opacity">
                                            {log}
                                        </div>
                                    ))}
                                </div>

                                {investigation.thoughts.map((thought, i) => (
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
                            <div className="p-3 border-t border-slate-800 bg-slate-950/30 backdrop-blur-sm z-20">
                                <InterventionInput onSend={handleIntervention} status={investigation.status} />
                            </div>
                        </div>

                        {/* VIEW 2: Final Report */}
                        <div className={`absolute inset-0 z-20 flex flex-col ${activeTab === 'report' ? 'z-20' : 'hidden'}`}>
                            {investigation.finalReport && (
                                <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-100">
                                    <div className="max-w-4xl mx-auto my-8 lg:my-12 bg-white shadow-xl shadow-slate-200/50 rounded-xl border border-slate-200 overflow-hidden">

                                        {/* Report Header */}
                                        <div className="bg-slate-50 border-b border-slate-100 px-8 py-6 flex items-start justify-between">
                                            <div>
                                                <h1 className="text-2xl font-bold text-slate-800 mb-2">Investigation Report</h1>
                                                <div className="flex items-center gap-4 text-sm text-slate-500">
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
                                            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${investigation.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                                investigation.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                    'bg-slate-200 text-slate-600'
                                                }`}>
                                                {investigation.status}
                                            </div>
                                        </div>

                                        {/* Report Content */}
                                        <div className="p-8 lg:p-12">
                                            <div className="prose prose-slate max-w-none 
                                                prose-headings:font-bold prose-headings:text-slate-800 
                                                prose-h1:text-3xl prose-h1:mb-6 prose-h1:pb-4 prose-h1:border-b prose-h1:border-slate-100
                                                prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:text-brand-600
                                                prose-h3:text-lg prose-h3:mt-6
                                                prose-p:text-slate-600 prose-p:leading-relaxed
                                                prose-a:text-brand-600 prose-a:font-medium hover:prose-a:text-brand-700
                                                prose-strong:text-slate-700
                                                prose-code:text-brand-600 prose-code:bg-brand-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                                prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-xl prose-pre:shadow-lg
                                                prose-li:text-slate-600
                                                prose-img:rounded-xl prose-img:shadow-md
                                                prose-blockquote:border-l-4 prose-blockquote:border-brand-500 prose-blockquote:bg-brand-50/50 prose-blockquote:px-6 prose-blockquote:py-2 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-slate-700
                                            ">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {investigation.finalReport}
                                                </ReactMarkdown>
                                            </div>
                                        </div>

                                        {/* Report Footer */}
                                        <div className="bg-slate-50 border-t border-slate-100 px-8 py-4 text-center">
                                            <p className="text-xs text-slate-400 font-medium">
                                                CONFIDENTIAL • Generated automatically by AI Investigation Agent
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* VIEW 3: Retrospective — Split Layout (Chat + Proposals) */}
                        <div className={`absolute inset-0 bg-slate-950 z-20 flex ${activeTab === 'retrospect' ? 'z-20' : 'hidden'}`}>
                            
                            {/* LEFT: Chat Panel (60%) */}
                            <div className="flex-[3] flex flex-col border-r border-slate-800 min-w-0">
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
                                        <div className="flex gap-3 justify-start animate-fade-in pl-2">
                                            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
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
                                    {investigation.retrospect?.messages.map((msg, i) => (
                                        <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            {msg.role !== 'user' && (
                                                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                                                    <Sparkles className="w-4 h-4 text-purple-400" />
                                                </div>
                                            )}
                                            <div className={`max-w-[80%] rounded-2xl p-4 ${msg.role === 'user'
                                                ? 'bg-purple-600 text-white rounded-tr-none'
                                                : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'
                                                }`}>
                                                <div className="prose prose-invert prose-sm max-w-none">
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
                                    ))}

                                    {/* Analysis complete indicator */}
                                    {investigation.retrospect?.analysisComplete && !isAnalyzing && !isRetrospectThinking && (investigation.retrospect?.messages?.length || 0) > 0 && (
                                        <div className="flex gap-3 justify-start pl-2">
                                            <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            </div>
                                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl rounded-tl-none px-4 py-2.5 text-sm text-emerald-300 font-medium">
                                                Analysis finished {(investigation.retrospect?.proposals?.length || 0) > 0
                                                    ? `— ${investigation.retrospect?.proposals?.length} proposed change${(investigation.retrospect?.proposals?.length || 0) === 1 ? '' : 's'} ready for review`
                                                    : '— no changes proposed'
                                                }
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
                                                className="flex items-center justify-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-sm font-medium py-2 px-4 rounded-xl transition-all"
                                            >
                                                <RefreshCw className="w-4 h-4" /> Re-run Analysis
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
                                                alert(err.message);
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
                            <div className="flex-[2] flex flex-col bg-slate-900/50 min-w-0">
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
                                                        } catch (err: any) { alert(err.message); }
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
                                                            <div className="p-3 max-h-64 overflow-y-auto custom-scrollbar">
                                                                {proposal.type === 'edit' && proposal.originalContent ? (
                                                                    <div className="space-y-2">
                                                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Changes Preview</div>
                                                                        <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                                                                            <div className="text-red-400/70 mb-2">
                                                                                <span className="text-red-500 font-bold">- Original:</span> {proposal.originalContent.length.toLocaleString()} chars
                                                                            </div>
                                                                            <div className="text-emerald-400/70">
                                                                                <span className="text-emerald-500 font-bold">+ Proposed:</span> {proposal.content.length.toLocaleString()} chars
                                                                            </div>
                                                                            <div className="text-slate-500 mt-2 border-t border-slate-800 pt-2">
                                                                                {(() => {
                                                                                    const origLines = proposal.originalContent!.split('\n').length;
                                                                                    const newLines = proposal.content.split('\n').length;
                                                                                    const diff = newLines - origLines;
                                                                                    return `${origLines} lines → ${newLines} lines (${diff >= 0 ? '+' : ''}${diff})`;
                                                                                })()}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        <div className="text-xs font-bold text-emerald-500 uppercase tracking-wider">New File Preview</div>
                                                                        <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-300 leading-relaxed max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all">
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

                    </div>
                </div>

                {/* Query Modal */}
                {
                    showQueryModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowQueryModal(false)}>
                            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
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
                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Stamp</span>
                                                <div className="font-mono text-sm text-blue-300 font-medium">
                                                    {investigation?.stamp || <span className="text-slate-600 italic">Not specified</span>}
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
                                                    navigator.clipboard.writeText(investigation?.query || '');
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
            </div>
        </div>
    );
};
