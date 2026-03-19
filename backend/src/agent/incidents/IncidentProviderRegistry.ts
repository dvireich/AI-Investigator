import { IncidentProvider, IncidentProviderConfig } from './IncidentProvider';
import { IcmProvider } from './providers/IcmProvider';
import { PagerDutyProvider } from './providers/PagerDutyProvider';
import { ManualProvider } from './providers/ManualProvider';

type ProviderFactory = () => IncidentProvider;

const builtInFactories: Record<string, ProviderFactory> = {
    'icm': () => new IcmProvider(),
    'pagerduty': () => new PagerDutyProvider(),
    'manual': () => new ManualProvider(),
};

/**
 * Registry for incident management providers.
 */
export class IncidentProviderRegistry {
    private customFactories: Record<string, ProviderFactory> = {};
    private instances: Record<string, IncidentProvider> = {};

    register(type: string, factory: ProviderFactory): void {
        this.customFactories[type] = factory;
        delete this.instances[type];
    }

    get(type: string): IncidentProvider {
        if (this.instances[type]) return this.instances[type];

        const factory = this.customFactories[type] || builtInFactories[type];
        if (!factory) {
            throw new Error(`Unknown incident provider type: "${type}". Available: ${this.listTypes().join(', ')}`);
        }

        const instance = factory();
        this.instances[type] = instance;
        return instance;
    }

    getConfigured(config: IncidentProviderConfig): IncidentProvider {
        const provider = this.get(config.type);
        provider.configure(config);
        return provider;
    }

    listTypes(): string[] {
        const types = new Set([...Object.keys(builtInFactories), ...Object.keys(this.customFactories)]);
        return Array.from(types).sort();
    }

    listProviders(): Array<{ type: string; displayName: string }> {
        return this.listTypes().map(type => {
            const provider = this.get(type);
            return { type, displayName: provider.displayName };
        });
    }

    reset(): void {
        this.instances = {};
    }
}
