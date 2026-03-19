import OpenAI from 'openai';

/**
 * Authentication status returned by a provider.
 */
export interface AuthStatus {
    authenticated: boolean;
    username?: string;
    avatarUrl?: string;
    displayName?: string;
    /** If the provider requires an interactive auth flow (e.g. OAuth device code). */
    requiresInteractiveFlow?: boolean;
}

/**
 * Result of initiating an interactive auth flow (e.g. GitHub device code).
 */
export interface AuthFlowResult {
    deviceCode?: string;
    userCode?: string;
    verificationUri?: string;
    interval?: number;
}

/**
 * Describes what kind of authentication a provider needs.
 */
export type AuthRequirement =
    | { type: 'none' }                          // Ollama — no auth needed
    | { type: 'api-key'; envVar?: string }      // OpenAI, Anthropic — API key
    | { type: 'api-key-and-endpoint' }          // Azure OpenAI — key + endpoint
    | { type: 'oauth-device-flow' };            // GitHub Copilot — interactive

/**
 * Configuration blob for an LLM provider. Shape varies by provider type.
 */
export interface LlmProviderConfig {
    type: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    /** Azure OpenAI specific */
    apiVersion?: string;
    /** Additional headers to include on every request */
    headers?: Record<string, string>;
}

/**
 * Unified interface for all LLM providers.
 * Every provider produces an OpenAI SDK-compatible client.
 */
export interface LlmProvider {
    /** Provider type identifier (e.g. 'copilot', 'openai', 'ollama'). */
    readonly type: string;

    /** Human-readable display name (e.g. "GitHub Copilot", "OpenAI"). */
    readonly displayName: string;

    /** Describes what auth this provider requires. */
    getAuthRequirement(): AuthRequirement;

    /** Configure the provider with credentials / settings. */
    configure(config: LlmProviderConfig): void;

    /** Check current authentication status. */
    getAuthStatus(): Promise<AuthStatus>;

    /**
     * Start an interactive auth flow (only for providers with type 'oauth-device-flow').
     * Returns flow details the frontend can display.
     */
    startAuthFlow?(): Promise<AuthFlowResult>;

    /**
     * Poll an in-progress interactive auth flow.
     * Returns `{ pending: true }` while waiting, or `{ pending: false }` on success.
     */
    pollAuthFlow?(deviceCode: string): Promise<{ pending: boolean }>;

    /**
     * Return an OpenAI SDK client configured for this provider.
     * The client can be used with the standard chat completions API.
     * @param timeout - per-request timeout in milliseconds
     */
    getClient(timeout?: number): Promise<OpenAI>;

    /** List available models from this provider. */
    listModels(): Promise<string[]>;
}
