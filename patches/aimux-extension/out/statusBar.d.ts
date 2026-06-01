import * as vscode from 'vscode';
export interface AimuxProfile {
    name?: string;
    email?: string;
    role?: string;
}
export declare class AimuxStatusBar {
    private context;
    private modelItem;
    private accountItem;
    private connected;
    private model;
    private profile;
    constructor(context: vscode.ExtensionContext);
    register(): void;
    setConnected(model?: string, profile?: AimuxProfile): void;
    setProfile(profile: AimuxProfile): void;
    setDisconnected(): void;
    getProfile(): AimuxProfile;
    private profileLabel;
    private updateDisplay;
    dispose(): void;
}
//# sourceMappingURL=statusBar.d.ts.map