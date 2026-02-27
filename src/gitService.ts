import * as cp from "child_process";
import * as path from "path";

export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string; // for renames
  additions?: number;
  deletions?: number;
}

interface NumStat {
  additions: number;
  deletions: number;
}

function normalizeNumstatPath(rawPath: string): string {
  if (rawPath.includes("\t")) {
    const parts = rawPath.split("\t");
    return parts[parts.length - 1];
  }

  const braceRename = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRename) {
    const [, prefix, , renamed, suffix] = braceRename;
    return `${prefix}${renamed}${suffix}`;
  }

  const simpleRename = rawPath.match(/^(.*) => (.*)$/);
  if (simpleRename) {
    return simpleRename[2];
  }

  return rawPath;
}

function parseNumStat(output: string): Map<string, NumStat> {
  const stats = new Map<string, NumStat>();
  if (!output) {
    return stats;
  }

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const additions = parts[0] === "-" ? 0 : Number(parts[0]);
    const deletions = parts[1] === "-" ? 0 : Number(parts[1]);
    const rawPath = parts.slice(2).join("\t");
    const normalizedPath = normalizeNumstatPath(rawPath);
    if (!normalizedPath) {
      continue;
    }

    stats.set(normalizedPath, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }

  return stats;
}

function exec(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export class GitService {
  constructor(private workspaceRoot: string) {}

  async getCurrentBranch(): Promise<string> {
    return exec("git rev-parse --abbrev-ref HEAD", this.workspaceRoot);
  }

  async getMergeBase(baseBranch: string): Promise<string> {
    return exec(`git merge-base ${baseBranch} HEAD`, this.workspaceRoot);
  }

  async getChangedFiles(baseBranch: string): Promise<ChangedFile[]> {
    let mergeBase: string;
    try {
      mergeBase = await this.getMergeBase(baseBranch);
    } catch {
      // If merge-base fails (e.g. unrelated histories), diff against the branch directly
      mergeBase = baseBranch;
    }

    const [diffOutput, numstatOutput, untrackedOutput] = await Promise.all([
      exec(`git diff --name-status ${mergeBase}`, this.workspaceRoot),
      exec(`git diff --numstat --find-renames --find-copies ${mergeBase}`, this.workspaceRoot),
      exec("git ls-files --others --exclude-standard", this.workspaceRoot).catch(() => ""),
    ]);

    const files: ChangedFile[] = [];
    const numstatByPath = parseNumStat(numstatOutput);

    if (diffOutput) {
      for (const line of diffOutput.split("\n")) {
        const parts = line.split("\t");
        const rawStatus = parts[0];

        if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
          const path = parts[2];
          files.push({
            status: rawStatus[0] as FileStatus,
            oldPath: parts[1],
            path,
            additions: numstatByPath.get(path)?.additions,
            deletions: numstatByPath.get(path)?.deletions,
          });
        } else {
          const path = parts[1];
          files.push({
            status: rawStatus[0] as FileStatus,
            path,
            additions: numstatByPath.get(path)?.additions,
            deletions: numstatByPath.get(path)?.deletions,
          });
        }
      }
    }

    if (untrackedOutput) {
      const trackedPaths = new Set(files.map((f) => f.path));
      for (const filePath of untrackedOutput.split("\n")) {
        if (filePath && !trackedPaths.has(filePath)) {
          files.push({ status: "A", path: filePath });
        }
      }
    }

    return files;
  }

  async getBranches(): Promise<string[]> {
    const output = await exec(
      "git branch -a --format='%(refname:short)'",
      this.workspaceRoot
    );
    return output
      .split("\n")
      .map((b) => b.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  }

  getAbsolutePath(relativePath: string): string {
    return path.join(this.workspaceRoot, relativePath);
  }

  getMergeBaseRef(baseBranch: string): Promise<string> {
    return this.getMergeBase(baseBranch);
  }
}
