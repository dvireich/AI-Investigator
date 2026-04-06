import React, { useState, useRef, useCallback } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Settings, X, RotateCcw, AlertTriangle, FileText, Code, Cpu, Expand, HelpCircle, Eye } from 'lucide-react';
import type { AgentDefinition, PipelineStage, PipelineDefinition } from '../types/pipeline';

// ── Palette colors for new custom agents ─────────────────────────────

const CUSTOM_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
    '#14b8a6', '#eab308', '#ef4444', '#6366f1',
];

function pickColor(index: number): string {
    return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}

// ── Props ────────────────────────────────────────────────────────────

interface PipelineBuilderProps {
    /** Current pipeline definition (may be null if none configured) */
    value: PipelineDefinition | null;
    /** Called whenever the pipeline changes */
    onChange: (pipeline: PipelineDefinition | null) => void;
    /** Available builtin agent definitions */
    builtinAgents: AgentDefinition[];
    /** Available LLM models for the model override dropdown */
    availableModels?: string[];
}

// ── Component ────────────────────────────────────────────────────────

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({ value, onChange, builtinAgents, availableModels = [] }) => {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [editingStageIndex, setEditingStageIndex] = useState<number | null>(null);
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [editingAgentForStage, setEditingAgentForStage] = useState<number | null>(null);
    const [showJsonView, setShowJsonView] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [builtinDetailAgent, setBuiltinDetailAgent] = useState<AgentDefinition | null>(null);
    const helpRef = useRef<HTMLDivElement>(null);

    const stages = value?.stages || [];

    // ── Helpers ──────────────────────────────────────────────────────

    const updatePipeline = useCallback((newStages: PipelineStage[]) => {
        if (newStages.length === 0) {
            onChange(null);
            return;
        }
        onChange({
            id: value?.id || 'pipeline-' + Date.now(),
            name: value?.name || 'Custom Pipeline',
            stages: newStages,
            agents: value?.agents,
        });
    }, [value, onChange]);

    const addStage = useCallback((agent: AgentDefinition) => {
        const newStage: PipelineStage = {
            agent: { ...agent },
            inputMode: 'conversation',
        };
        updatePipeline([...stages, newStage]);
    }, [stages, updatePipeline]);

    const removeStage = useCallback((index: number) => {
        const newStages = stages.filter((_, i) => i !== index);
        updatePipeline(newStages);
        if (editingStageIndex === index) setEditingStageIndex(null);
    }, [stages, updatePipeline, editingStageIndex]);

    const updateStage = useCallback((index: number, patch: Partial<PipelineStage>) => {
        const newStages = stages.map((s, i) => i === index ? { ...s, ...patch } : s);
        updatePipeline(newStages);
    }, [stages, updatePipeline]);

    const updateStageAgent = useCallback((index: number, agent: AgentDefinition) => {
        const newStages = stages.map((s, i) => i === index ? { ...s, agent } : s);
        updatePipeline(newStages);
    }, [stages, updatePipeline]);

    // ── Drag & Drop ─────────────────────────────────────────────────

    const handleDragStart = (index: number) => {
        setDragIndex(index);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        setDragOverIndex(index);
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        const newStages = [...stages];
        const [moved] = newStages.splice(dragIndex, 1);
        newStages.splice(dropIndex, 0, moved);
        updatePipeline(newStages);
        setDragIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDragIndex(null);
        setDragOverIndex(null);
    };

    // ── Agent label helper ──────────────────────────────────────────

    const getAgentLabel = (stage: PipelineStage): string => {
        return stage.agent?.name || stage.agentId || 'Unknown';
    };

    const getAgentColor = (stage: PipelineStage, index: number): string => {
        return stage.agent?.color || pickColor(index);
    };

    const getAgentIcon = (stage: PipelineStage): string => {
        return stage.agent?.icon || stage.agent?.name?.charAt(0)?.toUpperCase() || '?';
    };

    // ── Render ──────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* ── Help Modal ────────────────────────────────────────── */}
            {showHelp && (
                <div
                    ref={helpRef}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                    onClick={e => { if (e.target === helpRef.current) setShowHelp(false); }}
                >
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <HelpCircle size={18} className="text-cyan-400" />
                                <h3 className="text-base font-semibold text-white">Multi-Agent Pipeline Guide</h3>
                            </div>
                            <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
                        </div>
                        <div className="px-6 py-5 overflow-y-auto space-y-5 text-sm text-slate-300 leading-relaxed">
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">What is a Pipeline?</h4>
                                <p>A pipeline lets you chain multiple AI agents together in sequence. Each agent performs a specialized task, then passes its output to the next agent. This enables complex workflows like: investigate → validate → summarize.</p>
                            </section>
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">How to Build One</h4>
                                <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
                                    <li><span className="text-slate-300">Click an agent chip</span> from the palette above (or create a custom agent) to add stages.</li>
                                    <li><span className="text-slate-300">Reorder stages</span> by dragging the grip handle on each card.</li>
                                    <li><span className="text-slate-300">Configure each stage</span> by expanding its card — set input mode, rejection rules, timeouts, etc.</li>
                                    <li><span className="text-slate-300">Save</span> your settings. The pipeline will be used for all new investigations.</li>
                                </ol>
                            </section>
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">Agent Types</h4>
                                <ul className="space-y-1.5 text-slate-400">
                                    <li><span className="text-cyan-400 font-medium">⚡ Built-in</span> — Pre-configured agents (Investigator, Retrospector, etc.) with proven prompts and tool access.</li>
                                    <li><span className="text-cyan-400 font-medium">📄 File</span> — Uses a custom prompt from a markdown file on disk. Great for version-controlled prompts.</li>
                                    <li><span className="text-cyan-400 font-medium">✏️ Inline</span> — Write the system prompt directly in the builder. Quick for one-off agents.</li>
                                </ul>
                            </section>
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">Stage Settings</h4>
                                <ul className="space-y-1.5 text-slate-400">
                                    <li><span className="text-slate-300 font-medium">Input Mode</span> — <code className="text-xs bg-slate-800 px-1 rounded">conversation</code> passes the full chat history; <code className="text-xs bg-slate-800 px-1 rounded">report-only</code> passes only the previous agent's final report.</li>
                                    <li><span className="text-slate-300 font-medium">Can Reject</span> — If enabled, this agent can reject the previous agent's work with feedback, sending it back to retry.</li>
                                    <li><span className="text-slate-300 font-medium">On Reject → Target</span> — Choose which earlier stage to send rejections to (defaults to the previous stage).</li>
                                    <li><span className="text-slate-300 font-medium">Max Retries</span> — How many times a rejection loop can repeat before forcing continuation.</li>
                                    <li><span className="text-slate-300 font-medium">Timeout</span> — Maximum seconds a single stage can run before being stopped.</li>
                                </ul>
                            </section>
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">Template Variables</h4>
                                <p className="text-slate-400 mb-2">When writing custom prompts (file or inline), you can use these placeholders that get filled in automatically:</p>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{GOAL}}'}</code>
                                    <span className="text-slate-500">The investigation goal / query</span>
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{TARGET}}'}</code>
                                    <span className="text-slate-500">The target being investigated</span>
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{REPORT}}'}</code>
                                    <span className="text-slate-500">Previous agent's final report</span>
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{CONVERSATION}}'}</code>
                                    <span className="text-slate-500">Full conversation history</span>
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{AGENT_NAME}}'}</code>
                                    <span className="text-slate-500">Current agent's name</span>
                                    <code className="bg-slate-800 px-2 py-1 rounded text-cyan-300">{'{{AGENT_NAMES}}'}</code>
                                    <span className="text-slate-500">List of all agents in the pipeline</span>
                                </div>
                            </section>
                            <section>
                                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wide mb-2">Tips</h4>
                                <ul className="list-disc list-inside space-y-1.5 text-slate-400">
                                    <li>A single-stage pipeline behaves like a normal investigation — no overhead.</li>
                                    <li>The first stage always receives the user's original query as input.</li>
                                    <li>Use the JSON view toggle (<Code size={11} className="inline text-slate-500" />) to inspect or paste raw pipeline config.</li>
                                    <li>Rejection loops are powerful for quality control — e.g., a Validator agent can reject and ask the Investigator to dig deeper.</li>
                                </ul>
                            </section>
                        </div>
                        <div className="flex justify-end px-6 py-4 border-t border-slate-700">
                            <button
                                onClick={() => setShowHelp(false)}
                                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Agent Palette ─────────────────────────────────────── */}
            <div className="bg-slate-800/40 p-5 rounded-2xl border border-slate-700/40 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-bold text-slate-300">Agent Palette</label>
                        <button
                            onClick={() => setShowHelp(true)}
                            className="p-1 text-slate-500 hover:text-cyan-400 transition-colors rounded-md hover:bg-slate-700/50"
                            title="How to use the pipeline builder"
                        >
                            <HelpCircle size={15} />
                        </button>
                    </div>
                    <span className="text-[10px] text-slate-500">Drag or click to add</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {builtinAgents.map(agent => (
                        <AgentChip
                            key={agent.id}
                            agent={agent}
                            onClick={() => addStage(agent)}
                        />
                    ))}
                    <button
                        onClick={() => {
                            setEditingAgentForStage(null);
                            setShowAgentModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-dashed border-slate-600 text-xs font-medium transition-colors"
                    >
                        <Plus size={12} /> Custom Agent
                    </button>
                </div>
            </div>

            {/* ── Pipeline Name ─────────────────────────────────────── */}
            {stages.length > 0 && (
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={value?.name || ''}
                        onChange={e => onChange({ ...value!, name: e.target.value })}
                        placeholder="Pipeline name..."
                        className="flex-1 bg-slate-800/60 text-sm text-white border border-slate-700/50 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 outline-none"
                    />
                    <button
                        onClick={() => setShowJsonView(!showJsonView)}
                        className="px-2 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/50 rounded-lg transition-colors"
                        title="Toggle JSON view"
                    >
                        <Code size={14} />
                    </button>
                    {builtinAgents.length >= 4 && (
                        <button
                            onClick={() => {
                                try { onChange(buildDefaultPipeline(builtinAgents)); } catch { /* ignore */ }
                            }}
                            className="px-2.5 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-slate-800/60 border border-slate-700/50 rounded-lg transition-colors"
                            title="Reset to recommended default pipeline"
                        >
                            <RotateCcw size={13} />
                        </button>
                    )}
                </div>
            )}

            {/* ── Pipeline Lane (drag-and-drop) ────────────────────── */}
            {stages.length === 0 ? (
                <EmptyState
                    onAddFirst={() => {
                        if (builtinAgents.length > 0) addStage(builtinAgents[0]);
                        else { setEditingAgentForStage(null); setShowAgentModal(true); }
                    }}
                    onLoadDefault={builtinAgents.length >= 4 ? () => {
                        try {
                            onChange(buildDefaultPipeline(builtinAgents));
                        } catch { /* ignore if builtins not yet loaded */ }
                    } : undefined}
                />
            ) : (
                <div className="space-y-1">
                    {stages.map((stage, index) => (
                        <React.Fragment key={index}>
                            {/* Drop zone indicator */}
                            {dragOverIndex === index && dragIndex !== index && (
                                <div className="h-1 bg-cyan-500/50 rounded-full mx-8 transition-all" />
                            )}

                            <StageCard
                                stage={stage}
                                index={index}
                                total={stages.length}
                                color={getAgentColor(stage, index)}
                                icon={getAgentIcon(stage)}
                                label={getAgentLabel(stage)}
                                isDragging={dragIndex === index}
                                isExpanded={editingStageIndex === index}
                                onToggleExpand={() => setEditingStageIndex(editingStageIndex === index ? null : index)}
                                onRemove={() => removeStage(index)}
                                onUpdate={(patch) => updateStage(index, patch)}
                                onEditAgent={() => {
                                    const agent = stage.agent;
                                    if (agent?.source === 'builtin') {
                                        const full = builtinAgents.find(a => a.builtinType === agent.builtinType) || agent;
                                        setBuiltinDetailAgent(full);
                                    } else {
                                        setEditingAgentForStage(index); setShowAgentModal(true);
                                    }
                                }}
                                onDragStart={() => handleDragStart(index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                            />

                            {/* Arrow between stages */}
                            {index < stages.length - 1 && (
                                <div className="flex justify-center py-0.5">
                                    <div className="flex flex-col items-center">
                                        <div className="w-px h-3 bg-slate-600" />
                                        <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-slate-600" />
                                    </div>
                                    {/* Rejection loop arrow */}
                                    {stage.canReject && stage.onReject === 'loop' && (
                                        <div className="ml-2 flex items-center gap-1 text-[10px] text-amber-500/60">
                                            <RotateCcw size={10} />
                                            <span>reject → {stage.rejectTarget === 'previous' ? 'prev' : `#${stage.rejectTarget}`}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </React.Fragment>
                    ))}

                    {/* Add stage button at the end */}
                    <div className="flex justify-center pt-2">
                        <div className="flex flex-col items-center">
                            <div className="w-px h-3 bg-slate-700" />
                            <button
                                onClick={() => {
                                    setEditingAgentForStage(null);
                                    setShowAgentModal(true);
                                }}
                                className="w-8 h-8 rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center text-slate-500 hover:text-white hover:border-cyan-500 transition-colors"
                                title="Add stage"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── JSON View (toggle) ───────────────────────────────── */}
            {showJsonView && value && (
                <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-4">
                    <label className="text-xs font-bold text-slate-400 block mb-2">Pipeline JSON (read-only)</label>
                    <pre className="text-xs text-slate-300 overflow-x-auto font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {JSON.stringify(value, null, 2)}
                    </pre>
                </div>
            )}

            {/* ── Agent Creation/Edit Modal ─────────────────────────── */}
            {showAgentModal && (
                <AgentModal
                    builtinAgents={builtinAgents}
                    availableModels={availableModels}
                    existingAgent={editingAgentForStage !== null ? stages[editingAgentForStage]?.agent : undefined}
                    defaultColor={pickColor(editingAgentForStage ?? stages.length)}
                    onSave={(agent) => {
                        if (editingAgentForStage !== null) {
                            updateStageAgent(editingAgentForStage, agent);
                        } else {
                            addStage(agent);
                        }
                        setShowAgentModal(false);
                        setEditingAgentForStage(null);
                    }}
                    onClose={() => { setShowAgentModal(false); setEditingAgentForStage(null); }}
                />
            )}

            {/* ── Builtin Agent Detail (read-only) ───────────── */}
            {builtinDetailAgent && (
                <BuiltinDetailModal agent={builtinDetailAgent} onClose={() => setBuiltinDetailAgent(null)} />
            )}
        </div>
    );
};

// ── Sub-components ──────────────────────────────────────────────────

/** Small chip in the palette representing a draggable agent */
const AgentChip: React.FC<{
    agent: AgentDefinition;
    onClick: () => void;
}> = React.memo(({ agent, onClick }) => (
    <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 hover:bg-slate-800 rounded-lg border border-slate-700/40 hover:border-slate-600 text-xs transition-colors group"
        title={`Add ${agent.name} to pipeline`}
    >
        <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
            style={{ backgroundColor: agent.color || '#6b7280' }}
        >
            {agent.icon || agent.name.charAt(0).toUpperCase()}
        </span>
        <span className="text-slate-300 group-hover:text-white font-medium">{agent.name}</span>
        <Plus size={10} className="text-slate-600 group-hover:text-cyan-400" />
    </button>
));
AgentChip.displayName = 'AgentChip';

/** Build the default recommended pipeline */
function buildDefaultPipeline(builtinAgents: AgentDefinition[]): PipelineDefinition {
    const find = (type: string) => builtinAgents.find(a => a.builtinType === type);
    const investigator = find('investigator');
    const validator = find('validator');
    const proposer = find('implementation');
    const retrospect = find('retrospect');

    if (!investigator || !validator || !proposer || !retrospect) {
        throw new Error('Missing required builtin agents for default pipeline');
    }

    return {
        id: 'default-pipeline',
        name: 'Default Pipeline',
        stages: [
            { agent: { ...investigator }, inputMode: 'conversation' },
            { agent: { ...validator }, inputMode: 'conversation', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { agent: { ...proposer }, inputMode: 'conversation' },
            { agent: { ...retrospect }, inputMode: 'conversation' },
        ],
    };
}

/** Empty state when no stages exist */
const EmptyState: React.FC<{ onAddFirst: () => void; onLoadDefault?: () => void }> = ({ onAddFirst, onLoadDefault }) => (
    <div className="border-2 border-dashed border-slate-700 rounded-2xl p-10 text-center">
        <div className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Cpu className="text-slate-500" size={24} />
        </div>
        <h3 className="text-sm font-bold text-slate-300 mb-1">No pipeline configured</h3>
        <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
            Click an agent from the palette above, or add a custom agent to start building your multi-agent pipeline.
        </p>
        <button
            onClick={onAddFirst}
            className="px-4 py-2 bg-cyan-600/20 text-cyan-400 rounded-lg border border-cyan-500/30 text-xs font-medium hover:bg-cyan-600/30 transition-colors"
        >
            <Plus size={12} className="inline mr-1" /> Add first stage
        </button>
        {onLoadDefault && (
            <button
                onClick={onLoadDefault}
                className="ml-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg border border-emerald-500/30 text-xs font-medium hover:bg-emerald-600/30 transition-colors"
            >
                ⚡ Load recommended pipeline
            </button>
        )}
    </div>
);

/** A single stage card in the pipeline lane */
const StageCard: React.FC<{
    stage: PipelineStage;
    index: number;
    total: number;
    color: string;
    icon: string;
    label: string;
    isDragging: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onRemove: () => void;
    onUpdate: (patch: Partial<PipelineStage>) => void;
    onEditAgent: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}> = React.memo(({
    stage, index, total, color, icon, label, isDragging, isExpanded,
    onToggleExpand, onRemove, onUpdate, onEditAgent,
    onDragStart, onDragOver, onDrop, onDragEnd,
}) => {
    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            className={`rounded-xl border transition-all ${
                isDragging ? 'opacity-40 scale-95' : ''
            } ${isExpanded ? 'bg-slate-800/60 border-slate-600' : 'bg-slate-800/30 border-slate-700/40 hover:border-slate-600/60'}`}
        >
            {/* Header row */}
            <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={onToggleExpand}>
                {/* Drag handle */}
                <div className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 flex-shrink-0" title="Drag to reorder">
                    <GripVertical size={14} />
                </div>

                {/* Stage number */}
                <span className="text-[10px] text-slate-500 font-mono w-4 text-center flex-shrink-0">
                    {index + 1}
                </span>

                {/* Agent avatar */}
                <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: color }}
                >
                    {icon}
                </span>

                {/* Agent name & source */}
                <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-white truncate block">{label}</span>
                    <span className="text-[10px] text-slate-500">
                        {stage.agent?.source || 'inline'}
                        {stage.agent?.builtinType && ` · ${stage.agent.builtinType}`}
                        {stage.canReject && (
                            <span className="ml-1.5 text-amber-400">⚡ can reject</span>
                        )}
                    </span>
                </div>

                {/* Actions */}
                <button onClick={(e) => { e.stopPropagation(); onEditAgent(); }} className="p-1 text-slate-500 hover:text-cyan-400 transition-colors" title={stage.agent?.source === 'builtin' ? 'View agent details' : 'Edit agent'}>
                    {stage.agent?.source === 'builtin' ? <Eye size={13} /> : <Settings size={13} />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 text-slate-500 hover:text-red-400 transition-colors" title="Remove stage">
                    <Trash2 size={13} />
                </button>
                <div className="text-slate-600">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
            </div>

            {/* Expanded: stage configuration */}
            {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                    {/* Input Mode */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-slate-400 w-24 flex-shrink-0">Input Mode</label>
                        <select
                            value={stage.inputMode || 'conversation'}
                            onChange={e => onUpdate({ inputMode: e.target.value as PipelineStage['inputMode'] })}
                            className="flex-1 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30"
                        >
                            <option value="conversation">Full conversation</option>
                            <option value="report-only">Reports only</option>
                        </select>
                    </div>

                    {/* Can Reject */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-slate-400 w-24 flex-shrink-0">Can Reject</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={stage.canReject || false}
                                onChange={e => onUpdate({ canReject: e.target.checked })}
                                className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-slate-700 rounded-full peer peer-checked:bg-amber-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
                        </label>
                    </div>

                    {/* Rejection settings (only if canReject) */}
                    {stage.canReject && (
                        <>
                            <div className="flex items-center gap-3">
                                <label className="text-xs text-slate-400 w-24 flex-shrink-0">On Reject</label>
                                <select
                                    value={stage.onReject || 'flag'}
                                    onChange={e => onUpdate({ onReject: e.target.value as PipelineStage['onReject'] })}
                                    className="flex-1 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30"
                                >
                                    <option value="loop">Loop back (retry)</option>
                                    <option value="flag">Flag and continue</option>
                                    <option value="abort">Abort pipeline</option>
                                </select>
                            </div>

                            {stage.onReject === 'loop' && (
                                <>
                                    <div className="flex items-center gap-3">
                                        <label className="text-xs text-slate-400 w-24 flex-shrink-0">Reject Target</label>
                                        <select
                                            value={stage.rejectTarget === undefined ? 'previous' : String(stage.rejectTarget)}
                                            onChange={e => {
                                                const val = e.target.value;
                                                onUpdate({ rejectTarget: val === 'previous' ? 'previous' : Number(val) });
                                            }}
                                            className="flex-1 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30"
                                        >
                                            <option value="previous">Previous stage</option>
                                            {Array.from({ length: index }, (_, i) => (
                                                <option key={i} value={i}>Stage {i + 1}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-xs text-slate-400 w-24 flex-shrink-0">Max Retries</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={5}
                                            value={stage.maxRetries ?? 2}
                                            onChange={e => onUpdate({ maxRetries: Math.min(5, Math.max(1, Number(e.target.value))) })}
                                            className="w-20 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30"
                                        />
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* Timeout */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-slate-400 w-24 flex-shrink-0">Timeout (min)</label>
                        <input
                            type="number"
                            min={0}
                            value={stage.timeout ?? 0}
                            onChange={e => onUpdate({ timeout: Number(e.target.value) || undefined })}
                            placeholder="0 = no limit"
                            className="w-20 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30"
                        />
                        <span className="text-[10px] text-slate-600">0 = no limit</span>
                    </div>
                </div>
            )}
        </div>
    );
});
StageCard.displayName = 'StageCard';

// ── Builtin Agent Detail Modal (read-only) ──────────────────────────

const BuiltinDetailModal: React.FC<{ agent: AgentDefinition; onClose: () => void }> = ({ agent, onClose }) => {
    const backdropRef = useRef<HTMLDivElement>(null);

    return (
        <div
            ref={backdropRef}
            onClick={e => { if (e.target === backdropRef.current) onClose(); }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                    <div className="flex items-center gap-3">
                        <span
                            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                            style={{ backgroundColor: agent.color || '#6b7280' }}
                        >
                            {agent.icon || agent.name.charAt(0)}
                        </span>
                        <div>
                            <h3 className="text-lg font-bold text-white">{agent.name}</h3>
                            <span className="text-[10px] text-cyan-400 font-medium uppercase tracking-wider">Built-in Agent</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Description */}
                    {agent.description && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Description</label>
                            <p className="text-sm text-slate-300 leading-relaxed">{agent.description}</p>
                        </div>
                    )}

                    {/* Type */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Type</label>
                            <span className="text-sm text-slate-200 bg-slate-800 px-2.5 py-1 rounded-md inline-block">{agent.builtinType || 'builtin'}</span>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Source</label>
                            <span className="text-sm text-slate-200 bg-slate-800 px-2.5 py-1 rounded-md inline-block">⚡ Built-in</span>
                        </div>
                    </div>

                    {/* Prompt File */}
                    {agent.promptPath && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Prompt File</label>
                            <code className="text-xs text-cyan-300 bg-slate-800 px-2.5 py-1.5 rounded-md block font-mono">{agent.promptPath}</code>
                        </div>
                    )}

                    {/* Tools */}
                    {agent.tools && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">
                                Tools <span className="text-slate-600">({agent.tools.mode})</span>
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {agent.tools.list?.map(tool => (
                                    <span key={tool} className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-mono border border-slate-700/50">
                                        {tool}
                                    </span>
                                ))}
                                {(!agent.tools.list || agent.tools.list.length === 0) && (
                                    <span className="text-xs text-slate-500 italic">All tools available</span>
                                )}
                            </div>
                        </div>
                    )}

                    {!agent.tools && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Tools</label>
                            <span className="text-xs text-slate-500 italic">All tools available (no restrictions)</span>
                        </div>
                    )}

                    {/* Model & Max Steps */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Model Override</label>
                            <span className="text-sm text-slate-400 italic">{agent.model || 'Uses global default'}</span>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Max Steps</label>
                            <span className="text-sm text-slate-400 italic">{agent.maxSteps || 'Uses global default'}</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/50 bg-slate-900/60">
                    <span className="text-[10px] text-slate-600 flex items-center gap-1">
                        <Eye size={10} /> Read-only — built-in agents cannot be modified
                    </span>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Agent Creation/Edit Modal ───────────────────────────────────────

interface AgentModalProps {
    builtinAgents: AgentDefinition[];
    availableModels: string[];
    existingAgent?: AgentDefinition;
    defaultColor: string;
    onSave: (agent: AgentDefinition) => void;
    onClose: () => void;
}

const AgentModal: React.FC<AgentModalProps> = ({ builtinAgents, availableModels, existingAgent, defaultColor, onSave, onClose }) => {
    const isEditing = !!existingAgent;
    const [source, setSource] = useState<AgentDefinition['source']>(existingAgent?.source || 'file');
    const [name, setName] = useState(existingAgent?.name || '');
    const [builtinType, setBuiltinType] = useState(existingAgent?.builtinType || (builtinAgents[0]?.builtinType || builtinAgents[0]?.id || ''));
    const [promptPath, setPromptPath] = useState(existingAgent?.promptPath || '');
    const [promptContent, setPromptContent] = useState(existingAgent?.promptContent || '');
    const [description, setDescription] = useState(existingAgent?.description || '');
    const [model, setModel] = useState(existingAgent?.model || '');
    const [maxSteps, setMaxSteps] = useState(existingAgent?.maxSteps ?? 0);
    const [color, setColor] = useState(existingAgent?.color || defaultColor);
    const [showDescPopup, setShowDescPopup] = useState(false);
    const backdropRef = useRef<HTMLDivElement>(null);
    const descPopupRef = useRef<HTMLDivElement>(null);

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === backdropRef.current) onClose();
    };

    const handleSave = () => {
        const agentName = source === 'builtin'
            ? builtinAgents.find(a => (a.builtinType || a.id) === builtinType)?.name || builtinType
            : name || 'Unnamed Agent';

        const agent: AgentDefinition = {
            id: existingAgent?.id || agentName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36),
            name: agentName,
            source,
            color,
        };

        if (source === 'builtin') {
            agent.builtinType = builtinType;
            const builtin = builtinAgents.find(a => (a.builtinType || a.id) === builtinType);
            if (builtin) {
                agent.color = builtin.color || color;
                agent.icon = builtin.icon;
            }
        } else if (source === 'file') {
            agent.promptPath = promptPath;
        } else if (source === 'inline') {
            agent.promptContent = promptContent;
        }

        if (description) agent.description = description;
        if (model) agent.model = model;
        if (maxSteps > 0) agent.maxSteps = maxSteps;

        onSave(agent);
    };

    return (
        <div
            ref={backdropRef}
            onClick={handleBackdropClick}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                    <h3 className="text-lg font-bold text-white">
                        {isEditing ? 'Edit Agent' : 'Add Agent'}
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* Source selector */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 block mb-1.5">Agent Source</label>
                        <div className="flex gap-2">
                            {(['builtin', 'file', 'inline'] as const).map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSource(s)}
                                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                                        source === s
                                            ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500/40'
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                                    }`}
                                >
                                    {s === 'builtin' ? '⚡ Built-in' : s === 'file' ? '📄 File' : '✏️ Inline'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Builtin selector */}
                    {source === 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Built-in Type</label>
                            <select
                                value={builtinType}
                                onChange={e => setBuiltinType(e.target.value)}
                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30"
                            >
                                {builtinAgents.map(a => (
                                    <option key={a.id} value={a.builtinType || a.id}>{a.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Name (for file/inline) */}
                    {source !== 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Agent Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g., Validator, Security Reviewer"
                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30"
                            />
                        </div>
                    )}

                    {/* File path */}
                    {source === 'file' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Prompt File Path</label>
                            <input
                                type="text"
                                value={promptPath}
                                onChange={e => setPromptPath(e.target.value)}
                                placeholder="prompts/examples/ValidatorPrompt.md"
                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-cyan-500/30"
                            />
                            <p className="text-[10px] text-slate-500 mt-1">Relative to repo root, or absolute path.</p>
                        </div>
                    )}

                    {/* Inline prompt */}
                    {source === 'inline' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">System Prompt</label>
                            <textarea
                                value={promptContent}
                                onChange={e => setPromptContent(e.target.value)}
                                rows={6}
                                placeholder={"You are {{AGENT_NAME}}, a specialist...\n\nUse {{REPORT}} and {{CONVERSATION}} to reference prior agents' work."}
                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 font-mono resize-y outline-none focus:ring-2 focus:ring-cyan-500/30"
                                spellCheck={false}
                            />
                            <p className="text-[10px] text-slate-500 mt-1">
                                Template variables: {'{{GOAL}}, {{TARGET}}, {{REPORT}}, {{CONVERSATION}}, {{AGENT_NAME}}, {{AGENT_NAMES}}'}
                            </p>
                        </div>
                    )}

                    {/* Description */}
                    {source !== 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Description <span className="text-slate-600">(optional)</span></label>
                            <div className="flex items-center gap-2">
                                <div
                                    className="flex-1 bg-slate-800 text-sm border border-slate-700 rounded-lg px-3 py-2 truncate cursor-pointer hover:border-slate-600 transition-colors min-h-[36px]"
                                    onClick={() => setShowDescPopup(true)}
                                >
                                    {description ? (
                                        <span className="text-slate-200">{description}</span>
                                    ) : (
                                        <span className="text-slate-500">Brief description of what this agent does</span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowDescPopup(true)}
                                    className="p-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-cyan-400 hover:border-slate-600 transition-colors flex-shrink-0"
                                    title="Edit description"
                                >
                                    <Expand size={14} />
                                </button>
                            </div>

                            {/* Description popup */}
                            {showDescPopup && (
                                <div
                                    ref={descPopupRef}
                                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
                                    onClick={e => { if (e.target === descPopupRef.current) setShowDescPopup(false); }}
                                >
                                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[70vh]">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                                            <h4 className="text-sm font-semibold text-slate-200">Description</h4>
                                            <button onClick={() => setShowDescPopup(false)} className="text-slate-400 hover:text-slate-200"><X size={16} /></button>
                                        </div>
                                        <div className="p-4 flex-1 overflow-y-auto">
                                            <textarea
                                                autoFocus
                                                value={description}
                                                onChange={e => setDescription(e.target.value)}
                                                rows={8}
                                                placeholder="Brief description of what this agent does"
                                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30 resize-y min-h-[120px]"
                                            />
                                        </div>
                                        <div className="flex justify-end px-4 py-3 border-t border-slate-700">
                                            <button
                                                onClick={() => setShowDescPopup(false)}
                                                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition-colors"
                                            >
                                                Done
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Model override */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 block mb-1.5">Model Override <span className="text-slate-600">(optional)</span></label>
                        <select
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30"
                        >
                            <option value="">Use global model</option>
                            {availableModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>

                    {/* Max Steps */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 block mb-1.5">Max Steps <span className="text-slate-600">(optional)</span></label>
                        <input
                            type="number"
                            min={0}
                            value={maxSteps || ''}
                            onChange={e => setMaxSteps(Number(e.target.value) || 0)}
                            placeholder="Default"
                            className="w-28 bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Leave empty to use the global max steps setting.</p>
                    </div>

                    {/* Color picker */}
                    {source !== 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Color</label>
                            <div className="flex gap-2">
                                {CUSTOM_COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => setColor(c)}
                                        className={`w-7 h-7 rounded-full border-2 transition-all ${
                                            color === c ? 'border-white scale-110' : 'border-transparent hover:border-slate-500'
                                        }`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                                <input
                                    type="color"
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="w-7 h-7 rounded-full border border-slate-600 cursor-pointer"
                                    title="Custom color"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/50 bg-slate-900/60">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={source === 'file' && !promptPath && !isEditing}
                        className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isEditing ? 'Update' : 'Add to Pipeline'}
                    </button>
                </div>
            </div>
        </div>
    );
};
