import * as vscode from "vscode";
import { chromium, Browser, Page } from "playwright-core";
import * as os from "os";

export class BrowserController {
  private browser?: Browser;
  private page?: Page;

  async init() {
    if (!this.browser) {
      const config = vscode.workspace.getConfiguration("browserAgent");
      const headless = config.get<boolean>("headless", false);

      let executablePath = '';
      if (os.platform() === 'win32') {
        executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      } else if (os.platform() === 'darwin') {
        executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      } else {
        executablePath = '/usr/bin/google-chrome';
      }
      
      this.browser = await chromium.launch({
        headless,
        executablePath,
        args: ['--start-maximized']
      });
      const context = await this.browser.newContext();
      this.page = await context.newPage();
    }
  }

  async ask(prompt: string, updateStatus: (msg: string) => void): Promise<string> {
    await this.init();
    if (!this.page) throw new Error("Failed to initialize browser page.");

    const config = vscode.workspace.getConfiguration("browserAgent");
    const url = config.get<string>("targetUrl", "https://www.perplexity.ai");
    const inputSelector = config.get<string>("promptSelector", "textarea");
    const responseSelector = config.get<string>("responseSelector", ".prose");

    updateStatus(`Navigating to ${url}...`);
    if (this.page.url() !== url && !this.page.url().startsWith(url)) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    
    updateStatus("Typing prompt...");
    await this.page.waitForSelector(inputSelector, { state: 'visible' });
    await this.page.fill(inputSelector, prompt);
    
    await this.page.keyboard.press('Enter');

    updateStatus("Waiting for response...");
    
    await this.page.waitForTimeout(3000); 
    await this.page.waitForSelector(responseSelector, { timeout: 60000 });
    
    let previousText = "";
    let stableCount = 0;
    while (stableCount < 3) {
      await this.page.waitForTimeout(2000);
      const elements = await this.page.$$(responseSelector);
      const lastElement = elements[elements.length - 1];
      if (!lastElement) continue;
      
      const text = await lastElement.innerText();
      if (text === previousText && text.length > 20) {
        stableCount++;
      } else {
        previousText = text;
        stableCount = 0;
      }
    }
    
    return previousText;
  }
}
