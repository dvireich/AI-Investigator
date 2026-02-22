
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // VS Code Client ID for Copilot
const SCOPE = 'read:user'; // Minimal scope, usually sufficient for Copilot if using the right client ID? 
// Actually, for Copilot specifically, we might need to handle the token exchange carefully.
// Standard GitHub Device Flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export class CopilotClient {
    private tokenPath: string;
    private token: string | null = null;
    private copilotApiToken: string | null = null;
    private copilotApiTokenExpiresAt: number = 0;

    constructor() {
        // Persist token in user's home dir or similar
        const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
        this.tokenPath = path.join(homeDir, '.investigation-dashboard-token');
        this.loadToken();
    }

    private loadToken() {
        if (fs.existsSync(this.tokenPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
                // Check expiration — reject tokens within 5 minutes of expiry
                if (data.expires_at && Date.now() >= data.expires_at - 5 * 60 * 1000) {
                    console.log('Stored token is expired or about to expire, ignoring.');
                    return;
                }
                this.token = data.access_token;
            } catch (e) {
                console.error("Failed to load token", e);
            }
        }
    }

    private saveToken(data: any) {
        // Persist expires_at so loadToken can check expiration
        const toStore = { ...data };
        if (!toStore.expires_at) {
            // Default: 8-hour lifetime if the OAuth response doesn't include one
            toStore.expires_at = Date.now() + 8 * 60 * 60 * 1000;
        }
        fs.writeFileSync(this.tokenPath, JSON.stringify(toStore), { mode: 0o600 });
        this.token = data.access_token;
    }

    // 1. Initiate Device Flow
    async startAuth() {
        const response = await axios.post('https://github.com/login/device/code', {
            client_id: CLIENT_ID,
            scope: 'read:user' // copilot scope is implicit for this client ID usually
        }, {
            headers: { 'Accept': 'application/json' }
        });
        return response.data; // { device_code, user_code, verification_uri, interval, ... }
    }

    // 2. Single-shot token check — client-side is responsible for polling
    async checkToken(deviceCode: string): Promise<{ pending: boolean; result?: any }> {
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }, {
            headers: { 'Accept': 'application/json' }
        });

        if (response.data.access_token) {
            this.saveToken(response.data);
            return { pending: false, result: response.data };
        }

        if (response.data.error === 'authorization_pending') {
            return { pending: true };
        }

        throw new Error(response.data.error_description || response.data.error);
    }

    async getCopilotToken(): Promise<string> {
        if (!this.token) throw new Error("Not authenticated with GitHub");

        // Return cached Copilot API token if still valid (>60s from expiry)
        if (this.copilotApiToken && Date.now() < this.copilotApiTokenExpiresAt - 60_000) {
            return this.copilotApiToken!;
        }

        // We need to exchange the GitHub Oauth token for a specific Copilot Token
        // Endpoint: https://api.github.com/copilot_internal/v2/token
        // Headers: Authorization: token <gh_token>

        try {
            const response = await axios.get('https://api.github.com/copilot_internal/v2/token', {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'User-Agent': 'GithubCopilot/1.155.0' // Mimic VS Code
                }
            });
            // Cache the token with its expiry (default 30 min if not provided)
            this.copilotApiToken = response.data.token;
            this.copilotApiTokenExpiresAt = response.data.expires_at
                ? new Date(response.data.expires_at).getTime()
                : Date.now() + 30 * 60 * 1000;
            return this.copilotApiToken!;
        } catch (e: any) {
            // If 401, the stored OAuth token is revoked/expired — clear it
            if (e.response?.status === 401) {
                console.error('Copilot token exchange returned 401 — clearing stored token.');
                this.token = null;
                this.copilotApiToken = null;
                this.copilotApiTokenExpiresAt = 0;
                try { fs.unlinkSync(this.tokenPath); } catch { /* ignore */ }
            }
            console.error("Failed to get Copilot token:", e.response?.data || e.message);
            throw new Error("Failed to get Copilot token. You may need to re-login.");
        }
    }

    async listModels(): Promise<string[]> {
        if (!this.token) return ['gpt-4', 'gpt-3.5-turbo']; // Fallback if not auth

        try {
            const token = await this.getCopilotToken();
            const response = await axios.get('https://api.githubcopilot.com/models', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'GithubCopilot/1.155.0',
                    'Editor-Version': 'vscode/1.85.1',
                    'Editor-Plugin-Version': 'copilot/1.155.0'
                }
            });

            if (response.data && Array.isArray(response.data.data)) {
                return response.data.data.map((m: any) => m.id).sort();
            }
            return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
        } catch (e) {
            console.error("Failed to fetch models from Copilot API", e);
            // Fallback to known robust list
            return ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
        }
    }

    async isAuthenticated() {
        return !!this.token;
    }
}
