import type { ComponentType } from 'react';
import type { Investigation } from '../../api';

export interface WidgetDefinition {
    id: string;
    name: string;
    description: string;
    icon: string; // lucide icon name for display
    component: ComponentType<{ investigations: Investigation[] }>;
}

// Lazy-loaded widget components — imported at registration time
import { InvestigationTrend } from './InvestigationTrend';
import { IssueTypeDonut } from './IssueTypeDonut';
import { DurationDistribution } from './DurationDistribution';
import { SuccessRateDonut } from './SuccessRateDonut';
import { StampActivity } from './StampActivity';
import { VerdictBreakdown } from './VerdictBreakdown';
import { ModelUsage } from './ModelUsage';
import { ContestRate } from './ContestRate';

// Wrapper to adapt SuccessRateDonut (which takes {completed, failed, aborted}) to Investigation[] prop
const SuccessRateWrapper = ({ investigations }: { investigations: Investigation[] }) => {
    const completed = investigations.filter(i => i.status === 'completed').length;
    const failed = investigations.filter(i => i.status === 'failed').length;
    const aborted = investigations.filter(i => i.status === 'aborted').length;
    return SuccessRateDonut({ completed, failed, aborted });
};

export const WIDGET_REGISTRY: WidgetDefinition[] = [
    {
        id: 'trend',
        name: '14-Day Trend',
        description: 'Daily investigation counts over the last 14 days',
        icon: 'TrendingUp',
        component: InvestigationTrend,
    },
    {
        id: 'issueTypes',
        name: 'Issue Types',
        description: 'Distribution of investigations by issue type',
        icon: 'PieChart',
        component: IssueTypeDonut,
    },
    {
        id: 'duration',
        name: 'Duration Distribution',
        description: 'How long investigations take to complete',
        icon: 'Timer',
        component: DurationDistribution as ComponentType<{ investigations: Investigation[] }>,
    },
    {
        id: 'successRate',
        name: 'Success Rate',
        description: 'Completion success percentage donut',
        icon: 'CheckCircle2',
        component: SuccessRateWrapper,
    },
    {
        id: 'stampActivity',
        name: 'Stamp Activity',
        description: 'Top stamps by investigation count, stacked by status',
        icon: 'Server',
        component: StampActivity,
    },
    {
        id: 'verdictBreakdown',
        name: 'Verdict Breakdown',
        description: 'Scheduled investigation verdicts: healthy, warning, critical',
        icon: 'ShieldAlert',
        component: VerdictBreakdown,
    },
    {
        id: 'modelUsage',
        name: 'Model Usage',
        description: 'Which AI models are used most frequently',
        icon: 'Sparkles',
        component: ModelUsage,
    },
    {
        id: 'contestRate',
        name: 'Contest Rate',
        description: 'Proportion of investigations that were contested',
        icon: 'RotateCcw',
        component: ContestRate,
    },
];

export const DEFAULT_WIDGET_IDS = ['trend', 'stampActivity', 'successRate'];

const STORAGE_KEY = 'inv-analytics-widgets';

export function getSelectedWidgetIds(): string[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const ids = JSON.parse(stored) as string[];
            // Validate all IDs still exist in registry
            const validIds = ids.filter(id => WIDGET_REGISTRY.some(w => w.id === id));
            if (validIds.length === 3) return validIds;
        }
    } catch { /* ignore */ }
    return DEFAULT_WIDGET_IDS;
}

export function setSelectedWidgetIds(ids: string[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function getWidgetById(id: string): WidgetDefinition | undefined {
    return WIDGET_REGISTRY.find(w => w.id === id);
}
