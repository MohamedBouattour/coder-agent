import * as vscode from "vscode";
import { openDefaultBrowser } from "./browserController";
import { applyChanges } from "./fileApplicator";
import { buildFullContext, buildEnrichedPrompt } from "./promptEngineer";
import { BrowserAgentViewProvider } from "./webview/panel";

function getConfig(): any {
  const cfg = vscode.workspace.getConfiguration("browserAgent");
  return {
    targetUrl: cfg.get<string>("targetUrl", "https://www.perplexity.ai"),
  };
}

export function activate(context: vscode.ExtensionContext) {
  const runAgent = async (userPrompt: string) => {
    provider.postStatus("Building context…");

    const agentContext = await buildFullContext(userPrompt);

    if (!agentContext) {
      provider.postError("No workspace open or context build failed.");
      return;
    }

    const taskPrompt = buildEnrichedPrompt(userPrompt, agentContext);

    // Copy to clipboard for easy pasting
    await vscode.env.clipboard.writeText(taskPrompt);

    const config = getConfig();
    const url = config.targetUrl || "https://www.perplexity.ai";

    provider.postStatus(`Context copied to clipboard. Opening ${url}…`);

    // Open default browser
    await openDefaultBrowser(url);

    provider.postStatus(
      "Waiting for you to paste the AI response into the result box below.",
    );
  };

  const applyResponse = async (response: string) => {
    if (!response.trim()) return;
    provider.postStatus("Applying file changes…");
    try {
      await applyChanges(response);
      provider.postStatus("Done.");
      vscode.window.showInformationMessage(
        "[BrowserAgent] Changes applied successfully.",
      );
    } catch (e: any) {
      provider.postError(`Apply failed: ${e.message}`);
    }
  };

  const provider = new BrowserAgentViewProvider(
    context.extensionUri,
    runAgent,
    applyResponse,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BrowserAgentViewProvider.viewType,
      provider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("browserAgent.run", async () => {
      provider.reveal();

      const prompt = await vscode.window.showInputBox({
        title: "Browser Agent Prompt",
        prompt: "Describe the change you want in your workspace",
        ignoreFocusOut: true,
      });

      if (!prompt?.trim()) return;
      await runAgent(prompt);
    }),
  );
}

export function deactivate() {}
