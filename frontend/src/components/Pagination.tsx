import { ChevronLeft, ChevronRight } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

interface PaginationProps {
    totalItems: number;
    currentPage: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    noun?: string;
}

export { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS };

export const Pagination = ({ totalItems, currentPage, pageSize, onPageChange, onPageSizeChange, noun = 'items' }: PaginationProps) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    if (totalItems === 0) return null;

    // Build visible page numbers with ellipsis
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (currentPage > 3) pages.push('...');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4">
            <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{start}–{end} of {totalItems} {noun}</span>
                <span className="text-slate-700">|</span>
                <label className="flex items-center gap-1.5">
                    <span>Per page</span>
                    <select
                        value={pageSize}
                        onChange={e => {
                            onPageSizeChange(Number(e.target.value));
                            onPageChange(1);
                        }}
                        className="bg-slate-800 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-300 text-xs focus:ring-2 focus:ring-brand-500 outline-none cursor-pointer"
                    >
                        {PAGE_SIZE_OPTIONS.map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>

                {pages.map((p, i) =>
                    p === '...' ? (
                        <span key={`e${i}`} className="px-1.5 text-slate-600 text-xs">...</span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => onPageChange(p)}
                            className={`min-w-[28px] h-7 rounded-lg text-xs font-bold transition-all ${
                                p === currentPage
                                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20'
                                    : 'text-slate-500 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            {p}
                        </button>
                    )
                )}

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Next page"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
