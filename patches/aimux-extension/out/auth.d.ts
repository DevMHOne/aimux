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
     * Direct username/password login against /api/ide/auth/login.
     * No browser, cannot be blocked by Google/GitHub app verification policies.
     */
    loginWithPassword(baseUrl: string): Promise<string>;
    private runBrowserOAuth;
    private pickProvider;
    private createCallbackServer;
}
//# sourceMappingURL=auth.d.ts.map