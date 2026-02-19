import * as vscode from "vscode";
import * as path from "path";
import { GitService, ChangedFile, FileStatus } from "./gitService";

export const DECORATION_SCHEME = "git-compare-decoration";

type TreeNode = FileNode | FolderNode;

export class FileNode {
  readonly type = "file" as const;

  constructor(
    public readonly relativePath: string,
    public readonly status: FileStatus,
    public readonly oldPath?: string
  ) {}

  get label(): string {
    const name = path.basename(this.relativePath);
    if (this.oldPath) {
      return `${path.basename(this.oldPath)} → ${name}`;
    }
    return name;
  }

  get decorationUri(): vscode.Uri {
    return vscode.Uri.parse(
      `${DECORATION_SCHEME}:status?path=${encodeURIComponent(this.relativePath)}&status=${this.status}`
    );
  }
}

class FolderNode {
  readonly type = "folder" as const;
  children: Map<string, TreeNode> = new Map();

  constructor(public readonly folderPath: string) {}

  get label(): string {
    return path.basename(this.folderPath) || this.folderPath;
  }
}

const STATUS_LABELS: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
};


export class GitCompareProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private baseBranch = "main";
  private rootFolder: FolderNode = new FolderNode("");
  private gitService: GitService;
  constructor(private workspaceRoot: string) {
    this.gitService = new GitService(workspaceRoot);
  }

  getBaseBranch(): string {
    return this.baseBranch;
  }

  setBaseBranch(branch: string): void {
    this.baseBranch = branch;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "folder") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "folder";
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = `${element.relativePath} — ${STATUS_LABELS[element.status] ?? element.status}`;
    item.contextValue = "file";
    item.resourceUri = element.decorationUri;

    item.command = {
      command: "gitCompare.openDiff",
      title: "Open Diff",
      arguments: [element],
    };

    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (!element) {
      await this.buildTree();
      return this.getSortedChildren(this.rootFolder);
    }

    if (element.type === "folder") {
      return this.getSortedChildren(element);
    }

    return [];
  }

  private getSortedChildren(folder: FolderNode): TreeNode[] {
    const children = Array.from(folder.children.values());
    return children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }

  private async buildTree(): Promise<void> {
    this.rootFolder = new FolderNode("");

    let files: ChangedFile[];
    try {
      files = await this.gitService.getChangedFiles(this.baseBranch);
    } catch (e: any) {
      vscode.window.showWarningMessage(`Git Compare: ${e.message}`);
      return;
    }

    for (const file of files) {
      this.insertFile(file);
    }

    this.collapsesingles(this.rootFolder);
  }

  private insertFile(file: ChangedFile): void {
    const segments = file.path.split("/");
    let current = this.rootFolder;

    for (let i = 0; i < segments.length - 1; i++) {
      const folderName = segments[i];
      let child = current.children.get(folderName);
      if (!child || child.type !== "folder") {
        child = new FolderNode(segments.slice(0, i + 1).join("/"));
        current.children.set(folderName, child);
      }
      current = child;
    }

    const fileName = segments[segments.length - 1];
    current.children.set(
      fileName,
      new FileNode(file.path, file.status, file.oldPath)
    );
  }

  /**
   * Collapse folders that have only a single child folder into "a/b/c" style labels.
   */
  private collapsesingles(folder: FolderNode): void {
    for (const [key, child] of folder.children) {
      if (child.type === "folder") {
        this.collapsesingles(child);

        if (child.children.size === 1) {
          const [grandchildKey, grandchild] = child.children.entries().next().value!;
          if (grandchild.type === "folder") {
            const merged = new FolderNode(grandchild.folderPath);
            merged.children = new Map(grandchild.children);
            const mergedKey = `${key}/${grandchildKey}`;
            folder.children.delete(key);
            folder.children.set(mergedKey, merged);
          }
        }
      }
    }
  }

  getGitService(): GitService {
    return this.gitService;
  }
}
