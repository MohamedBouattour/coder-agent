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
exports.BrowserAgentViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promptEngineer_1 = require("../promptEngineer");
const browserController_1 = require("../browserController");
const fileApplicator_1 = require("../fileApplicator");
class BrowserAgentViewProvider {
    _extensionUri;
    static viewType = "browserAgent.panel";
    _view;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case "run":
                    await this._handleRun(data.prompt, data.headless, data.targetUrl);
                    break;
                case "apply":
                    await (0, fileApplicator_1.applyChanges)(data.response);
                    break;
            }
        });
    }
    async _handleRun(userPrompt, headless, targetUrl) {
        if (!this._view)
            return;
        try {
            const config = vscode.workspace.getConfiguration("browserAgent");
            this._view.webview.postMessage({
                command: "status",
                text: "Gathering workspace context...",
            });
            const context = await (0, promptEngineer_1.getAgentContext)();
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
            const enrichedPrompt = (0, promptEngineer_1.buildEnrichedPrompt)(userPrompt, context);
            this._view.webview.postMessage({
                command: "status",
                text: "Starting browser session...",
            });
            const response = await (0, browserController_1.runBrowserSession)(enrichedPrompt, {
                headless: headless,
                targetUrl: targetUrl || config.get("targetUrl"),
                promptSelector: config.get("promptSelector"),
                submitSelector: config.get("submitSelector"),
                responseSelector: config.get("responseSelector"),
            });
            this._view.webview.postMessage({
                command: "success",
                response: response,
            });
        }
        catch (error) {
            this._view.webview.postMessage({
                command: "error",
                text: `Error: ${error.message}`,
            });
        }
    }
    _getHtmlForWebview(webview) {
        const htmlPath = path.join(this._extensionUri.fsPath, "src", "webview", "ui.html");
        let html = fs.readFileSync(htmlPath, "utf8");
        // In a real build system, we might need to adjust paths for assets
        // but here we are using a single file for UI.
        return html;
    }
}
exports.BrowserAgentViewProvider = BrowserAgentViewProvider;
//# sourceMappingURL=panel.js.map