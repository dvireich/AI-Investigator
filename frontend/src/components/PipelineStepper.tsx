import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PipelineStageState } from '../types/pipeline';

interface PipelineStepperProps {
    stages: PipelineStageState[];
    currentStageIndex: number;
}

const statusIcon: Record<PipelineStageState['status'], string> = {
    pending: '○',
    running: '●',
    completed: '✓',
    rejected: '↩',
    skipped: '−',
    failed: '✗',
    aborted: '⊘',
};

const statusLabel: Record<PipelineStageState['status'], string> = {
    pending: 'Waiting',
    running: 'Running',
    completed: 'Completed',
    rejected: 'Rejected',
    skipped: 'Skipped',
    failed: 'Failed',
    aborted: 'Aborted',
};

const statusColor: Record<PipelineStageState['status'], string> = {
    pending: 'text-slate-400',
    running: 'text-blue-400',
    completed: 'text-emerald-400',
    rejected: 'text-amber-400',
    skipped: 'text-slate-500',
    failed: 'text-red-400',
    aborted: 'text-red-400',
};

interface TooltipData {
    stage: PipelineStageState;
    color: string;
    durationStr: string;
    rect: DOMRect;
}

/** Portal-based tooltip that escapes overflow:hidden parents */
const StageTooltip: React.FC<{ data: TooltipData }> = ({ data }) => {
    const { stage, color, durationStr, rect } = data;
    const tooltipW = 220;
    // Position above the element, centered horizontally
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tooltipW / 2, window.innerWidth - tooltipW - 8));
    const top = rect.top - 8; // 8px gap above element

    return createPortal(
        <div
            className="fixed z-[9999] pointer-events-none"
            style={{ left, top, width: tooltipW, transform: 'translateY(-100%)' }}
        >
            <div className="bg-slate-900 border border-slate-600/60 rounded-lg shadow-xl shadow-black/50 px-3 py-2.5 text-left animate-in fade-in zoom-in-95 duration-100">
                {/* Header: icon + name */}
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base" style={{ color }}>{stage.icon || statusIcon[stage.status]}</span>
                    <span className="text-sm font-semibold text-slate-100 truncate">{stage.agentName}</span>
                </div>

                {/* Description */}
                {stage.description && (
                    <p className="text-[11px] text-slate-400 leading-snug mb-2 line-clamp-3">{stage.description}</p>
                )}

                {/* Divider */}
                <div className="border-t border-slate-700/60 my-1.5" />

                {/* Status row */}
                <div className="flex items-center gap-1.5 text-[11px] mb-1">
                    <span className="text-slate-500 font-medium">Status:</span>
                    <span className={`font-semibold ${statusColor[stage.status]}`}>
                        {statusLabel[stage.status]}
                    </span>
                    {stage.verdict && (
                        <span className="text-amber-400 font-medium">({stage.verdict})</span>
                    )}
                </div>

                {/* Duration row */}
                {durationStr && (
                    <div className="flex items-center gap-1.5 text-[11px] mb-1">
                        <span className="text-slate-500 font-medium">Duration:</span>
                        <span className="text-slate-300">{durationStr}</span>
                    </div>
                )}

                {/* Retry row */}
                {stage.retryCount > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-500 font-medium">Retries:</span>
                        <span className="text-amber-400 font-semibold">{stage.retryCount}</span>
                    </div>
                )}

                {/* Click hint */}
                {(stage.report || stage.feedback) && (
                    <>
                        <div className="border-t border-slate-700/60 my-1.5" />
                        <div className="text-[10px] text-slate-500 text-center">Click stage to expand ›</div>
                    </>
                )}
            </div>
            {/* Arrow pointing down */}
            <div className="flex justify-center -mt-[1px]">
                <div className="w-2.5 h-2.5 bg-slate-900 border-r border-b border-slate-600/60 rotate-45" />
            </div>
        </div>,
        document.body,
    );
};

