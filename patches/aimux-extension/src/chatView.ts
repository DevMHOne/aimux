import * as vscode from 'vscode';
import { AimuxApi, ChatMessage } from './api';

/**
 * Self-contained chat panel rendered as a Webview view in the sidebar.
 *
 * This deliberately does NOT use `vscode.chat.createChatParticipant`, which is a
 * proposed/gated API that is undefined in VSCodium-based builds (it silently
 * removes the chat UI). A webview works in every build and talks straight to the
 * Aimux `/v1/chat/completions` endpoint.
 */
export class AimuxChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aimux.chatView';

    private view?: vscode.WebviewView;
    private history: ChatMessage[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly api: AimuxApi
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'send') {
                await this.handleUserMessage(msg.text);
            } else if (msg.type === 'clear') {
                this.history = [];
            } else if (msg.type === 'ready') {
                this.postState();
            } else if (msg.type === 'selectModel') {
                await vscode.commands.executeCommand('aimux.selectModel');
                this.postState();
            } else if (msg.type === 'signIn') {
                await vscode.commands.executeCommand('aimux.signIn');
                this.postState();
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.postState();
            }
        });
    }

    /** Allow other commands (status bar etc.) to refresh the panel. */
    public refresh(): void {
        this.postState();
    }

    private isSignedIn(): boolean {
        const config = vscode.workspace.getConfiguration('aimux');
        return config.get<string>('apiKey', '').length > 0;
    }

    private postState(): void {
        if (!this.view) { return; }
        this.view.webview.postMessage({
            type: 'state',
            signedIn: this.isSignedIn(),
            model: this.api.getCurrentModel() || '',
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        if (!this.view) { return; }
        const trimmed = (text || '').trim();
        if (!trimmed) { return; }

        if (!this.isSignedIn()) {
            this.view.webview.postMessage({ type: 'error', text: 'Not signed in. Click "Sign in to Aimux" first.' });
            return;
        }
        const model = this.api.getCurrentModel();
        if (!model) {
            this.view.webview.postMessage({ type: 'error', text: 'No model selected. Click the model name to choose one.' });
            return;
        }

        // Echo the user's message and open an empty assistant bubble to stream into.
        this.view.webview.postMessage({ type: 'userMessage', text: trimmed });
        this.view.webview.postMessage({ type: 'assistantStart' });

        const messages: ChatMessage[] = [
            { role: 'system', content: this.buildSystemPrompt() },
            ...this.history,
            { role: 'user', content: trimmed },
        ];

        const ctx = this.buildWorkspaceContext();
        if (ctx) {
            messages.splice(1, 0, { role: 'system', content: `Current workspace context:\n${ctx}` });
        }

        let full = '';
        try {
            await this.api.chatStream(
                messages,
                (chunk) => {
                    full += chunk;
                    this.view?.webview.postMessage({ type: 'assistantChunk', text: chunk });
                },
                { model, temperature: 0.7 }
            );
        } catch (streamErr: any) {
            // Fallback to non-streaming
            try {
                const resp = await this.api.chatCompletions(messages, { model });
                full = resp.choices?.[0]?.message?.content || '';
                this.view.webview.postMessage({ type: 'assistantChunk', text: full });
            } catch (err: any) {
                this.view.webview.postMessage({ type: 'error', text: `Aimux error: ${err.message}` });
                this.view.webview.postMessage({ type: 'assistantEnd' });
                return;
            }
        }

        this.view.webview.postMessage({ type: 'assistantEnd' });

        // Persist to history (cap to last 20 turns to bound payload size)
        this.history.push({ role: 'user', content: trimmed });
        this.history.push({ role: 'assistant', content: full });
        if (this.history.length > 40) {
            this.history = this.history.slice(-40);
        }
    }

    private buildSystemPrompt(): string {
        const editor = vscode.window.activeTextEditor;
        let prompt = `You are Aimux, an expert AI coding assistant embedded in the editor.
You help developers write, debug, refactor, and understand code.
Respond concisely and accurately. When writing code, use markdown code blocks with the appropriate language.`;
        if (editor) {
            prompt += `\nThe user's current file language is: ${editor.document.languageId}.`;
        }
        return prompt;
    }

    private buildWorkspaceContext(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return ''; }
        const doc = editor.document;
        const parts: string[] = [`File: ${doc.fileName}`, `Language: ${doc.languageId}`];
        const selection = editor.selection;
        if (!selection.isEmpty) {
            const sel = doc.getText(selection);
            if (sel.length < 2000) {
                parts.push(`Selected text:\n\`\`\`${doc.languageId}\n${sel}\n\`\`\``);
            }
        } else {
            const start = Math.max(0, selection.active.line - 15);
            const end = Math.min(doc.lineCount - 1, selection.active.line + 15);
            const around = doc.getText(new vscode.Range(start, 0, end, 0));
            if (around.length < 3000) {
                parts.push(`Context around line ${selection.active.line + 1}:\n\`\`\`${doc.languageId}\n${around}\n\`\`\``);
            }
        }
        return parts.join('\n');
    }

    private getHtml(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 11px;
  }
  #modelBtn {
    cursor: pointer; padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    border: none; font-size: 11px;
  }
  #clearBtn {
    margin-left: auto; cursor: pointer; background: transparent;
    color: var(--vscode-foreground); border: none; opacity: 0.7; font-size: 11px;
  }
  #clearBtn:hover { opacity: 1; }
  #messages { flex: 1; overflow-y: auto; padding: 10px; }
  .msg { margin-bottom: 12px; line-height: 1.5; }
  .msg .role { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin-bottom: 3px; }
  .msg.user .bubble {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word;
  }
  .msg.assistant .bubble { white-space: pre-wrap; word-wrap: break-word; }
  .msg.assistant pre {
    background: var(--vscode-textCodeBlock-background, #1e1e1e);
    padding: 8px; border-radius: 6px; overflow-x: auto;
  }
  .msg.error .bubble { color: var(--vscode-errorForeground); }
  #empty { opacity: .55; text-align: center; margin-top: 30px; padding: 0 16px; line-height: 1.5; }
  #signinWrap { padding: 16px; text-align: center; }
  .btn {
    cursor: pointer; padding: 7px 14px; border-radius: 6px; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font-size: 13px;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  #inputRow { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #input {
    flex: 1; resize: none; min-height: 34px; max-height: 140px;
    padding: 7px 9px; border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    font-family: inherit; font-size: 13px;
  }
  #send {
    cursor: pointer; border: none; border-radius: 6px; padding: 0 14px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  #send:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
  <div id="header" style="display:none">
    <span>Aimux</span>
    <button id="modelBtn" title="Click to change model">no model</button>
    <button id="clearBtn">Clear</button>
  </div>

  <div id="signinWrap" style="display:none">
    <p style="opacity:.7">Sign in to your Aimux account to start chatting.</p>
    <button class="btn" id="signinBtn">Sign in to Aimux</button>
  </div>

  <div id="messages" style="display:none">
    <div id="empty">Ask Aimux anything about your code.<br/>Selected text and the current file are sent as context.</div>
  </div>

  <div id="inputRow" style="display:none">
    <textarea id="input" rows="1" placeholder="Ask Aimux… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const emptyEl = document.getElementById('empty');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const headerEl = document.getElementById('header');
  const inputRow = document.getElementById('inputRow');
  const signinWrap = document.getElementById('signinWrap');
  const modelBtn = document.getElementById('modelBtn');
  let currentAssistant = null;
  let streaming = false;

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  // Minimal markdown: fenced code blocks + inline code, rest escaped.
  function renderMarkdown(text) {
    const parts = text.split(/(\`\`\`[\\s\\S]*?\`\`\`)/g);
    return parts.map(p => {
      if (p.startsWith('\`\`\`') && p.endsWith('\`\`\`')) {
        const inner = p.slice(3, -3).replace(/^[a-zA-Z0-9]*\\n/, '');
        return '<pre>' + escapeHtml(inner) + '</pre>';
      }
      return escapeHtml(p).replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    }).join('');
  }

  function addMessage(role, text) {
    if (emptyEl) emptyEl.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const r = document.createElement('div'); r.className = 'role';
    r.textContent = role === 'user' ? 'You' : (role === 'error' ? 'Error' : 'Aimux');
    const b = document.createElement('div'); b.className = 'bubble';
    if (role === 'assistant') b.innerHTML = renderMarkdown(text); else b.textContent = text;
    wrap.appendChild(r); wrap.appendChild(b);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return b;
  }

  function setStreaming(on) {
    streaming = on;
    sendBtn.disabled = on;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || streaming) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    vscode.postMessage({ type: 'send', text });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    messagesEl.querySelectorAll('.msg').forEach(n => n.remove());
    if (emptyEl) emptyEl.style.display = 'block';
    vscode.postMessage({ type: 'clear' });
  });
  document.getElementById('signinBtn').addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
  modelBtn.addEventListener('click', () => vscode.postMessage({ type: 'selectModel' }));

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'state') {
      const signedIn = m.signedIn;
      headerEl.style.display = signedIn ? 'flex' : 'none';
      messagesEl.style.display = signedIn ? 'block' : 'none';
      inputRow.style.display = signedIn ? 'flex' : 'none';
      signinWrap.style.display = signedIn ? 'none' : 'block';
      modelBtn.textContent = m.model || 'select model';
    } else if (m.type === 'userMessage') {
      addMessage('user', m.text);
    } else if (m.type === 'assistantStart') {
      setStreaming(true);
      currentAssistant = addMessage('assistant', '');
      currentAssistant._raw = '';
    } else if (m.type === 'assistantChunk') {
      if (currentAssistant) {
        currentAssistant._raw = (currentAssistant._raw || '') + m.text;
        currentAssistant.innerHTML = renderMarkdown(currentAssistant._raw);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } else if (m.type === 'assistantEnd') {
      setStreaming(false);
      currentAssistant = null;
    } else if (m.type === 'error') {
      setStreaming(false);
      addMessage('error', m.text);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
