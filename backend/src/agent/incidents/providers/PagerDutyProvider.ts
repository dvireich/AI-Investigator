import { IncidentProvider, IncidentProviderConfig, IncidentData, IncidentProgressEvent } from '../IncidentProvider';

/**
 * PagerDuty incident provider stub.
 * Provides the interface structure — implement fetchIncident with the PagerDuty REST API.
 */
export class PagerDutyProvider implements IncidentProvider {
    readonly type = 'pagerduty';
    readonly displayName = 'PagerDuty';

    private apiKey: string | null = null;
    private baseUrl: string = 'https://api.pagerduty.com';

    configure(config: IncidentProviderConfig): void {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.baseUrl) this.baseUrl = config.baseUrl;
    }

    async isAvailable(): Promise<boolean> {
        return !!this.apiKey;
    }

    async fetchIncident(id: string, onProgress?: (event: IncidentProgressEvent) => void): Promise<IncidentData> {
        if (!this.apiKey) throw new Error('PagerDuty API key not configured.');

        onProgress?.({ type: 'progress', step: 'fetch', status: 'running', detail: 'Fetching PagerDuty incident...' });

        // TODO: Implement PagerDuty REST API call
        // GET https://api.pagerduty.com/incidents/{id}
        // Headers: Authorization: Token token=${this.apiKey}
        throw new Error(`PagerDuty provider not yet implemented. Incident ID: ${id}`);
    }
}
