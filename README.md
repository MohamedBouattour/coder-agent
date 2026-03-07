# BrowserAgent VS Code Extension

BrowserAgent is a deep-integration AI assistant that uses Playwright to interact with AI chat interfaces (like Claude or ChatGPT) directly from VS Code.

## Features

- **Context Injection**: Automatically sends your file tree, active file content, and selected code to the AI.
- **Browser Automation**: Uses Playwright to navigate, type, and extract responses from AI sites.
- **Smart File Application**: Parses AI responses for file blocks and applies them to your workspace with a diff preview.
- **Configurable**: Headless mode, target URLs, and CSS selectors are all customizable.

## Setup Instructions

### 1. Install Dependencies

Run the following in the `browser-agent` directory:

```bash
npm install
```

### 2. Install Playwright Browsers

The extension requires Chromium to be installed via Playwright:

```bash
npx playwright install chromium
```

### 3. Build the Extension

Build the extension using the defined esbuild script:

```bash
npm run compile-build
```

### 4. Run/Debug

1. Open this folder in VS Code.
2. Press `F5` to start a new "Extension Development Host" window.
3. Find the "Browser Agent" tab in the Activity Bar (robot icon).

## Configuration

You can customize the following settings in VS Code:

- `browserAgent.headless`: Toggle between headed and headless browser.
- `browserAgent.targetUrl`: The AI site to use (default: Claude).
- `browserAgent.promptSelector`: CSS selector for the AI site's input.
- `browserAgent.submitSelector`: CSS selector for the AI site's submit button.
- `browserAgent.responseSelector`: CSS selector for the AI site's response container.

## Usage

1. Open a workspace and select some code or open a file.
2. Open the Browser Agent sidebar.
3. Enter your request (e.g., "Add a unit test for this function").
4. Click "Run Agent".
5. Wait for the browser session to complete.
6. Review the extracted response and click "Apply Changes" to see a diff and commit the code.

## Safety

BrowserAgent always routes file changes through `vscode.WorkspaceEdit` and shows a diff preview before applying changes. No files are written directly to disk without your confirmation.
