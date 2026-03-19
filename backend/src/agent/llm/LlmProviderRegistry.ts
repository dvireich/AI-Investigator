import { LlmProvider, LlmProviderConfig } from './LlmProvider';
import { CopilotProvider } from './providers/CopilotProvider';
import { OpenAiProvider } from './providers/OpenAiProvider';
import { AzureOpenAiProvider } from './providers/AzureOpenAiProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { OllamaProvider } from './providers/OllamaProvider';

type ProviderFactory = () => LlmProvider;

const builtInFactories: Record<string, ProviderFactory> = {
    'copilot': () => new CopilotProvider(),
    'openai': () => new OpenAiProvider(),
    'azure-openai': () => new AzureOpenAiProvider(),
    'anthropic': () => new AnthropicProvider(),
    'ollama': () => new OllamaProvider(),
};

/**
 * Registry that creates and manages LLM provider instances.
 * Providers are singletons within a registry instance — calling get() twice
 * for the same type returns the same instance.
 */
export class LlmProviderRegistry {
    private customFactories: Record<string, ProviderFactory> = {};
    private instances: Record<string, LlmProvider> = {};

    /** Register a custom provider factory. */
    register(type: string, factory: ProviderFactory): void {
        this.customFactories[type] = factory;
        delete this.instances[type]; // invalidate cached instance
    }

    /** Get or create a provider instance by type. */
    get(type: string): LlmProvider {
        if (this.instances[type]) return this.instances[type];

        const factory = this.customFactories[type] || builtInFactories[type];
        if (!factory) {
            throw new Error(`Unknown LLM provider type: "${type}". Available: ${this.listTypes().join(', ')}`);
        }

        const instance = factory();
        this.instances[type] = instance;
        return instance;
    }

    /** Get or create a provider, then configure it. */
    getConfigured(config: LlmProviderConfig): LlmProvider {
        const provider = this.get(config.type);
        provider.configure(config);
        return provider;
    }

    /** List all available provider types. */
    listTypes(): string[] {
        const types = new Set([...Object.keys(builtInFactories), ...Object.keys(this.customFactories)]);
        return Array.from(types).sort();
    }

    /** List all providers with their display names and auth requirements. */
    listProviders(): Array<{ type: string; displayName: string; authRequirement: ReturnType<LlmProvider['getAuthRequirement']> }> {
        return this.listTypes().map(type => {
            const provider = this.get(type);
            return {
                type,
                displayName: provider.displayName,
                authRequirement: provider.getAuthRequirement()
            };
        });
    }

    /** Clear cached instances (e.g. on config reload). */
    reset(): void {
        this.instances = {};
    }
}
