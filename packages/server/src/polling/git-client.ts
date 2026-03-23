import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const exec = promisify(execFile);

export interface CommitInfo {
  hash: string;
  authorEmail: string;
  timestamp: string; // ISO string
  parentCount: number;
  message: string;
}

/** Clone a bare repo. targetDir should be under pokelog-data/repos/ */
export async function cloneBareRepo(
  url: string,
  targetDir: string,
): Promise<void> {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await exec("git", ["clone", "--bare", url, targetDir]);
}

/** Fetch latest from origin */
export async function fetchRepo(repoDir: string): Promise<void> {
  await exec("git", ["fetch", "origin"], { cwd: repoDir });
}

/**
 * Get new commits since lastHash on a branch. Returns oldest-first order.
 * If lastHash is null (first time), get all commits on the branch.
 */
export async function getNewCommits(
  repoDir: string,
  branch: string,
  lastHash: string | null,
): Promise<CommitInfo[]> {
  const range = lastHash
    ? `${lastHash}..origin/${branch}`
    : `origin/${branch}`;
  const format = "%H|%ae|%aI|%P|%s"; // hash|email|date|parents|subject
  try {
    const { stdout } = await exec(
      "git",
      ["log", range, `--format=${format}`, "--reverse"],
      { cwd: repoDir },
    );
    if (!stdout.trim()) return [];
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, authorEmail, timestamp, parents, message] =
          line.split("|");
        return {
          hash,
          authorEmail,
          timestamp,
          parentCount: parents ? parents.trim().split(" ").length : 0,
          message: message || "",
        };
      });
  } catch {
    return [];
  }
}

/** Calculate byte changes for a single commit using diff-tree and cat-file */
export async function getCommitByteChanges(
  repoDir: string,
  commitHash: string,
): Promise<number> {
  try {
    const { stdout } = await exec(
      "git",
      ["diff-tree", "-r", "--root", "--no-commit-id", commitHash],
      { cwd: repoDir },
    );
    if (!stdout.trim()) return 0;

    let totalBytes = 0;
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      // Format: :oldMode newMode oldBlob newBlob status\tpath
      const match = line.match(/:(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (!match) continue;
      const [, , , oldBlob, newBlob] = match;

      const nullHash = "0000000000000000000000000000000000000000";

      let bytes = 0;
      if (oldBlob === nullHash) {
        // New file: full size
        const { stdout: size } = await exec(
          "git",
          ["cat-file", "-s", newBlob],
          { cwd: repoDir },
        );
        bytes = parseInt(size.trim(), 10);
      } else if (newBlob === nullHash) {
        // Deleted file: old size
        const { stdout: size } = await exec(
          "git",
          ["cat-file", "-s", oldBlob],
          { cwd: repoDir },
        );
        bytes = parseInt(size.trim(), 10);
      } else {
        // Modified: max(old, new)
        const { stdout: oldSize } = await exec(
          "git",
          ["cat-file", "-s", oldBlob],
          { cwd: repoDir },
        );
        const { stdout: newSize } = await exec(
          "git",
          ["cat-file", "-s", newBlob],
          { cwd: repoDir },
        );
        bytes = Math.max(
          parseInt(oldSize.trim(), 10),
          parseInt(newSize.trim(), 10),
        );
      }

      totalBytes += bytes;
    }

    return totalBytes;
  } catch {
    return 0;
  }
}

/** Get the latest commit hash on a branch */
export async function getLatestHash(
  repoDir: string,
  branch: string,
): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git",
      ["rev-parse", `origin/${branch}`],
      { cwd: repoDir },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
