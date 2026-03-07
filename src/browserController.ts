import { chromium, BrowserContext, Page } from "playwright-core";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync } from "child_process";

// ─── Types ────────────────────────────────────────────────────────────────────

type OSPlatform = "win32" | "darwin" | "linux";

export interface BrowserConfig {
  headless: boolean;
  targetUrl: string;
  promptSelector: string;
  submitSelector: string;
  responseSelector: string;
  persistSession: boolean;
  waitForManualLogin: boolean;
  /** Use the OS-installed Chrome (with user sessions) instead of Playwright Chromium */
  useSystemChrome: boolean;
  /** Chrome profile folder name inside User Data dir (e.g. "Default", "Profile 1") */
  chromeProfile: string;
  /** Connect to an already-running Chrome instance via Chrome DevTools Protocol */
  useCdp: boolean;
  /** Localhost port Chrome is listening on for CDP (launch Chrome with --remote-debugging-port=N) */
  cdpPort: number;
}

// ─── Chrome Path Resolution ───────────────────────────────────────────────────

/**
 * Returns the Chrome User Data directory path for the current OS.
 * This is where all profiles, cookies, and session data are stored.
 */
function getChromeUserDataDir(): string {
  const platform = os.platform() as OSPlatform;
  switch (platform) {
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ||
          path.join(os.homedir(), "AppData", "Local"),
        "Google",
        "Chrome",
        "User Data",
      );
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Google",
        "Chrome",
      );
    case "linux":
      return path.join(os.homedir(), ".config", "google-chrome");
    default:
      throw new Error(
        `[BrowserAgent] Unsupported platform for Chrome profile detection: ${platform}`,
      );
  }
}

/**
 * Resolves the Google Chrome executable path for the current OS.
 * Tries multiple known install locations and falls back to PATH lookup on Linux.
 */
function getChromeExecutablePath(): string | undefined {
  const platform = os.platform() as OSPlatform;
  const candidates: string[] = [];

  switch (platform) {
    case "win32":
      const localApp =
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), "AppData", "Local");
      const progFiles =
        process.env.PROGRAMFILES || "C:\\Program Files";
      const progFilesX86 =
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
      candidates.push(
        path.join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(
          progFilesX86,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
      );
      // Also check registry for custom install path
      try {
        const regOut = execSync(
          'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
          { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
        );
        const match = regOut.match(/REG_SZ\s+([^\r\n]+)/);
        if (match?.[1]?.endsWith(".exe")) {
          candidates.unshift(match[1].trim());
        }
      } catch {}
      break;

    case "darwin":
      candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        path.join(
          os.homedir(),
          "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ),
      );
      break;

    case "linux":
      candidates.push(
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
      );
      // Try `which` as a last resort
      try {
        const which = execSync(
          "which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null",
          { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
        ).trim();
        if (which) {
          candidates.unshift(which);
        }
      } catch {}
      break;
  }

  return candidates.find((p) => fs.existsSync(p));
}

// ─── Profile Copy Utilities ───────────────────────────────────────────────────

/**
 * Copies a Chrome profile to a temporary directory so we can launch Chrome
 * without hitting the "profile already in use" lock error, while still
 * inheriting all cookies and session data from the original profile.
 *
 * Files copied:
 *  - Cookies, Cookies-journal (authentication cookies)
 *  - Login Data, Login Data For Account (saved passwords)
 *  - Web Data (autofill etc.)
 *  - Preferences (site permissions, settings)
 *  - Session Storage/ (active tab session data)
 *  - Local State (root-level Chrome config — required)
 */
async function copyProfileToTemp(
  userDataDir: string,
  profileName: string,
): Promise<string> {
  const tempRoot = path.join(
    os.tmpdir(),
    `browser-agent-profile-${Date.now()}`,
  );
  const tempProfileDir = path.join(tempRoot, profileName);
  fs.mkdirSync(tempProfileDir, { recursive: true });

  const srcProfileDir = path.join(userDataDir, profileName);

  // Profile-level files that carry session/auth state
  const profileFiles = [
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data For Account",
    "Web Data",
    "Preferences",
    "Bookmarks",
  ];

  for (const file of profileFiles) {
    const src = path.join(srcProfileDir, file);
    const dst = path.join(tempProfileDir, file);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    } catch (e) {
      console.warn(`[BrowserAgent] Could not copy profile file "${file}":`, e);
    }
  }

  // Copy Session Storage directory (recursive)
  const sessionStorageSrc = path.join(srcProfileDir, "Session Storage");
  const sessionStorageDst = path.join(tempProfileDir, "Session Storage");
  if (fs.existsSync(sessionStorageSrc)) {
    copyDirSync(sessionStorageSrc, sessionStorageDst);
  }

  // Copy Local State to the root of the temp user data dir (Chrome requires this)
  const localStateSrc = path.join(userDataDir, "Local State");
  const localStateDst = path.join(tempRoot, "Local State");
  try {
    if (fs.existsSync(localStateSrc)) {
      fs.copyFileSync(localStateSrc, localStateDst);
    }
  } catch (e) {
    console.warn(`[BrowserAgent] Could not copy "Local State":`, e);
  }

  console.log(
    `[BrowserAgent] Profile copied to temp dir: ${tempRoot} (profile: ${profileName})`,
  );
  return tempRoot;
}

