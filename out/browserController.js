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
exports.runBrowserSession = runBrowserSession;
const playwright_core_1 = require("playwright-core");
const vscode = __importStar(require("vscode"));
async function runBrowserSession(enrichedPrompt, config) {
    let browser;
    try {
        // Attempt to launch browser
        browser = await playwright_core_1.chromium.launch({
            headless: config.headless,
            // On some systems, playwright might not find the browser if it's not installed via playwright install
            // chromium.executablePath() could be used if we want to point to a specific chrome install
        });
    }
    catch (error) {
        vscode.window
            .showErrorMessage(`Failed to launch browser: ${error.message}. Please run 'npx playwright install chromium' in your terminal.`, "Open Terminal")
            .then((selection) => {
            if (selection === "Open Terminal") {
                vscode.commands.executeCommand("workbench.action.terminal.new");
            }
        });
        throw error;
    }
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        console.log(`Navigating to ${config.targetUrl}...`);
        await page.goto(config.targetUrl);
        // Wait for the prompt input
        console.log(`Waiting for prompt selector: ${config.promptSelector}`);
        await page.waitForSelector(config.promptSelector, { timeout: 30000 });
        // Fill the prompt
        // For many AI sites, we might need click + type or fill
        await page.fill(config.promptSelector, enrichedPrompt);
        // Wait a bit before clicking submit
        await page.waitForTimeout(500);
        // Click submit
        console.log(`Clicking submit button: ${config.submitSelector}`);
        await page.click(config.submitSelector);
        // Wait for response and wait for it to stabilize
        console.log(`Waiting for response selector: ${config.responseSelector}`);
        await page.waitForSelector(config.responseSelector, { timeout: 60000 });
        let lastText = "";
        let stableCount = 0;
        const maxStableChecks = 10; // Check for 2 seconds (10 * 200ms)
        while (stableCount < maxStableChecks) {
            const currentText = await page.innerText(config.responseSelector);
            if (currentText === lastText && currentText.length > 0) {
                stableCount++;
            }
            else {
                lastText = currentText;
                stableCount = 0;
            }
            await page.waitForTimeout(200);
        }
        return lastText;
    }
    catch (error) {
        console.error("Browser session error:", error);
        vscode.window.showErrorMessage(`Browser session failed: ${error.message}`);
        throw error;
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
//# sourceMappingURL=browserController.js.map