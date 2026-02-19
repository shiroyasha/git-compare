import * as cp from "child_process";
import * as path from "path";

export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string; // for renames
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

    const output = await exec(
      `git diff --name-status ${mergeBase}`,
      this.workspaceRoot
    );

    if (!output) {
      return [];
    }

    return output.split("\n").map((line) => {
      const parts = line.split("\t");
      const rawStatus = parts[0];

      // Renames show as R100\told\tnew
      if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
        return {
          status: rawStatus[0] as FileStatus,
          oldPath: parts[1],
          path: parts[2],
        };
      }

      return {
        status: rawStatus[0] as FileStatus,
        path: parts[1],
      };
    });
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
