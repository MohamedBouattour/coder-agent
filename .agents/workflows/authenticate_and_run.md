---
description: How to authenticate and run the Browser Agent with persistence
---

To authenticate and run the Browser Agent with session persistence, follow these steps:

1. **Launch Extension Host**:
   - Open the `browser-agent` project in VS Code.
   - Press `F5` to start the Extension Development Host.

2. **Open Browser Agent Panel**:
   - In the sidebar (robot icon), find the "Browser Agent" tab.

3. **Configure Session Settings**:
   - Uncheck **Headless Mode** (so you can see the browser).
   - Check **Persist Session** (to save cookies/login state).
   - Check **Wait for Manual Login** (the agent will pause for you to authenticate).
   - Check **Use OS Default Browser** (to use your system's default browser like Chrome or Edge).

4. **Run the Agent**:
   - Enter your prompt in the text area.
   - Select your target AI site (e.g., Perplexity or Claude).
   - Click **Run Agent**.

5. **Perform Manual Authentication**:
   - A browser window will open.
   - If Cloudflare or a login screen appears, complete it manually.
   - Once you are on the main chat page, click **OK** on the VS Code information message.

6. **Observe the Agent**:
   - The agent will automatically type your prompt and submit it.
   - You can watch the steps in the browser window.
   - Once the response is stable, it will be returned to VS Code.

// turbo 7. **Build the extension**:
Run `npm run compile-build` in the project root to ensure all latest changes are included.
