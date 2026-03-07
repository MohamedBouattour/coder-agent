"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEnrichedPrompt = buildEnrichedPrompt;
exports.getAgentContext = getAgentContext;
const vscode = __importStar(require("vscode"));
function buildEnrichedPrompt(userPrompt, context) {
    const fileTreeStr = context.fileTree.join("\n");
    const selectionStr = context.selectedText || "none";
    return `[SYSTEM]
You are an expert software engineer assistant.
Respond ONLY with file changes in this format per changed file:

FILE: <relative/path/to/file>
\`\`\`
<full new content or unified diff>
\`\`\`

[CONTEXT]
Workspace: ${context.workspaceRoot}
Active file: ${context.activeFilePath}
Selected code:
${selectionStr}

Active file content:
${context.activeFileContent}

File tree:
${fileTreeStr}

[USER REQUEST]
${userPrompt}
`;
}
async function getAgentContext() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return undefined;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const activeEditor = vscode.window.activeTextEditor;
    let activeFilePath = "none";
    let activeFileContent = "none";
    let selectedText = "";
    if (activeEditor) {
        activeFilePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
        activeFileContent = activeEditor.document.getText();
        selectedText = activeEditor.document.getText(activeEditor.selection);
    }
    const fileTree = [];
    const files = await vscode.workspace.findFiles("**/*", "**/node_modules/**");
    for (const file of files) {
        fileTree.push(vscode.workspace.asRelativePath(file));
    }
    return {
        workspaceRoot,
        activeFilePath,
        activeFileContent,
        selectedText,
        fileTree,
    };
}
//# sourceMappingURL=promptEngineer.js.map