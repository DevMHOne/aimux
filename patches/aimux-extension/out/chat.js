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
exports.registerChatParticipant = registerChatParticipant;
const vscode = __importStar(require("vscode"));
function registerChatParticipant(api) {
    const participant = vscode.chat.createChatParticipant('aimux', async (request, context, stream, token) => {
        if (!api.getCurrentModel()) {
            stream.markdown('⚠️ No model selected. Run **Aimux: Select Model** first.');
            return {};
        }
        if (!hasApiKey(api)) {
            stream.markdown('⚠️ Not signed in. Run **Aimux: Sign In** first.');
            return {};
        }
        const model = api.getCurrentModel();
        // Build messages from conversation history + current request
        const messages = [];
        // System prompt
        messages.push({
            role: 'system',
            content: buildSystemPrompt(),
        });
        // History from chat context
        for (const hist of context.history) {
            if ('prompt' in hist) {
                // ChatRequestTurn
                messages.push({ role: 'user', content: hist.prompt });
            }
            else {
                // ChatResponseTurn - get text from response array
                const textParts = [];
                for (const part of hist.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        textParts.push(typeof part.value === 'string' ? part.value : part.value.value || String(part.value));
                    }
                }
                if (textParts.length > 0) {
                    messages.push({ role: 'assistant', content: textParts.join('\n') });
                }
            }
        }
        // Current request
        messages.push({
            role: 'user',
            content: request.prompt,
        });
        // Append context from workspace
        const workspaceContext = buildWorkspaceContext();
        if (workspaceContext) {
            messages.push({
                role: 'system',
                content: `Current workspace context:\n${workspaceContext}`,
            });
        }
        try {
            const abortController = new AbortController();
            if (token.onCancellationRequested) {
                token.onCancellationRequested(() => abortController.abort());
            }
            // Try streaming
            await api.chatStream(messages, (chunk) => {
                stream.markdown(chunk);
            }, {
                model,
                temperature: 0.7,
                signal: abortController.signal,
            });
        }
        catch (err) {
            if (err.message?.includes('abort') || token.isCancellationRequested) {
                stream.markdown('_(cancelled)_');
                return {};
            }
            // Fallback to non-streaming
            try {
                const response = await api.chatCompletions(messages, { model });
                const content = response.choices?.[0]?.message?.content || 'No response received.';
                stream.markdown(content);
            }
            catch (fallbackErr) {
                stream.markdown(`⚠️ Aimux error: ${fallbackErr.message}`);
            }
        }
        return {};
    });
    participant.iconPath = new vscode.ThemeIcon('sparkle');
}
function hasApiKey(api) {
    // Access through workspace config since AimuxApi doesn't expose it directly
    const config = vscode.workspace.getConfiguration('aimux');
    return (config.get('apiKey', '').length > 0);
}
function buildSystemPrompt() {
    const editor = vscode.window.activeTextEditor;
    let prompt = `You are Aimux, an expert AI coding assistant embedded in VS Code.
You help developers write, debug, refactor, and understand code.
You respond concisely and accurately. When writing code, use markdown code blocks with the appropriate language.
You can help with any programming language or technology.
Be helpful, direct, and focused on the developer's question.`;
    if (editor) {
        const lang = editor.document.languageId;
        prompt += `\nThe user's current file language is: ${lang}.`;
    }
    return prompt;
}
function buildWorkspaceContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return '';
    }
    const parts = [];
    // Current file info
    const doc = editor.document;
    parts.push(`File: ${doc.fileName}`);
    parts.push(`Language: ${doc.languageId}`);
    // Selected text
    const selection = editor.selection;
    if (!selection.isEmpty) {
        const selectedText = doc.getText(selection);
        if (selectedText.length < 2000) {
            parts.push(`Selected text:\n\`\`\`\n${selectedText}\n\`\`\``);
        }
    }
    else {
        // Include surrounding lines for context
        const lineCount = doc.lineCount;
        const startLine = Math.max(0, selection.active.line - 15);
        const endLine = Math.min(lineCount - 1, selection.active.line + 15);
        const range = new vscode.Range(startLine, 0, endLine, 0);
        const contextText = doc.getText(range);
        if (contextText.length < 3000) {
            const currentLine = selection.active.line + 1;
            parts.push(`Context around line ${currentLine}:\n\`\`\`${doc.languageId}\n${contextText}\n\`\`\``);
        }
    }
    return parts.join('\n');
}
//# sourceMappingURL=chat.js.map