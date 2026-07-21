import path from "node:path";

import { detectDiagramType, type RenderRequest } from "@diagram-as-code/contracts";
import { parseDiagramConfig, type DiagramConfig } from "@diagram-as-code/diagram-config";
import * as vscode from "vscode";

import { GatewayClient, RenderCoordinator, resolveOutputPath } from "./core.js";

const SECRET_PREFIX = "diagramAsCode.apiKey:";

interface ProjectContext {
  config: DiagramConfig;
  folder: vscode.WorkspaceFolder;
  apiKey: string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function previewHtml(svg: string): string {
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--vscode-editor-background);overflow:auto}img{max-width:calc(100% - 32px);max-height:calc(100% - 32px)}</style></head>
<body><img alt="Diagram preview" src="data:image/svg+xml;base64,${encoded}"></body></html>`;
}

function messageHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px}.error{color:var(--vscode-errorForeground);white-space:pre-wrap}</style></head><body><div class="error">${escapeHtml(message)}</div></body></html>`;
}

async function readProjectContext(
  extensionContext: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<ProjectContext> {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) throw new Error("Open the diagram inside a VS Code workspace");

  const configName = vscode.workspace
    .getConfiguration("diagramAsCode", document.uri)
    .get<string>("configFile", ".diagramrc.yml");
  const configUri = vscode.Uri.joinPath(folder.uri, configName);
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(configUri);
  } catch {
    throw new Error(`Cannot read ${configName}. Add the project configuration before rendering.`);
  }
  const config = parseDiagramConfig(Buffer.from(bytes).toString("utf8"));
  const envKey = process.env[config.server.apiKeyEnv];
  const storedKey = await extensionContext.secrets.get(`${SECRET_PREFIX}${config.server.url}`);
  return { config, folder, apiKey: envKey ?? storedKey };
}

class PreviewSession implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private revision = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly renderDocument: (document: vscode.TextDocument) => Promise<string>,
    private readonly debounceMs: number,
    onDispose: () => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.document.uri.toString()) this.schedule();
      }),
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (saved.uri.toString() === this.document.uri.toString()) this.schedule(0);
      }),
      panel.onDidDispose(() => {
        onDispose();
        this.dispose();
      }),
    );
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  schedule(delay = this.debounceMs): void {
    if (this.timer) clearTimeout(this.timer);
    const scheduledRevision = ++this.revision;
    this.timer = setTimeout(() => void this.update(scheduledRevision), delay);
  }

  async update(expectedRevision: number): Promise<void> {
    try {
      const svg = await this.renderDocument(this.document);
      if (expectedRevision !== this.revision) return;
      this.panel.webview.html = previewHtml(svg);
    } catch (error) {
      if (expectedRevision !== this.revision) return;
      if (error instanceof Error && /superseded|aborted/i.test(error.message)) return;
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.html = messageHtml(message);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

class DiagramController implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly coordinators = new Map<string, { fingerprint: string; coordinator: RenderCoordinator }>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async render(document: vscode.TextDocument): Promise<string> {
    const type = detectDiagramType(document.uri.fsPath);
    if (!type) throw new Error("The active file is not a supported .mmd, .puml, .dot, or .d2 diagram");
    const project = await readProjectContext(this.context, document);
    if (project.config.server.url.startsWith("https://") && !project.apiKey) {
      throw new Error("No Gateway API key found. Run Diagram: Set Gateway API Key.");
    }

    const request: RenderRequest = { type, format: "svg", source: document.getText() };
    const resource = document.uri.toString();
    const fingerprint = `${project.config.server.url}\0${project.apiKey ?? ""}`;
    let entry = this.coordinators.get(resource);
    if (!entry || entry.fingerprint !== fingerprint) {
      const client = new GatewayClient(project.config.server.url, project.apiKey);
      entry = {
        fingerprint,
        coordinator: new RenderCoordinator((renderRequest, signal) => client.render(renderRequest, signal)),
      };
      this.coordinators.set(resource, entry);
    }
    return entry.coordinator.render(resource, request);
  }

  async preview(document: vscode.TextDocument): Promise<void> {
    const resource = document.uri.toString();
    const existing = this.sessions.get(resource);
    if (existing) {
      existing.reveal();
      existing.schedule(0);
      return;
    }

    const project = await readProjectContext(this.context, document);
    const panel = vscode.window.createWebviewPanel(
      "diagramAsCode.preview",
      `Preview: ${path.basename(document.uri.fsPath)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: true },
    );
    panel.webview.html = messageHtml("Rendering...");
    const session = new PreviewSession(
      document,
      panel,
      (current) => this.render(current),
      project.config.preview.debounceMs,
      () => this.sessions.delete(resource),
    );
    this.sessions.set(resource, session);
    session.schedule(0);
  }

  async export(document: vscode.TextDocument): Promise<void> {
    const project = await readProjectContext(this.context, document);
    const outputPath = resolveOutputPath(
      project.folder.uri.fsPath,
      document.uri.fsPath,
      project.config.sources.directory,
      project.config.output.directory,
    );
    const svg = await this.render(document);
    const outputUri = vscode.Uri.file(outputPath);
    const temporaryUri = vscode.Uri.file(`${outputPath}.tmp-${process.pid}-${Date.now()}`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputPath)));
    try {
      await vscode.workspace.fs.writeFile(temporaryUri, Buffer.from(svg, "utf8"));
      await vscode.workspace.fs.rename(temporaryUri, outputUri, { overwrite: true });
    } catch (error) {
      try { await vscode.workspace.fs.delete(temporaryUri); } catch { /* Nothing to clean up. */ }
      throw error;
    }
    await vscode.window.showInformationMessage(`Exported ${vscode.workspace.asRelativePath(outputUri)}`);
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.coordinators.clear();
  }
}

function activeDocument(): vscode.TextDocument {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) throw new Error("Open a diagram source file first");
  return document;
}

async function showCommandError(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new DiagramController(context);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("diagramAsCode.preview", () =>
      showCommandError(() => controller.preview(activeDocument())),
    ),
    vscode.commands.registerCommand("diagramAsCode.exportSvg", () =>
      showCommandError(() => controller.export(activeDocument())),
    ),
    vscode.commands.registerCommand("diagramAsCode.setApiKey", () =>
      showCommandError(async () => {
        const document = activeDocument();
        const project = await readProjectContext(context, document);
        const apiKey = await vscode.window.showInputBox({
          title: "Diagram Gateway API Key",
          password: true,
          ignoreFocusOut: true,
          prompt: project.config.server.url,
        });
        if (apiKey) {
          await context.secrets.store(`${SECRET_PREFIX}${project.config.server.url}`, apiKey);
          await vscode.window.showInformationMessage("Diagram Gateway API key stored in VS Code SecretStorage");
        }
      }),
    ),
  );
}

export function deactivate(): void {}
