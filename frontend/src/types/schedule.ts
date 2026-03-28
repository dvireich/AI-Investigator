export interface ScheduleDefinition {
    id: string;
    name: string;
    enabled: boolean;
    target: string;
    query: string;
    intervalMinutes: number;
    productId?: string;
    model?: string;
    maxSteps?: number;
    timeRange?: string;
    category?: string;
    autoEscalate: boolean;
    escalationQuery?: string;
    retentionCount?: number;
    createdBy?: string;
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
    lastVerdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    lastInvestigationId?: string;
    activeInvestigationId?: string;
    activeEscalationId?: string;
    consecutiveCriticalCount?: number;
    historyCount?: number;
}

export interface ScheduleHistoryEntry {
    timestamp: string;
    verdict: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    investigationId: string;
    summary?: string;
}

export interface ScheduleReport {
    scheduleId: string;
    scheduleName: string;
    totalRuns: number;
    verdictBreakdown: Record<string, number>;
    successRate: number;
    trend: 'improving' | 'degrading' | 'stable';
    firstRunAt?: string;
    lastRunAt?: string;
    recentSummaries: {
        timestamp: string;
        verdict: string;
        investigationId: string;
        summary?: string;
    }[];
    executiveSummary?: string;
}
