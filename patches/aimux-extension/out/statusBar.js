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
exports.AimuxStatusBar = void 0;
const vscode = __importStar(require("vscode"));
class AimuxStatusBar {
    context;
    modelItem;
    accountItem;
    connected = false;
    model = '';
    profile = {};
    constructor(context) {
        this.context = context;
        // Model indicator (click → select model)
        this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.modelItem.command = 'aimux.selectModel';
        this.modelItem.tooltip = 'Aimux AI — Click to select model';
        // Account / profile indicator (click → account menu or sign in)
        this.accountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.accountItem.command = 'aimux.account';
    }
    register() {
        this.context.subscriptions.push(this.modelItem, this.accountItem);
        this.updateDisplay();
    }
    setConnected(model, profile) {
        this.connected = true;
        this.model = model || '';
        if (profile) {
            this.profile = profile;
        }
        this.updateDisplay();
    }
    setProfile(profile) {
        this.profile = profile || {};
        this.updateDisplay();
    }
    setDisconnected() {
        this.connected = false;
        this.model = '';
        this.profile = {};
        this.updateDisplay();
    }
    getProfile() {
        return this.profile;
    }
    profileLabel() {
        return this.profile.name || this.profile.email || 'Account';
    }
    updateDisplay() {
        const config = vscode.workspace.getConfiguration('aimux');
        const apiKey = config.get('apiKey', '');
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
            }
            else {
                this.modelItem.text = '$(sparkle) Aimux: Select Model';
                this.modelItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.modelItem.tooltip = 'Aimux — No model selected\nClick to select model';
            }
            this.modelItem.show();
        }
        else {
            // ── Not signed in: account icon is the sign-in entry point ──
            this.accountItem.text = '$(account) Sign in to Aimux';
            this.accountItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
            this.accountItem.tooltip = 'Aimux — Click to sign in';
            this.accountItem.show();
            // Hide the model indicator until signed in
            this.modelItem.hide();
        }
    }
    dispose() {
        this.modelItem.dispose();
        this.accountItem.dispose();
    }
}
exports.AimuxStatusBar = AimuxStatusBar;
//# sourceMappingURL=statusBar.js.map