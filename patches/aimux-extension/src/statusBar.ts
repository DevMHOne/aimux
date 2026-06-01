import * as vscode from 'vscode';

export class AimuxStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private modelStatusBarItem: vscode.StatusBarItem;
    private connected: boolean = false;
    private model: string = '';

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'aimux.selectModel';
        this.statusBarItem.tooltip = 'Aimux AI — Click to select model';

        this.modelStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.modelStatusBarItem.command = 'aimux.signIn';
    }

    register(): void {
        this.context.subscriptions.push(this.statusBarItem, this.modelStatusBarItem);
        this.updateDisplay();
    }

    setConnected(model?: string): void {
        this.connected = true;
        this.model = model || '';
        this.updateDisplay();
    }

    setDisconnected(): void {
        this.connected = false;
        this.model = '';
        this.updateDisplay();
    }

    private updateDisplay(): void {
        if (this.connected) {
            // Model indicator
            this.statusBarItem.text = `$(sparkle) Aimux: ${this.model || 'no model'}`;
            this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.foreground');
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = this.model
                ? `Aimux — Active model: ${this.model}\nClick to change model`
                : 'Aimux — Connected but no model selected\nClick to select model';
            this.statusBarItem.show();

            // Hidden login indicator
            this.modelStatusBarItem.hide();
        } else {
            // Check if signed in but no model
            const config = vscode.workspace.getConfiguration('aimux');
            const apiKey = config.get<string>('apiKey', '');

            if (apiKey) {
                // Signed in, no model
                this.statusBarItem.text = '$(warning) Aimux: No Model';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.tooltip = 'Aimux — Signed in but no model selected\nClick to select model';
                this.statusBarItem.show();
            } else {
                // Not signed in
                this.statusBarItem.text = '$(plug) Aimux: Sign In';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                this.statusBarItem.tooltip = 'Aimux — Click to sign in';
                this.statusBarItem.command = 'aimux.signIn';
                this.statusBarItem.show();
            }

            this.modelStatusBarItem.hide();
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
        this.modelStatusBarItem.dispose();
    }
}
