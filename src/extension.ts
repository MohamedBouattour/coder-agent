import * as vscode from "vscode";
import { applyChanges } from "./fileApplicator";
import { getBasicContext, enrichContext, buildPhase1Prompt, parsePhase1Response, buildPhase2Prompt, BasicContext } from "./promptEngineer";
import { BrowserAgentViewProvider, getHtml } from "./webview/panel";

enum AgentState {
  Idle,
  WaitingForPhase1,
  WaitingForPhase2
}

export function activate(context: vscode.ExtensionContext) {
  let currentState = AgentState.Idle;
  let currentBasicContext: BasicContext | undefined;
  let currentImprovedPrompt: string = "";

  // Helper to handle the state logic
  const handleLogic = async (text: string, providerOrPanel: any) => {
    if (!text.trim()) return;

    try {
      if (currentState === AgentState.Idle) {
        providerOrPanel.postStatus("Phase 1: Building project context...");
        currentBasicContext = await getBasicContext();
        if (!currentBasicContext) {
          providerOrPanel.postError("No workspace open.");
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
        
        providerOrPanel.postStatus("Opening default browser for Phase 1...");
        await vscode.env.clipboard.writeText(phase1Prompt);
        await vscode.env.openExternal(vscode.Uri.parse("https://www.perplexity.ai/"));
        
        currentState = AgentState.WaitingForPhase1;
        providerOrPanel.updateState("Phase 1: Paste AI JSON Response", "Paste the JSON object response here...", true);
        providerOrPanel.postStatus("Prompt copied! Paste it in the browser, hit enter, then paste the AI JSON response here.");

      } else if (currentState === AgentState.WaitingForPhase1) {
        if (!currentBasicContext) {
          resetState(providerOrPanel);
          return;
        }
        providerOrPanel.postStatus("Phase 1: Parsing requested files...");
        const parsed = parsePhase1Response(text, currentBasicContext.fileTree);
        
        providerOrPanel.postStatus(`Phase 2: Loading ${parsed.files.length} requested files...`);
        const enrichedContext = await enrichContext(currentBasicContext, parsed.files);
        currentImprovedPrompt = parsed.improvedPrompt || "Proceed with updates";

        const phase2Prompt = buildPhase2Prompt(currentImprovedPrompt, enrichedContext);
        
        providerOrPanel.postStatus("Opening default browser for Phase 2...");
        await vscode.env.clipboard.writeText(phase2Prompt);
        await vscode.env.openExternal(vscode.Uri.parse("https://www.perplexity.ai/"));
        
        currentState = AgentState.WaitingForPhase2;
        providerOrPanel.updateState("Phase 2: Paste Final Code Response", "Paste the generated code here...", true);
        providerOrPanel.postStatus("Phase 2 prompt copied! Paste it in the browser, then copy the final generated code here.");

      } else if (currentState === AgentState.WaitingForPhase2) {
        providerOrPanel.postStatus("Applying file changes...");
        await applyChanges(text);
        vscode.window.showInformationMessage("[BrowserAgent] Changes applied successfully.");
        resetState(providerOrPanel);
      }
    } catch (e: any) {
      providerOrPanel.postError(`Agent failed: ${e.message}`);
      resetState(providerOrPanel);
    }
  };

  const resetState = (providerOrPanel: any) => {
    currentState = AgentState.Idle;
    currentBasicContext = undefined;
    currentImprovedPrompt = "";
    providerOrPanel.updateState("Describe Task", "e.g. Add a logout button...", false);
    providerOrPanel.postStatus("Ready.");
  };

  // 1. Sidebar View Provider
  const sidebarProvider = new BrowserAgentViewProvider(context.extensionUri, 
    (text) => handleLogic(text, sidebarProvider), 
    () => resetState(sidebarProvider)
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(BrowserAgentViewProvider.viewType, sidebarProvider));

  context.subscriptions.push(vscode.commands.registerCommand("browserAgent.run", () => sidebarProvider.reveal()));

  // 2. Full Editor Tab Command (Simulate Browser Tab)
  context.subscriptions.push(vscode.commands.registerCommand("browserAgent.openTab", () => {
    const panel = vscode.window.createWebviewPanel(
      'browserAgentTab',
      'Agent Workspace',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [context.extensionUri] }
    );

    const panelInterface = {
      postStatus: (text: string) => panel.webview.postMessage({ type: "status", text }),
      postError: (text: string) => panel.webview.postMessage({ type: "error", text }),
      updateState: (instruction: string, placeholder: string, showCancel: boolean) => 
        panel.webview.postMessage({ type: "state", instruction, placeholder, showCancel })
    };

    panel.webview.html = getHtml(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg?.type === "submit") {
          const text = String(msg?.text ?? "").trim();
          if (text) await handleLogic(text, panelInterface);
        } else if (msg?.type === "cancel") {
          resetState(panelInterface);
        } else if (msg?.type === "ping") {
          panelInterface.postStatus("Ready.");
        }
      } catch (e: any) {
        panelInterface.postError(e?.message ?? String(e));
      }
    });
  }));
}

export function deactivate() {}
