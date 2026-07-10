/**
 * Cross-process advisory lock — serializes a critical section across BOTH
 * separate Node processes and async flows within one process. Needed for the
 * blue-green deploy window where the old and new server processes briefly run
 * at once and would otherwise race on the same user's JSON file (lost updates
 * have corrupted rosters in production).
 *
 * Mechanism: `fs.mkdir(lockDir)` is atomic across processes on every platform —
 * exactly one caller wins, everyone else gets EEXIST. We spin (mkdir → retry on
 * EEXIST with capped backoff + jitter) until we win or a BOUNDED timeout
 * elapses, at which point we THROW rather than hang forever. A holder writes
 * `{pid, host, at}` into the dir for diagnostics; a crashed holder leaves a
 * stale dir, so on EEXIST we check the dir's age and steal it once it exceeds a
 * threshold. The lock is always released in a `finally`.
 *
 * No external dependency — `node:fs` only. Lock dirs live under
 * `pokelog-data/.locks/<sanitized-key>/`; the dot-prefixed `.locks` directory
 * sorts/globs apart from user data files (which are `<id>.json`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getDataDir } from "../paths.js";
import { childLogger } from "../logger.js";

const log = childLogger("xproc-lock");

/** Directory name (under the data dir) that holds every lock dir. */
export const LOCKS_DIRNAME = ".locks";

export interface ProcessLockOptions {
  /**
   * Max time to wait for the lock before throwing. Bounded so a wedged holder
   * degrades to an error instead of an infinite hang.
   */
  timeoutMs?: number;
  /**
   * A held lock older than this is presumed abandoned (holder crashed) and is
   * stolen. Must comfortably exceed the longest legitimate critical section.
   */
  staleMs?: number;
  /** Initial retry backoff; grows geometrically up to {@link maxBackoffMs}. */
  initialBackoffMs?: number;
  /** Upper bound on the per-retry backoff. */
  maxBackoffMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_INITIAL_BACKOFF_MS = 15;
const DEFAULT_MAX_BACKOFF_MS = 250;

/** Absolute path to the `.locks` root directory under the current data dir. */
export function locksRoot(): string {
  return path.join(getDataDir(), LOCKS_DIRNAME);
}

/**
 * Map an arbitrary lock key (e.g. `user:abc-123`, `match:...`, `world-boss`) to
 * a single safe directory name. Non-alphanumeric characters are replaced so the
 * result is a valid filename on every platform, and a short hash of the full key
 * is appended so distinct keys can never collide onto the same directory after
 * sanitization (e.g. `user:a/b` vs `user:a_b`).
 */
export function lockDirFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  // djb2 — small, dependency-free, ample to separate sanitization collisions.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  const suffix = (hash >>> 0).toString(36);
  return path.join(locksRoot(), `${safe}.${suffix}`);
}

interface LockMeta {
  pid: number;
  host: string;
  at: string;
  key: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when the lock directory at `dir` is older than `staleMs` (holder likely
 * crashed). Uses the directory mtime; missing dir → not stale (someone released
 * it while we looked, so the caller should just retry the mkdir).
 */
async function isStale(dir: string, staleMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

/**
 * Best-effort steal of a presumed-abandoned lock: remove the whole lock dir so
 * the next mkdir can win. Concurrent stealers race harmlessly — whoever's rmdir
 * lands first frees it; a later rmdir on the already-gone (or freshly re-taken)
 * dir is swallowed, and the subsequent mkdir arbitrates the real winner.
 */
async function steal(dir: string, key: string): Promise<void> {
  const meta = await readMeta(dir);
  log.warn({ key, dir, staleHolder: meta }, "Stealing stale cross-process lock (holder presumed crashed)");
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function readMeta(dir: string): Promise<LockMeta | null> {
  return readJsonQuiet(path.join(dir, "meta.json"));
}

async function readJsonQuiet(file: string): Promise<LockMeta | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as LockMeta;
  } catch {
    return null;
  }
}

/**
 * Acquire the lock for `key`. Resolves once held; throws if the timeout elapses
 * first. On success the caller MUST eventually {@link releaseProcessLock}; use
 * {@link withProcessLock} to guarantee that in a `finally`.
 */
export async function acquireProcessLock(
  key: string,
  opts: ProcessLockOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const initialBackoff = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoff = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  const dir = lockDirFor(key);
  const root = locksRoot();
  const deadline = Date.now() + timeoutMs;
  let backoff = initialBackoff;
  let stealAttempted = false;

  // Ensure the .locks root exists once up front (mkdir recursive is idempotent).
  await fs.mkdir(root, { recursive: true });

  for (;;) {
    try {
      // Atomic across processes: exactly one mkdir succeeds, the rest see EEXIST.
      // `recursive: false` (default) is required — recursive mkdir treats an
      // existing dir as success and would defeat the mutual exclusion.
      await fs.mkdir(dir);
      // Won the lock. Record diagnostics (best-effort; failure doesn't lose it).
      const meta: LockMeta = { pid: process.pid, host: os.hostname(), at: new Date().toISOString(), key };
      await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf-8").catch(() => undefined);
      return dir;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err; // real error (perms, ENOSPC, ...) — surface it.

      // Held by someone else. Steal it if it looks abandoned (once per acquire
      // to avoid thrashing), otherwise back off and retry.
      if (!stealAttempted && (await isStale(dir, staleMs))) {
        stealAttempted = true;
        await steal(dir, key);
        continue; // retry mkdir immediately after freeing it.
      }

      if (Date.now() >= deadline) {
        const holder = await readMeta(dir);
        throw new Error(
          `Timed out after ${timeoutMs}ms acquiring cross-process lock '${key}'` +
            (holder ? ` (held by pid ${holder.pid}@${holder.host} since ${holder.at})` : ""),
        );
      }

      // Jittered, capped backoff. Jitter de-synchronizes competing waiters so
      // they don't wake and collide in lockstep.
      const jitter = Math.floor(Math.random() * backoff);
      await sleep(Math.min(backoff, maxBackoff) + jitter);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
  }
}

/**
 * Release a lock acquired via {@link acquireProcessLock}. Idempotent and never
 * throws — a missing dir (already released/stolen) is fine.
 */
export async function releaseProcessLock(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
    log.warn({ err, dir }, "Failed to release cross-process lock dir");
  });
}

/**
 * Run `fn` while holding the cross-process lock for `key`. Acquires (bounded,
 * throws on timeout), runs `fn`, and ALWAYS releases in a `finally` — including
 * when `fn` throws, in which case the original error propagates unchanged.
 */
export async function withProcessLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: ProcessLockOptions = {},
): Promise<T> {
  const dir = await acquireProcessLock(key, opts);
  try {
    return await fn();
  } finally {
    await releaseProcessLock(dir);
  }
}
