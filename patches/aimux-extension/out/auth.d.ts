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
    private pickProvider;
    private createCallbackServer;
}
//# sourceMappingURL=auth.d.ts.map