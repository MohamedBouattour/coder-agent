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

    webviewView.webview.html = getHtml(webviewView.webview, this.extensionUri);

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
}

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
  body { font-family: var(--vscode-font-family); padding: 15px; color: var(--vscode-foreground); display: flex; flex-direction: column; gap: 12px; height: 100vh; margin: 0; box-sizing: border-box; max-width: 800px; margin: 0 auto; }
  textarea { width: 100%; min-height: 120px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 10px; box-sizing: border-box; border-radius: 4px; font-size: 14px; }
  button { width: 100%; padding: 10px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; font-weight: 500; border-radius: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .box { padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); margin-top: 10px; }
  .muted { opacity: 0.8; font-size: 0.9em; font-weight: bold; margin-bottom: 6px; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 0.9em; margin: 0; font-family: var(--vscode-editor-font-family); }
  
  .notice { font-size: 0.85em; padding: 10px; background: var(--vscode-editorInfo-background, rgba(0, 122, 204, 0.1)); border-left: 3px solid var(--vscode-editorInfo-foreground, #007acc); margin-bottom: 10px; }
</style>
</head>
<body>

<div class="notice">
  <strong>Why external browser?</strong> VS Code uses an isolated Chromium environment that cannot access your system cookies. By using your default browser, you stay automatically authenticated with Perplexity Pro without being blocked by Cloudflare.
</div>

<div class="muted" id="instruction">Describe Task</div>
<textarea id="prompt" placeholder="e.g. Add a logout button... (Press Enter to submit, Shift+Enter for new line)"></textarea>

<button id="submitBtn">Submit Prompt & Open Browser</button>
<button id="cancelBtn" class="secondary" style="display: none;">Cancel / Start Over</button>

<div class="box">
  <div class="muted">Status</div>
  <pre id="status">Ready.</pre>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const instructionEl = document.getElementById('instruction');
  const promptEl = document.getElementById('prompt');
  const statusEl = document.getElementById('status');
  const submitBtn = document.getElementById('submitBtn');
  const cancelBtn = document.getElementById('cancelBtn');

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
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        return;
      } else {
        e.preventDefault();
        submit();
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
    } else if (msg.type === 'state') {
      instructionEl.textContent = msg.instruction;
      promptEl.value = '';
      promptEl.placeholder = msg.placeholder;
      cancelBtn.style.display = msg.showCancel ? 'block' : 'none';
      submitBtn.textContent = msg.showCancel ? 'Submit Paste' : 'Submit Prompt & Open Browser';
    }
  });

  vscode.postMessage({ type: 'ping' });
</script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
