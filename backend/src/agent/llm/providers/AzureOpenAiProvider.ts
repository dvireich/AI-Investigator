import OpenAI from 'openai';
import { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement } from '../LlmProvider';

export class AzureOpenAiProvider implements LlmProvider {
    readonly type = 'azure-openai';
    readonly displayName = 'Azure OpenAI';

    private apiKey: string | null = null;
    private baseUrl: string | null = null;
    private apiVersion: string = '2024-06-01';
    private cachedClient: OpenAI | null = null;
    private cachedTimeout: number | null = null;

    constructor() {
        if (process.env.AZURE_OPENAI_API_KEY) this.apiKey = process.env.AZURE_OPENAI_API_KEY;
        if (process.env.AZURE_OPENAI_ENDPOINT) this.baseUrl = process.env.AZURE_OPENAI_ENDPOINT;
    }

    getAuthRequirement(): AuthRequirement {
        return { type: 'api-key-and-endpoint' };
    }

    configure(config: LlmProviderConfig): void {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.baseUrl) this.baseUrl = config.baseUrl;
        if (config.apiVersion) this.apiVersion = config.apiVersion;
        this.cachedClient = null;
    }

    async getAuthStatus(): Promise<AuthStatus> {
        return {
            authenticated: !!(this.apiKey && this.baseUrl),
            displayName: 'Azure OpenAI'
        };
    }

    async getClient(timeout?: number): Promise<OpenAI> {
        if (!this.apiKey) throw new Error('Azure OpenAI API key not configured.');
        if (!this.baseUrl) throw new Error('Azure OpenAI endpoint not configured.');
        const effectiveTimeout = timeout ?? 180_000;

        if (this.cachedClient && this.cachedTimeout === effectiveTimeout) {
            return this.cachedClient;
        }

        this.cachedTimeout = effectiveTimeout;
        this.cachedClient = new OpenAI({
            apiKey: this.apiKey,
            baseURL: this.baseUrl,
            timeout: effectiveTimeout,
            defaultQuery: { 'api-version': this.apiVersion }
        });
        return this.cachedClient;
    }

    async listModels(): Promise<string[]> {
        // Azure OpenAI doesn't have a standard models list endpoint —
        // deployments are custom. Return common deployment names.
        return ['gpt-4o', 'gpt-4', 'gpt-4-turbo', 'gpt-35-turbo'];
    }
}
