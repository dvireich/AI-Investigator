import React, { useRef, useState } from 'react';
import { X, Save, Expand } from 'lucide-react';
import type { AgentDefinition, AgentKind } from '../types/pipeline';
import { AGENT_KINDS } from '../types/pipeline';

// ── Palette colors for new custom agents ─────────────────────────────

export const CUSTOM_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f97316',
    '#14b8a6', '#eab308', '#ef4444', '#6366f1',
];

export function pickColor(index: number): string {
    return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}

export const AGENT_ICONS = [
    '🤖', '🛡️', '🔍', '📊', '🔬', '🧠', '📡', '🩹',
    '⏱️', '📋', '😈', '🔎', '📜', '✅', '🔗', '🚨',
    '💡', '⚡', '🎯', '🧪', '🔥', '✨', '🏗️', '🕵️',
];

// ── Props ────────────────────────────────────────────────────────────

export interface AgentModalProps {
    builtinAgents: AgentDefinition[];
    availableModels: string[];
    existingAgent?: AgentDefinition;
    defaultColor: string;
    onSave: (agent: AgentDefinition) => void;
    onSaveToLibrary?: (agent: AgentDefinition) => void;
    onClose: () => void;
    /**
     * Where the modal is being launched from.
     * - 'pipeline' (default): primary button is "Add to Pipeline"; "Save to Library" appears as a secondary action when supported.
     * - 'library': primary button is "Save to Library" / "Update"; the redundant secondary library button is hidden.
     */
    mode?: 'pipeline' | 'library';
}

// ── Component ────────────────────────────────────────────────────────

export const AgentModal: React.FC<AgentModalProps> = ({
    builtinAgents,
    availableModels,
    existingAgent,
    defaultColor,
    onSave,
    onSaveToLibrary,
    onClose,
    mode = 'pipeline',
}) => {
    const isEditing = !!existingAgent;
    const isLibraryMode = mode === 'library';
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

    // In library mode, the primary button persists to the library and the
    // separate "Save to Library" secondary button is redundant — hide it.
    const showSecondaryLibraryButton = !isLibraryMode && !isEditing && !!onSaveToLibrary && source !== 'builtin';
    const primaryLabel = isEditing
        ? 'Update'
        : isLibraryMode ? 'Save to Library' : 'Add to Pipeline';
    const primaryDisabled =
        (source === 'file' && !promptPath && !isEditing)
        || (isLibraryMode && source === 'builtin' && !isEditing);

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
                        {isEditing ? 'Edit Agent' : isLibraryMode ? 'New Agent' : 'Add Agent'}
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
                        {isLibraryMode && source === 'builtin' && !isEditing && (
                            <p className="text-[10px] text-amber-400/80 mt-1.5">
                                Built-in agents are already available everywhere. Pick <strong>File</strong> or <strong>Inline</strong> to create a reusable custom agent.
                            </p>
                        )}
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
                    {showSecondaryLibraryButton && (
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
                        disabled={primaryDisabled}
                        className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {primaryLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
