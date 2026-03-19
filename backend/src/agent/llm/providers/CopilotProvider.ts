import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { LlmProvider, LlmProviderConfig, AuthStatus, AuthRequirement, AuthFlowResult } from '../LlmProvider';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // VS Code Client ID for Copilot
const COPILOT_HEADERS = {
    'Editor-Version': 'vscode/1.85.1',
    'Editor-Plugin-Version': 'copilot/1.155.0',
    'User-Agent': 'GithubCopilot/1.155.0'
};

export class CopilotProvider implements LlmProvider {
    readonly type = 'copilot';
    readonly displayName = 'GitHub Copilot';

    private tokenPath: string;
    private token: string | null = null;
    private copilotApiToken: string | null = null;
    private copilotApiTokenExpiresAt: number = 0;
    private cachedClient: OpenAI | null = null;
    private cachedClientToken: string | null = null;
    private cachedClientTimeout: number | null = null;

    constructor() {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
        this.tokenPath = path.join(homeDir, '.investigation-dashboard-token');
        this.loadToken();
    }

    getAuthRequirement(): AuthRequirement {
        return { type: 'oauth-device-flow' };
    }

    configure(_config: LlmProviderConfig): void {
        // Copilot doesn't use config-based credentials — it uses the OAuth device flow
    }

    private loadToken(): void {
        if (fs.existsSync(this.tokenPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
                if (data.expires_at && Date.now() >= data.expires_at - 5 * 60 * 1000) {
                    return;
                }
                this.token = data.access_token;
            } catch {
                // corrupt token file
            }
        }
    }

    private saveToken(data: any): void {
        const toStore = { ...data };
        if (!toStore.expires_at) {
            toStore.expires_at = Date.now() + 8 * 60 * 60 * 1000;
        }
        fs.writeFileSync(this.tokenPath, JSON.stringify(toStore), { mode: 0o600 });
        this.token = data.access_token;
    }

    async startAuthFlow(): Promise<AuthFlowResult> {
        const response = await axios.post('https://github.com/login/device/code', {
            client_id: CLIENT_ID,
            scope: 'read:user'
        }, {
            headers: { 'Accept': 'application/json' }
        });
        return {
            deviceCode: response.data.device_code,
            userCode: response.data.user_code,
            verificationUri: response.data.verification_uri,
            interval: response.data.interval
        };
    }

    async pollAuthFlow(deviceCode: string): Promise<{ pending: boolean }> {
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }, {
            headers: { 'Accept': 'application/json' }
        });

        if (response.data.access_token) {
            this.saveToken(response.data);
            return { pending: false };
        }
        if (response.data.error === 'authorization_pending') {
            return { pending: true };
        }
        throw new Error(response.data.error_description || response.data.error);
    }

    async getAuthStatus(): Promise<AuthStatus> {
        if (!this.token) {
            return { authenticated: false, requiresInteractiveFlow: true };
        }
        try {
            const response = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'User-Agent': COPILOT_HEADERS['User-Agent']
                }
            });
            return {
                authenticated: true,
                username: response.data.login,
                displayName: response.data.name,
                avatarUrl: response.data.avatar_url
            };
        } catch {
            return { authenticated: false, requiresInteractiveFlow: true };
        }
    }

    private async getCopilotToken(): Promise<string> {
        if (!this.token) throw new Error('Not authenticated with GitHub');

        if (this.copilotApiToken && Date.now() < this.copilotApiTokenExpiresAt - 60_000) {
            return this.copilotApiToken;
        }

        try {
            const response = await axios.get('https://api.github.com/copilot_internal/v2/token', {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'User-Agent': COPILOT_HEADERS['User-Agent']
                }
            });
            this.copilotApiToken = response.data.token;
            this.copilotApiTokenExpiresAt = response.data.expires_at
                ? new Date(response.data.expires_at).getTime()
                : Date.now() + 30 * 60 * 1000;
            return this.copilotApiToken!;
        } catch (e: any) {
            if (e.response?.status === 401) {
                this.token = null;
                this.copilotApiToken = null;
                this.copilotApiTokenExpiresAt = 0;
                try { fs.unlinkSync(this.tokenPath); } catch { /* ignore */ }
            }
            throw new Error('Failed to get Copilot token. You may need to re-login.');
        }
    }

    async getClient(timeout?: number): Promise<OpenAI> {
        const token = await this.getCopilotToken();
        const effectiveTimeout = timeout ?? 180_000;

        if (this.cachedClient && this.cachedClientToken === token && this.cachedClientTimeout === effectiveTimeout) {
            return this.cachedClient;
        }

        this.cachedClientToken = token;
        this.cachedClientTimeout = effectiveTimeout;
        this.cachedClient = new OpenAI({
            apiKey: token,
            baseURL: 'https://api.githubcopilot.com',
            timeout: effectiveTimeout,
            defaultHeaders: COPILOT_HEADERS
        });
        return this.cachedClient;
    }

    async listModels(): Promise<string[]> {
        if (!this.token) return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];

        try {
            const token = await this.getCopilotToken();
            const response = await axios.get('https://api.githubcopilot.com/models', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    ...COPILOT_HEADERS
                }
            });
            if (response.data?.data && Array.isArray(response.data.data)) {
                return response.data.data.map((m: any) => m.id).sort();
            }
        } catch {
            // fallback
        }
        return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
    }
}
