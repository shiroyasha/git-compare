import * as vscode from "vscode";
import { ChangedTreeNode } from "./changedFilesModel";
import { FileStatus } from "./gitService";

export interface OpenDiffPayload {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

export interface GitCompareViewState {
  baseBranch: string;
  nodes: ChangedTreeNode[];
}

interface GitCompareWebviewCallbacks {
  onRefresh: () => void;
  onSetBaseBranch: () => void;
  onOpenDiff: (payload: OpenDiffPayload) => void;
}

export class GitCompareWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: GitCompareViewState = {
    baseBranch: "main",
    nodes: [],
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: GitCompareWebviewCallbacks
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const data = message as { type?: string; payload?: OpenDiffPayload };
      switch (data.type) {
        case "refresh":
          this.callbacks.onRefresh();
          break;
        case "setBaseBranch":
          this.callbacks.onSetBaseBranch();
          break;
        case "openDiff":
          if (data.payload?.path && data.payload?.status) {
            this.callbacks.onOpenDiff(data.payload);
          }
          break;
      }
    });

    this.render();
  }

  setState(nextState: GitCompareViewState): void {
    this.state = nextState;
    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = getWebviewHtml(this.view.webview, this.state, this.extensionUri);
  }
}

function getWebviewHtml(
  webview: vscode.Webview,
  state: GitCompareViewState,
  extensionUri: vscode.Uri
): string {
  const nonce = createNonce();
  const codiconCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css")
  );
  const content = state.nodes.map(renderNode).join("");
  const totals = getTotals(state.nodes);
  const plusSummary = totals.additions > 0 ? `<span class="plus">+${totals.additions}</span>` : "";
  const minusSummary = totals.deletions > 0 ? `<span class="minus">-${totals.deletions}</span>` : "";
  const summarySeparator = plusSummary && minusSummary ? " " : "";
  const summaryHtml = `${plusSummary}${summarySeparator}${minusSummary}`;
  const emptyState = state.nodes.length === 0 ? `<div class="empty">No changed files</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${codiconCssUri}" rel="stylesheet" />
  <style>
    :root {
      --gc-bg: var(--vscode-sideBar-background);
      --gc-fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
      --gc-muted: var(--vscode-descriptionForeground);
      --gc-border: var(--vscode-sideBar-border, var(--vscode-panel-border));
      --gc-hover: var(--vscode-list-hoverBackground);
      --gc-hover-fg: var(--vscode-list-hoverForeground, var(--gc-fg));
      --gc-tree-gutter: 18px;
    }
    body {
      margin: 0;
      padding: 0;
      color: var(--gc-fg);
      background: var(--gc-bg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--gc-bg);
      border-bottom: 1px solid var(--gc-border);
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .base {
      color: var(--gc-muted);
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .summary {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      font-size: 0.9em;
    }
    .container {
      padding: 6px 4px 12px 4px;
    }
    details {
      margin: 0;
      padding: 0;
    }
    summary {
      cursor: pointer;
      list-style: none;
      margin: 0;
      padding: 2px 6px;
      border-radius: 4px;
      user-select: none;
      display: flex;
      align-items: center;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary:hover {
      background: var(--gc-hover);
      color: var(--gc-hover-fg);
    }
    .folder-chevron {
      color: var(--vscode-icon-foreground, var(--vscode-descriptionForeground));
      width: 8px;
      margin-right: 10px;
      flex: 0 0 auto;
      line-height: 8px;
    }
    .folder-chevron::before {
      font-size: 12px;
    }
    .folder-chevron.down {
      display: none;
    }
    details[open] > summary .folder-chevron.down {
      display: inline-block;
    }
    details[open] > summary .folder-chevron.right {
      display: none;
    }
    .children {
      margin-left: var(--gc-tree-gutter);
    }
    .file-row {
      width: 100%;
      border: none;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .file-row:hover {
      background: var(--gc-hover);
      color: var(--gc-hover-fg);
    }
    .name {
      color: inherit;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .counts {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      font-size: 0.9em;
    }
    .plus {
      color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-terminal-ansiGreen));
    }
    .minus {
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-terminal-ansiRed));
    }
    .empty {
      color: var(--gc-muted);
      padding: 8px 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="base">Base: ${escapeHtml(state.baseBranch)}</div>
    <div class="summary">${summaryHtml}</div>
  </div>
  <div class="container">
    ${emptyState}
    ${content}
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.querySelectorAll("[data-file]").forEach((el) => {
      el.addEventListener("click", () => {
        const path = el.getAttribute("data-path");
        const status = el.getAttribute("data-status");
        const oldPath = el.getAttribute("data-old-path") || undefined;
        if (!path || !status) {
          return;
        }
        vscode.postMessage({
          type: "openDiff",
          payload: { path, status, oldPath },
        });
      });
    });
  </script>
</body>
</html>`;
}

function renderNode(node: ChangedTreeNode): string {
  if (node.type === "folder") {
    const children = node.children.map(renderNode).join("");
    return `<details open>
      <summary>
        <span class="codicon codicon-chevron-right folder-chevron right" aria-hidden="true"></span>
        <span class="codicon codicon-chevron-down folder-chevron down" aria-hidden="true"></span>
        <span class="folder-label">${escapeHtml(node.label)}</span>
      </summary>
      <div class="children">${children}</div>
    </details>`;
  }

  const plusPart = node.additions > 0 ? `<span class="plus">+${node.additions}</span>` : "";
  const minusPart = node.deletions > 0 ? `<span class="minus">-${node.deletions}</span>` : "";
  const separator = plusPart && minusPart ? " " : "";

  return `<button
      type="button"
      class="file-row"
      data-file="1"
      data-path="${escapeAttribute(node.path)}"
      data-status="${escapeAttribute(node.status)}"
      data-old-path="${escapeAttribute(node.oldPath ?? "")}"
      title="${escapeAttribute(`${node.path} — ${node.status}`)}"
    >
      <span class="name">${escapeHtml(node.label)}</span>
      <span class="counts">${plusPart}${separator}${minusPart}</span>
    </button>`;
}

function getTotals(nodes: ChangedTreeNode[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const node of nodes) {
    if (node.type === "file") {
      additions += node.additions;
      deletions += node.deletions;
      continue;
    }

    const childTotals = getTotals(node.children);
    additions += childTotals.additions;
    deletions += childTotals.deletions;
  }

  return { additions, deletions };
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(input: string): string {
  return escapeHtml(input);
}
