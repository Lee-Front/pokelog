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

/**
 * List every distinct non-merge-deduplicated commit across all branches,
 * oldest-first. Unlike getNewCommitsAcrossBranches this applies no syncState
 * exclusion — it returns the repo's full history. Used by the admin recompute
 * tool to replay a single user's commits from scratch without touching the
 * shared per-repo syncState baseline (which would force-reprocess other users).
 * `git log --all` already deduplicates commits reachable from several branches.
 */
export async function getAllCommitsAcrossBranches(
  repoDir: string,
): Promise<CommitInfo[]> {
  const format = "%H|%ae|%aI|%P|%s"; // hash|email|date|parents|subject
  try {
    const { stdout } = await exec(
      "git",
      ["log", "--all", `--format=${format}`, "--reverse"],
      { cwd: repoDir },
    );
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
// 보상 산정에서 제외할 생성/빌드/바이너리 경로. 사람이 작성한 데이터(json 포함)는 인정한다.
// (바이너리는 git이 텍스트 diff를 내지 않아 어차피 0바이트로 잡히지만, 생성된 *텍스트*
//  — dist 번들·lockfile·min/소스맵 — 는 경로로 명시 제외해야 한다.)
const REWARD_EXCLUDED_DIRS = [
  "dist", "build", "target", "out", "node_modules", ".next", ".gradle", "vendor", "coverage", ".idea",
];
const REWARD_EXCLUDED_BASENAMES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "gemfile.lock", "poetry.lock",
];
const REWARD_EXCLUDED_EXTENSIONS = [".map", ".min.js", ".min.css", ".lock"];

/** 보상 산정에서 제외할 생성/빌드 경로인지. json 등 작성 데이터는 인정(false). */
export function isGeneratedPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const segments = lower.split("/");
  if (segments.some((s) => REWARD_EXCLUDED_DIRS.includes(s))) return true;
  const base = segments[segments.length - 1];
  if (REWARD_EXCLUDED_BASENAMES.includes(base)) return true;
  return REWARD_EXCLUDED_EXTENSIONS.some((ext) => base.endsWith(ext));
}

/**
 * `git show -U0` 패치에서 사람이 실제로 추가/삭제한 텍스트 바이트(추가+삭제)를 센다.
 * 파일 전체 크기가 아니라 변경된 줄만 계산하므로, 큰 파일의 한 줄 수정이 파일 크기로
 * 부풀려지지 않는다. 선행 +/- 1바이트는 제외하고 줄 내용 바이트만 더한다.
 * 생성/빌드 경로(isGeneratedPath)는 건너뛴다. 바이너리는 +/- 줄이 없어 자연히 0.
 */
export function countDiffTextBytes(patch: string): number {
  let total = 0;
  let excluded = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // "diff --git a/<old> b/<new>" — 변경 후 경로(b/)로 제외 판정.
      const match = line.match(/ b\/(.*)$/);
      excluded = match ? isGeneratedPath(match[1]) : false;
      continue;
    }
    if (excluded) continue;
    // 파일 헤더(+++/---)와 헝크 헤더(@@)는 변경 내용이 아니므로 제외.
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      total += Buffer.byteLength(line, "utf8") - 1;
    }
  }
  return total;
}

export async function getCommitByteChanges(
  repoDir: string,
  commitHash: string,
): Promise<number> {
  try {
    // -U0: 컨텍스트 줄 없이 변경 줄만. --format=: 커밋 헤더 제거(패치만).
    // maxBuffer를 크게 — 큰 커밋 패치가 기본 1MB를 넘으면 throw → 0이 되어 적립 누락.
    const { stdout } = await exec(
      "git",
      ["show", commitHash, "-p", "-U0", "--format=", "--no-color"],
      { cwd: repoDir, maxBuffer: 256 * 1024 * 1024 },
    );
    return countDiffTextBytes(stdout);
  } catch {
    return 0;
  }
}

/**
 * List distinct author emails across all branches with their commit counts,
 * ordered by count descending. Used to populate the integration form so users
 * pick which of their own emails to attribute commits to (rather than typing
 * them blindly). Routes through runGit so a token-bearing URL can never leak.
 */
export async function listAuthorEmails(
  repoDir: string,
): Promise<{ email: string; count: number }[]> {
  const { stdout } = await runGit(["log", "--all", "--format=%ae"], { cwd: repoDir });
  const counts = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const email = line.trim();
    if (!email) continue;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => b.count - a.count);
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
