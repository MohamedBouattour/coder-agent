import * as vscode from "vscode";

export class BrowserAgentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "browserAgent.panel";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onSubmit: (text: string) => Promise<void>,
    private readonly onCancel: () => void
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
        if (msg?.type === "submit") {
          const text = String(msg?.text ?? "").trim();
          if (text) {
            await this.onSubmit(text);
          }
        } else if (msg?.type === "cancel") {
          this.onCancel();
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

  public updateState(instruction: string, placeholder: string, showCancel: boolean): void {
    this._view?.webview.postMessage({ type: "state", instruction, placeholder, showCancel });
  }

  public navigateIframe(url: string, show: boolean): void {
    this._view?.webview.postMessage({ type: "navigate", url, show });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src *;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Browser Agent</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); display: flex; flex-direction: column; gap: 8px; height: 100vh; margin: 0; box-sizing: border-box; }
    textarea { width: 100%; min-height: 80px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; box-sizing: border-box; }
    button { width: 100%; padding: 8px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; font-weight: 500; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 0.9em; padding: 6px; }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .box { padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
    .muted { opacity: 0.8; font-size: 0.9em; font-weight: bold; margin-bottom: 4px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.85em; margin: 0; font-family: var(--vscode-editor-font-family); }
    iframe { flex: 1; width: 100%; border: 1px solid var(--vscode-widget-border); border-radius: 4px; display: none; background: #fff; }
  </style>
</head>
<body>
  <div class="muted" id="instruction">Describe Task</div>
  <textarea id="prompt" placeholder="e.g. Add a logout button..."></textarea>
  
  <button id="submitBtn">Submit</button>
  <button id="cancelBtn" class="secondary" style="display: none;">Cancel / Start Over</button>

  <div class="box">
    <div class="muted" style="font-size: 0.8em; margin-bottom: 6px;">Status</div>
    <pre id="status">Ready.</pre>
  </div>

  <iframe id="perplexityFrame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" src="about:blank"></iframe>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const instructionEl = document.getElementById('instruction');
    const promptEl = document.getElementById('prompt');
    const statusEl = document.getElementById('status');
    const submitBtn = document.getElementById('submitBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const iframeEl = document.getElementById('perplexityFrame');

    function submit() {
      const text = (promptEl.value || '').trim();
      if (text) {
        vscode.postMessage({ type: 'submit', text });
      }
    }

    submitBtn.addEventListener('click', submit);
    
    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    promptEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      if (msg.type === 'status') {
        statusEl.textContent = msg.text ?? '';
      } else if (msg.type === 'error') {
        statusEl.textContent = 'Error: ' + (msg.text ?? '');
      } else if (msg.type === 'state') {
        instructionEl.textContent = msg.instruction;
        promptEl.value = '';
        promptEl.placeholder = msg.placeholder;
        cancelBtn.style.display = msg.showCancel ? 'block' : 'none';
      } else if (msg.type === 'navigate') {
        iframeEl.src = msg.url;
        iframeEl.style.display = msg.show ? 'block' : 'none';
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
