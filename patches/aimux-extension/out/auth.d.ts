import * as vscode from 'vscode';
export declare class AimuxAuth {
    private globalState;
    private apiKey;
    constructor(globalState: vscode.Memento);
    setApiKey(key: string): void;
    clearApiKey(): void;
    getApiKey(): string;
    isAuthenticated(): boolean;
    startOAuthFlow(baseUrl: string): Promise<string>;
    /**
     * Device-code flow (GitHub-CLI / Cursor style). Opens the browser to
     * aimux.id/oauth/login?code=XXXX-XXXX and polls until the user authorizes.
     * The user is usually already signed in to aimux.id via Google, so this is a
     * single click — no password, cannot be blocked by OAuth app policies.
     */
    loginWithDeviceCode(baseUrl: string): Promise<string>;
    /**
     * Direct username/password login against /api/ide/auth/login.
     * No browser, cannot be blocked by Google/GitHub app verification policies.
     */
    loginWithPassword(baseUrl: string): Promise<string>;
    private runBrowserOAuth;
    private pickProvider;
    private createCallbackServer;
}
//# sourceMappingURL=auth.d.ts.map