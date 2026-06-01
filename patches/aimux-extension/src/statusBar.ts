import * as vscode from 'vscode';

export interface AimuxProfile {
    name?: string;
    email?: string;
    role?: string;
}

export class AimuxStatusBar {
    private modelItem: vscode.StatusBarItem;
    private accountItem: vscode.StatusBarItem;
    private connected: boolean = false;
    private model: string = '';
    private profile: AimuxProfile = {};

    constructor(private context: vscode.ExtensionContext) {
        // Model indicator (click → select model)
        this.modelItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.modelItem.command = 'aimux.selectModel';
        this.modelItem.tooltip = 'Aimux AI — Click to select model';

        // Account / profile indicator (click → account menu or sign in)
        this.accountItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.accountItem.command = 'aimux.account';
    }

    register(): void {
        this.context.subscriptions.push(this.modelItem, this.accountItem);
        this.updateDisplay();
    }

    setConnected(model?: string, profile?: AimuxProfile): void {
        this.connected = true;
        this.model = model || '';
        if (profile) {
            this.profile = profile;
        }
        this.updateDisplay();
    }

    setProfile(profile: AimuxProfile): void {
        this.profile = profile || {};
        this.updateDisplay();
    }

    setDisconnected(): void {
        this.connected = false;
        this.model = '';
        this.profile = {};
        this.updateDisplay();
    }

    getProfile(): AimuxProfile {
        return this.profile;
    }

    private profileLabel(): string {
        return this.profile.name || this.profile.email || 'Account';
    }

    private updateDisplay(): void {
        const config = vscode.workspace.getConfiguration('aimux');
        const apiKey = config.get<string>('apiKey', '');
        const signedIn = this.connected || !!apiKey;

        if (signedIn) {
            // ── Account / profile icon ──
            this.accountItem.text = `$(account) ${this.profileLabel()}`;
            this.accountItem.backgroundColor = undefined;
            this.accountItem.tooltip = this.profile.email
                ? `Aimux — Signed in as ${this.profile.email}\nClick for account options`
                : 'Aimux — Signed in\nClick for account options';
            this.accountItem.show();

            // ── Model indicator ──
            if (this.model) {
                this.modelItem.text = `$(sparkle) ${this.model}`;
                this.modelItem.backgroundColor = undefined;
                this.modelItem.tooltip = `Aimux — Active model: ${this.model}\nClick to change model`;
            } else {
                this.modelItem.text = '$(sparkle) Aimux: Select Model';
                this.modelItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.modelItem.tooltip = 'Aimux — No model selected\nClick to select model';
            }
            this.modelItem.show();
        } else {
            // ── Not signed in: account icon is the sign-in entry point ──
            this.accountItem.text = '$(account) Sign in to Aimux';
            this.accountItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
            this.accountItem.tooltip = 'Aimux — Click to sign in';
            this.accountItem.show();

            // Hide the model indicator until signed in
            this.modelItem.hide();
        }
    }

    dispose(): void {
        this.modelItem.dispose();
        this.accountItem.dispose();
    }
}
