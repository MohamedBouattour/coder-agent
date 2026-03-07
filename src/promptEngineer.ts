// src/promptEngineer.ts
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

// ─── Language Map ─────────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".py": "py",
  ".java": "java",
  ".cs": "cs",
  ".go": "go",
  ".rs": "rs",
  ".rb": "rb",
  ".php": "php",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "md",
  ".sh": "sh",
  ".toml": "toml",
  ".xml": "xml",
  ".graphql": "graphql",
  ".prisma": "prisma",
  ".sql": "sql",
  ".env": "env",
};

// All DI framework decorators across NestJS, Angular, InversifyJS, tsyringe
const DI_INJECTABLE_DECORATORS = new Set([
  "Injectable",
  "Controller",
  "Service",
  "Repository",
  "Component",
  "Pipe",
  "Guard",
  "Interceptor",
  "Middleware",
  "Resolver",
  "Module",
  "Global",
  "Singleton",
  "autoInjectable",
  "provide",
  "EventSubscriber",
  "Entity",
  "OrmEntity",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".mp3",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
]);

const SKIP_DIRS_GLOB =
  "**/{node_modules,.git,dist,build,out,.next,.turbo,.cache,coverage}/**";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileMetadata {
  lang: string;
  lines: number;
  sizeKb: number;
  functions: number;
  classes: number;
  interfaces: number; // TS interfaces / abstract classes
  types: number; // TS type aliases
  exports: number; // export keyword count
  imports: number; // import / require count
  decorators: string[]; // unique decorator names found (e.g. ["Injectable", "Get"])
  injectable: boolean; // true if any DI decorator is present
  isTest: boolean; // .spec. / .test. / __tests__
  isConfig: boolean; // config / env / settings / constants files
  isEntryPoint: boolean; // main.ts / index.ts / app.module.ts
  hasDefaultExport: boolean;
}

export interface FileEntry {
  relPath: string;
  metadata: FileMetadata;
}

export interface BasicContext {
  workspaceRoot: string;
  activeFilePath: string;
  activeFileContent: string;
  selectedText: string;
  fileTree: FileEntry[];
}

export interface AgentContext extends BasicContext {
  /** Files the model requested in Phase 1 — relative path → full content */
  requestedFiles: Record<string, string>;
}

// ─── File Metadata Analysis ───────────────────────────────────────────────────

/**
 * Analyse a file's content using regex heuristics.
 * No AST parser needed — fast and accurate enough for model signals.
 */
