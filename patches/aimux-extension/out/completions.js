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
exports.registerCompletionProvider = registerCompletionProvider;
const vscode = __importStar(require("vscode"));
function registerCompletionProvider(api) {
    const provider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
        provideInlineCompletionItems: async (document, position, context, token) => {
            // Check if completions are enabled
            const config = vscode.workspace.getConfiguration('aimux');
            if (!config.get('completions.enabled', true)) {
                return undefined;
            }
            const apiKey = config.get('apiKey', '');
            if (!api.getCurrentModel() || !apiKey) {
                return undefined;
            }
            // Don't trigger in very short documents
            if (document.lineCount < 2) {
                return undefined;
            }
            // Build prompt from document context
            const prompt = buildCompletionPrompt(document, position);
            if (!prompt) {
                return undefined;
            }
            // Check cancellation
            if (token.isCancellationRequested) {
                return undefined;
            }
            try {
                const response = await api.completions(prompt, {
                    model: api.getCurrentModel(),
                    maxTokens: getMaxLength(document),
                    temperature: 0.2,
                    stop: getStopTokens(document),
                });
                if (token.isCancellationRequested) {
                    return undefined;
                }
                const choices = response.choices || [];
                const items = [];
                for (const choice of choices) {
                    if (choice.text && choice.text.trim()) {
                        const item = new vscode.InlineCompletionItem(choice.text, new vscode.Range(position, position));
                        items.push(item);
                    }
                }
                return items.length > 0 ? new vscode.InlineCompletionList(items) : undefined;
            }
            catch (err) {
                // Silently fail — don't spam user during typing
                console.debug('Aimux completions error:', err.message);
                return undefined;
            }
        },
    });
}
function buildCompletionPrompt(document, position) {
    const lineCount = document.lineCount;
    if (lineCount === 0) {
        return null;
    }
    // Use surrounding context: ~40 lines before, current line position
    const contextStart = Math.max(0, position.line - 40);
    const prefix = document.getText(new vscode.Range(contextStart, 0, position.line, position.character));
    // Trim very long prefixes
    const maxPrefixLength = 6000;
    const trimmedPrefix = prefix.length > maxPrefixLength
        ? prefix.slice(prefix.length - maxPrefixLength)
        : prefix;
    const suffix = document.getText(new vscode.Range(position.line, position.character, Math.min(position.line + 10, lineCount - 1), 0));
    // Format as fill-in-the-middle
    const prompt = `<fim_prefix>${trimmedPrefix}<fim_suffix>${suffix}<fim_middle>`;
    return prompt;
}
function getMaxLength(document) {
    const lang = document.languageId;
    switch (lang) {
        case 'python':
        case 'javascript':
        case 'typescript':
        case 'typescriptreact':
        case 'javascriptreact':
            return 256;
        case 'rust':
        case 'go':
        case 'java':
        case 'c':
        case 'cpp':
            return 200;
        default:
            return 128;
    }
}
function getStopTokens(document) {
    const common = ['\n\n', '\r\n\r\n'];
    switch (document.languageId) {
        case 'python':
            return [...common, '\ndef ', '\nclass ', '\n#'];
        case 'javascript':
        case 'typescript':
        case 'typescriptreact':
        case 'javascriptreact':
            return [...common, '\nfunction ', '\nconst ', '\nexport '];
        case 'rust':
        case 'go':
            return [...common, '\nfunc ', '\npub fn ', '\nfn '];
        case 'java':
            return [...common, '\npublic ', '\nprivate ', '\nprotected '];
        default:
            return common;
    }
}
//# sourceMappingURL=completions.js.map