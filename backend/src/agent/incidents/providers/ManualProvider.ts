import { IncidentProvider, IncidentProviderConfig, IncidentData } from '../IncidentProvider';

/**
 * Manual/no-op incident provider.
 * Used when no incident management system is configured.
 * Users create investigations by filling in all fields manually.
 */
export class ManualProvider implements IncidentProvider {
    readonly type = 'manual';
    readonly displayName = 'Manual (no provider)';

    configure(_config: IncidentProviderConfig): void {
        // no-op
    }

    async isAvailable(): Promise<boolean> {
        return false; // Manual provider is always "unavailable" — it hides the incident input
    }

    async fetchIncident(id: string): Promise<IncidentData> {
        return {
            id,
            title: `Manual Incident ${id}`,
            summary: 'No incident provider configured. Please fill in investigation details manually.'
        };
    }
}
