import * as vscode from "vscode";
import { BrowserAgentViewProvider } from "./webview/panel";

export function activate(context: vscode.ExtensionContext) {
  console.log("BrowserAgent extension is now active!");

  const provider = new BrowserAgentViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BrowserAgentViewProvider.viewType,
      provider,
    ),
  );

  let runCommand = vscode.commands.registerCommand("browserAgent.run", () => {
    // This command can be used to focus the view or trigger logic
    vscode.commands.executeCommand("browserAgent.panel.focus");
  });

  context.subscriptions.push(runCommand);
}

export function deactivate() {}
