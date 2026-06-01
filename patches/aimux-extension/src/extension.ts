import * as vscode from 'vscode';
import { AimuxAuth } from './auth';
import { AimuxApi } from './api';
import { registerChatParticipant } from './chat';
import { registerCompletionProvider } from './completions';
import { AimuxStatusBar } from './statusBar';
import { AimuxChatViewProvider } from './chatView';

export interface AimuxContext {
    auth: AimuxAuth;
    api: AimuxApi;
    statusBar: AimuxStatusBar;
    chatProvider?: AimuxChatViewProvider;
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
    registerAccountCommand(context, auth, api, statusBar);

    // Register status bar FIRST so the Sign In button always appears,
    // even if optional/proposed APIs (chat) are unavailable in this build.
    statusBar.register();

    // Register the webview chat panel (sidebar). This replaces the gated
    // vscode.chat participant which is undefined in VSCodium-based builds.
    const chatProvider = new AimuxChatViewProvider(context.extensionUri, api);
    aimuxContext.chatProvider = chatProvider;
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AimuxChatViewProvider.viewType,
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('aimux.openChat', () => {
            vscode.commands.executeCommand('aimux.chatView.focus');
        }),
        vscode.commands.registerCommand('aimux.chat.clear', () => chatProvider.refresh())
    );

    // Check initial auth state
    if (auth.isAuthenticated()) {
        vscode.commands.executeCommand('setContext', 'aimux:signedIn', true);
        statusBar.setConnected(api.getCurrentModel());
    } else {
        statusBar.setDisconnected();
    }

    // Register chat participant (proposed API — guard so a missing API can't abort activation)
    try {
        const chatApi = (vscode as any).chat;
        if (chatApi && typeof chatApi.createChatParticipant === 'function') {
            registerChatParticipant(api);
        } else {
            console.warn('Aimux: vscode.chat API unavailable — chat participant disabled');
        }
    } catch (err: any) {
        console.warn('Aimux: failed to register chat participant —', err && err.message);
    }

    // Register inline completion provider (guard defensively)
    try {
        registerCompletionProvider(api);
    } catch (err: any) {
        console.warn('Aimux: failed to register completion provider —', err && err.message);
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
                        getAimuxContext()?.chatProvider?.refresh();
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
            getAimuxContext()?.chatProvider?.refresh();
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

/**
 * Account / profile menu — the entry point behind the profile ($(account)) status
 * bar item. When signed out it triggers sign-in; when signed in it offers model
 * selection and sign-out, showing the account name/email.
 */
function registerAccountCommand(
    context: vscode.ExtensionContext,
    auth: AimuxAuth,
    api: AimuxApi,
    statusBar: AimuxStatusBar
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('aimux.account', async () => {
            if (!auth.isAuthenticated()) {
                // Not signed in → start sign-in
                await vscode.commands.executeCommand('aimux.signIn');
                return;
            }

            const profile = statusBar.getProfile();
            const who = profile.name || profile.email || 'Aimux account';
            const currentModel = api.getCurrentModel();

            const picks: (vscode.QuickPickItem & { id: string })[] = [
                {
                    id: 'model',
                    label: '$(sparkle) Select Model',
                    description: currentModel ? `Current: ${currentModel}` : 'No model selected',
                },
                {
                    id: 'signout',
                    label: '$(sign-out) Sign Out',
                    description: profile.email || undefined,
                },
            ];

            const selected = await vscode.window.showQuickPick(picks, {
                title: `Aimux — ${who}`,
                placeHolder: profile.email ? `Signed in as ${profile.email}` : 'Account options',
            });

            if (!selected) {
                return;
            }
            if (selected.id === 'model') {
                await vscode.commands.executeCommand('aimux.selectModel');
            } else if (selected.id === 'signout') {
                await vscode.commands.executeCommand('aimux.signOut');
            }
        })
    );
}
