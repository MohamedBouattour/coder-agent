import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getAgentContext, buildEnrichedPrompt } from "../promptEngineer";
import { runBrowserSession } from "../browserController";
import { applyChanges } from "../fileApplicator";

export class BrowserAgentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "browserAgent.panel";
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case "run":
          await this._handleRun(
            data.prompt,
            data.headless,
            data.targetUrl,
            data.persistSession,
            data.waitForManualLogin,
            data.useDefaultBrowser,
          );
          break;

        case "apply":
          await applyChanges(data.response);
          break;
      }
    });
  }

  private async _handleRun(
    userPrompt: string,
    headless: boolean,
    targetUrl: string,
    persistSession: boolean,
    waitForManualLogin: boolean,
    useDefaultBrowser: boolean,
  ) {
    if (!this._view) return;

    try {
      const config = vscode.workspace.getConfiguration("browserAgent");

      this._view.webview.postMessage({
        command: "status",
        text: "Gathering workspace context...",
      });
      const context = await getAgentContext();

      if (!context) {
        this._view.webview.postMessage({
          command: "error",
          text: "No workspace open.",
        });
        return;
      }

      this._view.webview.postMessage({
        command: "status",
        text: "Building enriched prompt...",
      });
      const enrichedPrompt = buildEnrichedPrompt(userPrompt, context);

      this._view.webview.postMessage({
        command: "status",
        text: "Starting browser session...",
      });
      const response = await runBrowserSession(enrichedPrompt, {
        headless: headless,
        targetUrl: targetUrl || (config.get("targetUrl") as string),
        promptSelector: config.get("promptSelector") as string,
        submitSelector: config.get("submitSelector") as string,
        responseSelector: config.get("responseSelector") as string,
        persistSession: persistSession,
        waitForManualLogin: waitForManualLogin,
        useDefaultBrowser: useDefaultBrowser,
      });

      this._view.webview.postMessage({
        command: "success",
        response: response,
      });
    } catch (error: any) {
      this._view.webview.postMessage({
        command: "error",
        text: `Error: ${error.message}`,
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "src",
      "webview",
      "ui.html",
    );
    let html = fs.readFileSync(htmlPath, "utf8");

    // In a real build system, we might need to adjust paths for assets
    // but here we are using a single file for UI.
    return html;
  }
}
