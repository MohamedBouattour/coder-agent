import { chromium, BrowserContext, Page } from "playwright-core";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

async function getDefaultBrowserPath(): Promise<string | undefined> {
  if (os.platform() !== "win32") return undefined;

  try {
    // 1. Find ProgId for http
    let progId: string | undefined;
    try {
      const progIdOutput = execSync(
        'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
      ).toString();
      const progIdMatch = progIdOutput.match(/ProgId\s+REG_SZ\s+(\S+)/);
      if (progIdMatch) progId = progIdMatch[1];
    } catch (e) {
      console.log("ProgId not found in HKCU, falling back...");
    }

    if (!progId) return undefined;

    // 2. Find command for ProgId - Check HKCU first then HKLM (Software\Classes)
    const hives = [
      `HKEY_CURRENT_USER\\Software\\Classes\\${progId}\\shell\\open\\command`,
      `HKEY_LOCAL_MACHINE\\Software\\Classes\\${progId}\\shell\\open\\command`,
      `HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command`,
    ];

    for (const key of hives) {
      try {
        const cmdOutput = execSync(`reg query "${key}" /ve`).toString();
        // Regex to extract the path, handling both "C:\path\to.exe" --args and C:\path\to.exe --args
        const cmdMatch = cmdOutput.match(/REG_SZ\s+(?:"([^"]+)"|([^\s]+))/);
        if (cmdMatch) {
          const path = cmdMatch[1] || cmdMatch[2];
          if (path && path.toLowerCase().endsWith(".exe")) {
            return path.trim();
          }
        }
      } catch (e) {
        // Continue to next hive
      }
    }

    return undefined;
  } catch (error) {
    console.error("Failed to detect default browser path:", error);
    return undefined;
  }
}

export async function runBrowserSession(
  enrichedPrompt: string,
  config: {
    headless: boolean;
    targetUrl: string;
    promptSelector: string;
    submitSelector: string;
    responseSelector: string;
    persistSession: boolean;
    waitForManualLogin: boolean;
    useDefaultBrowser: boolean;
  },
): Promise<string> {
  let context: BrowserContext | undefined;
  const userDataDir = path.join(os.homedir(), ".browser-agent-session");

  try {
    let executablePath: string | undefined;
    if (config.useDefaultBrowser) {
      executablePath = await getDefaultBrowserPath();
      console.log(`Using default browser at: ${executablePath}`);
    }

    if (config.persistSession) {
      console.log(`Launching persistent context in ${userDataDir}...`);
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: config.headless,
        viewport: { width: 1280, height: 720 },
        executablePath: executablePath,
      });
    } else {
      const browser = await chromium.launch({
        headless: config.headless,
        executablePath: executablePath,
      });
      context = await browser.newContext();
    }
  } catch (error: any) {
    vscode.window
      .showErrorMessage(
        `Failed to launch browser: ${error.message}. Please check if you have Chromium installed.`,
        "Open Terminal",
      )
      .then((selection) => {
        if (selection === "Open Terminal") {
          vscode.commands.executeCommand("workbench.action.terminal.new");
        }
      });
    throw error;
  }

  try {
    const page = await context.newPage();

    console.log(`Navigating to ${config.targetUrl}...`);
    await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

    if (config.waitForManualLogin) {
      vscode.window.showInformationMessage(
        "Please complete manual authentication/CAPTCHA in the browser window, then click 'OK' to continue.",
        "OK",
      );
      // We don't actually need to wait for the button click here if we want to be fully automated,
      // but waiting for a selector is better. Let's wait for the prompt selector to appear.
      console.log("Waiting for manual interaction/authentication...");
    }

    // Wait for the prompt input (up to 2 minutes if manual login is requested)
    const timeout = config.waitForManualLogin ? 120000 : 30000;
    console.log(`Waiting for prompt selector: ${config.promptSelector}`);
    await page.waitForSelector(config.promptSelector, { timeout });

    // Fill the prompt
    console.log("Filling prompt...");
    await page.click(config.promptSelector);
    await page.keyboard.insertText(enrichedPrompt);

    // Wait a bit before clicking submit
    await page.waitForTimeout(1000);

    // Click submit
    console.log(`Clicking submit button: ${config.submitSelector}`);
    await page.click(config.submitSelector);

    // Wait for response and wait for it to stabilize
    console.log(`Waiting for response selector: ${config.responseSelector}`);
    await page.waitForSelector(config.responseSelector, { timeout: 60000 });

    let lastText = "";
    let stableCount = 0;
    const maxStableChecks = 15; // Check for 3 seconds (15 * 200ms)

    while (stableCount < maxStableChecks) {
      const currentText = await page.innerText(config.responseSelector);
      if (currentText === lastText && currentText.length > 20) {
        // Assume response has some length
        stableCount++;
      } else {
        lastText = currentText;
        stableCount = 0;
      }
      await page.waitForTimeout(200);
    }

    return lastText;
  } catch (error: any) {
    console.error("Browser session error:", error);
    vscode.window.showErrorMessage(`Browser session failed: ${error.message}`);
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
  }
}
