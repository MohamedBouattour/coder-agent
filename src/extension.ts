import * as vscode from "vscode";
import { applyChanges } from "./fileApplicator";
import { getBasicContext, enrichContext, buildPhase1Prompt, parsePhase1Response, buildPhase2Prompt, BasicContext } from "./promptEngineer";
import { BrowserAgentViewProvider } from "./webview/panel";

enum AgentState {
  Idle,
  WaitingForPhase1,
  WaitingForPhase2
}

export function activate(context: vscode.ExtensionContext) {
  let currentState = AgentState.Idle;
  let currentBasicContext: BasicContext | undefined;
  let currentImprovedPrompt: string = "";

  const resetState = () => {
    currentState = AgentState.Idle;
    currentBasicContext = undefined;
    currentImprovedPrompt = "";
    provider.updateState("Describe Task", "e.g. Add a logout button...", false);
    provider.postStatus("Ready.");
    provider.navigateIframe("about:blank", false);
  };

  const openPerplexityWithPrompt = async (prompt: string) => {
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://www.perplexity.ai/search/new?q=${encodedPrompt}`;
    provider.navigateIframe(url, true);
  };

  const handleSubmit = async (text: string) => {
    if (!text.trim()) return;

    try {
      if (currentState === AgentState.Idle) {
        provider.postStatus("Phase 1: Building project context...");
        currentBasicContext = await getBasicContext();
        if (!currentBasicContext) {
          provider.postError("No workspace open.");
          return;
        }
        
        const workspaceRoot = vscode.workspace.workspaceFolders![0].uri;
        const pkgPath = vscode.Uri.joinPath(workspaceRoot, "package.json");
        let pkgContent = "";
        try {
          const pkgData = await vscode.workspace.fs.readFile(pkgPath);
          pkgContent = Buffer.from(pkgData).toString("utf-8");
        } catch (err) {}

        const phase1Prompt = buildPhase1Prompt(text, currentBasicContext, pkgContent);
        
        provider.postStatus("Loading embedded browser for Phase 1...");
        await openPerplexityWithPrompt(phase1Prompt);
        
        currentState = AgentState.WaitingForPhase1;
        provider.updateState("Phase 1: Paste AI JSON Response", "Copy the JSON response from the frame below and paste it here...", true);
        provider.postStatus("Waiting for Phase 1 JSON response from embedded frame...");

      } else if (currentState === AgentState.WaitingForPhase1) {
        if (!currentBasicContext) {
          resetState();
          return;
        }
        provider.postStatus("Phase 1: Parsing requested files...");
        const parsed = parsePhase1Response(text, currentBasicContext.fileTree);
        
        provider.postStatus(`Phase 2: Loading ${parsed.files.length} requested files...`);
        const enrichedContext = await enrichContext(currentBasicContext, parsed.files);
        currentImprovedPrompt = parsed.improvedPrompt || "Proceed with updates";

        const phase2Prompt = buildPhase2Prompt(currentImprovedPrompt, enrichedContext);
        
        provider.postStatus("Loading embedded browser for Phase 2...");
        await openPerplexityWithPrompt(phase2Prompt);
        
        currentState = AgentState.WaitingForPhase2;
        provider.updateState("Phase 2: Paste Final Code Response", "Copy the generated code from the frame below and paste it here...", true);

      } else if (currentState === AgentState.WaitingForPhase2) {
        provider.postStatus("Applying file changes...");
        await applyChanges(text);
        vscode.window.showInformationMessage("[BrowserAgent] Changes applied successfully.");
        resetState();
      }
    } catch (e: any) {
      provider.postError(`Agent failed: ${e.message}`);
      resetState();
    }
  };

  const provider = new BrowserAgentViewProvider(context.extensionUri, handleSubmit, resetState);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(BrowserAgentViewProvider.viewType, provider));
  context.subscriptions.push(vscode.commands.registerCommand("browserAgent.run", () => provider.reveal()));
}

export function deactivate() {}
