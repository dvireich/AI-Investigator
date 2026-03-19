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
    createdBy?: string;
    createdAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
    lastVerdict?: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    lastInvestigationId?: string;
    activeInvestigationId?: string;
    activeEscalationId?: string;
    consecutiveCriticalCount?: number;
}

export interface ScheduleHistoryEntry {
    timestamp: string;
    verdict: 'healthy' | 'warning' | 'critical' | 'error' | 'paused' | 'completed' | 'unknown';
    investigationId: string;
    summary?: string;
}
