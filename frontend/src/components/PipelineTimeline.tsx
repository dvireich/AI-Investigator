import React, { useMemo, useState } from 'react';
import type { ConversationEntry } from '../types/pipeline';

interface PipelineTimelineProps {
    conversationLog: ConversationEntry[];
    /** Whether this tab is currently visible — triggers scroll-to-bottom on activation */
    isActive?: boolean;
}

const roleConfig: Record<ConversationEntry['role'], { label: string; icon: string }> = {
    thought: { label: 'Thought', icon: '💭' },
    action: { label: 'Action', icon: '⚡' },
    observation: { label: 'Observation', icon: '👁' },
    report: { label: 'Report', icon: '📋' },
    verdict: { label: 'Verdict', icon: '⚖️' },
    handoff: { label: '', icon: '' },
};

/**
 * Renders the multi-agent conversation as a group-chat-style timeline.
 * Each entry is color-coded by agent identity with role badges.
 */
export const PipelineTimeline: React.FC<PipelineTimelineProps> = React.memo(({ conversationLog, isActive }) => {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const userHasScrolledUp = React.useRef(false);
    const [activeFilter, setActiveFilter] = useState<string | null>(null);

    const entries = useMemo(() => conversationLog || [], [conversationLog]);

    // Derive unique agents (preserve insertion order, skip 'pipeline' system entries)
    const agents = useMemo(() => {
        const seen = new Map<string, { name: string; color?: string; icon?: string }>();
        for (const e of entries) {
            if (e.agentId === 'pipeline' || seen.has(e.agentId)) continue;
            seen.set(e.agentId, { name: e.agentName, color: e.agentColor, icon: e.agentIcon });
        }
        return Array.from(seen.entries()).map(([id, info]) => ({ id, ...info }));
    }, [entries]);

    // Filtered entries
    const visibleEntries = useMemo(
        () => activeFilter ? entries.filter(e => e.agentId === activeFilter || e.role === 'handoff') : entries,
        [entries, activeFilter],
    );

    // Track whether user has scrolled away from bottom
    const handleScroll = React.useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        userHasScrolledUp.current = !atBottom;
    }, []);

    // Auto-scroll to bottom when new entries arrive (unless user scrolled up)
    const prevLengthRef = React.useRef(0);
    React.useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        if (visibleEntries.length > prevLengthRef.current) {
            prevLengthRef.current = visibleEntries.length;
            if (userHasScrolledUp.current) return;
            requestAnimationFrame(() => {
                if (el) el.scrollTop = el.scrollHeight;
            });
        }
    }, [visibleEntries.length]);

    // Scroll to bottom when tab becomes active
    React.useEffect(() => {
        if (!isActive) return;
        const el = scrollContainerRef.current;
        if (!el) return;
        userHasScrolledUp.current = false;
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }, [isActive]);

    if (entries.length === 0) {
        return (
            <div className="flex flex-col flex-1 min-h-0">
                {agents.length > 0 && <AgentFilterBar agents={agents} activeFilter={activeFilter} setActiveFilter={setActiveFilter} />}
                <EmptyState />
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Agent filter bar */}
            <AgentFilterBar agents={agents} activeFilter={activeFilter} setActiveFilter={setActiveFilter} />

            {/* Scrollable messages */}
            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex flex-col gap-3 px-3 py-4 flex-1 overflow-y-auto custom-scrollbar">
                {visibleEntries.map((entry, i) => {
                    if (entry.role === 'handoff') {
                        return <HandoffCard key={i} entry={entry} />;
                    }
                    return <ConversationBubble key={i} entry={entry} />;
                })}
            </div>
        </div>
    );
});

PipelineTimeline.displayName = 'PipelineTimeline';

// ── Sub-components ──────────────────────────────────────────────────

interface AgentInfo { id: string; name: string; color?: string; icon?: string }

