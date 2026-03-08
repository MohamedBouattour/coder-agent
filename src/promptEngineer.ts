import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

const LANG_MAP: Record<string, string> = { ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".py": "py", ".java": "java", ".cs": "cs", ".go": "go", ".rs": "rs", ".rb": "rb", ".php": "php", ".vue": "vue", ".svelte": "svelte", ".css": "css", ".scss": "scss", ".less": "less", ".html": "html", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "md", ".sh": "sh", ".toml": "toml", ".xml": "xml", ".graphql": "graphql", ".prisma": "prisma", ".sql": "sql", ".env": "env" };
const DI_INJECTABLE_DECORATORS = new Set(["Injectable", "Controller", "Service", "Repository", "Component", "Pipe", "Guard", "Interceptor", "Middleware", "Resolver", "Module", "Global", "Singleton", "autoInjectable", "provide", "EventSubscriber", "Entity", "OrmEntity"]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".mp3", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".lock"]);
const SKIP_DIRS_GLOB = "**/{node_modules,.git,dist,build,out,.next,.turbo,.cache,coverage}/**";

export interface FileMetadata {
  lang: string; lines: number; sizeKb: number; functions: number; classes: number; interfaces: number; types: number; exports: number; imports: number; decorators: string[]; injectable: boolean; isTest: boolean; isConfig: boolean; isEntryPoint: boolean; hasDefaultExport: boolean;
}
export interface FileEntry { relPath: string; metadata: FileMetadata; }
export interface BasicContext { workspaceRoot: string; activeFilePath: string; activeFileContent: string; selectedText: string; fileTree: FileEntry[]; }
export interface AgentContext extends BasicContext { requestedFiles: Record<string, string>; }