function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    try {
      if (entry.isDirectory()) {
        copyDirSync(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    } catch {
      // Silently skip locked or inaccessible files
    }
  }
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[BrowserAgent] Cleaned up temp profile dir: ${dir}`);
  } catch (e) {
    console.warn("[BrowserAgent] Could not remove temp profile dir:", e);
  }
}

// ─── Main Session Runner ─────────────────────────────────────────────────────

/**
 * Launches a browser session using one of three strategies (in priority order):
 *
 * Strategy 1 — CDP (headless: false + useCdp: true)
 *   Connects to an already-running Chrome instance via Chrome DevTools Protocol.
 *   Chrome must be running with: --remote-debugging-port=<cdpPort>
 *   This is the BEST option: no profile copy needed, live session is used directly.
 *
 * Strategy 2 — System Chrome with profile copy (headless: false + useSystemChrome: true)
 *   Copies the user's Chrome profile (cookies, sessions) to a temp dir, then
 *   launches the system Chrome exe against that copy. All logins are preserved.
 *   Temp dir is cleaned up after the session closes.
 *
 * Strategy 3 — Playwright persistent session (fallback / headless mode)
 *   Uses Playwright's own Chromium with a persistent session stored in
 *   ~/.browser-agent-session. No system Chrome required.
 */
export async function runBrowserSession(
  enrichedPrompt: string,
  config: BrowserConfig,
): Promise<string> {
  let context: BrowserContext | undefined;
  let tempProfileDir: string | undefined;

  // ── Strategy 1: CDP — connect to running Chrome ─────────────────────────
  if (config.useCdp && !config.headless) {
    try {
      console.log(
        `[BrowserAgent] Strategy 1: Connecting to Chrome via CDP on port ${config.cdpPort}…`,
      );
      const browser = await chromium.connectOverCDP(
        `http://localhost:${config.cdpPort}`,
      );
      const existingContexts = browser.contexts();
      context = existingContexts[0] ?? (await browser.newContext());
      console.log("[BrowserAgent] ✓ Connected to running Chrome via CDP.");
    } catch (cdpError: any) {
      console.warn(
        `[BrowserAgent] CDP failed (${cdpError.message}) — Chrome may not be running with --remote-debugging-port=${config.cdpPort}. Falling back to Strategy 2.`,
      );
    }
  }

  // ── Strategy 2: System Chrome with profile copy ─────────────────────────
  if (!context && config.useSystemChrome && !config.headless) {
    try {
      const executablePath = getChromeExecutablePath();
      if (!executablePath) {
        throw new Error(
          "Google Chrome not found. Install it or disable 'browserAgent.useSystemChrome' to use the bundled browser.",
        );
      }

      const userDataDir = getChromeUserDataDir();
      const profileName = config.chromeProfile || "Default";
      const profileDir = path.join(userDataDir, profileName);

      if (!fs.existsSync(profileDir)) {
        const available = fs
          .readdirSync(userDataDir)
          .filter((d) =>
            fs.statSync(path.join(userDataDir, d)).isDirectory(),
          )
          .join(", ");
        throw new Error(
          `Chrome profile "${profileName}" not found.\n` +
            `User Data dir: ${userDataDir}\n` +
            `Available profiles: ${available || "(none found)"}`,
        );
      }

      console.log(
        `[BrowserAgent] Strategy 2: Copying Chrome profile "${profileName}" → temp dir…`,
      );
      tempProfileDir = await copyProfileToTemp(userDataDir, profileName);

      console.log(
        `[BrowserAgent] Launching Chrome at: ${executablePath}`,
      );
      context = await chromium.launchPersistentContext(tempProfileDir, {
        headless: false,
        executablePath,
        viewport: { width: 1280, height: 800 },
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-sync",
          "--disable-blink-features=AutomationControlled",
          `--profile-directory=${profileName}`,
        ],
        // Remove the "Chrome is controlled by automated software" infobbar
        ignoreDefaultArgs: ["--enable-automation"],
      });
      console.log("[BrowserAgent] ✓ Chrome launched with user profile copy.");
    } catch (error: any) {
      console.error("[BrowserAgent] Strategy 2 failed:", error.message);
      vscode.window
        .showErrorMessage(
          `[BrowserAgent] Could not launch system Chrome: ${error.message}`,
          "Open Settings",
        )
        .then((sel) => {
          if (sel === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "browserAgent",
            );
          }
        });
      throw error;
    }
  }

  // ── Strategy 3: Playwright persistent session (fallback) ────────────────
  if (!context) {
    const playwrightUserDataDir = path.join(
      os.homedir(),
      ".browser-agent-session",
    );
    const executablePath = config.useSystemChrome
      ? getChromeExecutablePath()
      : undefined;

    console.log(
      `[BrowserAgent] Strategy 3: Launching Playwright persistent context at ${playwrightUserDataDir}…`,
    );
    try {
      context = await chromium.launchPersistentContext(playwrightUserDataDir, {
        headless: config.headless,
        executablePath,
        viewport: { width: 1280, height: 800 },
        args: ["--no-first-run", "--no-default-browser-check"],
      });
      console.log("[BrowserAgent] ✓ Playwright persistent context ready.");
    } catch (error: any) {
      vscode.window
        .showErrorMessage(
          `[BrowserAgent] Failed to launch browser: ${error.message}`,
          "Open Terminal",
          "Open Settings",
        )
        .then((sel) => {
          if (sel === "Open Terminal") {
            vscode.commands.executeCommand("workbench.action.terminal.new");
          } else if (sel === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "browserAgent",
            );
          }
        });
      throw error;
    }
  }

  // ── Run the automation ────────────────────────────────────────────────────
  try {
    const page = await context.newPage();

    console.log(`[BrowserAgent] Navigating to ${config.targetUrl}…`);
    await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

    if (config.waitForManualLogin) {
      await vscode.window.showInformationMessage(
        "[BrowserAgent] Complete authentication in the browser window, then click OK.",
        "OK",
      );
    }

    const selectorTimeout = config.waitForManualLogin ? 120_000 : 30_000;
    console.log(
      `[BrowserAgent] Waiting for prompt input: ${config.promptSelector}`,
    );
    await page.waitForSelector(config.promptSelector, {
      timeout: selectorTimeout,
    });

    await page.click(config.promptSelector);
    await page.keyboard.insertText(enrichedPrompt);
    await page.waitForTimeout(800);

    console.log(`[BrowserAgent] Submitting via: ${config.submitSelector}`);
    await page.click(config.submitSelector);

    console.log(
      `[BrowserAgent] Waiting for AI response: ${config.responseSelector}`,
    );
    await page.waitForSelector(config.responseSelector, { timeout: 120_000 });

    const response = await waitForStableResponse(page, config.responseSelector);
    console.log(
      `[BrowserAgent] ✓ Response stabilised (${response.length} chars).`,
    );
    return response;
  } catch (error: any) {
    console.error("[BrowserAgent] Session error:", error);
    vscode.window.showErrorMessage(
      `[BrowserAgent] Session failed: ${error.message}`,
    );
    throw error;
  } finally {
    await context.close();
    if (tempProfileDir) {
      cleanupTempDir(tempProfileDir);
    }
  }
}

// ─── Response Stability Polling ───────────────────────────────────────────────

/**
 * Polls the response container until its text has not changed for `stableMs`.
 * Handles streaming AI responses that emit tokens progressively.
 *
 * @param stableMs  How long the text must be unchanged to be considered done (default 2s)
 * @param pollMs    How often to poll (default 300ms)
 * @param maxWaitMs Give up and return whatever we have after this duration (default 3min)
 */
async function waitForStableResponse(
  page: Page,
  selector: string,
  stableMs = 2_000,
  pollMs = 300,
  maxWaitMs = 180_000,
): Promise<string> {
  let lastText = "";
  let stableFor = 0;
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    const currentText = await page.innerText(selector).catch(() => "");

    if (currentText === lastText && currentText.length > 20) {
      stableFor += pollMs;
      if (stableFor >= stableMs) {
        return currentText;
      }
    } else {
      lastText = currentText;
      stableFor = 0;
    }

    await page.waitForTimeout(pollMs);
    elapsed += pollMs;
  }

  console.warn(
    `[BrowserAgent] Response did not stabilise within ${maxWaitMs / 1000}s — returning current text.`,
  );
  return lastText;
}
