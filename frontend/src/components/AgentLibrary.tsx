import React, { useState, useEffect, useCallback } from 'react';
import { Search, Eye, Pencil, Trash2, Plus, ChevronLeft, ChevronRight, Wrench, Cpu, FileText, Code, Shield } from 'lucide-react';
import type { AgentDefinition } from '../types/pipeline';
import type { SavedAgent } from '../api';
import { api } from '../api';
import { BuiltinDetailModal } from './PipelineBuilder';

interface AgentLibraryProps {
    builtinAgents: AgentDefinition[];
    onCreateAgent?: () => void;
}

const PAGE_SIZE = 12;

const toolSummary = (agent: AgentDefinition): string => {
    if (!agent.tools) return 'All tools';
    if (agent.tools.mode === 'all') return 'All tools';
    const count = agent.tools.list?.length ?? 0;
    return `${count} tool${count !== 1 ? 's' : ''} (${agent.tools.mode})`;
};

const sourceLabel = (agent: AgentDefinition): string => {
    if (agent.source === 'builtin') return '⚡ Built-in';
    if (agent.source === 'file') return '📄 File';
    return '✏️ Inline';
};

export const AgentLibrary: React.FC<AgentLibraryProps> = ({ builtinAgents, onCreateAgent }) => {
    const [savedAgents, setSavedAgents] = useState<SavedAgent[]>([]);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all');
    const [viewingAgent, setViewingAgent] = useState<AgentDefinition | null>(null);

    const refreshSavedAgents = useCallback(async () => {
        try {
            const agents = await api.getSavedAgents();
            setSavedAgents(agents);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { refreshSavedAgents(); }, [refreshSavedAgents]);

    const handleDelete = async (id: string) => {
        try {
            await api.deleteSavedAgent(id);
            setSavedAgents(prev => prev.filter(sa => sa.id !== id));
        } catch { /* ignore */ }
    };

    // Merge builtin + saved into unified list
    const allAgents: { agent: AgentDefinition; savedId?: string }[] = [
        ...builtinAgents.map(a => ({ agent: a })),
        ...savedAgents.map(sa => ({ agent: sa.agent, savedId: sa.id })),
    ];

    const searchLower = search.toLowerCase();
    const filtered = allAgents.filter(({ agent }) => {
        if (filter === 'builtin' && agent.source !== 'builtin') return false;
        if (filter === 'custom' && agent.source === 'builtin') return false;
        if (!search) return true;
        return (
            agent.name.toLowerCase().includes(searchLower) ||
            (agent.description || '').toLowerCase().includes(searchLower) ||
            (agent.builtinType || '').toLowerCase().includes(searchLower)
        );
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    return (
        <div className="space-y-6 animate-fade-in">
            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                        <Cpu className="text-violet-400" /> Agent Library
                    </h2>
                    <p className="text-slate-400">
                        Browse all available agents — <span className="text-slate-300 font-medium">{builtinAgents.length} built-in</span> and <span className="text-slate-300 font-medium">{savedAgents.length} custom</span>.
                        View details, tools, and prompts.
                    </p>
                </div>
                {onCreateAgent && (
                    <button
                        type="button"
                        onClick={onCreateAgent}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-500 text-white transition-colors shrink-0"
                    >
                        <Plus className="w-4 h-4" />
                        New Agent
                    </button>
                )}
            </div>

            {/* ── Search + Filters ── */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(0); }}
                        placeholder="Search agents by name, description, or type…"
                        className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700/40 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-600/50 transition-colors"
                    />
                </div>
                <div className="flex gap-1">
                    {(['all', 'builtin', 'custom'] as const).map(f => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => { setFilter(f); setPage(0); }}
                            className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                                filter === f
                                    ? 'bg-violet-600/20 text-violet-400 border border-violet-500/40'
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 border border-transparent'
                            }`}
                        >
                            {f === 'all' ? 'All' : f === 'builtin' ? 'Built-in' : 'Custom'}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Results count + pagination ── */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                    {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
                    {search && ` matching "${search}"`}
                </span>
                {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={safePage === 0}
                            className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4 text-slate-400" />
                        </button>
                        <span className="text-xs text-slate-500 tabular-nums min-w-[2.5rem] text-center">
                            {safePage + 1}/{totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={safePage >= totalPages - 1}
                            className="p-0.5 rounded hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </button>
                    </div>
                )}
            </div>

            {/* ── Agent Cards Grid ── */}
            {pageItems.length === 0 ? (
                <div className="py-12 text-center">
                    <Cpu className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">
                        {search ? `No agents match "${search}"` : 'No agents available'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pageItems.map(({ agent, savedId }) => (
                        <div
                            key={agent.id}
                            className="group rounded-xl border border-slate-700/40 bg-slate-800/40 hover:border-slate-600/60 hover:bg-slate-800/60 transition-all overflow-hidden"
                        >
                            {/* Card Header */}
                            <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                                <span
                                    className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0 shadow-lg"
                                    style={{ backgroundColor: agent.color || '#6b7280' }}
                                >
                                    {agent.icon || agent.name.charAt(0)}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-bold text-white text-sm truncate">{agent.name}</h4>
                                    <span className="text-[10px] text-slate-500">{sourceLabel(agent)}</span>
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setViewingAgent(agent)}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                                        title="View details"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    {savedId && (
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(savedId)}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                                            title="Delete agent"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Description */}
                            <div className="px-4 pb-3">
                                <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 min-h-[2rem]">
                                    {agent.description || 'No description'}
                                </p>
                            </div>

                            {/* Footer pills */}
                            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4">
                                <span className="inline-flex items-center gap-1 text-[10px] bg-slate-700/60 text-slate-400 px-2 py-0.5 rounded-full">
                                    <Wrench className="w-2.5 h-2.5" />
                                    {toolSummary(agent)}
                                </span>
                                {agent.model && (
                                    <span className="inline-flex items-center gap-1 text-[10px] bg-slate-700/60 text-slate-400 px-2 py-0.5 rounded-full">
                                        <Cpu className="w-2.5 h-2.5" />
                                        {agent.model}
                                    </span>
                                )}
                                {agent.maxSteps && (
                                    <span className="text-[10px] bg-slate-700/60 text-slate-400 px-2 py-0.5 rounded-full">
                                        {agent.maxSteps} steps
                                    </span>
                                )}
                                {agent.builtinType && (
                                    <span className="text-[10px] bg-violet-600/20 text-violet-400 px-2 py-0.5 rounded-full font-medium">
                                        {agent.builtinType}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Detail Modal ── */}
            {viewingAgent && (
                <BuiltinDetailModal agent={viewingAgent} onClose={() => setViewingAgent(null)} />
            )}
        </div>
    );
};
