import OpenAI from 'openai';
import { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement } from '../LlmProvider';

/**
 * Anthropic provider using the OpenAI-compatible API endpoint.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/openai-sdk
 */
export class AnthropicProvider implements LlmProvider {
    readonly type = 'anthropic';
    readonly displayName = 'Anthropic (Claude)';

    private apiKey: string | null = null;
    private baseUrl: string = 'https://api.anthropic.com/v1/';
    private cachedClient: OpenAI | null = null;
    private cachedTimeout: number | null = null;

    constructor() {
        if (process.env.ANTHROPIC_API_KEY) this.apiKey = process.env.ANTHROPIC_API_KEY;
    }

    getAuthRequirement(): AuthRequirement {
        return { type: 'api-key', envVar: 'ANTHROPIC_API_KEY' };
    }

    configure(config: LlmProviderConfig): void {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.baseUrl) this.baseUrl = config.baseUrl;
        this.cachedClient = null;
    }

    async getAuthStatus(): Promise<AuthStatus> {
        return {
            authenticated: !!this.apiKey,
            displayName: 'Anthropic API Key'
        };
    }

    async getClient(timeout?: number): Promise<OpenAI> {
        if (!this.apiKey) throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY or configure via settings.');
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
        return [
            'claude-sonnet-4-20250514',
            'claude-opus-4-20250514',
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229'
        ];
    }
}
