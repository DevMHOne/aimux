import * as vscode from 'vscode';
export declare class AimuxStatusBar {
    private context;
    private statusBarItem;
    private modelStatusBarItem;
    private connected;
    private model;
    constructor(context: vscode.ExtensionContext);
    register(): void;
    setConnected(model?: string): void;
    setDisconnected(): void;
    private updateDisplay;
    dispose(): void;
}
//# sourceMappingURL=statusBar.d.ts.map