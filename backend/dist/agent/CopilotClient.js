"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotClient = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // VS Code Client ID for Copilot
const SCOPE = 'read:user'; // Minimal scope, usually sufficient for Copilot if using the right client ID? 
// Actually, for Copilot specifically, we might need to handle the token exchange carefully.
// Standard GitHub Device Flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
class CopilotClient {
    constructor() {
        this.token = null;
        // Persist token in user's home dir or similar
        const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
        this.tokenPath = path.join(homeDir, '.teleduct-copilot-token');
        this.loadToken();
    }
    loadToken() {
        if (fs.existsSync(this.tokenPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
                // TODO: Check expiration
                this.token = data.access_token;
            }
            catch (e) {
                console.error("Failed to load token", e);
            }
        }
    }
    saveToken(data) {
        fs.writeFileSync(this.tokenPath, JSON.stringify(data));
        this.token = data.access_token;
    }
    // 1. Initiate Device Flow
    async startAuth() {
        const response = await axios_1.default.post('https://github.com/login/device/code', {
            client_id: CLIENT_ID,
            scope: 'read:user' // copilot scope is implicit for this client ID usually
        }, {
            headers: { 'Accept': 'application/json' }
        });
        return response.data; // { device_code, user_code, verification_uri, interval, ... }
    }
    // 2. Poll for Token
    async pollToken(deviceCode, interval) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const poller = setInterval(async () => {
                if (Date.now() - start > 15 * 60 * 1000) { // 15 min timeout
                    clearInterval(poller);
                    reject(new Error('Timeout'));
                    return;
                }
                try {
                    const response = await axios_1.default.post('https://github.com/login/oauth/access_token', {
                        client_id: CLIENT_ID,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    }, {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (response.data.access_token) {
                        clearInterval(poller);
                        this.saveToken(response.data);
                        resolve(response.data);
                    }
                    else if (response.data.error !== 'authorization_pending') {
                        clearInterval(poller);
                        reject(new Error(response.data.error_description || response.data.error));
                    }
                    // Else continue polling
                }
                catch (e) {
                    // Ignore transient network errors
                }
            }, (interval + 1) * 1000);
        });
    }
    async getCopilotToken() {
        if (!this.token)
            throw new Error("Not authenticated with GitHub");
        // We need to exchange the GitHub Oauth token for a specific Copilot Token
        // Endpoint: https://api.github.com/copilot_internal/v2/token
        // Headers: Authorization: token <gh_token>
        try {
            const response = await axios_1.default.get('https://api.github.com/copilot_internal/v2/token', {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'User-Agent': 'GithubCopilot/1.155.0' // Mimic VS Code
                }
            });
            return response.data.token;
        }
        catch (e) {
            console.error("Failed to get Copilot token:", e.response?.data || e.message);
            throw new Error("Failed to get Copilot token. You may need to re-login.");
        }
    }
    async listModels() {
        if (!this.token)
            return ['gpt-4', 'gpt-3.5-turbo']; // Fallback if not auth
        try {
            const token = await this.getCopilotToken();
            const response = await axios_1.default.get('https://api.githubcopilot.com/models', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'GithubCopilot/1.155.0',
                    'Editor-Version': 'vscode/1.85.1',
                    'Editor-Plugin-Version': 'copilot/1.155.0'
                }
            });
            if (response.data && Array.isArray(response.data.data)) {
                return response.data.data.map((m) => m.id).sort();
            }
            return ['gpt-4', 'gpt-3.5-turbo'];
        }
        catch (e) {
            console.error("Failed to fetch models from Copilot API", e);
            // Fallback to known robust list
            return ['gpt-4', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
        }
    }
    async isAuthenticated() {
        return !!this.token;
    }
}
exports.CopilotClient = CopilotClient;
