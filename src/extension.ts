import * as vscode from "vscode";
import { buildChangedFilesTree } from "./changedFilesModel";
import {
  GitCompareWebviewProvider,
  OpenDiffPayload,
} from "./gitCompareWebviewProvider";
import { FileStatus, GitService } from "./gitService";

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  const gitService = new GitService(workspaceRoot);
  let baseBranch = "main";
  const webviewProvider = new GitCompareWebviewProvider(context.extensionUri, {
    onRefresh: () => {
      void refreshView();
    },
    onSetBaseBranch: () => {
      void setBaseBranch();
    },
    onOpenDiff: (payload) => {
      void openDiff(payload);
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("gitCompareTree", webviewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),

    vscode.commands.registerCommand("gitCompare.refresh", () => {
      void refreshView();
    }),

    vscode.commands.registerCommand("gitCompare.openDiff", async (targetInput) => {
      const target = toDiffTarget(targetInput);
      if (!target) {
        return;
      }
      await openDiff(target);
    }),

    vscode.commands.registerCommand("gitCompare.setBaseBranch", async () => {
      await setBaseBranch();
    }),

    registerBaseContentProvider(workspaceRoot)
  );

  const gitWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, ".git/HEAD")
  );
  gitWatcher.onDidChange(() => {
    void refreshView();
  });
  context.subscriptions.push(gitWatcher);

  void refreshView();

  async function openDiff(target: OpenDiffPayload): Promise<void> {
    const filePath = target.path;
    const status = target.status;
    try {
      const rightUri = vscode.Uri.file(gitService.getAbsolutePath(filePath));

      if (status === "A") {
        await vscode.commands.executeCommand("vscode.open", rightUri);
        return;
      }

      const mergeBase = await gitService.getMergeBaseRef(baseBranch);
      if (status === "D") {
        const leftUri = vscode.Uri.parse(`git-compare-base:${filePath}?${mergeBase}`);
        await vscode.commands.executeCommand("vscode.open", leftUri);
        return;
      }

      const baseRef = mergeBase.substring(0, 8);
      const leftUri = toGitUri(filePath, mergeBase);
      const title = `${filePath} (${baseRef} ↔ Working Tree)`;
      await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to open diff: ${e.message}`);
    }
  }

  async function setBaseBranch(): Promise<void> {
    let branches: string[];
    try {
      branches = await gitService.getBranches();
    } catch {
      branches = ["main", "master", "develop"];
    }

    const picked = await vscode.window.showQuickPick(branches, {
      placeHolder: `Current base: ${baseBranch}. Pick a new base branch.`,
    });
    if (!picked) {
      return;
    }

    baseBranch = picked;
    await refreshView();
  }

  async function refreshView(): Promise<void> {
    try {
      const files = await gitService.getChangedFiles(baseBranch);
      webviewProvider.setState({
        baseBranch,
        nodes: buildChangedFilesTree(files),
      });
    } catch (e: any) {
      vscode.window.showWarningMessage(`Git Compare: ${e.message}`);
      webviewProvider.setState({
        baseBranch,
        nodes: [],
      });
    }
  }
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
function toDiffTarget(input: any): OpenDiffPayload | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const status = input.status as FileStatus | undefined;
  const filePath = (input.path as string | undefined) ?? (input.relativePath as string | undefined);
  if (!filePath || !status) {
    return undefined;
  }

  return {
    path: filePath,
    status,
    oldPath: input.oldPath as string | undefined,
  };
}

function toGitUri(relativePath: string, ref: string): vscode.Uri {
  return vscode.Uri.parse(`git-compare-base:${relativePath}?${ref}`);
}

export function deactivate() {}
