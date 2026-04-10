import React from 'react';
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

/**
 * Horizontal stepper showing pipeline stages and their progress.
 * Responsive: compact circles + no labels on mobile, full layout on sm+.
 * The currently-active stage gets an animated glow highlight.
 */
export const PipelineStepper: React.FC<PipelineStepperProps> = React.memo(({ stages, currentStageIndex: _currentStageIndex }) => {
    if (!stages || stages.length === 0) return null;

    return (
        <div className="flex items-center justify-center gap-1 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-r from-slate-800/90 via-slate-800/70 to-slate-800/90 border border-slate-700/40 rounded-xl overflow-x-auto w-full backdrop-blur-sm shadow-lg shadow-black/20">
            {stages.map((stage, index) => {
                const isActive = stage.status === 'running';
                const isDone = stage.status === 'completed';
                const isRejected = stage.status === 'rejected';
                const isFailed = stage.status === 'failed';
                const isAborted = stage.status === 'aborted';
                const isPending = stage.status === 'pending';
                const color = stage.color || (isActive ? '#3b82f6' : isDone ? '#22c55e' : isRejected ? '#f59e0b' : isFailed || isAborted ? '#ef4444' : '#64748b');

                return (
                    <React.Fragment key={stage.agentId + '-' + index}>
                        {/* Connector line — animated gradient for active transition */}
                        {index > 0 && (
                            <div className="flex-shrink-0 flex-1 min-w-[8px] sm:min-w-[16px] max-w-[24px] sm:max-w-[48px] flex items-center">
                                <div
                                    className={`w-full h-[2px] rounded-full transition-all duration-500 ${
                                        isPending ? '' : ''
                                    }`}
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
                            className="flex flex-col items-center gap-0.5 sm:gap-1 flex-shrink-0"
                            title={`${stage.agentName}: ${stage.status}${stage.verdict ? ` (${stage.verdict})` : ''}${stage.retryCount > 0 ? ` [retry ${stage.retryCount}]` : ''}`}
                        >
                            {/* Circle with glow rings */}
                            <div className="relative">
                                {/* Outer glow ring for active stage */}
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
                                    className={`relative w-7 h-7 sm:w-9 sm:h-9 rounded-full border-2 flex items-center justify-center text-xs sm:text-sm font-bold transition-all duration-300 ${
                                        isActive ? 'shadow-lg shadow-blue-500/20 scale-110' :
                                        isDone ? 'shadow-md shadow-emerald-500/10' :
                                        isPending ? 'opacity-40' : ''
                                    }`}
                                    style={{
                                        borderColor: color,
                                        color: isDone ? '#fff' : color,
                                        backgroundColor: isDone ? color : isActive ? color + '20' : 'transparent',
                                    }}
                                >
                                    {stage.icon || statusIcon[stage.status]}
                                </div>
                            </div>

                            {/* Label: hidden on mobile, shown on sm+ */}
                            <span
                                className={`hidden sm:block text-[10px] text-center leading-tight max-w-[80px] truncate font-medium transition-colors duration-300 ${
                                    isActive ? 'text-white' : isDone ? 'text-slate-300' : isPending ? 'text-slate-600' : 'text-slate-400'
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
                            {isFailed && (
                                <span className="hidden sm:inline-flex text-[9px] px-2 py-0.5 rounded-full font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                                    failed
                                </span>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
});

PipelineStepper.displayName = 'PipelineStepper';
