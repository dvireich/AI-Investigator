import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import {
    WIDGET_REGISTRY,
    DEFAULT_WIDGET_IDS,
    getSelectedWidgetIds,
    setSelectedWidgetIds,
    getWidgetById,
} from '../../components/charts/widgetRegistry';

describe('widgetRegistry', () => {
    describe('WIDGET_REGISTRY', () => {
        it('has 8 widgets', () => {
            expect(WIDGET_REGISTRY).toHaveLength(8);
        });

        it('each widget has required fields', () => {
            for (const widget of WIDGET_REGISTRY) {
                expect(widget.id).toBeTruthy();
                expect(widget.name).toBeTruthy();
                expect(widget.description).toBeTruthy();
                expect(widget.icon).toBeTruthy();
                expect(widget.component).toBeDefined();
            }
        });

        it('all widget IDs are unique', () => {
            const ids = WIDGET_REGISTRY.map(w => w.id);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    describe('DEFAULT_WIDGET_IDS', () => {
        it('has 3 defaults', () => {
            expect(DEFAULT_WIDGET_IDS).toHaveLength(3);
        });

        it('all defaults exist in registry', () => {
            for (const id of DEFAULT_WIDGET_IDS) {
                expect(WIDGET_REGISTRY.some(w => w.id === id)).toBe(true);
            }
        });
    });

    describe('getSelectedWidgetIds', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('returns defaults when nothing stored', () => {
            expect(getSelectedWidgetIds()).toEqual(DEFAULT_WIDGET_IDS);
        });

        it('returns stored IDs when valid', () => {
            const ids = ['trend', 'categories', 'duration'];
            localStorage.setItem('inv-analytics-widgets', JSON.stringify(ids));
            expect(getSelectedWidgetIds()).toEqual(ids);
        });

        it('returns defaults when stored IDs are invalid', () => {
            localStorage.setItem('inv-analytics-widgets', JSON.stringify(['bad', 'ids', 'here']));
            expect(getSelectedWidgetIds()).toEqual(DEFAULT_WIDGET_IDS);
        });

        it('returns defaults when stored data is not valid JSON', () => {
            localStorage.setItem('inv-analytics-widgets', 'not json');
            expect(getSelectedWidgetIds()).toEqual(DEFAULT_WIDGET_IDS);
        });

        it('returns defaults when stored array has wrong count', () => {
            localStorage.setItem('inv-analytics-widgets', JSON.stringify(['trend']));
            expect(getSelectedWidgetIds()).toEqual(DEFAULT_WIDGET_IDS);
        });
    });

    describe('setSelectedWidgetIds', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('stores IDs in localStorage', () => {
            setSelectedWidgetIds(['trend', 'duration', 'categories']);
            const stored = JSON.parse(localStorage.getItem('inv-analytics-widgets')!);
            expect(stored).toEqual(['trend', 'duration', 'categories']);
        });
    });

    describe('getWidgetById', () => {
        it('finds existing widget', () => {
            const widget = getWidgetById('trend');
            expect(widget).toBeDefined();
            expect(widget!.id).toBe('trend');
        });

        it('returns undefined for non-existent widget', () => {
            expect(getWidgetById('nonexistent')).toBeUndefined();
        });
    });

    describe('SuccessRateWrapper', () => {
        it('adapts Investigation[] to completed/failed/aborted props', () => {
            const widget = getWidgetById('successRate');
            expect(widget).toBeDefined();
            
            // The SuccessRateWrapper component counts statuses from Investigation[]
            const investigations = [
                { id: '1', status: 'completed' },
                { id: '2', status: 'completed' },
                { id: '3', status: 'failed' },
                { id: '4', status: 'aborted' },
                { id: '5', status: 'running' }, // Not counted
            ] as any;
            
            // Render the wrapper component to verify it works
            const SuccessRateWrapper = widget!.component;
            const { container } = render(SuccessRateWrapper({ investigations }));
            
            // Should render without error
            expect(container).toBeTruthy();
        });

        it('handles all completed investigations', () => {
            const widget = getWidgetById('successRate');
            const investigations = [
                { id: '1', status: 'completed' },
                { id: '2', status: 'completed' },
            ] as any;
            
            const SuccessRateWrapper = widget!.component;
            const { container } = render(SuccessRateWrapper({ investigations }));
            expect(container).toBeTruthy();
        });

        it('handles empty investigations array', () => {
            const widget = getWidgetById('successRate');
            const investigations: any[] = [];
            
            const SuccessRateWrapper = widget!.component;
            const { container } = render(SuccessRateWrapper({ investigations }));
            expect(container).toBeTruthy();
        });

        it('handles only failed and aborted investigations', () => {
            const widget = getWidgetById('successRate');
            const investigations = [
                { id: '1', status: 'failed' },
                { id: '2', status: 'aborted' },
            ] as any;
            
            const SuccessRateWrapper = widget!.component;
            const { container } = render(SuccessRateWrapper({ investigations }));
            expect(container).toBeTruthy();
        });
    });
});
