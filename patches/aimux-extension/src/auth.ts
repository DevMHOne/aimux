import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

interface OAuthProvider {
    name: string;
    getAuthUrl: (redirectUri: string, state: string) => string;
    parseCallback: (query: Record<string, string>) => string | null;
}

const PROVIDERS: OAuthProvider[] = [
    {
        name: 'Google',
        getAuthUrl: (redirectUri: string, state: string) =>
            `${apiBase}/api/ide/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
        parseCallback: (query) => query.api_key || query.token || null,
    },
    {
        name: 'GitHub',
        getAuthUrl: (redirectUri: string, state: string) =>
            `${apiBase}/api/ide/auth/github/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
        parseCallback: (query) => query.api_key || query.token || null,
    },
];

let apiBase = 'https://aimux.id';

export class AimuxAuth {
    private apiKey: string = '';

    constructor(private globalState: vscode.Memento) {
        this.apiKey = globalState.get<string>('aimux.apiKey', '');
    }

    setApiKey(key: string): void {
        this.apiKey = key;
        this.globalState.update('aimux.apiKey', key);
    }

    clearApiKey(): void {
        this.apiKey = '';
        this.globalState.update('aimux.apiKey', '');
    }

    getApiKey(): string {
        return this.apiKey;
    }

    isAuthenticated(): boolean {
        return this.apiKey.length > 0;
    }

    async startOAuthFlow(baseUrl: string): Promise<string> {
        apiBase = baseUrl;

        // Let the user choose how to sign in. "Aimux Account" (device code) is the
        // primary, recommended method: opens aimux.id in the browser (where the user
        // is typically already logged in via Google), they click Authorize once, and
        // the IDE logs in automatically by polling. No password typed in the editor,
        // and it can never be blocked by Google/GitHub app-verification policies.
        const choice = await vscode.window.showQuickPick(
            [
                {
                    label: '$(account) Sign in with Aimux',
                    description: 'Opens aimux.id — authorize once, logs in automatically (recommended)',
                    id: 'device',
                },
                {
                    label: '$(key) Email & password',
                    description: 'Sign in with your Aimux email & password',
                    id: 'password',
                },
            ],
            {
                placeHolder: 'How would you like to sign in to Aimux?',
                title: 'Aimux: Sign In',
            }
        );

        if (!choice) {
            throw new Error('Sign in cancelled');
        }

        if (choice.id === 'password') {
            return this.loginWithPassword(baseUrl);
        }
        return this.loginWithDeviceCode(baseUrl);
    }

    /**
     * Device-code flow (GitHub-CLI / Cursor style). Opens the browser to
     * aimux.id/oauth/login?code=XXXX-XXXX and polls until the user authorizes.
     * The user is usually already signed in to aimux.id via Google, so this is a
     * single click — no password, cannot be blocked by OAuth app policies.
     */
    async loginWithDeviceCode(baseUrl: string): Promise<string> {
        apiBase = baseUrl;

        // 1. Request a device + user code
        const start = await postToAimux(`${apiBase}/api/ide/auth/device/code`, {});
        const deviceCode = start && start.device_code;
        const userCode = start && start.user_code;
        const verifyUrl = (start && (start.verification_uri_complete || start.verification_uri)) || `${apiBase}/oauth/login`;
        const interval = Math.max(2, Number(start && start.interval) || 4);
        const expiresIn = Number(start && start.expires_in) || 600;
        if (!deviceCode || !userCode) {
            throw new Error('Could not start device login');
        }

        // 2. Show the code and open the browser
        const openChoice = await vscode.window.showInformationMessage(
            `Aimux sign-in code: ${userCode}\n\nA browser will open to authorize this code. Keep this code visible.`,
            { modal: true },
            'Open Browser & Authorize'
        );
        if (openChoice !== 'Open Browser & Authorize') {
            throw new Error('Sign in cancelled');
        }
        vscode.env.openExternal(vscode.Uri.parse(verifyUrl));

        // 3. Poll for authorization
        const deadline = Date.now() + expiresIn * 1000;
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Aimux: waiting for authorization (code ${userCode})…`,
                cancellable: true,
            },
            async (_progress, token): Promise<string> => {
                while (Date.now() < deadline) {
                    if (token.isCancellationRequested) {
                        throw new Error('Sign in cancelled');
                    }
                    await delay(interval * 1000);
                    let resp: any;
                    try {
                        resp = await postToAimux(`${apiBase}/api/ide/auth/device/token`, { device_code: deviceCode });
                    } catch {
                        continue; // transient network error — keep polling
                    }
                    const status = resp && resp.status;
                    if (status === 'authorized' && resp.token) {
                        return resp.token as string;
                    }
                    if (status === 'access_denied') {
                        throw new Error('Authorization was denied');
                    }
                    if (status === 'expired_token') {
                        throw new Error('Code expired — please try again');
                    }
                    // authorization_pending → keep polling
                }
                throw new Error('Sign in timed out — please try again');
            }
        );
    }

    /**
     * Direct username/password login against /api/ide/auth/login.
     * No browser, cannot be blocked by Google/GitHub app verification policies.
     */
    async loginWithPassword(baseUrl: string): Promise<string> {
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

    private async runBrowserOAuth(provider: OAuthProvider): Promise<string> {
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
            } else if (authUrlResponse && typeof authUrlResponse === 'object') {
                // Response might be { url: "..." } or { redirect_url: "..." }
                authUrl = (authUrlResponse as any).url
                    || (authUrlResponse as any).redirect_url
                    || (authUrlResponse as any).auth_url
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
        } finally {
            server.close();
        }
    }

    private async pickProvider(): Promise<OAuthProvider | null> {
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

    private createCallbackServer(): {
        server: http.Server;
        port: number;
        promise: Promise<{ query: Record<string, string>; state: string }>;
    } {
        let resolvePromise: (data: { query: Record<string, string>; state: string }) => void;
        let rejectPromise: (err: Error) => void;

        const promise = new Promise<{ query: Record<string, string>; state: string }>((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });

        const server = http.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://127.0.0.1`);

            if (url.pathname === '/callback') {
                const query: Record<string, string> = {};
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
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        // Try ports 3210–3220
        let port = 3210;
        const maxAttempts = 10;

        const tryListen = (attempt: number): void => {
            if (attempt >= maxAttempts) {
                rejectPromise(new Error('Could not find available port for OAuth callback'));
                return;
            }

            server.listen(port, '127.0.0.1', () => {
                // Success — port is listening
            });

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    port++;
                    server.removeAllListeners('error');
                    tryListen(attempt + 1);
                } else {
                    rejectPromise(err);
                }
            });
        };

        tryListen(0);

        return { server, port, promise };
    }
}

async function fetchFromAimux(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');
        const req = protocol.get(url, { headers: { Accept: 'application/json' } }, (res: http.IncomingMessage) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
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

async function postToAimux(url: string, payload: any): Promise<any> {
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
        const req = protocol.request(options, (res: http.IncomingMessage) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
