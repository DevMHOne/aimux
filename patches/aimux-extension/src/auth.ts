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
            `${apiBase}/api/admin/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        parseCallback: (query) => query.api_key || query.token || null,
    },
    {
        name: 'GitHub',
        getAuthUrl: (redirectUri: string, state: string) =>
            `${apiBase}/api/admin/auth/github/url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
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

        // Pick provider
        const provider = await this.pickProvider();
        if (!provider) {
            throw new Error('Sign in cancelled');
        }

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
