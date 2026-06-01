import * as vscode from 'vscode';
import { AimuxAuth } from './auth';
import { AimuxApi } from './api';
import { AimuxStatusBar } from './statusBar';
import { AimuxChatViewProvider } from './chatView';
export interface AimuxContext {
    auth: AimuxAuth;
    api: AimuxApi;
    statusBar: AimuxStatusBar;
    chatProvider?: AimuxChatViewProvider;
    globalState: vscode.Memento;
}
export declare function getAimuxContext(): AimuxContext | null;
export declare function activate(context: vscode.ExtensionContext): Promise<void>;
export declare function deactivate(): void;
//# sourceMappingURL=extension.d.ts.map