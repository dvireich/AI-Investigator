export interface ScheduleDefinition {
    id: string;
    name: string;
    enabled: boolean;
    stamp: string;
    query: string;
    intervalMinutes: number;
    productId?: string;
    maxSteps?: number;
    timeRange?: string;
    issueType?: string;
    autoEscalate: boolean;
    escalationQuery?: string;
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
    lastVerdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';
    lastInvestigationId?: string;
    activeInvestigationId?: string;
    activeEscalationId?: string;
    consecutiveCriticalCount?: number;
}

export interface ScheduleHistoryEntry {
    timestamp: string;
    verdict: 'healthy' | 'warning' | 'critical' | 'error' | 'unknown';
    investigationId: string;
    summary?: string;
}
