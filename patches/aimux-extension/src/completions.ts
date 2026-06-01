import * as vscode from 'vscode';
import { AimuxApi } from './api';

export function registerCompletionProvider(api: AimuxApi): void {
    const provider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        {
            provideInlineCompletionItems: async (
                document: vscode.TextDocument,
                position: vscode.Position,
                context: vscode.InlineCompletionContext,
                token: vscode.CancellationToken
            ): Promise<vscode.InlineCompletionList | undefined> => {
                // Check if completions are enabled
                const config = vscode.workspace.getConfiguration('aimux');
                if (!config.get<boolean>('completions.enabled', true)) {
                    return undefined;
                }

                const apiKey = config.get<string>('apiKey', '');
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
                    const items: vscode.InlineCompletionItem[] = [];

                    for (const choice of choices) {
                        if (choice.text && choice.text.trim()) {
                            const item = new vscode.InlineCompletionItem(
                                choice.text,
                                new vscode.Range(position, position)
                            );
                            items.push(item);
                        }
                    }

                    return items.length > 0 ? new vscode.InlineCompletionList(items) : undefined;
                } catch (err: any) {
                    // Silently fail — don't spam user during typing
                    console.debug('Aimux completions error:', err.message);
                    return undefined;
                }
            },
        }
    );
}

function buildCompletionPrompt(
    document: vscode.TextDocument,
    position: vscode.Position
): string | null {
    const lineCount = document.lineCount;
    if (lineCount === 0) {
        return null;
    }

    // Use surrounding context: ~40 lines before, current line position
    const contextStart = Math.max(0, position.line - 40);
    const prefix = document.getText(
        new vscode.Range(contextStart, 0, position.line, position.character)
    );

    // Trim very long prefixes
    const maxPrefixLength = 6000;
    const trimmedPrefix = prefix.length > maxPrefixLength
        ? prefix.slice(prefix.length - maxPrefixLength)
        : prefix;

    const suffix = document.getText(
        new vscode.Range(position.line, position.character, Math.min(position.line + 10, lineCount - 1), 0)
    );

    // Format as fill-in-the-middle
    const prompt = `<fim_prefix>${trimmedPrefix}<fim_suffix>${suffix}<fim_middle>`;

    return prompt;
}

function getMaxLength(document: vscode.TextDocument): number {
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

function getStopTokens(document: vscode.TextDocument): string[] {
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
