import OpenAI from 'openai';
import axios from 'axios';
import { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement } from '../LlmProvider';

export class OllamaProvider implements LlmProvider {
    readonly type = 'ollama';
    readonly displayName = 'Ollama (Local)';

    private baseUrl: string = 'http://localhost:11434/v1';
    private cachedClient: OpenAI | null = null;
    private cachedTimeout: number | null = null;

    constructor() {
        if (process.env.OLLAMA_BASE_URL) {
            this.baseUrl = process.env.OLLAMA_BASE_URL;
        }
    }

    getAuthRequirement(): AuthRequirement {
        return { type: 'none' };
    }

    configure(config: LlmProviderConfig): void {
        if (config.baseUrl) this.baseUrl = config.baseUrl;
        this.cachedClient = null;
        this.cachedTimeout = null;
    }

    async getAuthStatus(): Promise<AuthStatus> {
        // Check if Ollama is actually running
        try {
            const ollamaRoot = this.baseUrl.replace(/\/v1\/?$/, '');
            await axios.get(ollamaRoot, { timeout: 3000 });
            return { authenticated: true, displayName: 'Ollama (running)' };
        } catch {
            return { authenticated: false, displayName: 'Ollama (not running)' };
        }
    }

    async getClient(timeout?: number): Promise<OpenAI> {
        const effectiveTimeout = timeout ?? 300_000; // Longer default for local models

        if (this.cachedClient && this.cachedTimeout === effectiveTimeout) {
            return this.cachedClient;
        }

        this.cachedTimeout = effectiveTimeout;
        this.cachedClient = new OpenAI({
            apiKey: 'ollama', // Ollama doesn't require a real key but the SDK needs one
            baseURL: this.baseUrl,
            timeout: effectiveTimeout
        });
        return this.cachedClient;
    }

    async listModels(): Promise<string[]> {
        try {
            const ollamaRoot = this.baseUrl.replace(/\/v1\/?$/, '');
            const response = await axios.get(`${ollamaRoot}/api/tags`, { timeout: 5000 });
            if (response.data?.models && Array.isArray(response.data.models)) {
                return response.data.models.map((m: any) => m.name).sort();
            }
        } catch {
            // Ollama not running or error
        }
        return [];
    }
}
