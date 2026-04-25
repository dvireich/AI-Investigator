import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings, X, RotateCcw, AlertTriangle, FileText, Code, Cpu, Expand, HelpCircle, Eye, Search, Save, Library } from 'lucide-react';
import type { AgentDefinition, PipelineStage, PipelineDefinition, PipelinePreset, AgentKind } from '../types/pipeline';
import { AGENT_KINDS } from '../types/pipeline';
import type { SavedAgent } from '../api';
import { api } from '../api';

// ── Palette colors for new custom agents ─────────────────────────────

const CUSTOM_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
    '#14b8a6', '#eab308', '#ef4444', '#6366f1',
];

function pickColor(index: number): string {
    return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}

const AGENT_ICONS = [
    '🤖', '🛡️', '🔍', '📊', '🔬', '🧠', '📡', '🩹',
    '⏱️', '📋', '😈', '🔎', '📜', '✅', '🔗', '🚨',
    '💡', '⚡', '🎯', '🧪', '🔥', '✨', '🏗️', '🕵️',
];

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
    /** When true, the pipeline is shown read-only — no drag/delete/expand/add controls */
    readOnly?: boolean;
    /** Display label for the pipeline section (e.g. workflow name). Falls back to pipeline.name */
    label?: string;
}

// ── Component ────────────────────────────────────────────────────────

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({ value, onChange, builtinAgents, availableModels = [], readOnly = false, label }) => {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [editingStageIndex, setEditingStageIndex] = useState<number | null>(null);
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [editingAgentForStage, setEditingAgentForStage] = useState<number | null>(null);
    const [showJsonView, setShowJsonView] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [builtinDetailAgent, setBuiltinDetailAgent] = useState<AgentDefinition | null>(null);
    const [paletteSearch, setPaletteSearch] = useState('');
    const [palettePage, setPalettePage] = useState(0);
    const helpRef = useRef<HTMLDivElement>(null);
    const [savedAgents, setSavedAgents] = useState<SavedAgent[]>([]);
    const [editingSavedAgentId, setEditingSavedAgentId] = useState<string | null>(null);

    const stages = value?.stages || [];

    // ── Load saved agents from API ──────────────────────────────────

    const refreshSavedAgents = useCallback(async () => {
        try {
            const agents = await api.getSavedAgents();
            setSavedAgents(agents);
        } catch { /* ignore – palette will just show built-ins */ }
    }, []);

    useEffect(() => { refreshSavedAgents(); }, [refreshSavedAgents]);

    const handleDeleteSavedAgent = useCallback(async (id: string) => {
        try {
            await api.deleteSavedAgent(id);
            setSavedAgents(prev => prev.filter(sa => sa.id !== id));
        } catch { /* ignore */ }
    }, []);

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

    const addStage = useCallback((agent: AgentDefinition, savedId?: string) => {
        // When the agent comes from the saved-agent library, store ONLY the reference.
        // The library (CustomAgentStore) is the single source of truth — no inline copy.
        // Otherwise (builtin agents, one-off custom agents), store the inline definition.
        const newStage: PipelineStage = savedId
            ? { savedAgentId: savedId, inputMode: 'conversation' }
            : { agent: { ...agent }, inputMode: 'conversation' };
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
        // Editing the inline agent definition converts a library-linked stage into
        // a standalone inline stage: the edit has diverged from the library, so the
        // `savedAgentId` reference is dropped and the inline copy takes over.
        const newStages = stages.map((s, i) => {
            if (i !== index) return s;
            const { savedAgentId: _dropped, ...rest } = s;
            return { ...rest, agent };
        });
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

    /**
     * Resolve the agent definition that should currently be shown/used for a stage.
     * If the stage has a `savedAgentId` and that saved agent exists, return it — this
     * makes library edits propagate to every workflow referencing the agent.
     * Otherwise fall back to the inline snapshot.
     */
    const resolveStageAgentDef = useCallback((stage: PipelineStage): AgentDefinition | undefined => {
        if (stage.savedAgentId) {
            const saved = savedAgents.find(sa => sa.id === stage.savedAgentId);
            if (saved) return saved.agent;
        }
        return stage.agent;
    }, [savedAgents]);

    /** True when the stage references a savedAgentId that cannot be resolved. */
    const isStageRefDangling = useCallback((stage: PipelineStage): boolean => {
        if (!stage.savedAgentId) return false;
        return !savedAgents.some(sa => sa.id === stage.savedAgentId);
    }, [savedAgents]);

    const getAgentLabel = (stage: PipelineStage): string => {
        const a = resolveStageAgentDef(stage);
        return a?.name || stage.agentId || 'Unknown';
    };

    const getAgentColor = (stage: PipelineStage, index: number): string => {
        const a = resolveStageAgentDef(stage);
        return a?.color || pickColor(index);
    };

    const getAgentIcon = (stage: PipelineStage): string => {
        const a = resolveStageAgentDef(stage);
        return a?.icon || a?.name?.charAt(0)?.toUpperCase() || '?';
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
                                    <li><span className="text-slate-300 font-medium">Max Retries</span> — How many times a rejection loop can repeat. When the limit is reached, the rejected output is accepted as a "flag" and the pipeline continues to the next stage (it does not fail). Range 1–5, or check <em>Unlimited</em> to keep looping until the agent stops rejecting.</li>
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
            {!readOnly && (() => {
                const PALETTE_PAGE_SIZE = 8;
                const allAgents: (AgentDefinition & { _savedId?: string })[] = [
                    ...builtinAgents,
                    ...savedAgents.map(sa => ({ ...sa.agent, _savedId: sa.id })),
                ];
                const filtered = allAgents.filter(a => a.name.toLowerCase().includes(paletteSearch.toLowerCase()));
                const totalPages = Math.ceil((filtered.length + 1) / PALETTE_PAGE_SIZE); // +1 for Custom Agent button
                const safePage = Math.min(palettePage, Math.max(0, totalPages - 1));
                const startIdx = safePage * PALETTE_PAGE_SIZE;
                const pageAgents = filtered.slice(startIdx, Math.min(startIdx + PALETTE_PAGE_SIZE, filtered.length));
                return (
                    <div className="bg-slate-800/40 p-5 rounded-2xl border border-slate-700/40 shadow-sm space-y-3 overflow-visible">
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
                            <span className="text-[10px] text-slate-500">Click to add</span>
                        </div>
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                value={paletteSearch}
                                onChange={e => { setPaletteSearch(e.target.value); setPalettePage(0); }}
                                placeholder="Search agents…"
                                className="w-full pl-8 pr-3 py-1.5 bg-slate-900/60 border border-slate-700/40 rounded-lg text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 transition-colors"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {pageAgents.map(agent => {
                                const savedId = (agent as any)._savedId as string | undefined;
                                return (
                                    <AgentChip
                                        key={agent.id}
                                        agent={agent}
                                        onClick={() => addStage(agent, savedId)}
                                        savedId={savedId}
                                        onDelete={savedId ? () => handleDeleteSavedAgent(savedId) : undefined}
                                        onEdit={savedId ? () => { setEditingSavedAgentId(savedId); setEditingAgentForStage(null); setShowAgentModal(true); } : undefined}
                                    />
                                );
                            })}
                            <button
                                onClick={() => {
                                    setEditingSavedAgentId(null);
                                    setEditingAgentForStage(null);
                                    setShowAgentModal(true);
                                }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-dashed border-slate-600 text-xs font-medium transition-colors"
                                >
                                    <Plus size={12} /> Custom Agent
                                </button>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-1">
                                <button
                                    onClick={() => setPalettePage(p => Math.max(0, p - 1))}
                                    disabled={safePage === 0}
                                    className="p-1 text-slate-400 hover:text-white disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="text-[10px] text-slate-500">{safePage + 1} / {totalPages}</span>
                                <button
                                    onClick={() => setPalettePage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={safePage >= totalPages - 1}
                                    className="p-1 text-slate-400 hover:text-white disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* ── Pipeline Name ─────────────────────────────────────── */}
            {stages.length > 0 && (
                <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm font-semibold text-slate-300">
                        {label || value?.name || 'Custom Pipeline'}
                    </span>
                    {!readOnly && <button
                        onClick={() => setShowJsonView(!showJsonView)}
                        className="px-2 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/50 rounded-lg transition-colors"
                        title="Toggle JSON view"
                    >
                        <Code size={14} />
                    </button>}
                    {!readOnly && <div className="relative group/presets">
                        <button
                            className="px-2.5 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-slate-800/60 border border-slate-700/50 rounded-lg transition-colors flex items-center gap-1"
                            title="Load a workflow template"
                        >
                            <RotateCcw size={13} />
                            <ChevronDown size={10} />
                        </button>
                        <div className="absolute right-0 top-full mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover/presets:opacity-100 group-hover/presets:visible transition-all duration-150 z-50 py-1">
                            {PIPELINE_PRESETS.filter(preset =>
                                preset.stages.every(s => builtinAgents.some(a => a.builtinType === s.builtinType))
                            ).map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => { try { onChange(buildPipelinePreset(preset.id, builtinAgents)); } catch { /* ignore */ } }}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors flex items-start gap-2"
                                >
                                    <span className="text-sm mt-0.5">{preset.icon}</span>
                                    <div className="min-w-0">
                                        <div className="text-xs font-medium text-slate-200">{preset.name}</div>
                                        <div className="text-[10px] text-slate-500 leading-snug">{preset.description}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>}
                </div>
            )}

            {/* ── Pipeline Lane (drag-and-drop) ────────────────────── */}
            {stages.length === 0 ? (
                <EmptyState
                    onAddFirst={() => {
                        if (builtinAgents.length > 0) addStage(builtinAgents[0]);
                        else { setEditingSavedAgentId(null); setEditingAgentForStage(null); setShowAgentModal(true); }
                    }}
                    onLoadPreset={(presetId) => {
                        try { onChange(buildPipelinePreset(presetId, builtinAgents)); } catch { /* ignore */ }
                    }}
                    builtinAgents={builtinAgents}
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
                                readOnly={readOnly}
                                resolvedAgent={resolveStageAgentDef(stage)}
                                hasSavedRef={!!stage.savedAgentId}
                                isDangling={isStageRefDangling(stage)}
                                onToggleExpand={() => setEditingStageIndex(editingStageIndex === index ? null : index)}
                                onRemove={() => removeStage(index)}
                                onUpdate={(patch) => updateStage(index, patch)}
                                onEditAgent={() => {
                                    const agent = resolveStageAgentDef(stage);
                                    if (agent) {
                                        if (agent.source === 'builtin') {
                                            const full = builtinAgents.find(a => a.builtinType === agent.builtinType) || agent;
                                            setBuiltinDetailAgent(full);
                                        } else {
                                            setBuiltinDetailAgent(agent);
                                        }
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
                                            <span>reject → {stage.rejectTarget === 'previous' ? 'prev' : `#${(stage.rejectTarget as number) + 1}`}</span>
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
                                    setEditingSavedAgentId(null);
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
            {showAgentModal && (() => {
                const editingSaved = editingSavedAgentId ? savedAgents.find(sa => sa.id === editingSavedAgentId) : undefined;
                const existingAgent = editingSaved ? editingSaved.agent
                    : editingAgentForStage !== null ? stages[editingAgentForStage]?.agent
                    : undefined;
                return (
                    <AgentModal
                        builtinAgents={builtinAgents}
                        availableModels={availableModels}
                        existingAgent={existingAgent}
                        defaultColor={pickColor(editingAgentForStage ?? stages.length)}
                        onSave={(agent) => {
                            if (editingSavedAgentId) {
                                api.updateSavedAgent(editingSavedAgentId, { agent }).then(() => refreshSavedAgents()).catch(() => {});
                            } else if (editingAgentForStage !== null) {
                                updateStageAgent(editingAgentForStage, agent);
                            } else {
                                addStage(agent);
                            }
                            setShowAgentModal(false);
                            setEditingAgentForStage(null);
                            setEditingSavedAgentId(null);
                        }}
                        onSaveToLibrary={!editingSavedAgentId && editingAgentForStage === null ? async (agent) => {
                            try {
                                await api.createSavedAgent(agent);
                                await refreshSavedAgents();
                                setShowAgentModal(false);
                                setEditingAgentForStage(null);
                            } catch { /* ignore */ }
                        } : undefined}
                        onClose={() => { setShowAgentModal(false); setEditingAgentForStage(null); setEditingSavedAgentId(null); }}
                    />
                );
            })()}

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
    savedId?: string;
    onDelete?: () => void;
    onEdit?: () => void;
}> = React.memo(({ agent, onClick, savedId, onDelete, onEdit }) => (
    <div className="relative group/chip">
        <button
            onClick={onClick}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 hover:bg-slate-800 rounded-lg border border-slate-700/40 hover:border-slate-600 text-xs transition-colors group"
        >
            <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: agent.color || '#6b7280' }}
            >
                {agent.icon || agent.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-slate-300 group-hover:text-white font-medium">{agent.name}</span>
            {savedId && (
                <Library size={9} className="text-slate-600" />
            )}
            <Plus size={10} className="text-slate-600 group-hover:text-cyan-400" />
        </button>
        {savedId && onEdit && (
            <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-slate-600 text-white flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-cyan-500"
                title="Edit saved agent"
            >
                <Settings size={8} />
            </button>
        )}
        {savedId && onDelete && (
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-red-500"
                title="Remove from library"
            >
                <X size={8} />
            </button>
        )}
        {agent.description && (
            <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg shadow-xl text-[11px] text-slate-300 leading-relaxed w-64 opacity-0 invisible group-hover/chip:opacity-100 group-hover/chip:visible transition-all duration-150 pointer-events-none z-[100]">
                <div className="absolute bottom-full left-4 -mb-px w-2 h-2 bg-slate-900 border-t border-l border-slate-600 rotate-45" />
                <div className="font-semibold text-white mb-0.5">{agent.name}</div>
                {savedId && <div className="text-[9px] text-cyan-400/60 mb-1">📚 Saved to library</div>}
                {agent.description}
            </div>
        )}
    </div>
));
AgentChip.displayName = 'AgentChip';

/** Build the default recommended pipeline */
function buildDefaultPipeline(builtinAgents: AgentDefinition[]): PipelineDefinition {
    return buildPipelinePreset('default', builtinAgents);
}

// ── Pipeline Presets ────────────────────────────────────────────────
// PipelinePreset type is imported from ../types/pipeline
// Re-export for backward compatibility
export type { PipelinePreset } from '../types/pipeline';

export const PIPELINE_PRESETS: PipelinePreset[] = [
    {
        id: 'default',
        name: 'Standard',
        description: 'Balanced pipeline: investigate, validate, propose changes, and improve knowledge base.',
        icon: '⚡',
        stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'deep-investigation',
        name: 'Deep Investigation',
        description: 'Thorough pipeline with planning, code scouting, adversarial review, grounding audit, and executive summary for complex issues.',
        icon: '🔬',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'code-scout' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'incident-response',
        name: 'Incident Response',
        description: 'Fast triage, enrichment, timeline reconstruction, and remediation for active incidents.',
        icon: '🚨',
        stages: [
            { builtinType: 'triage' },
            { builtinType: 'enrichment' },
            { builtinType: 'investigator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'summarizer' },
        ],
    },
    {
        id: 'quick-health-check',
        name: 'Quick Health Check',
        description: 'Lightweight pipeline for scheduled health checks and routine monitoring.',
        icon: '💚',
        stages: [
            { builtinType: 'triage' },
            { builtinType: 'investigator' },
            { builtinType: 'validator' },
        ],
    },
    {
        id: 'compliance-review',
        name: 'Compliance Review',
        description: 'Investigation followed by grounding audit, compliance auditing, and change proposals.',
        icon: '📜',
        stages: [
            { builtinType: 'investigator' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 'previous', maxRetries: 2 },
            { builtinType: 'compliance', canReject: true, onReject: 'flag' },
            { builtinType: 'implementation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'root-cause-analysis',
        name: 'Root Cause Analysis',
        description: 'Plan, scout the code, correlate with past incidents, reconstruct timeline, verify grounding, and generate remediation plan.',
        icon: '🔍',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'code-scout' },
            { builtinType: 'investigator' },
            { builtinType: 'correlator' },
            { builtinType: 'timeline' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'remediation' },
            { builtinType: 'retrospect' },
        ],
    },
    {
        id: 'grounded-investigation',
        name: 'Grounded Investigation',
        description: 'Rigorous pipeline that ensures all conclusions are grounded in observed telemetry and real code paths — rejects absence-based reasoning where missing data is treated as evidence.',
        icon: '📡',
        stages: [
            { builtinType: 'planner' },
            { builtinType: 'code-scout' },
            { builtinType: 'investigator' },
            { builtinType: 'devils-advocate', canReject: true, onReject: 'flag' },
            { builtinType: 'signal-grounding', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'validator', canReject: true, onReject: 'loop', rejectTarget: 2, maxRetries: 1 },
            { builtinType: 'summarizer' },
            { builtinType: 'retrospect' },
        ],
    },
];

/**
 * Build a PipelineDefinition from a preset, resolving builtinType references
 * against the available agents. Skips stages for agents not available.
 */
export function buildPipelinePreset(presetId: string, builtinAgents: AgentDefinition[]): PipelineDefinition {
    const preset = PIPELINE_PRESETS.find(p => p.id === presetId);
    if (!preset) throw new Error(`Unknown pipeline preset: ${presetId}`);

    const find = (type: string) => builtinAgents.find(a => a.builtinType === type);

    const pipelineStages: PipelineStage[] = [];
    for (const stageDef of preset.stages) {
        const agent = find(stageDef.builtinType);
        if (!agent) continue; // skip stages for agents not available
        const stage: PipelineStage = {
            agent: { ...agent },
            inputMode: 'conversation',
        };
        if (stageDef.canReject) stage.canReject = true;
        if (stageDef.onReject) stage.onReject = stageDef.onReject;
        if (stageDef.rejectTarget !== undefined) stage.rejectTarget = stageDef.rejectTarget;
        if (stageDef.maxRetries !== undefined) stage.maxRetries = stageDef.maxRetries;
        pipelineStages.push(stage);
    }

    if (pipelineStages.length === 0) {
        throw new Error(`No agents available for preset "${preset.name}"`);
    }

    return {
        id: `preset-${preset.id}`,
        name: preset.name,
        stages: pipelineStages,
    };
}

/** Empty state when no stages exist */
const EmptyState: React.FC<{
    onAddFirst: () => void;
    onLoadPreset: (presetId: string) => void;
    builtinAgents: AgentDefinition[];
}> = ({ onAddFirst, onLoadPreset, builtinAgents }) => {
    // Only show presets whose agents are all available
    const availablePresets = PIPELINE_PRESETS.filter(preset =>
        preset.stages.every(s => builtinAgents.some(a => a.builtinType === s.builtinType))
    );

    return (
        <div className="border-2 border-dashed border-slate-700 rounded-2xl p-8 text-center space-y-5">
            <div className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                <Cpu className="text-slate-500" size={24} />
            </div>
            <div>
                <h3 className="text-sm font-bold text-slate-300 mb-1">No pipeline configured</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Pick a workflow template below, or drag agents from the palette to build your own.
                </p>
            </div>

            {/* Preset cards */}
            {availablePresets.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-2xl mx-auto">
                    {availablePresets.map(preset => (
                        <button
                            key={preset.id}
                            onClick={() => onLoadPreset(preset.id)}
                            className={`group text-left p-3 rounded-xl border transition-all hover:scale-[1.02] ${
                                preset.id === 'default'
                                    ? 'bg-cyan-950/40 border-cyan-700/50 hover:border-cyan-500/60 hover:bg-cyan-950/60'
                                    : 'bg-slate-800/50 border-slate-700/40 hover:border-slate-500/50 hover:bg-slate-800/80'
                            }`}
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-base">{preset.icon}</span>
                                <span className="text-xs font-bold text-slate-200 group-hover:text-white">{preset.name}</span>
                                {preset.id === 'default' && (
                                    <span className="text-[9px] bg-cyan-600/30 text-cyan-400 px-1.5 py-0.5 rounded-full font-medium">recommended</span>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-500 group-hover:text-slate-400 leading-relaxed line-clamp-2">{preset.description}</p>
                            <div className="flex flex-wrap gap-0.5 mt-2">
                                {preset.stages.map((s, i) => {
                                    const agent = builtinAgents.find(a => a.builtinType === s.builtinType);
                                    return agent ? (
                                        <span
                                            key={i}
                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px]"
                                            style={{ backgroundColor: agent.color || '#6b7280' }}
                                            title={agent.name}
                                        >
                                            {agent.icon || agent.name.charAt(0)}
                                        </span>
                                    ) : null;
                                })}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            <button
                onClick={onAddFirst}
                className="px-4 py-2 bg-slate-700/40 text-slate-400 rounded-lg border border-slate-600/30 text-xs font-medium hover:bg-slate-700/60 hover:text-slate-300 transition-colors"
            >
                <Plus size={12} className="inline mr-1" /> Build from scratch
            </button>
        </div>
    );
};

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
    readOnly?: boolean;
    /** The live-resolved agent definition for this stage (saved-lib lookup or inline). Undefined when dangling. */
    resolvedAgent?: AgentDefinition;
    /** True when the stage is backed by a live saved-agent reference. */
    hasSavedRef?: boolean;
    /** True when the stage has a savedAgentId that can't be resolved in the library. */
    isDangling?: boolean;
    onToggleExpand: () => void;
    onRemove: () => void;
    onUpdate: (patch: Partial<PipelineStage>) => void;
    onEditAgent: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}> = React.memo(({
    stage, index, total, color, icon, label, isDragging, isExpanded, readOnly,
    resolvedAgent, hasSavedRef, isDangling,
    onToggleExpand, onRemove, onUpdate, onEditAgent,
    onDragStart, onDragOver, onDrop, onDragEnd,
}) => {
    return (
        <div
            draggable={!readOnly}
            onDragStart={readOnly ? undefined : onDragStart}
            onDragOver={readOnly ? undefined : onDragOver}
            onDrop={readOnly ? undefined : onDrop}
            onDragEnd={readOnly ? undefined : onDragEnd}
            className={`rounded-xl border transition-all ${
                isDragging ? 'opacity-40 scale-95' : ''
            } ${isExpanded ? 'bg-slate-800/60 border-slate-600' : 'bg-slate-800/30 border-slate-700/40 hover:border-slate-600/60'}`}
        >
            {/* Header row */}
            <div className={`flex items-center gap-2 px-3 py-2.5 ${readOnly ? '' : 'cursor-pointer'}`} onClick={readOnly ? undefined : onToggleExpand}>
                {/* Drag handle */}
                {!readOnly && <div className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 flex-shrink-0" title="Drag to reorder">
                    <GripVertical size={14} />
                </div>}

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
                    <span className="text-sm font-semibold text-white truncate block">
                        {label}
                        {hasSavedRef && !isDangling && (
                            <span
                                className="ml-1.5 align-middle inline-flex items-center gap-0.5 text-[9px] font-medium text-cyan-300/80 bg-cyan-900/30 border border-cyan-700/30 px-1 py-0 rounded"
                                title="Linked to a saved agent in your library. Edits in the library propagate here."
                            >
                                <Library size={8} /> linked
                            </span>
                        )}
                        {isDangling && (
                            <span
                                className="ml-1.5 align-middle inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1 py-0 rounded"
                                title="This stage references a saved agent that no longer exists in your library. The workflow will fail to run until the agent is restored or the stage is replaced."
                            >
                                <AlertTriangle size={8} /> unlinked
                            </span>
                        )}
                    </span>
                    <span className="text-[10px] text-slate-500">
                        {resolvedAgent?.source || 'inline'}
                        {resolvedAgent?.builtinType && ` · ${resolvedAgent.builtinType}`}
                        {stage.canReject && (
                            <span className="ml-1.5 text-amber-400">⚡ can reject</span>
                        )}
                    </span>
                </div>

                {/* Actions */}
                <button onClick={(e) => { e.stopPropagation(); onEditAgent(); }} className="p-1 text-slate-500 hover:text-cyan-400 transition-colors" title="View agent details">
                    <Eye size={13} />
                </button>
                {!readOnly && <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 text-slate-500 hover:text-red-400 transition-colors" title="Remove stage">
                    <Trash2 size={13} />
                </button>}
                {!readOnly && <div className="text-slate-600">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>}
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
                                        <label className="text-xs text-slate-400 w-24 flex-shrink-0 flex items-center gap-1">
                                            Max Retries
                                            <span
                                                className="relative inline-flex group"
                                                tabIndex={0}
                                                aria-label="Max retries help"
                                            >
                                                <HelpCircle
                                                    size={12}
                                                    className="text-slate-500 group-hover:text-cyan-400 group-focus:text-cyan-400 cursor-help"
                                                />
                                                <span
                                                    role="tooltip"
                                                    className="pointer-events-none absolute left-0 bottom-full mb-1.5 z-50 w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity"
                                                >
                                                    How many times this agent may reject and loop back.
                                                    <br /><br />
                                                    When the limit is reached, the rejected output is accepted as-is (marked with a <span className="text-amber-400">flag</span>) and the pipeline <span className="text-slate-100">continues to the next stage</span> — it does <span className="text-slate-100">not</span> fail or stop.
                                                    <br /><br />
                                                    <span className="text-slate-400">Range: 1–5, or <span className="text-cyan-300">Unlimited</span> (loop until the agent stops rejecting).</span>
                                                </span>
                                            </span>
                                        </label>
                                        {(() => {
                                            const isUnlimited = stage.maxRetries !== undefined && stage.maxRetries <= 0;
                                            return (
                                                <>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={5}
                                                        value={isUnlimited ? '' : (stage.maxRetries ?? 2)}
                                                        disabled={isUnlimited}
                                                        placeholder={isUnlimited ? '∞' : undefined}
                                                        onChange={e => {
                                                            const raw = e.target.value;
                                                            // Allow empty input transiently — don't clamp mid-typing
                                                            if (raw === '') return;
                                                            const n = Number(raw);
                                                            if (!Number.isFinite(n)) return;
                                                            // Only commit values inside the allowed range while typing
                                                            if (n >= 1 && n <= 5) onUpdate({ maxRetries: n });
                                                        }}
                                                        onBlur={e => {
                                                            if (isUnlimited) return;
                                                            const n = Number(e.target.value);
                                                            if (!Number.isFinite(n) || n < 1) onUpdate({ maxRetries: 1 });
                                                            else if (n > 5) onUpdate({ maxRetries: 5 });
                                                        }}
                                                        className="w-20 bg-slate-900 text-xs text-slate-200 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    />
                                                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                                                        <input
                                                            type="checkbox"
                                                            checked={isUnlimited}
                                                            onChange={e => onUpdate({ maxRetries: e.target.checked ? 0 : 2 })}
                                                            className="accent-cyan-500"
                                                        />
                                                        Unlimited
                                                    </label>
                                                </>
                                            );
                                        })()}
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

export const BuiltinDetailModal: React.FC<{ agent: AgentDefinition; onClose: () => void }> = ({ agent, onClose }) => {
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
                            <span className="text-[10px] text-cyan-400 font-medium uppercase tracking-wider">
                                {agent.source === 'builtin' ? 'Built-in Agent' : agent.source === 'file' ? 'File Agent' : 'Inline Agent'}
                            </span>
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

                    {/* Type & Source */}
                    <div className="grid grid-cols-2 gap-4">
                        {agent.builtinType && (
                            <div>
                                <label className="text-xs font-bold text-slate-400 block mb-1">Type</label>
                                <span className="text-sm text-slate-200 bg-slate-800 px-2.5 py-1 rounded-md inline-block">{agent.builtinType}</span>
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Source</label>
                            <span className="text-sm text-slate-200 bg-slate-800 px-2.5 py-1 rounded-md inline-block">
                                {agent.source === 'builtin' ? '⚡ Built-in' : agent.source === 'file' ? '📄 File' : '✏️ Inline'}
                            </span>
                        </div>
                    </div>

                    {/* Prompt File */}
                    {agent.promptPath && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">Prompt File</label>
                            <code className="text-xs text-cyan-300 bg-slate-800 px-2.5 py-1.5 rounded-md block font-mono">{agent.promptPath}</code>
                        </div>
                    )}

                    {/* Inline Prompt */}
                    {agent.promptContent && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1">System Prompt</label>
                            <pre className="text-xs text-slate-300 bg-slate-800 px-2.5 py-1.5 rounded-md font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{agent.promptContent}</pre>
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
                        <Eye size={10} /> Read-only — edit agents from the palette
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
    onSaveToLibrary?: (agent: AgentDefinition) => void;
    onClose: () => void;
}

const AgentModal: React.FC<AgentModalProps> = ({ builtinAgents, availableModels, existingAgent, defaultColor, onSave, onSaveToLibrary, onClose }) => {
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
    const [icon, setIcon] = useState(existingAgent?.icon || '');
    const [kind, setKind] = useState<AgentKind>(existingAgent?.kind || 'custom');
    const [agentRepoRoot, setAgentRepoRoot] = useState(existingAgent?.repoRoot || '');
    const [agentKnowledgeBasePath, setAgentKnowledgeBasePath] = useState(existingAgent?.knowledgeBasePath || '');
    const [agentWorkingDirectory, setAgentWorkingDirectory] = useState(existingAgent?.workingDirectory || '');
    const [showContextFields, setShowContextFields] = useState(
        !!(existingAgent?.repoRoot || existingAgent?.knowledgeBasePath || existingAgent?.workingDirectory)
    );
    const [showDescPopup, setShowDescPopup] = useState(false);
    const backdropRef = useRef<HTMLDivElement>(null);
    const descPopupRef = useRef<HTMLDivElement>(null);

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === backdropRef.current) onClose();
    };

    const buildAgent = (): AgentDefinition => {
        const agentName = source === 'builtin'
            ? builtinAgents.find(a => (a.builtinType || a.id) === builtinType)?.name || builtinType
            : name || 'Unnamed Agent';

        const agent: AgentDefinition = {
            id: existingAgent?.id || agentName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36),
            name: agentName,
            source,
            color,
        };

        if (icon) agent.icon = icon;

        if (source === 'builtin') {
            agent.builtinType = builtinType;
            const builtin = builtinAgents.find(a => (a.builtinType || a.id) === builtinType);
            if (builtin) {
                agent.color = builtin.color || color;
                if (!icon) agent.icon = builtin.icon;
                // Inherit kind from the underlying built-in so retrospect-tab
                // routing keeps working even if the user wraps it in a stage.
                if (builtin.kind) agent.kind = builtin.kind;
            }
        } else if (source === 'file') {
            agent.promptPath = promptPath;
            agent.kind = kind;
        } else if (source === 'inline') {
            agent.promptContent = promptContent;
            agent.kind = kind;
        }

        if (description) agent.description = description;
        if (model) agent.model = model;
        if (maxSteps > 0) agent.maxSteps = maxSteps;
        if (agentRepoRoot.trim()) agent.repoRoot = agentRepoRoot.trim();
        if (agentKnowledgeBasePath.trim()) agent.knowledgeBasePath = agentKnowledgeBasePath.trim();
        if (agentWorkingDirectory.trim()) agent.workingDirectory = agentWorkingDirectory.trim();

        return agent;
    };

    const handleSave = () => {
        onSave(buildAgent());
    };

    const handleSaveToLibrary = () => {
        if (onSaveToLibrary) onSaveToLibrary(buildAgent());
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

                    {/* Kind (custom agents only) */}
                    {source !== 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">
                                Role (kind)
                                <span className="text-slate-600 font-normal ml-1">— drives UI routing (e.g. Retrospect tab surfaces agents with <code>retrospect</code>)</span>
                            </label>
                            <select
                                value={kind}
                                onChange={e => setKind(e.target.value as AgentKind)}
                                className="w-full bg-slate-800 text-sm text-slate-200 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/30"
                            >
                                {AGENT_KINDS.map(k => (
                                    <option key={k} value={k}>{k}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Investigation Context (per-agent path overrides) */}
                    {source !== 'builtin' && (
                        <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setShowContextFields(v => !v)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/40 hover:bg-slate-800/60 transition-colors text-left"
                            >
                                <div>
                                    <div className="text-xs font-bold text-slate-300">Investigation Context <span className="text-slate-500 font-normal">(optional)</span></div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">Per-agent repo, knowledge base, and working directory. Only needed for agents that read files or spawn MCP servers (typically <code>investigator</code>, <code>retrospect</code>, <code>implementation</code>).</div>
                                </div>
                                <span className="text-slate-500 text-xs ml-2">{showContextFields ? '▾' : '▸'}</span>
                            </button>
                            {showContextFields && (
                                <div className="px-3 py-3 space-y-3 bg-slate-800/20">
                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">Repository Root</label>
                                        <input
                                            type="text"
                                            value={agentRepoRoot}
                                            onChange={e => setAgentRepoRoot(e.target.value)}
                                            placeholder="C:/Repositories/MyRepo  (leave blank to use global)"
                                            className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded px-2 py-1.5 font-mono outline-none focus:ring-1 focus:ring-cyan-500/30"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">Knowledge Base Path</label>
                                        <input
                                            type="text"
                                            value={agentKnowledgeBasePath}
                                            onChange={e => setAgentKnowledgeBasePath(e.target.value)}
                                            placeholder="docs/investigations  (relative to repo root, or absolute)"
                                            className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded px-2 py-1.5 font-mono outline-none focus:ring-1 focus:ring-cyan-500/30"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">Working Directory</label>
                                        <input
                                            type="text"
                                            value={agentWorkingDirectory}
                                            onChange={e => setAgentWorkingDirectory(e.target.value)}
                                            placeholder="cwd for this agent's MCP servers (leave blank to use global)"
                                            className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded px-2 py-1.5 font-mono outline-none focus:ring-1 focus:ring-cyan-500/30"
                                        />
                                    </div>
                                </div>
                            )}
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

                    {/* Icon picker */}
                    {source !== 'builtin' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 block mb-1.5">Icon <span className="text-slate-600">(optional)</span></label>
                            <div className="flex flex-wrap gap-1.5">
                                <button
                                    onClick={() => setIcon('')}
                                    className={`w-8 h-8 rounded-lg border text-xs transition-all flex items-center justify-center ${
                                        !icon ? 'border-white bg-slate-700 text-slate-300 scale-105' : 'border-slate-700 bg-slate-800 text-slate-500 hover:border-slate-500'
                                    }`}
                                    title="No icon (auto-assign)"
                                >
                                    —
                                </button>
                                {AGENT_ICONS.map(i => (
                                    <button
                                        key={i}
                                        onClick={() => setIcon(i)}
                                        className={`w-8 h-8 rounded-lg border text-base transition-all flex items-center justify-center ${
                                            icon === i ? 'border-white bg-slate-700 scale-105' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                                        }`}
                                    >
                                        {i}
                                    </button>
                                ))}
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
                    {!isEditing && onSaveToLibrary && source !== 'builtin' && (
                        <button
                            onClick={handleSaveToLibrary}
                            disabled={source === 'file' && !promptPath}
                            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-emerald-400 hover:text-emerald-300 text-sm font-bold rounded-lg border border-slate-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Save this agent to your library so you can reuse it across any workflow"
                        >
                            <Save size={14} />
                            Save to Library
                        </button>
                    )}
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
