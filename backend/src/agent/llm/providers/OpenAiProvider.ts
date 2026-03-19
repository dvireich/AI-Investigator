import OpenAI from 'openai';
import { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement } from '../LlmProvider';

export class OpenAiProvider implements LlmProvider {
    readonly type = 'openai';
    readonly displayName = 'OpenAI';

    private apiKey: string | null = null;
    private baseUrl: string = 'https://api.openai.com/v1';
    private cachedClient: OpenAI | null = null;
    private cachedTimeout: number | null = null;

    constructor() {
        // Auto-load from environment variable if available
        if (process.env.OPENAI_API_KEY) {
            this.apiKey = process.env.OPENAI_API_KEY;
        }
    }

    getAuthRequirement(): AuthRequirement {
        return { type: 'api-key', envVar: 'OPENAI_API_KEY' };
    }

    configure(config: LlmProviderConfig): void {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.baseUrl) this.baseUrl = config.baseUrl;
        this.cachedClient = null; // invalidate
    }

    async getAuthStatus(): Promise<AuthStatus> {
        return {
            authenticated: !!this.apiKey,
            displayName: 'OpenAI API Key'
        };
    }

    async getClient(timeout?: number): Promise<OpenAI> {
        if (!this.apiKey) throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY or configure via settings.');
        const effectiveTimeout = timeout ?? 180_000;

        if (this.cachedClient && this.cachedTimeout === effectiveTimeout) {
            return this.cachedClient;
        }

        this.cachedTimeout = effectiveTimeout;
        this.cachedClient = new OpenAI({
            apiKey: this.apiKey,
            baseURL: this.baseUrl,
            timeout: effectiveTimeout
        });
        return this.cachedClient;
    }

    async listModels(): Promise<string[]> {
        if (!this.apiKey) return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];

        try {
            const client = await this.getClient();
            const response = await client.models.list();
            const models: string[] = [];
            for await (const model of response) {
                if (model.id.startsWith('gpt-') || model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) {
                    models.push(model.id);
                }
            }
            return models.sort();
        } catch {
            return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        }
    }
}
