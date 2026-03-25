import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export interface Crumb {
    label: string;
    to?: string;
}

interface BreadcrumbsProps {
    crumbs: Crumb[];
}

export const Breadcrumbs = ({ crumbs }: BreadcrumbsProps) => {
    // Find the last navigable crumb (the "back" target)
    const backCrumb = crumbs.filter(c => c.to).pop();
    const currentCrumb = crumbs[crumbs.length - 1];

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
            {/* Current page label */}
            {currentCrumb && !currentCrumb.to && (
                <span className="text-slate-300 font-medium truncate">{currentCrumb.label}</span>
            )}
        </nav>
    );
};
