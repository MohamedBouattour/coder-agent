import * as vscode from "vscode";
import { BrowserController } from "./browserController";
import { applyChanges } from "./fileApplicator";
import { getBasicContext, enrichContext, buildPhase1Prompt, parsePhase1Response, buildPhase2Prompt } from "./promptEngineer";
import { BrowserAgentViewProvider } from "./webview/panel";

export function activate(context: vscode.ExtensionContext) {
  const browserCtrl = new BrowserController();

  const runAgent = async (userPrompt: string) => {
    provider.postStatus("Phase 1: Building project context...");

    const basicContext = await getBasicContext();
    if (!basicContext) {
      provider.postError("No workspace open or context build failed.");
      return;
    }

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders![0].uri;
      const pkgPath = vscode.Uri.joinPath(workspaceRoot, "package.json");
      let pkgContent = "";
      try {
        const pkgData = await vscode.workspace.fs.readFile(pkgPath);
        pkgContent = Buffer.from(pkgData).toString("utf-8");
      } catch (err) {
        console.warn("No package.json found");
      }

      const phase1Prompt = buildPhase1Prompt(userPrompt, basicContext, pkgContent);
      
      provider.postStatus("Phase 1: Submitting to Perplexity...");
      const phase1Response = await browserCtrl.ask(phase1Prompt, (msg) => provider.postStatus(msg));

      provider.postStatus("Phase 1: Parsing requested files...");
      const parsed = parsePhase1Response(phase1Response, basicContext.fileTree);

      provider.postStatus(`Phase 2: Loading ${parsed.files.length} requested files...`);
      const enrichedContext = await enrichContext(basicContext, parsed.files);

      const phase2Prompt = buildPhase2Prompt(parsed.improvedPrompt || userPrompt, enrichedContext);

      provider.postStatus("Phase 2: Submitting code to Perplexity...");
      const finalResponse = await browserCtrl.ask(phase2Prompt, (msg) => provider.postStatus(msg));

      provider.postStatus("Applying file changes...");
      await applyChanges(finalResponse);
      
      provider.postStatus("Done. Changes applied successfully.");
      vscode.window.showInformationMessage("[BrowserAgent] Changes applied successfully.");
    } catch (e: any) {
      provider.postError(`Agent failed: ${e.message}`);
    }
  };

  const provider = new BrowserAgentViewProvider(
    context.extensionUri,
    runAgent
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BrowserAgentViewProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("browserAgent.run", async () => {
      provider.reveal();
    })
  );
}

export function deactivate() {}
