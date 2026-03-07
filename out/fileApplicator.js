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
exports.applyChanges = applyChanges;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
async function applyChanges(aiResponse) {
    const fileBlocks = extractFileBlocks(aiResponse);
    if (fileBlocks.length === 0) {
        vscode.window.showInformationMessage("No file changes detected in the AI response.");
        return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace open.");
        return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    for (const block of fileBlocks) {
        const absolutePath = path.join(rootPath, block.filePath);
        // Sanitize path (prevent path traversal)
        if (!absolutePath.startsWith(rootPath)) {
            vscode.window.showErrorMessage(`Invalid file path detected: ${block.filePath}. Potential path traversal blocked.`);
            continue;
        }
        const fileUri = vscode.Uri.file(absolutePath);
        const fileExists = fs.existsSync(absolutePath);
        // Show diff if file exists
        if (fileExists) {
            const tempUri = vscode.Uri.parse(`browser-agent-preview:${block.filePath}.tmp`);
            // We could use a temporary file for the diff or just apply directly if confirmed
            // For simplicity in this first version, we'll ask for confirmation per file
            const selection = await vscode.window.showInformationMessage(`Apply changes to ${block.filePath}?`, "Apply", "View Diff", "Skip");
            if (selection === "View Diff") {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const newDoc = await vscode.workspace.openTextDocument({
                    content: block.content,
                    language: doc.languageId,
                });
                await vscode.commands.executeCommand("vscode.diff", fileUri, newDoc.uri, `Diff: ${block.filePath}`);
                const confirm = await vscode.window.showInformationMessage(`Apply these changes to ${block.filePath}?`, "Apply", "Cancel");
                if (confirm !== "Apply")
                    continue;
            }
            else if (selection !== "Apply") {
                continue;
            }
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Applying changes to ${block.filePath}`,
            cancellable: false,
        }, async (progress) => {
            try {
                const wsEdit = new vscode.WorkspaceEdit();
                if (!fileExists) {
                    wsEdit.createFile(fileUri, { ignoreIfExists: true });
                }
                // Check if it's a unified diff (naive check)
                if (block.content.startsWith("---") &&
                    block.content.includes("\n+++")) {
                    // In a real implementation, we'd use a diff library like 'diff' npm package
                    // For this POC, we'll suggest full file replacements for better reliability
                    vscode.window.showWarningMessage(`Unified diff detected for ${block.filePath}, but full replacement is recommended.`);
                }
                // Apply full content replacement
                const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(100000, 0));
                if (fileExists) {
                    wsEdit.replace(fileUri, fullRange, block.content);
                }
                else {
                    wsEdit.insert(fileUri, new vscode.Position(0, 0), block.content);
                }
                await vscode.workspace.applyEdit(wsEdit);
                await vscode.workspace.saveAll();
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to apply changes to ${block.filePath}: ${error.message}`);
            }
        });
    }
}
function extractFileBlocks(text) {
    const blocks = [];
    // Regex to match "FILE: <path>" followed by a code block
    // This is a common format for AI agents
    const regex = /FILE:\s*([^\s\n\r]+)\s*[\r\n]+(?:```(?:[\w]*)\s*([\s\S]*?)```|([\s\S]*?)(?=FILE:|$))/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const filePath = match[1].trim();
        const content = (match[2] || match[3] || "").trim();
        if (filePath && content) {
            blocks.push({ filePath, content });
        }
    }
    return blocks;
}
//# sourceMappingURL=fileApplicator.js.map