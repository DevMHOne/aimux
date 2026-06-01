import * as vscode from 'vscode';
import { AimuxAuth } from './auth';
import { AimuxApi } from './api';
import { registerChatParticipant } from './chat';
import { registerCompletionProvider } from './completions';
import { AimuxStatusBar } from './statusBar';

export interface AimuxContext {
    auth: AimuxAuth;
    api: AimuxApi;
    statusBar: AimuxStatusBar;
    globalState: vscode.Memento;
}

let aimuxContext: AimuxContext | null = null;

export function getAimuxContext(): AimuxContext | null {
    return aimuxContext;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const auth = new AimuxAuth(context.globalState);
    const api = new AimuxApi(auth);
    const statusBar = new AimuxStatusBar(context);

    aimuxContext = { auth, api, statusBar, globalState: context.globalState };

    // Sync config
    syncConfig(auth, api, statusBar);

    // Register commands
    registerSignInCommand(context, auth, api, statusBar);
    registerSignOutCommand(context, auth, statusBar);
    registerSelectModelCommand(context, api, statusBar);

    // Register chat participant
    registerChatParticipant(api);

    // Register inline completion provider
    registerCompletionProvider(api);

    // Register status bar
    statusBar.register();

    // Check initial auth state
    if (auth.isAuthenticated()) {
        vscode.commands.executeCommand('setContext', 'aimux:signedIn', true);
        statusBar.setConnected(api.getCurrentModel());
    } else {
        statusBar.setDisconnected();
    }

    // Watch config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aimux')) {
                syncConfig(auth, api, statusBar);
            }
        })
    );
}

export function deactivate(): void {
    aimuxContext = null;
}

function syncConfig(auth: AimuxAuth, api: AimuxApi, statusBar: AimuxStatusBar): void {
    const config = vscode.workspace.getConfiguration('aimux');

    const apiUrl = config.get<string>('apiUrl', 'https://aimux.id');
    api.setBaseUrl(apiUrl);

    const apiKey = config.get<string>('apiKey', '');
    if (apiKey) {
        auth.setApiKey(apiKey);
    }

    const model = config.get<string>('model', '');
    if (model) {
        api.setCurrentModel(model);
        statusBar.setConnected(model);
    }
}

function registerSignInCommand(
    context: vscode.ExtensionContext,
    auth: AimuxAuth,
    api: AimuxApi,
    statusBar: AimuxStatusBar
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('aimux.signIn', async () => {
            try {
                const config = vscode.workspace.getConfiguration('aimux');
                const apiUrl = config.get<string>('apiUrl', 'https://aimux.id');

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Aimux: Signing in...',
                        cancellable: false,
                    },
                    async () => {
                        const apiKey = await auth.startOAuthFlow(apiUrl);
                        await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
                        vscode.commands.executeCommand('setContext', 'aimux:signedIn', true);

                        // Try to fetch models and auto-select
                        try {
                            const models = await api.fetchModels();
                            if (models.length > 0) {
                                const currentModel = api.getCurrentModel() || models[0].id;
                                api.setCurrentModel(currentModel);
                                await config.update('model', currentModel, vscode.ConfigurationTarget.Global);
                                statusBar.setConnected(currentModel);
                            }
                        } catch {
                            statusBar.setConnected(undefined);
                        }

                        vscode.window.showInformationMessage('Aimux: Signed in successfully!');
                    }
                );
            } catch (err: any) {
                if (err.message !== 'Sign in cancelled') {
                    vscode.window.showErrorMessage(`Aimux: Sign in failed — ${err.message}`);
                }
            }
        })
    );
}

function registerSignOutCommand(
    context: vscode.ExtensionContext,
    auth: AimuxAuth,
    statusBar: AimuxStatusBar
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('aimux.signOut', async () => {
            auth.clearApiKey();
            vscode.commands.executeCommand('setContext', 'aimux:signedIn', false);
            statusBar.setDisconnected();

            const config = vscode.workspace.getConfiguration('aimux');
            await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
            await config.update('model', '', vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage('Aimux: Signed out');
        })
    );
}

function registerSelectModelCommand(
    context: vscode.ExtensionContext,
    api: AimuxApi,
    statusBar: AimuxStatusBar
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('aimux.selectModel', async () => {
            try {
                const models = await api.fetchModels();

                if (models.length === 0) {
                    vscode.window.showWarningMessage('Aimux: No models available');
                    return;
                }

                const currentModel = api.getCurrentModel();
                const items: vscode.QuickPickItem[] = models.map(m => ({
                    label: m.id,
                    description: m.id === currentModel ? '(current)' : undefined,
                    detail: m.owned_by ? `Provider: ${m.owned_by}` : undefined,
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select an AI model',
                    title: 'Aimux: Model Selection',
                });

                if (selected) {
                    api.setCurrentModel(selected.label);
                    const config = vscode.workspace.getConfiguration('aimux');
                    await config.update('model', selected.label, vscode.ConfigurationTarget.Global);
                    statusBar.setConnected(selected.label);
                    vscode.window.showInformationMessage(`Aimux: Model set to ${selected.label}`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Aimux: Failed to fetch models — ${err.message}`);
            }
        })
    );
}
