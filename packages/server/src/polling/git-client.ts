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

export interface GitTlsOptions {
  caCertPath?: string;
  insecureSkipTls?: boolean;
}

/**
 * Strip `user:password@` credentials from any URL embedded in a string so that
 * tokens never leak into error messages, logs, or API responses. git's own
 * `fatal:` line already hides the token, but Node's execFile error prepends the
 * full command ("Command failed: git ls-remote https://oauth2:TOKEN@host"),
 * which would otherwise expose it.
 */
export function redactUrlCredentials(text: string): string {
  // Match a scheme://userinfo@ segment and drop the userinfo part.
  return text.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/g,
    "$1***@",
  );
}

/**
 * Build the `-c key=value` overrides for TLS handling. insecureSkipTls disables
 * verification entirely (last resort for self-signed certs); caCertPath points
 * git at a private CA bundle. insecureSkipTls takes precedence when both set.
 */
export function buildTlsConfigArgs(tls?: GitTlsOptions): string[] {
  if (!tls) return [];
  if (tls.insecureSkipTls) {
    return ["-c", "http.sslVerify=false"];
  }
  if (tls.caCertPath) {
    return ["-c", `http.sslCAInfo=${tls.caCertPath}`];
  }
  return [];
}

/**
 * Run a git command, redacting credentials from any error before it propagates.
 * All git invocations route through here so no token-bearing URL can escape via
 * an error message.
 */
async function runGit(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  try {
    // execFile defaults to utf8 encoding, so stdout/stderr are strings.
    return await exec("git", args, { ...options, encoding: "utf8" });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "git command failed";
    throw new Error(redactUrlCredentials(raw));
  }
}

function injectTokenUrl(url: string, token: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "oauth2";
    parsed.password = token;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveRepoUrl(url: string, authMode?: string, token?: string): string {
  if (authMode === "token" && token) {
    return injectTokenUrl(url, token);
  }
  return url;
}

export async function testRepoAccess(
  url: string,
  authMode?: string,
  token?: string,
  tls?: GitTlsOptions,
): Promise<{ ok: boolean; branches: string[]; error?: string }> {
  try {
    const effectiveUrl = resolveRepoUrl(url, authMode, token);
    const { stdout } = await runGit([
      ...buildTlsConfigArgs(tls),
      "ls-remote",
      "--heads",
      effectiveUrl,
    ]);
    const branches = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[1] || "")
      .filter(Boolean)
      .map((ref) => ref.replace("refs/heads/", ""));
    return { ok: true, branches };
  } catch (error) {
    // runGit already redacts, but redact again defensively in case a non-Error
    // value or a wrapped message slips through.
    const message = error instanceof Error ? error.message : "repository access failed";
    return { ok: false, branches: [], error: redactUrlCredentials(message) };
  }
}

const ORIGIN_FETCH_REFSPEC = "+refs/heads/*:refs/remotes/origin/*";

/**
 * Ensure the bare repo has the origin tracking refspec.
 *
 * `git clone --bare` stores branches in refs/heads/* and sets no fetch refspec,
 * so `origin/<branch>` never resolves and the downstream read path
 * (getNewCommits/getLatestHash/listRemoteBranches, all keyed on origin/*) would
 * silently return nothing. Setting the config is idempotent, so calling this on
 * every fetch also repairs bare clones created before this refspec was added
 * (migration gap) — no re-clone needed.
 */
async function ensureOriginRefspec(repoDir: string): Promise<void> {
  await runGit(
    ["config", "remote.origin.fetch", ORIGIN_FETCH_REFSPEC],
    { cwd: repoDir },
  );
}

/** Clone a bare repo. targetDir should be under pokelog-data/repos/ */
export async function cloneBareRepo(
  url: string,
  targetDir: string,
  authMode?: string,
  token?: string,
  tls?: GitTlsOptions,
): Promise<void> {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  const effectiveUrl = resolveRepoUrl(url, authMode, token);
  await runGit([...buildTlsConfigArgs(tls), "clone", "--bare", effectiveUrl, targetDir]);
  // Install the refspec and do one fetch so refs/remotes/origin/* is populated
  // and the repo is immediately readable, without relying on a separate
  // fetchRepo call first.
  await ensureOriginRefspec(targetDir);
  await runGit([...buildTlsConfigArgs(tls), "fetch", "origin"], { cwd: targetDir });
}

/** Fetch latest from origin */
export async function fetchRepo(repoDir: string, tls?: GitTlsOptions): Promise<void> {
  // Idempotently guarantee the tracking refspec first so pre-existing bare
  // clones (made before the refspec fix) start populating origin/* on fetch.
  await ensureOriginRefspec(repoDir);
  await runGit([...buildTlsConfigArgs(tls), "fetch", "origin"], { cwd: repoDir });
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

/**
 * Get new commits across multiple branches at once, deduplicated by commit.
 *
 * A commit reachable from several branches (e.g. the shared base history of
 * `main` and a feature branch) must be rewarded only once. Iterating branches
 * individually and calling getNewCommits per branch double-counts such commits
 * — once per branch they appear on — which massively inflates first-poll and
 * new-branch rewards.
 *
 * This unions all current branch tips and excludes everything reachable from
 * the previously-processed tips via `git log <tips> --not <previousTips>`. git's
 * own reachability handles dedup and also the cross-poll case: a commit already
 * processed on one branch is excluded even after it is later merged into
 * another branch. Returns oldest-first order.
 *
 * @param branchTips    current `origin/<branch>` refs to include
 * @param previousTips  commit hashes already processed (per-branch lastHash)
 */
export async function getNewCommitsAcrossBranches(
  repoDir: string,
  branchTips: string[],
  previousTips: string[],
): Promise<CommitInfo[]> {
  if (branchTips.length === 0) return [];
  const format = "%H|%ae|%aI|%P|%s"; // hash|email|date|parents|subject
  const args = ["log", ...branchTips, `--format=${format}`, "--reverse"];
  if (previousTips.length > 0) {
    args.push("--not", ...previousTips);
  }
  try {
    const { stdout } = await exec("git", args, { cwd: repoDir });
    if (!stdout.trim()) return [];
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, authorEmail, timestamp, parents, message] = line.split("|");
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

export async function listRemoteBranches(repoDir: string): Promise<string[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["for-each-ref", "--format=%(refname:strip=3)", "refs/remotes/origin"],
      { cwd: repoDir },
    );
    return stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== "HEAD");
  } catch {
    return [];
  }
}
