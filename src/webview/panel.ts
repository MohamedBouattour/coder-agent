import * as vscode from "vscode";

export type RunHandler = (userPrompt: string) => Promise<void>;

export class BrowserAgentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "browserAgent.panel";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onRun: RunHandler
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg?.type === "run") {
          const prompt = String(msg?.prompt ?? "").trim();
          if (!prompt) {
            this.postStatus("Please enter a prompt.");
            return;
          }
          await this.onRun(prompt);
        } else if (msg?.type === "ping") {
          this.postStatus("Ready.");
        }
      } catch (e: any) {
        this.postError(e?.message ?? String(e));
      }
    });
  }

  public reveal(): void {
    this._view?.show?.(true);
  }

  public postStatus(text: string): void {
    this._view?.webview.postMessage({ type: "status", text });
  }

  public postError(text: string): void {
    this._view?.webview.postMessage({ type: "error", text });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Browser Agent</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }
    textarea { width: 100%; min-height: 100px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .box { margin-top: 15px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    .muted { opacity: 0.8; font-size: 0.9em; margin-bottom: 4px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="muted">Describe Task (Press Enter to Submit)</div>
  <textarea id="prompt" placeholder="e.g. Add a logout button..."></textarea>

  <div class="box">
    <div class="muted">Status</div>
    <pre id="status">Ready.</pre>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const statusEl = document.getElementById('status');

    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const prompt = (promptEl.value || '').trim();
        if (prompt) {
          vscode.postMessage({ type: 'run', prompt });
        }
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      if (msg.type === 'status') {
        statusEl.textContent = msg.text ?? '';
      } else if (msg.type === 'error') {
        statusEl.textContent = 'Error: ' + (msg.text ?? '');
      }
    });

    vscode.postMessage({ type: 'ping' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
