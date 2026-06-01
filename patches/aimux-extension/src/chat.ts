import * as vscode from 'vscode';
import { AimuxApi, ChatMessage } from './api';

export function registerChatParticipant(api: AimuxApi): void {
    const participant = vscode.chat.createChatParticipant('aimux', async (request, context, stream, token): Promise<vscode.ChatResult> => {
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
        const messages: ChatMessage[] = [];

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
            } else {
                // ChatResponseTurn - get text from response array
                const textParts: string[] = [];
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
            await api.chatStream(
                messages,
                (chunk) => {
                    stream.markdown(chunk);
                },
                {
                    model,
                    temperature: 0.7,
                    signal: abortController.signal,
                }
            );
        } catch (err: any) {
            if (err.message?.includes('abort') || token.isCancellationRequested) {
                stream.markdown('_(cancelled)_');
                return {};
            }

            // Fallback to non-streaming
            try {
                const response = await api.chatCompletions(messages, { model });
                const content = response.choices?.[0]?.message?.content || 'No response received.';
                stream.markdown(content);
            } catch (fallbackErr: any) {
                stream.markdown(`⚠️ Aimux error: ${fallbackErr.message}`);
            }
        }

        return {};
    });

    participant.iconPath = new vscode.ThemeIcon('sparkle');
}

function hasApiKey(api: AimuxApi): boolean {
    // Access through workspace config since AimuxApi doesn't expose it directly
    const config = vscode.workspace.getConfiguration('aimux');
    return (config.get<string>('apiKey', '').length > 0);
}

function buildSystemPrompt(): string {
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

function buildWorkspaceContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return '';
    }

    const parts: string[] = [];

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
    } else {
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
