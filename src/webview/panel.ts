import * as vscode from "vscode";

export type RunHandler = (userPrompt: string) => Promise<void>;
export type ApplyHandler = (response: string) => Promise<void>;

export class BrowserAgentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "browserAgent.panel";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onRun: RunHandler,
    private readonly onApply: ApplyHandler,
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
        switch (msg?.type) {
          case "run": {
            const prompt = String(msg?.prompt ?? "").trim();
            if (!prompt) {
              this.postStatus("Please enter a prompt.");
              return;
            }
            await this.onRun(prompt);
            return;
          }
          case "apply": {
            const response = String(msg?.response ?? "").trim();
            if (!response) {
              this.postStatus("Please paste a response first.");
              return;
            }
            await this.onApply(response);
            return;
          }
          case "ping":
            this.postStatus("Ready.");
            return;
          default:
            return;
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

  public postResult(text: string): void {
    this._view?.webview.postMessage({ type: "result", text });
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
    button { margin-top: 8px; width: 100%; padding: 6px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .box { margin-top: 15px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    .muted { opacity: 0.8; font-size: 0.9em; margin-bottom: 4px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="muted">1. Describe Task</div>
  <textarea id="prompt" placeholder="e.g. Add a logout button to the header..."></textarea>
  <button id="run">Copy Context & Open Browser</button>

  <div class="box">
    <div class="muted">2. Paste AI Response</div>
    <textarea id="response" placeholder="Paste the full markdown response from the AI here..."></textarea>
    <button id="apply">Apply Changes</button>
  </div>

  <div class="box">
    <div class="muted">Status</div>
    <pre id="status">Ready.</pre>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const responseEl = document.getElementById('response');
    const statusEl = document.getElementById('status');
    const runBtn = document.getElementById('run');
    const applyBtn = document.getElementById('apply');

    runBtn.addEventListener('click', () => {
      const prompt = (promptEl.value || '').trim();
      vscode.postMessage({ type: 'run', prompt });
    });

    applyBtn.addEventListener('click', () => {
      const response = (responseEl.value || '').trim();
      vscode.postMessage({ type: 'apply', response });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'status':
          statusEl.textContent = msg.text ?? '';
          break;
        case 'error':
          statusEl.textContent = 'Error: ' + (msg.text ?? '');
          break;
      }
    });

    vscode.postMessage({ type: 'ping' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
