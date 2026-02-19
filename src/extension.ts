import * as vscode from "vscode";
import { GitCompareProvider, DECORATION_SCHEME } from "./gitCompareProvider";

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  const provider = new GitCompareProvider(workspaceRoot);

  const treeView = vscode.window.createTreeView("gitCompareTree", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  treeView.description = provider.getBaseBranch();

  context.subscriptions.push(
    treeView,

    vscode.commands.registerCommand("gitCompare.refresh", () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand("gitCompare.openDiff", async (fileNode) => {
      if (!fileNode || fileNode.type !== "file") {
        return;
      }

      const gitService = provider.getGitService();
      const filePath = fileNode.relativePath;
      const rightUri = vscode.Uri.file(gitService.getAbsolutePath(filePath));

      if (fileNode.status === "A") {
        await vscode.commands.executeCommand("vscode.open", rightUri);
        return;
      }

      if (fileNode.status === "D") {
        const mergeBase = await gitService.getMergeBaseRef(provider.getBaseBranch());
        const leftUri = vscode.Uri.parse(`git-compare-base:${filePath}?${mergeBase}`);
        await vscode.commands.executeCommand("vscode.open", leftUri);
        return;
      }

      try {
        const mergeBase = await gitService.getMergeBaseRef(provider.getBaseBranch());
        const baseRef = mergeBase.substring(0, 8);
        const leftUri = toGitUri(filePath, mergeBase, workspaceRoot);
        const title = `${filePath} (${baseRef} ↔ Working Tree)`;
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to open diff: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("gitCompare.setBaseBranch", async () => {
      const gitService = provider.getGitService();
      let branches: string[];
      try {
        branches = await gitService.getBranches();
      } catch {
        branches = ["main", "master", "develop"];
      }

      const picked = await vscode.window.showQuickPick(branches, {
        placeHolder: `Current base: ${provider.getBaseBranch()}. Pick a new base branch.`,
      });

      if (picked) {
        provider.setBaseBranch(picked);
        treeView.description = picked;
      }
    }),

    registerBaseContentProvider(workspaceRoot),
    registerFileDecorationProvider()
  );

  const gitWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, ".git/HEAD")
  );
  gitWatcher.onDidChange(() => provider.refresh());
  context.subscriptions.push(gitWatcher);
}

/**
 * Registers a text document content provider that serves file contents
 * at a specific git commit, used as the left side of the diff view.
 */
function registerBaseContentProvider(workspaceRoot: string): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider("git-compare-base", {
    provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const filePath = uri.path;
      const ref = uri.query;
      return new Promise((resolve, reject) => {
        const cp = require("child_process");
        cp.exec(
          `git show ${ref}:${filePath}`,
          { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
          (err: any, stdout: string) => {
            if (err) {
              reject(err);
            } else {
              resolve(stdout);
            }
          }
        );
      });
    },
  });
}

const DECORATION_COLORS: Record<string, vscode.ThemeColor> = {
  A: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
  M: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
  D: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
  R: new vscode.ThemeColor("gitDecoration.renamedResourceForeground"),
  C: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
  U: new vscode.ThemeColor("gitDecoration.conflictingResourceForeground"),
};

const DECORATION_BADGES: Record<string, string> = {
  A: "A",
  M: "M",
  D: "D",
  R: "R",
  C: "C",
  T: "T",
  U: "U",
};

const DECORATION_TOOLTIPS: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
};

function registerFileDecorationProvider(): vscode.Disposable {
  return vscode.window.registerFileDecorationProvider({
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
      if (uri.scheme !== DECORATION_SCHEME) {
        return undefined;
      }

      const params = new URLSearchParams(uri.query);
      const status = params.get("status") ?? "";

      return {
        badge: DECORATION_BADGES[status],
        color: DECORATION_COLORS[status],
        tooltip: DECORATION_TOOLTIPS[status],
      };
    },
  });
}

function toGitUri(relativePath: string, ref: string, _workspaceRoot: string): vscode.Uri {
  return vscode.Uri.parse(`git-compare-base:${relativePath}?${ref}`);
}

export function deactivate() {}