export function analyzeFileContent(content: string, relPath: string, sizeBytes: number): FileMetadata {
  const ext = path.extname(relPath).toLowerCase();
  const lang = LANG_MAP[ext] ?? ext.replace(".", "") ?? "unknown";
  const lines = content.split("\n").length;
  const sizeKb = Math.round(sizeBytes / 1024);
  const isTS = ["ts", "tsx", "js", "jsx"].includes(lang);

  let functions = 0;
  if (isTS) {
    functions += (content.match(/\bfunction\s+\w+\s*\(/g) ?? []).length;
    functions += (content.match(/\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g) ?? []).length;
    functions += (content.match(/^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*(?:get\s+|set\s+)?[[\w$]+\s*\([^)]*\)\s*(?::\s*[\w<>[\]|&,\s?]+)?\s*\{/gm) ?? []).length;
  }
  const classes = (content.match(/\bclass\s+\w+/g) ?? []).length;
  const interfaces = isTS ? (content.match(/\b(?:interface|abstract\s+class)\s+\w+/g) ?? []).length : 0;
  const types = isTS ? (content.match(/\btype\s+\w+\s*(?:<[^>]*>)?\s*=/g) ?? []).length : 0;
  const exports = (content.match(/\bexport\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum|abstract)/g) ?? []).length;
  const imports = isTS ? (content.match(/\bimport\s+(?:\*|{|[\w$])/g) ?? []).length : (content.match(/\brequire\s*\(/g) ?? []).length + (content.match(/\bimport\s+/g) ?? []).length;
  const decoratorMatches = content.match(/@(\w+)(?:\s*\(|(?=\s*\n|\s+\w))/g) ?? [];
  const decoratorNames = [...new Set(decoratorMatches.map((d) => d.replace(/@(\w+).*/s, "$1")))];
  const injectable = decoratorNames.some((d) => DI_INJECTABLE_DECORATORS.has(d));

  const base = path.basename(relPath).toLowerCase();
  const isTest = /\.(spec|test)\.[tj]sx?$/.test(relPath) || relPath.includes("__tests__");
  const isConfig = /^(\.env|tsconfig|jest\.config|webpack\.config|vite\.config|eslint|prettier|babel\.config|rollup\.config|nest-cli|angular\.json|next\.config)/.test(base) || base.includes("config") || base.includes("settings") || base.includes("constants");
  const isEntryPoint = ["main.ts", "index.ts", "index.js", "main.js", "app.ts", "app.module.ts", "server.ts", "server.js"].includes(base);
  const hasDefaultExport = /\bexport\s+default\b/.test(content);

  return { lang, lines, sizeKb, functions, classes, interfaces, types, exports, imports, decorators: decoratorNames, injectable, isTest, isConfig, isEntryPoint, hasDefaultExport };
}

export function formatFileEntry(entry: FileEntry): string {
  const { relPath, metadata: m } = entry;
  const flags: string[] = [];
  if (m.injectable) flags.push("injectable");
  if (m.isEntryPoint) flags.push("entry-point");
  if (m.isTest) flags.push("test");
  if (m.isConfig) flags.push("config");
  if (m.hasDefaultExport) flags.push("default-export");

  const decoratorStr = m.decorators.length > 0 ? m.decorators.map((d) => `@${d}`).join(" ") : "-";
  const flagStr = flags.length > 0 ? `[${flags.join(" ")}]` : "";

  return `${relPath.padEnd(55)} ${m.lang.padEnd(6)} | ${String(m.lines).padStart(4)}L ${String(m.sizeKb).padStart(3)}KB | cls:${m.classes} fn:${m.functions} iface:${m.interfaces} types:${m.types} | ${decoratorStr.padEnd(30)} | imp:${m.imports} exp:${m.exports} | ${flagStr}`;
}

const MAX_ANALYSIS_FILE_BYTES = 512 * 1024;
export async function buildFileTree(workspaceRoot: string): Promise<FileEntry[]> {
  const uris = await vscode.workspace.findFiles("**/*", SKIP_DIRS_GLOB);
  const textUris = uris.filter((uri) => !BINARY_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase()));
  const CONCURRENCY = 30;
  const results: FileEntry[] = [];

  for (let i = 0; i < textUris.length; i += CONCURRENCY) {
    const batch = textUris.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (uri): Promise<FileEntry> => {
        const relPath = vscode.workspace.asRelativePath(uri);
        try {
          const stat = await fs.stat(uri.fsPath);
          if (stat.size > MAX_ANALYSIS_FILE_BYTES) return { relPath, metadata: { lang: LANG_MAP[path.extname(relPath).toLowerCase()] ?? "unknown", lines: 0, sizeKb: Math.round(stat.size / 1024), functions: 0, classes: 0, interfaces: 0, types: 0, exports: 0, imports: 0, decorators: [], injectable: false, isTest: false, isConfig: false, isEntryPoint: false, hasDefaultExport: false } };
          const content = await fs.readFile(uri.fsPath, "utf-8");
          return { relPath, metadata: analyzeFileContent(content, relPath, stat.size) };
        } catch {
          return { relPath, metadata: { lang: "unknown", lines: 0, sizeKb: 0, functions: 0, classes: 0, interfaces: 0, types: 0, exports: 0, imports: 0, decorators: [], injectable: false, isTest: false, isConfig: false, isEntryPoint: false, hasDefaultExport: false } };
        }
      })
    );
    results.push(...batchResults);
  }
  return results.sort((a, b) => a.metadata.isEntryPoint !== b.metadata.isEntryPoint ? (a.metadata.isEntryPoint ? -1 : 1) : a.relPath.localeCompare(b.relPath));
}

export function buildPhase1Prompt(userPrompt: string, context: BasicContext, pkgContent: string): string {
  const annotatedTree = context.fileTree.map(formatFileEntry).join("\n");
  return `[SYSTEM]
You are a senior principal engineer performing a mandatory pre-analysis.
Your ONLY task is to decide which files you need to read in full to satisfy the user's request, and output an improved prompt.

Rules:
- Respond ONLY with a valid JSON object matching this schema: { "files": ["rel/path/file.ts"], "improvedPrompt": "Refined and detailed user instructions" }
- Choose files from the annotated file tree below.
- Limit to the 10 most relevant files. If none needed, return [].

[CONTEXT]
Workspace root: ${context.workspaceRoot}
Active file: ${context.activeFilePath}
Package.json (if any):
\`\`\`json
${pkgContent.slice(0, 1000)}
\`\`\`

Annotated file tree:
${annotatedTree}

[USER REQUEST]
${userPrompt}
`;
}

export function parsePhase1Response(aiResponse: string, fileTree: FileEntry[]): { files: string[], improvedPrompt: string } {
  const validPaths = new Set(fileTree.map((e) => e.relPath));
  const stripped = aiResponse.replace(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/g, "$1").trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) return { files: [], improvedPrompt: "" };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const files = (Array.isArray(parsed.files) ? parsed.files : [])
      .filter((p: any) => typeof p === "string")
      .map((p: string) => p.replace(/^[./\\]+/, ""))
      .filter((p: string) => validPaths.has(p))
      .filter((p: string, i: number, arr: string[]) => arr.indexOf(p) === i);
    
    return { files, improvedPrompt: parsed.improvedPrompt || "" };
  } catch {
    return { files: [], improvedPrompt: "" };
  }
}

