import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { UserData } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";

/**
 * Lightweight lookup index that maps user identities (email, nickname, repo
 * email) to userIds without loading every full user JSON into memory.
 *
 * Stored as a single JSON file at `<dataDir>/users/_index.json`. User IDs are
 * constrained to `[a-zA-Z0-9]+`, so the leading underscore guarantees the
 * index file never collides with a `<userId>.json` file.
 */

const INDEX_VERSION = 1;

export interface UserIndexEntry {
  /** Lowercased account id, kept for fuzzy identity search. */
  id: string;
  /** Lowercased nickname, kept for fuzzy identity search. */
  nickname: string;
  /** Original-case nickname for display. */
  nicknameDisplay: string;
  /** Git matching emails (account.matchings.git.emails). */
  emails: string[];
  /** normalizedRepoUrl -> emails registered for that repo via integrations. */
  repoEmails: Record<string, string[]>;
}

export interface UserIndex {
  version: number;
  /** userId -> entry */
  users: Record<string, UserIndexEntry>;
}

function indexPath(): string {
  return path.join(getDataDir(), "users", "_index.json");
}

/**
 * Serializes read-modify-write cycles on the single shared index file. Several
 * callers (e.g. accepting a trade) persist two users concurrently; without this
 * lock their interleaved reads would clobber each other's entries, and on
 * Windows the racing atomic renames fail with EPERM.
 */
let indexWriteLock: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(task: () => Promise<T>): Promise<T> {
  const run = indexWriteLock.then(task, task);
  // Keep the chain alive but swallow this task's result/error so one failure
  // does not reject every queued write.
  indexWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function emptyIndex(): UserIndex {
  return { version: INDEX_VERSION, users: {} };
}

/**
 * Build the index entry for a single user. Pure function so it can be reused
 * by both incremental updates (saveUser) and full rebuilds (migration).
 */
export function buildIndexEntry(user: UserData): UserIndexEntry {
  const repoEmails: Record<string, string[]> = {};
  for (const integration of user.integrations ?? []) {
    const provider = integration.provider;
    if (provider !== "git" && provider !== "github" && provider !== "gitlab") {
      continue;
    }
    const config = (integration as { config?: { repoUrl?: string } }).config;
    const repoUrl = config?.repoUrl;
    if (!repoUrl) continue;
    const emails = (integration as { emails?: string[] }).emails ?? [];
    const key = normalizeRepoUrl(repoUrl);
    const existing = repoEmails[key] ?? [];
    for (const email of emails) {
      if (!existing.includes(email)) existing.push(email);
    }
    repoEmails[key] = existing;
  }

  return {
    id: user.account.id.toLowerCase(),
    nickname: user.account.nickname.toLowerCase(),
    nicknameDisplay: user.account.nickname,
    emails: [...(user.account.matchings.git?.emails ?? [])],
    repoEmails,
  };
}

/** Read the index, returning an empty index when it does not yet exist. */
export async function readUserIndex(): Promise<UserIndex> {
  const index = await readJson<UserIndex>(indexPath());
  if (!index || typeof index !== "object" || !index.users) {
    return emptyIndex();
  }
  return { version: index.version ?? INDEX_VERSION, users: index.users };
}

async function writeUserIndex(index: UserIndex): Promise<void> {
  await writeJson(indexPath(), index);
}

/** Insert or replace a single user's index entry, persisting the change. */
export async function updateUserIndex(user: UserData): Promise<void> {
  const entry = buildIndexEntry(user);
  await withIndexLock(async () => {
    const index = await readUserIndex();
    index.users[user.account.id] = entry;
    await writeUserIndex(index);
  });
}

/** Remove a user from the index (used when accounts are deleted). */
export async function removeFromUserIndex(userId: string): Promise<void> {
  await withIndexLock(async () => {
    const index = await readUserIndex();
    if (index.users[userId]) {
      delete index.users[userId];
      await writeUserIndex(index);
    }
  });
}

/**
 * Rebuild the entire index from the on-disk user files. Used as a migration
 * path for existing deployments and to recover when the index is missing.
 *
 * Note: this is a full rebuild — callers must invoke it explicitly to repair a
 * stale index. There is no automatic staleness detection; ensureUserIndex only
 * rebuilds when the index file is absent. Stale entries are otherwise surfaced
 * by saveUser, which warns if it fails to update the index.
 */
export async function rebuildUserIndex(
  loadUser: (userId: string) => Promise<UserData | null>,
): Promise<UserIndex> {
  return withIndexLock(async () => {
    const usersDir = path.join(getDataDir(), "users");
    const index = emptyIndex();
    let files: string[];
    try {
      files = await fs.readdir(usersDir);
    } catch {
      await writeUserIndex(index);
      return index;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || file === "_index.json") continue;
      const userId = file.slice(0, -".json".length);
      const user = await loadUser(userId);
      if (user) {
        index.users[userId] = buildIndexEntry(user);
      }
    }
    await writeUserIndex(index);
    return index;
  });
}

/**
 * Read the index, rebuilding it first only if the index file is absent. Callers
 * that depend on the index for correctness (e.g. email lookups) use this so a
 * deployment that predates the index still resolves lookups correctly on first
 * use. A present-but-stale index is not detected here; see rebuildUserIndex.
 */
export async function ensureUserIndex(
  loadUser: (userId: string) => Promise<UserData | null>,
): Promise<UserIndex> {
  const existing = await readJson<UserIndex>(indexPath());
  if (existing && existing.users) {
    return { version: existing.version ?? INDEX_VERSION, users: existing.users };
  }
  return rebuildUserIndex(loadUser);
}