/** Expanded detail panel — portal overlay with full stage data, scrollable */
const StageDetailPanel: React.FC<{ stage: PipelineStageState; color: string; durationStr: string; onClose: () => void }> = ({ stage, color, durationStr, onClose }) => {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    // Close on click outside
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={handleBackdropClick}
        >
            <div
                ref={panelRef}
                className="bg-slate-900 border border-slate-600/60 rounded-xl shadow-2xl shadow-black/60 w-[90vw] max-w-lg max-h-[70vh] flex flex-col animate-in zoom-in-95 fade-in duration-150"
            >
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/60 shrink-0">
                    <span className="text-2xl" style={{ color }}>{stage.icon || statusIcon[stage.status]}</span>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-slate-100 truncate">{stage.agentName}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs font-semibold ${statusColor[stage.status]}`}>{statusLabel[stage.status]}</span>
                            {stage.verdict && <span className="text-xs text-amber-400 font-medium">({stage.verdict})</span>}
                            {durationStr && <span className="text-xs text-slate-500">· {durationStr}</span>}
                            {stage.retryCount > 0 && <span className="text-xs text-amber-400">· {stage.retryCount} {stage.retryCount === 1 ? 'retry' : 'retries'}</span>}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-slate-700/50"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 text-sm">
                    {/* Description */}
                    {stage.description && (
                        <section>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</h4>
                            <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{stage.description}</p>
                        </section>
                    )}

                    {/* Feedback */}
                    {stage.feedback && (
                        <section>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Feedback</h4>
                            <div className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-3 text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {stage.feedback}
                            </div>
                        </section>
                    )}

                    {/* Report */}
                    {stage.report && (
                        <section>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Report</h4>
                            <div className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-3 text-slate-300 leading-relaxed whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
                                {stage.report}
                            </div>
                        </section>
                    )}

                    {/* Empty state */}
                    {!stage.description && !stage.feedback && !stage.report && (
                        <p className="text-slate-500 italic text-center py-4">No additional details available for this stage.</p>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

/**
 * Horizontal stepper showing pipeline stages and their progress.
 * Responsive: compact circles + no labels on mobile, full layout on sm+.
 * Only the currently-running stage gets the animated glow highlight.
 * Rejected/flagged stages show their verdict badge but are visually subdued.
 * Hovering a stage shows a styled popover with status, description, and timing.
 * Clicking a stage opens a full detail panel with report, feedback, and description.
 */
export const PipelineStepper: React.FC<PipelineStepperProps> = React.memo(({ stages, currentStageIndex: _currentStageIndex }) => {
    if (!stages || stages.length === 0) return null;

    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const hoveredRef = useRef<TooltipData | null>(null);

    const showTooltip = useCallback((index: number, el: HTMLDivElement, stage: PipelineStageState, color: string, durationStr: string) => {
        hoveredRef.current = { stage, color, durationStr, rect: el.getBoundingClientRect() };
        setHoveredIdx(index);
    }, []);

    const hideTooltip = useCallback(() => {
        hoveredRef.current = null;
        setHoveredIdx(null);
    }, []);

    return (
        <div className="flex items-center justify-center gap-0.5 sm:gap-2 px-2 sm:px-5 py-2 sm:py-3 bg-gradient-to-r from-slate-800/90 via-slate-800/70 to-slate-800/90 border border-slate-700/40 rounded-xl w-full backdrop-blur-sm shadow-lg shadow-black/20">
            {stages.map((stage, index) => {
                const isActive = stage.status === 'running';
                const isDone = stage.status === 'completed';
                const isRejected = stage.status === 'rejected';
                const isFailed = stage.status === 'failed';
                const isAborted = stage.status === 'aborted';
                const isPending = stage.status === 'pending';
                const isSubdued = isRejected || isPending;
                const color = stage.color || (isActive ? '#3b82f6' : isDone ? '#22c55e' : isRejected ? '#f59e0b' : isFailed || isAborted ? '#ef4444' : '#64748b');

                // Duration string
                let durationStr = '';
                if (stage.startedAt && stage.completedAt && stage.completedAt >= stage.startedAt) {
                    const sec = Math.round((stage.completedAt - stage.startedAt) / 1000);
                    durationStr = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
                } else if (stage.startedAt && isActive) {
                    const sec = Math.round((Date.now() - stage.startedAt) / 1000);
                    durationStr = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
                }

                return (
                    <React.Fragment key={stage.agentId + '-' + index}>
                        {/* Connector line */}
                        {index > 0 && (
                            <div className="flex-1 min-w-[4px] sm:min-w-[16px] max-w-[16px] sm:max-w-[48px] flex items-center">
                                <div
                                    className="w-full h-[2px] rounded-full transition-all duration-500"
                                    style={{
                                        background: isPending
                                            ? '#334155'
                                            : `linear-gradient(90deg, ${stages[index - 1].color || color}88, ${color}88)`,
                                    }}
                                />
                            </div>
                        )}

                        {/* Stage node */}
                        <div
                            className="relative flex flex-col items-center gap-0.5 sm:gap-1 shrink-0 cursor-pointer"
                            onMouseEnter={(e) => showTooltip(index, e.currentTarget as HTMLDivElement, stage, color, durationStr)}
                            onMouseLeave={hideTooltip}
                            onClick={() => { hideTooltip(); setExpandedIdx(index); }}
                        >
                            {/* Circle with glow rings */}
                            <div className="relative">
                                {/* Outer glow ring — only for the active (running) stage */}
                                {isActive && (
                                    <>
                                        <div
                                            className="absolute -inset-2 sm:-inset-2.5 rounded-full animate-ping opacity-20"
                                            style={{ backgroundColor: color }}
                                        />
                                        <div
                                            className="absolute -inset-1 sm:-inset-1.5 rounded-full animate-pulse opacity-30"
                                            style={{ backgroundColor: color }}
                                        />
                                    </>
                                )}
                                {/* Completed glow */}
                                {isDone && (
                                    <div
                                        className="absolute -inset-0.5 rounded-full opacity-20 blur-[2px]"
                                        style={{ backgroundColor: color }}
                                    />
                                )}
                                <div
                                    className={`relative w-6 h-6 sm:w-9 sm:h-9 rounded-full border-2 flex items-center justify-center text-[10px] sm:text-sm font-bold transition-all duration-300 ${
                                        isActive ? 'shadow-lg shadow-blue-500/20 scale-110' :
                                        isDone ? 'shadow-md shadow-emerald-500/10' :
                                        isSubdued ? 'opacity-50' : ''
                                    }`}
                                    style={{
                                        borderColor: color,
                                        color: isDone ? '#fff' : color,
                                        backgroundColor: isDone ? color : isActive ? color + '20' : 'transparent',
                                    }}
                                >
                                    {stage.icon || statusIcon[stage.status]}
                                </div>

                                {/* Retry count badge */}
                                {stage.retryCount > 0 && (
                                    <div
                                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white border border-slate-700"
                                        style={{ backgroundColor: '#f59e0b' }}
                                    >
                                        {stage.retryCount}
                                    </div>
                                )}
                            </div>

                            {/* Label: hidden on mobile, shown on sm+ */}
                            <span
                                className={`hidden sm:block text-[10px] text-center leading-tight max-w-[80px] truncate font-medium transition-colors duration-300 ${
                                    isActive ? 'text-white' : isDone ? 'text-slate-300' : isSubdued ? 'text-slate-600' : 'text-slate-400'
                                }`}
                            >
                                {stage.agentName}
                            </span>

                            {/* Status tag (sm+ only) */}
                            {isActive && (
                                <span
                                    className="hidden sm:inline-flex items-center gap-0.5 text-[9px] px-2 py-0.5 rounded-full font-semibold animate-pulse"
                                    style={{ backgroundColor: color + '25', color }}
                                >
                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
                                    running
                                </span>
                            )}
                            {isDone && (
                                <span className="hidden sm:inline-flex text-[9px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                    done
                                </span>
                            )}
                            {isRejected && (
                                <span className="hidden sm:inline-flex text-[9px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                    {stage.verdict || 'rejected'}
                                </span>
                            )}
                            {isFailed && (
                                <span className="hidden sm:inline-flex text-[9px] px-2 py-0.5 rounded-full font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                                    failed
                                </span>
                            )}
                            {isAborted && (
                                <span className="hidden sm:inline-flex text-[9px] px-2 py-0.5 rounded-full font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                                    aborted
                                </span>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}
            {/* Portal tooltip — rendered outside overflow:hidden containers */}
            {hoveredIdx !== null && hoveredRef.current && (
                <StageTooltip data={hoveredRef.current} />
            )}
            {/* Expanded detail panel */}
            {expandedIdx !== null && stages[expandedIdx] && (() => {
                const s = stages[expandedIdx];
                const c = s.color || '#64748b';
                let d = '';
                if (s.startedAt && s.completedAt && s.completedAt >= s.startedAt) {
                    const sec = Math.round((s.completedAt - s.startedAt) / 1000);
                    d = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
                }
                return <StageDetailPanel stage={s} color={c} durationStr={d} onClose={() => setExpandedIdx(null)} />;
            })()}
        </div>
    );
});

PipelineStepper.displayName = 'PipelineStepper';
