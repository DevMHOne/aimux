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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AimuxAuth = void 0;
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const PROVIDERS = [
    {
        name: 'Google',
        getAuthUrl: (redirectUri, state) => `${apiBase}/api/ide/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
        parseCallback: (query) => query.api_key || query.token || null,
    },
    {
        name: 'GitHub',
        getAuthUrl: (redirectUri, state) => `${apiBase}/api/ide/auth/github/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
        parseCallback: (query) => query.api_key || query.token || null,
    },
];
let apiBase = 'https://aimux.id';
class AimuxAuth {
    globalState;
    apiKey = '';
    constructor(globalState) {
        this.globalState = globalState;
        this.apiKey = globalState.get('aimux.apiKey', '');
    }
    setApiKey(key) {
        this.apiKey = key;
        this.globalState.update('aimux.apiKey', key);
    }
    clearApiKey() {
        this.apiKey = '';
        this.globalState.update('aimux.apiKey', '');
    }
    getApiKey() {
        return this.apiKey;
    }
    isAuthenticated() {
        return this.apiKey.length > 0;
    }
    async startOAuthFlow(baseUrl) {
        apiBase = baseUrl;
        // Let the user choose how to sign in. "Aimux Account" (email + password)
        // is the primary, recommended method: no browser, no third-party app
        // policies, and it binds directly to the user's Aimux account so models,
        // balance, and API keys all resolve correctly.
        const choice = await vscode.window.showQuickPick([
            {
                label: '$(account) Aimux Account',
                description: 'Sign in with your Aimux email & password (recommended)',
                id: 'password',
            },
            {
                label: '$(globe) Google',
                description: 'Sign in with Google (opens browser)',
                id: 'google',
            },
            {
                label: '$(github) GitHub',
                description: 'Sign in with GitHub (opens browser)',
                id: 'github',
            },
        ], {
            placeHolder: 'How would you like to sign in to Aimux?',
            title: 'Aimux: Sign In',
        });
        if (!choice) {
            throw new Error('Sign in cancelled');
        }
        if (choice.id === 'password') {
            return this.loginWithPassword(baseUrl);
        }
        const provider = PROVIDERS.find(p => p.name.toLowerCase() === choice.id);
        if (!provider) {
            throw new Error('Sign in cancelled');
        }
        return this.runBrowserOAuth(provider);
    }
    /**
     * Direct username/password login against /api/ide/auth/login.
     * No browser, cannot be blocked by Google/GitHub app verification policies.
     */
    async loginWithPassword(baseUrl) {
        apiBase = baseUrl;
        const login = await vscode.window.showInputBox({
            title: 'Aimux: Sign In (1/2)',
            prompt: 'Enter your Aimux email or username',
            placeHolder: 'you@example.com',
            ignoreFocusOut: true,
            validateInput: (v) => (v && v.trim().length > 0 ? null : 'Email or username is required'),
        });
        if (login === undefined) {
            throw new Error('Sign in cancelled');
        }
        const password = await vscode.window.showInputBox({
            title: 'Aimux: Sign In (2/2)',
            prompt: 'Enter your Aimux password',
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => (v && v.length > 0 ? null : 'Password is required'),
        });
        if (password === undefined) {
            throw new Error('Sign in cancelled');
        }
        const resp = await postToAimux(`${apiBase}/api/ide/auth/login`, {
            login: login.trim(),
            password,
        });
        const token = resp && (resp.token || resp.api_key);
        if (!token) {
            const detail = (resp && (resp.detail || resp.error || resp.message)) || 'Login failed';
            throw new Error(typeof detail === 'string' ? detail : 'Login failed');
        }
        return token;
    }
    async runBrowserOAuth(provider) {
        // Start local server for OAuth callback
        const { server, port, promise } = this.createCallbackServer();
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const state = crypto.randomBytes(16).toString('hex');
        try {
            // Fetch auth URL from Aimux
            const authUrlResponse = await fetchFromAimux(provider.getAuthUrl(redirectUri, state));
            let authUrl = '';
            if (typeof authUrlResponse === 'string') {
                authUrl = authUrlResponse;
            }
            else if (authUrlResponse && typeof authUrlResponse === 'object') {
                // Response might be { url: "..." } or { redirect_url: "..." }
                authUrl = authUrlResponse.url
                    || authUrlResponse.redirect_url
                    || authUrlResponse.auth_url
                    || '';
            }
            if (!authUrl) {
                throw new Error('Could not obtain OAuth URL from Aimux');
            }
            // Open browser
            vscode.env.openExternal(vscode.Uri.parse(authUrl));
            // Wait for callback
            const callbackData = await promise;
            if (callbackData.state !== state) {
                throw new Error('OAuth state mismatch — possible CSRF attack');
            }
            // Extract API key
            const apiKey = provider.parseCallback(callbackData.query);
            if (!apiKey) {
                throw new Error('No API key received from OAuth callback');
            }
            return apiKey;
        }
        finally {
            server.close();
        }
    }
    async pickProvider() {
        const items = PROVIDERS.map(p => ({
            label: p.name,
            description: `Sign in with ${p.name}`,
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Choose sign-in provider',
            title: 'Aimux: Sign In',
        });
        if (!selected) {
            return null;
        }
        return PROVIDERS.find(p => p.name === selected.label) || null;
    }
    createCallbackServer() {
        let resolvePromise;
        let rejectPromise;
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });
        const server = http.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://127.0.0.1`);
            if (url.pathname === '/callback') {
                const query = {};
                url.searchParams.forEach((value, key) => {
                    query[key] = value;
                });
                // Send response to browser
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head><title>Aimux — Signed In</title>
                    <style>
                        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
                               align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
                        .card { text-align: center; padding: 3rem; border-radius: 12px;
                                background: #16213e; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
                        h1 { color: #00d2ff; margin-bottom: 0.5rem; }
                        p { color: #aaa; margin-top: 0.5rem; }
                    </style>
                    </head>
                    <body>
                        <div class="card">
                            <h1>✓ Signed in to Aimux</h1>
                            <p>You can close this tab and return to your editor.</p>
                        </div>
                    </body>
                    </html>
                `);
                resolvePromise({
                    query,
                    state: query.state || '',
                });
            }
            else {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        // Try ports 3210–3220
        let port = 3210;
        const maxAttempts = 10;
        const tryListen = (attempt) => {
            if (attempt >= maxAttempts) {
                rejectPromise(new Error('Could not find available port for OAuth callback'));
                return;
            }
            server.listen(port, '127.0.0.1', () => {
                // Success — port is listening
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    port++;
                    server.removeAllListeners('error');
                    tryListen(attempt + 1);
                }
                else {
                    rejectPromise(err);
                }
            });
        };
        tryListen(0);
        return { server, port, promise };
    }
}
exports.AimuxAuth = AimuxAuth;
async function fetchFromAimux(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');
        const req = protocol.get(url, { headers: { Accept: 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('OAuth request timed out'));
        });
    });
}
async function postToAimux(url, payload) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');
        const body = JSON.stringify(payload);
        const u = new URL(url);
        const options = {
            method: 'POST',
            hostname: u.hostname,
            port: u.port || (url.startsWith('https') ? 443 : 80),
            path: u.pathname + u.search,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve({ detail: data || `HTTP ${res.statusCode}` });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Login request timed out'));
        });
        req.write(body);
        req.end();
    });
}
//# sourceMappingURL=auth.js.map