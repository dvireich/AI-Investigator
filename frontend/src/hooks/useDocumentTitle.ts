import { useEffect, useRef } from 'react';

const BASE_TITLE = 'AI Investigator';

const STATUS_PREFIX: Record<string, string> = {
    running: '●',
    completed: '✓',
    paused: '⏸',
    failed: '✕',
    aborted: '⊘',
};

/**
 * Sets document.title based on page context. Restores original title on unmount.
 */
export function useDocumentTitle(title: string | null): void {
    const prevRef = useRef<string>(document.title);

    useEffect(() => {
        prevRef.current = document.title;
    }, []);

    useEffect(() => {
        document.title = title ? `${title} | ${BASE_TITLE}` : BASE_TITLE;
        return () => { document.title = prevRef.current; };
    }, [title]);
}

/**
 * Build a dashboard-style title string from investigation stats.
 * e.g. "(2 running, 1 paused)"
 */
export function buildDashboardTitle(running: number, paused: number): string | null {
    const parts: string[] = [];
    if (running > 0) parts.push(`${running} running`);
    if (paused > 0) parts.push(`${paused} paused`);
    if (parts.length === 0) return null;
    return `(${parts.join(', ')}) Dashboard`;
}

/**
 * Build an investigation detail title string.
 * e.g. "● Running — My Investigation"
 */
export function buildInvestigationTitle(status: string, name?: string): string {
    const prefix = STATUS_PREFIX[status] || '';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const label = name || 'Investigation';
    return `${prefix} ${statusLabel} — ${label}`.trim();
}
