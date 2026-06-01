"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAimuxContext = getAimuxContext;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const auth_1 = require("./auth");
const api_1 = require("./api");
const chat_1 = require("./chat");
const completions_1 = require("./completions");
const statusBar_1 = require("./statusBar");
const chatView_1 = require("./chatView");
let aimuxContext = null;
function getAimuxContext() {
    return aimuxContext;
}
async function activate(context) {
    const auth = new auth_1.AimuxAuth(context.globalState);
    const api = new api_1.AimuxApi(auth);
    const statusBar = new statusBar_1.AimuxStatusBar(context);
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
    const chatProvider = new chatView_1.AimuxChatViewProvider(context.extensionUri, api);
    aimuxContext.chatProvider = chatProvider;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(chatView_1.AimuxChatViewProvider.viewType, chatProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand('aimux.openChat', () => {
        vscode.commands.executeCommand('aimux.chatView.focus');
    }), vscode.commands.registerCommand('aimux.chat.clear', () => chatProvider.refresh()));
    // Check initial auth state
    if (auth.isAuthenticated()) {
        vscode.commands.executeCommand('setContext', 'aimux:signedIn', true);
        statusBar.setConnected(api.getCurrentModel());
    }
    else {
        statusBar.setDisconnected();
    }
    // Register chat participant (proposed API — guard so a missing API can't abort activation)
    try {
        const chatApi = vscode.chat;
        if (chatApi && typeof chatApi.createChatParticipant === 'function') {
            (0, chat_1.registerChatParticipant)(api);
        }
        else {
            console.warn('Aimux: vscode.chat API unavailable — chat participant disabled');
        }
    }
    catch (err) {
        console.warn('Aimux: failed to register chat participant —', err && err.message);
    }
    // Register inline completion provider (guard defensively)
    try {
        (0, completions_1.registerCompletionProvider)(api);
    }
    catch (err) {
        console.warn('Aimux: failed to register completion provider —', err && err.message);
    }
    // Watch config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aimux')) {
            syncConfig(auth, api, statusBar);
        }
    }));
}
function deactivate() {
    aimuxContext = null;
}
function syncConfig(auth, api, statusBar) {
    const config = vscode.workspace.getConfiguration('aimux');
    const apiUrl = config.get('apiUrl', 'https://aimux.id');
    api.setBaseUrl(apiUrl);
    const apiKey = config.get('apiKey', '');
    if (apiKey) {
        auth.setApiKey(apiKey);
    }
    const model = config.get('model', '');
    if (model) {
        api.setCurrentModel(model);
        statusBar.setConnected(model);
    }
}
function registerSignInCommand(context, auth, api, statusBar) {
    context.subscriptions.push(vscode.commands.registerCommand('aimux.signIn', async () => {
        try {
            const config = vscode.workspace.getConfiguration('aimux');
            const apiUrl = config.get('apiUrl', 'https://aimux.id');
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Aimux: Signing in...',
                cancellable: false,
            }, async () => {
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
                }
                catch {
                    statusBar.setConnected(undefined);
                }
                vscode.window.showInformationMessage('Aimux: Signed in successfully!');
                getAimuxContext()?.chatProvider?.refresh();
            });
        }
        catch (err) {
            if (err.message !== 'Sign in cancelled') {
                vscode.window.showErrorMessage(`Aimux: Sign in failed — ${err.message}`);
            }
        }
    }));
}
function registerSignOutCommand(context, auth, statusBar) {
    context.subscriptions.push(vscode.commands.registerCommand('aimux.signOut', async () => {
        auth.clearApiKey();
        vscode.commands.executeCommand('setContext', 'aimux:signedIn', false);
        statusBar.setDisconnected();
        const config = vscode.workspace.getConfiguration('aimux');
        await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
        await config.update('model', '', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Aimux: Signed out');
        getAimuxContext()?.chatProvider?.refresh();
    }));
}
function registerSelectModelCommand(context, api, statusBar) {
    context.subscriptions.push(vscode.commands.registerCommand('aimux.selectModel', async () => {
        try {
            const models = await api.fetchModels();
            if (models.length === 0) {
                vscode.window.showWarningMessage('Aimux: No models available');
                return;
            }
            const currentModel = api.getCurrentModel();
            const items = models.map(m => ({
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`Aimux: Failed to fetch models — ${err.message}`);
        }
    }));
}
/**
 * Account / profile menu — the entry point behind the profile ($(account)) status
 * bar item. When signed out it triggers sign-in; when signed in it offers model
 * selection and sign-out, showing the account name/email.
 */
function registerAccountCommand(context, auth, api, statusBar) {
    context.subscriptions.push(vscode.commands.registerCommand('aimux.account', async () => {
        if (!auth.isAuthenticated()) {
            // Not signed in → start sign-in
            await vscode.commands.executeCommand('aimux.signIn');
            return;
        }
        const profile = statusBar.getProfile();
        const who = profile.name || profile.email || 'Aimux account';
        const currentModel = api.getCurrentModel();
        const picks = [
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
        }
        else if (selected.id === 'signout') {
            await vscode.commands.executeCommand('aimux.signOut');
        }
    }));
}
//# sourceMappingURL=extension.js.map