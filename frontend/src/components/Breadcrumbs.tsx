import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Pencil } from 'lucide-react';

export interface Crumb {
    label: string;
    to?: string;
}

interface BreadcrumbsProps {
    crumbs: Crumb[];
    /** When provided the current-page label becomes editable. Called with the new label string. */
    onEditLabel?: (newLabel: string) => void;
}

export const Breadcrumbs = ({ crumbs, onEditLabel }: BreadcrumbsProps) => {
    // Find the last navigable crumb (the "back" target)
    const backCrumb = crumbs.filter(c => c.to).pop();
    const currentCrumb = crumbs[crumbs.length - 1];

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const startEditing = () => {
        if (!onEditLabel) return;
        setDraft(currentCrumb?.label || '');
        setEditing(true);
    };

    const commitEdit = () => {
        const trimmed = draft.trim();
        setEditing(false);
        if (trimmed && trimmed !== currentCrumb?.label) {
            onEditLabel?.(trimmed);
        }
    };

    const cancelEdit = () => {
        setEditing(false);
    };

    return (
        <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-sm mb-2 min-w-0">
            {/* Back pill — links to nearest parent */}
            {backCrumb?.to && (
                <Link
                    to={backCrumb.to}
                    className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] text-slate-400 hover:text-slate-200 transition-all duration-200 shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                    <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                    <span className="text-xs font-medium">{backCrumb.label}</span>
                </Link>
            )}
            {/* Separator */}
            {backCrumb?.to && currentCrumb && (
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
            )}
            {/* Current page label — editable when onEditLabel provided */}
            {currentCrumb && !currentCrumb.to && (
                editing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                        }}
                        onBlur={commitEdit}
                        className="flex-1 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-brand-500/40 text-brand-200 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
                        aria-label="Edit title"
                    />
                ) : (
                    <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-semibold truncate${onEditLabel ? ' cursor-pointer hover:bg-brand-500/20 transition-colors group/crumb' : ''}`}
                        onDoubleClick={startEditing}
                        role={onEditLabel ? 'button' : undefined}
                        title={onEditLabel ? 'Double-click or click pencil to rename' : undefined}
                    >
                        {currentCrumb.label}
                        {onEditLabel && (
                            <button
                                onClick={(e) => { e.stopPropagation(); startEditing(); }}
                                className="p-0.5 rounded hover:bg-brand-500/30 text-brand-400 hover:text-brand-200 transition-colors opacity-60 group-hover/crumb:opacity-100"
                                aria-label="Edit title"
                                title="Rename investigation"
                            >
                                <Pencil className="w-3 h-3" />
                            </button>
                        )}
                    </span>
                )
            )}
        </nav>
    );
};
