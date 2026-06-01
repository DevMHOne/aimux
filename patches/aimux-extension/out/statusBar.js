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
    statusBarItem;
    modelStatusBarItem;
    connected = false;
    model = '';
    constructor(context) {
        this.context = context;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'aimux.selectModel';
        this.statusBarItem.tooltip = 'Aimux AI — Click to select model';
        this.modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.modelStatusBarItem.command = 'aimux.signIn';
    }
    register() {
        this.context.subscriptions.push(this.statusBarItem, this.modelStatusBarItem);
        this.updateDisplay();
    }
    setConnected(model) {
        this.connected = true;
        this.model = model || '';
        this.updateDisplay();
    }
    setDisconnected() {
        this.connected = false;
        this.model = '';
        this.updateDisplay();
    }
    updateDisplay() {
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
        }
        else {
            // Check if signed in but no model
            const config = vscode.workspace.getConfiguration('aimux');
            const apiKey = config.get('apiKey', '');
            if (apiKey) {
                // Signed in, no model
                this.statusBarItem.text = '$(warning) Aimux: No Model';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.tooltip = 'Aimux — Signed in but no model selected\nClick to select model';
                this.statusBarItem.show();
            }
            else {
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
    dispose() {
        this.statusBarItem.dispose();
        this.modelStatusBarItem.dispose();
    }
}
exports.AimuxStatusBar = AimuxStatusBar;
//# sourceMappingURL=statusBar.js.map