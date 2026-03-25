import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentTitle, buildDashboardTitle, buildInvestigationTitle } from '../../hooks/useDocumentTitle';

describe('useDocumentTitle', () => {
    const originalTitle = document.title;

    afterEach(() => {
        document.title = originalTitle;
    });

    it('sets document.title with suffix when given a string', () => {
        renderHook(() => useDocumentTitle('My Page'));
        expect(document.title).toBe('My Page | AI Investigator');
    });

    it('sets base title when given null', () => {
        renderHook(() => useDocumentTitle(null));
        expect(document.title).toBe('AI Investigator');
    });

    it('restores previous title on unmount', () => {
        document.title = 'Original';
        const { unmount } = renderHook(() => useDocumentTitle('Test'));
        expect(document.title).toBe('Test | AI Investigator');
        unmount();
        expect(document.title).toBe('Original');
    });

    it('updates title when value changes', () => {
        const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
            initialProps: { title: 'First' as string | null },
        });
        expect(document.title).toBe('First | AI Investigator');
        rerender({ title: 'Second' });
        expect(document.title).toBe('Second | AI Investigator');
    });
});

describe('buildDashboardTitle', () => {
    it('returns null when no running or paused', () => {
        expect(buildDashboardTitle(0, 0)).toBeNull();
    });

    it('shows running count only', () => {
        expect(buildDashboardTitle(3, 0)).toBe('(3 running) Dashboard');
    });

    it('shows paused count only', () => {
        expect(buildDashboardTitle(0, 2)).toBe('(2 paused) Dashboard');
    });

    it('shows both running and paused', () => {
        expect(buildDashboardTitle(2, 1)).toBe('(2 running, 1 paused) Dashboard');
    });
});

describe('buildInvestigationTitle', () => {
    it('includes status prefix and name', () => {
        expect(buildInvestigationTitle('running', 'My Investigation')).toBe('● Running — My Investigation');
    });

    it('uses generic label when no name', () => {
        expect(buildInvestigationTitle('completed')).toBe('✓ Completed — Investigation');
    });

    it('handles paused status', () => {
        expect(buildInvestigationTitle('paused', 'Test')).toBe('⏸ Paused — Test');
    });

    it('handles failed status', () => {
        expect(buildInvestigationTitle('failed', 'Test')).toBe('✕ Failed — Test');
    });

    it('handles aborted status', () => {
        expect(buildInvestigationTitle('aborted', 'Test')).toBe('⊘ Aborted — Test');
    });

    it('handles unknown status gracefully', () => {
        const result = buildInvestigationTitle('unknown', 'Test');
        expect(result).toBe('Unknown — Test');
    });
});