function compressCode(code: string): string {
  let compressed = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''); 
  compressed = compressed.replace(/import\s+.*?from\s+['"].*?['"];?/gs, ''); 
  compressed = compressed.replace(/\s+/g, ' ').trim(); 
  return compressed;
}

const MAX_LOAD_FILE_BYTES = 200 * 1024;
export async function loadRequestedFiles(relativePaths: string[], workspaceRoot: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const normalizedRoot = path.normalize(workspaceRoot);

  await Promise.all(
    relativePaths.map(async (relPath) => {
      const absPath = path.resolve(workspaceRoot, relPath);
      if (!absPath.startsWith(normalizedRoot + path.sep) && absPath !== normalizedRoot) return;
      try {
        const stat = await fs.stat(absPath);
        let content = await fs.readFile(absPath, "utf-8");
        if (stat.size > MAX_LOAD_FILE_BYTES) content = content.slice(0, MAX_LOAD_FILE_BYTES) + "\n\n[... FILE TRUNCATED AT 200KB ...]";
        result[relPath] = compressCode(content);
      } catch {}
    })
  );
  return result;
}

export function buildPhase2Prompt(improvedPrompt: string, context: AgentContext): string {
  const requestedFilesSection = Object.keys(context.requestedFiles).length > 0
      ? Object.entries(context.requestedFiles)
          .map(([filePath, content]) => `#### ${filePath}\n\`\`\`\n${content}\n\`\`\``)
          .join("\n\n")
      : "_No additional files._";

  return `[SYSTEM]
You are an expert software engineer assistant practicing DDD and Clean Architecture.
Respond ONLY with file changes using this exact format for every modified or created file:

### FILE: <relative/path/to/file>
\`\`\`<lang>
<complete new file content>
\`\`\`

Rules:
- Output ONLY the blocks above — no prose, no explanation outside those blocks.
- Always output the FULL file content — never partial diffs or snippets.
- Keep architecture simple and SOLID. Remove unused deps/code.

[CONTEXT]
Compressed code (comments/imports/whitespace removed for compactness):
${requestedFilesSection}

[USER TASK]
${improvedPrompt}
`;
}

export async function getBasicContext(): Promise<BasicContext | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return undefined;

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const activeEditor = vscode.window.activeTextEditor;
  let activeFilePath = "none";
  let activeFileContent = "none";
  let selectedText = "";

  if (activeEditor) {
    activeFilePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
    activeFileContent = compressCode(activeEditor.document.getText());
    selectedText = activeEditor.document.getText(activeEditor.selection);
  }

  const fileTree = await buildFileTree(workspaceRoot);
  return { workspaceRoot, activeFilePath, activeFileContent, selectedText, fileTree };
}

export async function enrichContext(basic: BasicContext, requestedPaths: string[]): Promise<AgentContext> {
  const requestedFiles = await loadRequestedFiles(requestedPaths, basic.workspaceRoot);
  return { ...basic, requestedFiles };
}
