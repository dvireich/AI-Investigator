/**
 * Standard incident data returned by any incident provider.
 */
export interface IncidentData {
    id: string;
    title: string;
    severity?: string;
    status?: string;
    owner?: string;
    owningTeam?: string;
    createdAt?: string;
    mitigatedAt?: string;
    summary?: string;
    /** The target system/resource affected. */
    target?: string;
    /** Suggested time range for investigation. */
    timeRange?: string;
    /** Raw content/description of the incident. */
    content?: string;
    /** Provider-specific extra fields. */
    customFields?: Record<string, any>;
}

/**
 * Progress event emitted during incident fetch (for streaming to client via SSE).
 */
export interface IncidentProgressEvent {
    type: 'progress' | 'data' | 'error' | 'done';
    step?: string;
    status?: string;
    detail?: string;
    key?: string;
    value?: any;
}

/**
 * Configuration for an incident provider.
 */
export interface IncidentProviderConfig {
    type: string;
    apiKey?: string;
    baseUrl?: string;
    /** Path to provider-specific scripts directory (e.g. IcM scripts). */
    scriptsPath?: string;
    /** Provider-specific extra config. */
    [key: string]: any;
}

/**
 * Unified interface for incident management integrations.
 */
export interface IncidentProvider {
    /** Provider type identifier (e.g. 'icm', 'pagerduty', 'manual'). */
    readonly type: string;

    /** Human-readable display name. */
    readonly displayName: string;

    /** Check if this provider is available (dependencies installed, configured, etc.). */
    isAvailable(): Promise<boolean>;

    /** Configure the provider. */
    configure(config: IncidentProviderConfig): void;

    /**
     * Fetch incident data by ID, with progress callbacks for SSE streaming.
     */
    fetchIncident(id: string, onProgress?: (event: IncidentProgressEvent) => void): Promise<IncidentData>;
}