/** Attractive empty state with animated orbital rings */
const EmptyState: React.FC = () => (
    <div className="flex flex-col items-center justify-center flex-1 gap-5 relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute w-64 h-64 rounded-full opacity-[0.07] blur-3xl bg-blue-500" />

        {/* Animated orbital ring */}
        <div className="relative w-20 h-20">
            <div className="absolute inset-0 rounded-full border border-slate-700/50 animate-[spin_8s_linear_infinite]">
                <div className="absolute -top-1 left-1/2 -ml-1 w-2 h-2 rounded-full bg-blue-500/60" />
            </div>
            <div className="absolute inset-2 rounded-full border border-slate-700/30 animate-[spin_6s_linear_infinite_reverse]">
                <div className="absolute -top-1 left-1/2 -ml-1 w-2 h-2 rounded-full bg-purple-500/60" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50 flex items-center justify-center shadow-lg shadow-black/30">
                    <span className="text-sm">🤖</span>
                </div>
            </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center z-10">
            <span className="text-sm font-medium text-slate-400">Awaiting pipeline activity</span>
            <span className="text-xs text-slate-600 max-w-[240px]">Agents will appear here as they think, act, and collaborate</span>
        </div>

        {/* Pulsing dots */}
        <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-[pulse_2s_ease-in-out_infinite]" />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-[pulse_2s_ease-in-out_0.3s_infinite]" />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-[pulse_2s_ease-in-out_0.6s_infinite]" />
        </div>
    </div>
);

const AgentFilterBar: React.FC<{
    agents: AgentInfo[];
    activeFilter: string | null;
    setActiveFilter: React.Dispatch<React.SetStateAction<string | null>>;
}> = ({ agents, activeFilter, setActiveFilter }) => (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-800/80 bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-slate-900/90 backdrop-blur-sm flex-shrink-0 overflow-x-auto">
        <button
            onClick={() => setActiveFilter(null)}
            className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-all duration-200 whitespace-nowrap ${
                !activeFilter
                    ? 'bg-slate-600/80 text-white shadow-sm shadow-black/20'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
            }`}
        >
            All Agents
        </button>
        {agents.map(a => {
            const isSelected = activeFilter === a.id;
            const c = a.color || '#64748b';
            return (
                <button
                    key={a.id}
                    onClick={() => setActiveFilter(prev => prev === a.id ? null : a.id)}
                    className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full font-medium transition-all duration-200 whitespace-nowrap border ${
                        isSelected
                            ? 'text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200 border-transparent'
                    }`}
                    style={isSelected
                        ? { backgroundColor: c + '25', borderColor: c + '50', boxShadow: `0 0 8px ${c}20` }
                        : { backgroundColor: 'rgba(30,41,59,0.5)' }
                    }
                >
                    {a.icon ? (
                        <span className="text-xs">{a.icon}</span>
                    ) : (
                        <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: c }}
                        >
                            {a.name.charAt(0)}
                        </span>
                    )}
                    {a.name}
                </button>
            );
        })}
    </div>
);

