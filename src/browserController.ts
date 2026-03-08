import * as vscode from "vscode";

export async function openDefaultBrowser(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
