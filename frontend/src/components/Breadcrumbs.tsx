import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
    label: string;
    to?: string;
}

interface BreadcrumbsProps {
    crumbs: Crumb[];
}

export const Breadcrumbs = ({ crumbs }: BreadcrumbsProps) => (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-slate-400 mb-2">
        {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
                {crumb.to ? (
                    <Link to={crumb.to} className="hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-0.5">
                        {crumb.label}
                    </Link>
                ) : (
                    <span className="text-slate-300 font-medium">{crumb.label}</span>
                )}
            </span>
        ))}
    </nav>
);