const ConversationBubble: React.FC<{ entry: ConversationEntry }> = React.memo(({ entry }) => {
    const color = entry.agentColor || '#6b7280';
    const isVerdict = entry.role === 'verdict';
    const isReport = entry.role === 'report';
    const isThought = entry.role === 'thought';
    const isAction = entry.role === 'action';
    const cfg = roleConfig[entry.role];

    return (
        <div
            className={`rounded-lg border-l-[3px] px-3.5 py-2.5 border border-slate-700/40 ${
                isReport ? 'bg-gradient-to-r from-slate-800/90 to-slate-800/60 border-l-blue-500' :
                isVerdict ? 'bg-gradient-to-r from-slate-800/90 to-slate-800/60' :
                isThought ? 'bg-slate-800/50' :
                isAction ? 'bg-slate-800/60' :
                'bg-slate-800/50'
            }`}
            style={{ borderLeftColor: color }}
        >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-1.5">
                {/* Agent avatar */}
                <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm shrink-0"
                    style={{ backgroundColor: color }}
                    title={entry.agentName}
                >
                    {entry.agentIcon || entry.agentName.charAt(0).toUpperCase()}
                </span>

                {/* Agent name */}
                <span className="text-xs font-semibold tracking-wide" style={{ color }}>
                    {entry.agentName}
                </span>

                {/* Role badge with icon */}
                {cfg.label && (
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        isReport ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' :
                        isVerdict ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20' :
                        isAction ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' :
                        isThought ? 'bg-slate-600/30 text-slate-400 border border-slate-600/30' :
                        'bg-slate-700/50 text-slate-400 border border-slate-600/30'
                    }`}>
                        <span className="text-[9px]">{cfg.icon}</span>
                        {cfg.label}
                    </span>
                )}

                {/* Timestamp */}
                <span className="text-[10px] text-slate-500 ml-auto tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
            </div>

            {/* Content */}
            <div className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                isThought ? 'text-slate-300' :
                isAction ? 'text-slate-300 font-mono text-xs' :
                isReport ? 'text-slate-200' :
                'text-slate-300'
            }`}>
                {entry.content}
            </div>

            {/* Verdict metadata */}
            {isVerdict && entry.metadata?.verdict && (
                <div className="mt-2.5 flex items-center gap-2">
                    <span
                        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-semibold ${
                            entry.metadata.verdict === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' :
                            entry.metadata.verdict === 'rejected' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25' :
                            entry.metadata.verdict === 'flagged' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25' :
                            'bg-slate-700/50 text-slate-400 border border-slate-600/30'
                        }`}
                    >
                        <span>{
                            entry.metadata.verdict === 'approved' ? '✅' :
                            entry.metadata.verdict === 'rejected' ? '🔄' :
                            entry.metadata.verdict === 'flagged' ? '⚠️' : '—'
                        }</span>
                        {entry.metadata.verdict.charAt(0).toUpperCase() + entry.metadata.verdict.slice(1)}
                    </span>
                </div>
            )}
        </div>
    );
});

ConversationBubble.displayName = 'ConversationBubble';

const HandoffCard: React.FC<{ entry: ConversationEntry }> = React.memo(({ entry }) => {
    const meta = entry.metadata || {};
    const isRejection = meta.type === 'rejection-loop';
    const fromColor = meta.fromColor || '#6b7280';
    const toColor = meta.toColor || '#6b7280';

    return (
        <div className="flex justify-center py-1">
            <div className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs ${
                isRejection
                    ? 'bg-gradient-to-r from-amber-950/40 via-amber-950/30 to-amber-950/40 border border-amber-700/30 shadow-sm shadow-amber-900/20'
                    : 'bg-gradient-to-r from-slate-800/60 via-slate-800/40 to-slate-800/60 border border-slate-700/40'
            }`}>
                {/* From agent pill */}
                {meta.fromAgent && (
                    <span
                        className="inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full"
                        style={{
                            backgroundColor: fromColor + '20',
                            color: fromColor,
                            borderLeft: `2px solid ${fromColor}`,
                        }}
                    >
                        {meta.fromIcon && <span className="text-[10px]">{meta.fromIcon}</span>}
                        {meta.fromAgent}
                    </span>
                )}

                {/* Animated arrow connector */}
                <span className="flex items-center gap-0.5">
                    {isRejection ? (
                        <>
                            <span className="w-3 h-px bg-amber-600/50" />
                            <span className="text-amber-500 text-sm">↩</span>
                            <span className="w-3 h-px bg-amber-600/50" />
                        </>
                    ) : (
                        <>
                            <span className="w-4 h-px bg-gradient-to-r from-slate-600 to-slate-500" />
                            <span className="text-slate-400 text-base">›</span>
                            <span className="w-4 h-px bg-gradient-to-r from-slate-500 to-slate-600" />
                        </>
                    )}
                </span>

                {/* To agent pill */}
                {meta.toAgent && (
                    <span
                        className="inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full"
                        style={{
                            backgroundColor: toColor + '20',
                            color: toColor,
                            borderLeft: `2px solid ${toColor}`,
                        }}
                    >
                        {meta.toIcon && <span className="text-[10px]">{meta.toIcon}</span>}
                        {meta.toAgent}
                    </span>
                )}

                {/* Description / retry count */}
                <span className={`text-[10px] ml-1 ${isRejection ? 'text-amber-500/70' : 'text-slate-500'}`}>
                    {isRejection
                        ? `retry ${meta.retryCount}/${meta.maxRetries}`
                        : entry.content}
                </span>

                <span className="text-[10px] text-slate-600 tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
            </div>
        </div>
    );
});

HandoffCard.displayName = 'HandoffCard';