export function analyzeFileContent(
  content: string,
  relPath: string,
  sizeBytes: number,
): FileMetadata {
  const ext = path.extname(relPath).toLowerCase();
  const lang = LANG_MAP[ext] ?? ext.replace(".", "") ?? "unknown";
  const lines = content.split("\n").length;
  const sizeKb = Math.round(sizeBytes / 1024);
  const isTS = ["ts", "tsx", "js", "jsx"].includes(lang);
  const isPy = lang === "py";
  const isJava = ["java", "cs"].includes(lang);

  // ── Functions ──────────────────────────────────────────────────────────────
  let functions = 0;
  if (isTS) {
    // named function declarations
    functions += (content.match(/\bfunction\s+\w+\s*\(/g) ?? []).length;
    // arrow functions assigned to const/let/var
    functions += (
      content.match(/\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g) ?? []
    ).length;
    // class methods: optional modifiers + name + (
    functions += (
      content.match(
        /^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*(?:get\s+|set\s+)?[\w$]+\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|&,\s?]+)?\s*\{/gm,
      ) ?? []
    ).length;
  } else if (isPy) {
    functions += (content.match(/^\s*(?:async\s+)?def\s+\w+\s*\(/gm) ?? [])
      .length;
  } else if (isJava) {
    functions += (
      content.match(
        /(?:public|private|protected|static|void|async)\s+\w+\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/g,
      ) ?? []
    ).length;
  }

  // ── Classes ────────────────────────────────────────────────────────────────
  const classes = (content.match(/\bclass\s+\w+/g) ?? []).length;

  // ── Interfaces & Types (TS) ────────────────────────────────────────────────
  const interfaces = isTS
    ? (content.match(/\b(?:interface|abstract\s+class)\s+\w+/g) ?? []).length
    : 0;
  const types = isTS
    ? (content.match(/\btype\s+\w+\s*(?:<[^>]*>)?\s*=/g) ?? []).length
    : 0;

  // ── Exports & Imports ──────────────────────────────────────────────────────
  const exports = (
    content.match(
      /\bexport\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum|abstract)/g,
    ) ?? []
  ).length;
  const imports = isTS
    ? (content.match(/\bimport\s+(?:\*|{|[\w$])/g) ?? []).length
    : (content.match(/\brequire\s*\(/g) ?? []).length +
      (content.match(/\bimport\s+/g) ?? []).length;

  // ── Decorators ─────────────────────────────────────────────────────────────
  const decoratorMatches =
    content.match(/@(\w+)(?:\s*\(|(?=\s*\n|\s+\w))/g) ?? [];
  const decoratorNames = [
    ...new Set(decoratorMatches.map((d) => d.replace(/@(\w+).*/s, "$1"))),
  ];
  const injectable = decoratorNames.some((d) =>
    DI_INJECTABLE_DECORATORS.has(d),
  );

  // ── File Role Flags ────────────────────────────────────────────────────────
  const base = path.basename(relPath).toLowerCase();
  const isTest =
    /\.(spec|test)\.[tj]sx?$/.test(relPath) || relPath.includes("__tests__");
  const isConfig =
    /^(\.env|tsconfig|jest\.config|webpack\.config|vite\.config|eslint|prettier|babel\.config|rollup\.config|nest-cli|angular\.json|next\.config)/.test(
      base,
    ) ||
    base.includes("config") ||
    base.includes("settings") ||
    base.includes("constants");
  const isEntryPoint =
    base === "main.ts" ||
    base === "index.ts" ||
    base === "index.js" ||
    base === "main.js" ||
    base === "app.ts" ||
    base === "app.module.ts" ||
    base === "server.ts" ||
    base === "server.js";
  const hasDefaultExport = /\bexport\s+default\b/.test(content);

  return {
    lang,
    lines,
    sizeKb,
    functions,
    classes,
    interfaces,
    types,
    exports,
    imports,
    decorators: decoratorNames,
    injectable,
    isTest,
    isConfig,
    isEntryPoint,
    hasDefaultExport,
  };
}

/**
 * Format a single FileEntry as a compact, information-dense line for prompts.
 *
 * Example output:
 *   src/auth/auth.service.ts   ts | 87L 5KB | cls:1 fn:6 iface:0 types:2 | @Injectable @Roles | imp:8 exp:3 | [injectable]
 *   src/main.ts                ts | 15L 1KB | cls:0 fn:1 iface:0 types:0 |                    | imp:3 exp:0 | [entry-point]
 *   src/auth/auth.spec.ts      ts | 45L 3KB | cls:0 fn:8 iface:0 types:0 |                    | imp:5 exp:0 | [test]
 */
export function formatFileEntry(entry: FileEntry): string {
  const { relPath, metadata: m } = entry;

  const flags: string[] = [];
  if (m.injectable) flags.push("injectable");
  if (m.isEntryPoint) flags.push("entry-point");
  if (m.isTest) flags.push("test");
  if (m.isConfig) flags.push("config");
  if (m.hasDefaultExport) flags.push("default-export");

  const decoratorStr =
    m.decorators.length > 0 ? m.decorators.map((d) => `@${d}`).join(" ") : "-";

  const flagStr = flags.length > 0 ? `[${flags.join(" ")}]` : "";

  const paddedPath = relPath.padEnd(55);
  return (
    `${paddedPath} ${m.lang.padEnd(6)} | ` +
    `${String(m.lines).padStart(4)}L ${String(m.sizeKb).padStart(3)}KB | ` +
    `cls:${m.classes} fn:${m.functions} iface:${m.interfaces} types:${m.types} | ` +
    `${decoratorStr.padEnd(30)} | ` +
    `imp:${m.imports} exp:${m.exports} | ` +
    flagStr
  );
}

// ─── File Tree Builder ────────────────────────────────────────────────────────

const MAX_ANALYSIS_FILE_BYTES = 512 * 1024; // 512 KB — skip analysis above this

/**
 * Build the full enriched file tree with metadata for every file.
 * Files are read in parallel with a concurrency cap of 30.
 */
export async function buildFileTree(
  workspaceRoot: string,
): Promise<FileEntry[]> {
  const uris = await vscode.workspace.findFiles("**/*", SKIP_DIRS_GLOB);

  // Filter out known binary/non-text files
  const textUris = uris.filter((uri) => {
    const ext = path.extname(uri.fsPath).toLowerCase();
    return !BINARY_EXTENSIONS.has(ext);
  });

  const CONCURRENCY = 30;
  const results: FileEntry[] = [];

  // Process in batches to avoid overwhelming the file system
  for (let i = 0; i < textUris.length; i += CONCURRENCY) {
    const batch = textUris.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (uri): Promise<FileEntry> => {
        const relPath = vscode.workspace.asRelativePath(uri);
        try {
          const stat = await fs.stat(uri.fsPath);
          if (stat.size > MAX_ANALYSIS_FILE_BYTES) {
            // Too large to analyse — return minimal metadata
            return {
              relPath,
              metadata: {
                lang:
                  LANG_MAP[path.extname(relPath).toLowerCase()] ?? "unknown",
                lines: 0,
                sizeKb: Math.round(stat.size / 1024),
                functions: 0,
                classes: 0,
                interfaces: 0,
                types: 0,
                exports: 0,
                imports: 0,
                decorators: [],
                injectable: false,
                isTest: false,
                isConfig: false,
                isEntryPoint: false,
                hasDefaultExport: false,
              },
            };
          }
          const content = await fs.readFile(uri.fsPath, "utf-8");
          return {
            relPath,
            metadata: analyzeFileContent(content, relPath, stat.size),
          };
        } catch {
          return {
            relPath,
            metadata: {
              lang: "unknown",
              lines: 0,
              sizeKb: 0,
              functions: 0,
              classes: 0,
              interfaces: 0,
              types: 0,
              exports: 0,
              imports: 0,
              decorators: [],
              injectable: false,
              isTest: false,
              isConfig: false,
              isEntryPoint: false,
              hasDefaultExport: false,
            },
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  // Sort: entry-points first, then by path
  return results.sort((a, b) => {
    if (a.metadata.isEntryPoint !== b.metadata.isEntryPoint)
      return a.metadata.isEntryPoint ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
}

// ─── Phase 1: File Discovery Prompt ──────────────────────────────────────────

/**
 * Build the discovery prompt. The model sees the full annotated file tree
 * and must return a JSON array of which files it needs to read in full.
 */
export function buildFileDiscoveryPrompt(
  userPrompt: string,
  context: BasicContext,
): string {
  const annotatedTree = context.fileTree.map(formatFileEntry).join("\n");

  return `[SYSTEM]
You are an expert software engineer performing a mandatory pre-analysis step.

Your ONLY task right now is to decide which files you need to read in full
before you can safely and correctly complete the user's request.

Rules:
- Respond with ONLY a valid JSON array of relative file paths. No prose, no markdown fence.
- Choose files from the annotated file tree below.
- The tree shows for each file: language, lines, size, class/function/interface/type counts,
  detected decorators, import/export counts, and role flags (injectable, entry-point, test, config).
- Use these signals to prioritise: prefer injectable services, shared types/interfaces,
  config files, and direct imports of the active file.
- Exclude test files unless the request is about tests.
- Exclude lock files, generated files, dist/, coverage/.
- Limit to the 15 most relevant files.
- If the active file alone is sufficient, return an array containing only that path.
- If nothing is needed beyond what is already shown, return [].

Response format (strict — no deviation):
["relative/path/file1.ts", "relative/path/file2.ts"]

[CONTEXT]
Workspace root : ${context.workspaceRoot}
Active file    : ${context.activeFilePath}
Selected code  :
${context.selectedText || "none"}

Annotated file tree:
${annotatedTree}

[USER REQUEST]
${userPrompt}
`;
}

// ─── Phase 1: Response Parsing ────────────────────────────────────────────────

/**
 * Extract and validate file paths from the model's Phase 1 JSON response.
 * Strips markdown fences, validates against known file tree, guards traversal.
 */
export function parseRequestedFiles(
  aiResponse: string,
  fileTree: FileEntry[],
): string[] {
  const validPaths = new Set(fileTree.map((e) => e.relPath));

  // Strip optional markdown code fences
  const stripped = aiResponse
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1")
    .trim();

  const jsonMatch = stripped.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) {
    vscode.window.showWarningMessage(
      "[BrowserAgent] Phase 1: No JSON array found — proceeding with active file only.",
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    vscode.window.showWarningMessage(
      "[BrowserAgent] Phase 1: JSON parse failed.",
    );
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/^[./\\]+/, "")) // normalize leading slashes/dots
    .filter((p) => {
      if (!validPaths.has(p)) {
        console.warn(`[BrowserAgent] Ignoring hallucinated path: "${p}"`);
        return false;
      }
      return true;
    })
    .filter((p, i, arr) => arr.indexOf(p) === i); // deduplicate
}

// ─── Phase 2: File Loading ────────────────────────────────────────────────────

const MAX_LOAD_FILE_BYTES = 200 * 1024; // 200 KB per file in context

/**
 * Read requested file contents from disk.
 * Enforces workspace boundary and truncates oversized files.
 */
export async function loadRequestedFiles(
  relativePaths: string[],
  workspaceRoot: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const normalizedRoot = path.normalize(workspaceRoot);

  await Promise.all(
    relativePaths.map(async (relPath) => {
      const absPath = path.resolve(workspaceRoot, relPath);

      // Security: reject any path escaping the workspace root
      if (
        !absPath.startsWith(normalizedRoot + path.sep) &&
        absPath !== normalizedRoot
      ) {
        console.warn(`[BrowserAgent] Blocked path traversal: "${relPath}"`);
        return;
      }

      try {
        const stat = await fs.stat(absPath);
        let content = await fs.readFile(absPath, "utf-8");
        if (stat.size > MAX_LOAD_FILE_BYTES) {
          content =
            content.slice(0, MAX_LOAD_FILE_BYTES) +
            "\n\n[... FILE TRUNCATED AT 200KB ...]";
        }
        result[relPath] = content;
      } catch {
        console.warn(`[BrowserAgent] Could not read: "${relPath}"`);
      }
    }),
  );

  return result;
}

// ─── Phase 2: Enriched Task Prompt ───────────────────────────────────────────

/**
 * Build the full task prompt with annotated file tree + requested file contents.
 */
export function buildEnrichedPrompt(
  userPrompt: string,
  context: AgentContext,
): string {
  const annotatedTree = context.fileTree.map(formatFileEntry).join("\n");
  const selectionStr = context.selectedText || "none";

  const requestedFilesSection =
    Object.keys(context.requestedFiles).length > 0
      ? Object.entries(context.requestedFiles)
          .map(([filePath, content]) => {
            const entry = context.fileTree.find((e) => e.relPath === filePath);
            const meta = entry
              ? `<!-- ${formatFileEntry(entry).trim()} -->`
              : "";
            const lang = entry?.metadata.lang ?? "";
            return `#### ${filePath}\n${meta}\n\`\`\`${lang}\n${content}\n\`\`\``;
          })
          .join("\n\n")
      : "_No additional files were loaded._";

  return `[SYSTEM]
You are an expert software engineer assistant.
Respond ONLY with file changes using this exact format for every modified or created file:

### FILE: <relative/path/to/file>
\`\`\`<lang>
<complete new file content>
\`\`\`

Rules:
- Output ONLY the blocks above — no prose, no explanation outside those blocks.
- Always output the FULL file content — never partial diffs or snippets.
- Use the exact relative path from the workspace root.
- If no files need changing, respond with exactly: NO_CHANGES

[CONTEXT]
Workspace root : ${context.workspaceRoot}
Active file    : ${context.activeFilePath}
Selected code  :
${selectionStr}

Active file content:
\`\`\`
${context.activeFileContent}
\`\`\`

Annotated file tree:
${annotatedTree}

Additional files you requested during pre-analysis:
${requestedFilesSection}

[USER REQUEST]
${userPrompt}
`;
}

// ─── Context Builders ─────────────────────────────────────────────────────────

/**
 * Phase 1: Collect context with full annotated file tree (no heavy file loading yet).
 */
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
    activeFileContent = activeEditor.document.getText();
    selectedText = activeEditor.document.getText(activeEditor.selection);
  }

  const fileTree = await buildFileTree(workspaceRoot);

  return {
    workspaceRoot,
    activeFilePath,
    activeFileContent,
    selectedText,
    fileTree,
  };
}

/**
 * Phase 2: Enrich basic context with the specific files the model requested.
 */
export async function enrichContext(
  basic: BasicContext,
  requestedPaths: string[],
): Promise<AgentContext> {
  const requestedFiles = await loadRequestedFiles(
    requestedPaths,
    basic.workspaceRoot,
  );
  return { ...basic, requestedFiles };
}

// ─── Two-Phase Orchestrator ───────────────────────────────────────────────────

/**
 * Full two-phase pipeline:
 *   Phase 1 — send annotated file tree → model responds with file list
 *   Phase 2 — load those files → build enriched prompt → ready for task
 *
 * @param userPrompt  Raw user request
 * @param runBrowser  Callback that sends a prompt to the AI and returns response
 *
 * @example
 *   // In extension.ts command handler:
 *   const context = await runTwoPhaseContextBuild(userPrompt, runBrowserSession);
 *   if (!context) return;
 *   const taskPrompt = buildEnrichedPrompt(userPrompt, context);
 *   const aiResponse = await runBrowserSession(taskPrompt);
 *   await applyChanges(aiResponse);
 */
export async function runTwoPhaseContextBuild(
  userPrompt: string,
  runBrowser: (prompt: string) => Promise<string>,
): Promise<AgentContext | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Browser Agent",
      cancellable: false,
    },
    async (progress) => {
      // ── Phase 1: Discovery ───────────────────────────────────────────────
      progress.report({
        increment: 0,
        message:
          "Phase 1/2 — analysing workspace & asking model which files to scan…",
      });

      const basic = await getBasicContext();
      if (!basic) {
        vscode.window.showErrorMessage(
          "[BrowserAgent] No workspace folder open.",
        );
        return undefined;
      }

      const discoveryPrompt = buildFileDiscoveryPrompt(userPrompt, basic);

      let phase1Response: string;
      try {
        phase1Response = await runBrowser(discoveryPrompt);
      } catch (err) {
        vscode.window.showErrorMessage(
          `[BrowserAgent] Phase 1 browser error: ${err}`,
        );
        return undefined;
      }

      const requestedPaths = parseRequestedFiles(
        phase1Response,
        basic.fileTree,
      );

      // ── Phase 2: Load & Enrich ───────────────────────────────────────────
      progress.report({
        increment: 50,
        message: `Phase 2/2 — loading ${requestedPaths.length} file(s) into context…`,
      });

      const fullContext = await enrichContext(basic, requestedPaths);

      const loadedSummary = requestedPaths
        .map((p) => {
          const entry = basic.fileTree.find((e) => e.relPath === p);
          return entry
            ? `${p} (${entry.metadata.lines}L, ${entry.metadata.sizeKb}KB)`
            : p;
        })
        .join(", ");

      if (requestedPaths.length > 0) {
        vscode.window.showInformationMessage(
          `[BrowserAgent] Context loaded ${requestedPaths.length} file(s): ${loadedSummary}`,
        );
      } else {
        vscode.window.showInformationMessage(
          "[BrowserAgent] Model needs no additional files — proceeding with active file.",
        );
      }

      progress.report({
        increment: 100,
        message: "Context ready — running task…",
      });
      return fullContext;
    },
  );
}
