import * as path from "path";
import { ChangedFile, FileStatus } from "./gitService";

export type ChangedTreeNode = ChangedFolderNode | ChangedFileNode;

export interface ChangedFolderNode {
  type: "folder";
  key: string;
  label: string;
  children: ChangedTreeNode[];
}

export interface ChangedFileNode {
  type: "file";
  key: string;
  label: string;
  path: string;
  status: FileStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
}

interface MutableFolderNode {
  type: "folder";
  key: string;
  label?: string;
  children: Map<string, MutableFolderNode | ChangedFileNode>;
}

export function buildChangedFilesTree(files: ChangedFile[]): ChangedTreeNode[] {
  const root: MutableFolderNode = {
    type: "folder",
    key: "",
    children: new Map(),
  };

  for (const file of files) {
    insertFile(root, file);
  }

  collapseSingleFolders(root);
  return sortFolder(root);
}

function insertFile(root: MutableFolderNode, file: ChangedFile): void {
  const segments = file.path.split("/");
  let current = root;

  for (let i = 0; i < segments.length - 1; i++) {
    const folderName = segments[i];
    let child = current.children.get(folderName);
    if (!child || child.type !== "folder") {
      child = {
        type: "folder",
        key: segments.slice(0, i + 1).join("/"),
        children: new Map(),
      };
      current.children.set(folderName, child);
    }
    current = child;
  }

  const fileName = segments[segments.length - 1];
  current.children.set(fileName, {
    type: "file",
    key: file.path,
    label: getFileLabel(file.path, file.oldPath),
    path: file.path,
    status: file.status,
    oldPath: file.oldPath,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
  });
}

function getFileLabel(filePath: string, oldPath?: string): string {
  const name = path.basename(filePath);
  if (oldPath) {
    return `${path.basename(oldPath)} → ${name}`;
  }
  return name;
}

function collapseSingleFolders(folder: MutableFolderNode): void {
  for (const [key, child] of folder.children) {
    if (child.type !== "folder") {
      continue;
    }

    collapseSingleFolders(child);

    if (child.children.size !== 1) {
      continue;
    }

    const [grandchildKey, grandchild] = child.children.entries().next().value!;
    if (grandchild.type !== "folder") {
      continue;
    }

    const mergedKey = `${key}/${grandchildKey}`;
    const mergedFolder: MutableFolderNode = {
      type: "folder",
      key: grandchild.key,
      label: mergedKey,
      children: new Map(grandchild.children),
    };
    folder.children.delete(key);
    folder.children.set(mergedKey, mergedFolder);
  }
}

function sortFolder(folder: MutableFolderNode): ChangedTreeNode[] {
  const entries = Array.from(folder.children.values());
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }

    const aLabel = a.type === "folder" ? folderLabel(a) : a.label;
    const bLabel = b.type === "folder" ? folderLabel(b) : b.label;
    return aLabel.localeCompare(bLabel);
  });

  return entries.map((entry) => {
    if (entry.type === "folder") {
      return {
        type: "folder",
        key: entry.key,
        label: folderLabel(entry),
        children: sortFolder(entry),
      };
    }

    return entry;
  });
}

function folderLabel(folder: MutableFolderNode): string {
  return folder.label ?? (path.basename(folder.key) || folder.key);
}
