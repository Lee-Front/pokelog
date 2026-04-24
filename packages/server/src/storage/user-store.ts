import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { GitIntegration, Integration, OwnedPokemon, TowerRecord, UserData } from "../../../../shared/types.js";
import type { PvpStats } from "../../../../shared/pvp-types.js";
import { getDataDir } from "../paths.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { normalizeDamageTakenTotal } from "../game/battle-progress.js";
import { resolvePokemonGender, seededGenderRoll } from "../game/pokemon-gender.js";
import { normalizeMoveUsageCounts } from "../game/move-usage.js";

// ───────────────────────────────────────────────────────────────────────────
// In-memory user index
// ───────────────────────────────────────────────────────────────────────────
// Lightweight projection of each user's disk file, kept in memory so that
// cheap lookups (find-by-email, search-by-id/nickname, repo-email taken
// check) don't need to re-read every JSON file from disk on every call.
//
// The index is built lazily on first use, then incrementally updated by
// saveUser. Anything needing the FULL UserData still goes through getUser
// (single-file read) or getAllUsers (directory scan) — the index only
// backs the hot-path identity/email checks.
//
// Index is keyed by uid (== account.id). Each entry includes enough to
// evaluate all known O(N) scans without a disk hit:
//   - nickname  → searchUsersByIdentity
//   - gitEmails → findUserByEmail (legacy matchings.git.emails)
//   - gitIntegrations → getUsersForRepoCommit / isRepoEmailTaken
//     (we store a thin copy of each GitIntegration config and emails)
// ───────────────────────────────────────────────────────────────────────────

interface IndexedGitIntegration {
  id: string;
  repoUrl: string;
  normalizedRepoUrl: string;
  emails: string[];
  status: GitIntegration["status"];
  failCount: number;
}

interface UserIndexEntry {
  uid: string;
  nickname: string;
  gitEmails: string[];               // from account.matchings.git.emails
  gitIntegrations: IndexedGitIntegration[];
}

let userIndex: Map<string, UserIndexEntry> | null = null;
let indexBuildPromise: Promise<void> | null = null;

function toIndexEntry(user: UserData): UserIndexEntry {
  const gitEmails = user.account.matchings.git?.emails ?? [];
  const gitIntegrations: IndexedGitIntegration[] = [];
  for (const integration of user.integrations) {
    if (isGitIntegration(integration)) {
      gitIntegrations.push({
        id: integration.id,
        repoUrl: integration.config.repoUrl,
        normalizedRepoUrl: normalizeRepoUrl(integration.config.repoUrl),
        emails: integration.emails ?? [],
        status: integration.status,
        failCount: integration.failCount ?? 0,
      });
    }
  }
  return {
    uid: user.account.id,
    nickname: user.account.nickname,
    gitEmails: [...gitEmails],
    gitIntegrations,
  };
}

async function buildIndex(): Promise<void> {
  const index = new Map<string, UserIndexEntry>();
  const usersDir = path.join(getDataDir(), "users");
  try {
    const files = await fs.readdir(usersDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const user = await readJson<UserData>(path.join(usersDir, file));
      if (user) index.set(user.account.id, toIndexEntry(normalizeUserData(user)));
    }
  } catch {
    // users dir does not exist yet — empty index is fine
  }
  userIndex = index;
}

async function ensureIndex(): Promise<Map<string, UserIndexEntry>> {
  if (userIndex) return userIndex;
  if (!indexBuildPromise) indexBuildPromise = buildIndex();
  await indexBuildPromise;
  indexBuildPromise = null;
  return userIndex!;
}

/**
 * Testing helper: reset the in-memory index. Invoked by tests that swap
 * POKELOG_DATA_DIR between cases so stale entries from the previous tmp
 * dir don't leak into the new run.
 */
export function _resetUserIndex(): void {
  userIndex = null;
  indexBuildPromise = null;
}

/**
 * Public projection of UserData safe to expose over unauthenticated
 * endpoints (ranking, profile-by-nickname). Excludes the `account`
 * object (which carries the password hash, user id, and matching
 * identifiers), `integrations` (which hold provider tokens), battle
 * state, and any log entries that could leak activity patterns.
 */
export interface PublicUser {
  uid: string;
  nickname: string;
  createdAt: string;
  points: number;
  totalExp: number;
  pokedex: string[];
  pokemon: OwnedPokemon[];
  storage: OwnedPokemon[];
  pvpStats?: PvpStats;
  towerRecord?: TowerRecord;
}

export function toPublicUser(user: UserData): PublicUser {
  return {
    uid: user.account.id,
    nickname: user.account.nickname,
    createdAt: user.account.createdAt,
    points: user.points,
    totalExp: user.totalExp,
    pokedex: user.pokedex,
    pokemon: user.pokemon,
    storage: user.storage,
    pvpStats: user.pvpStats,
    towerRecord: user.towerRecord,
  };
}

function userPath(userId: string): string {
  return path.join(getDataDir(), "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  const user = await readJson<UserData>(userPath(userId));
  return user ? normalizeUserData(user) : null;
}

export async function saveUser(userData: UserData): Promise<void> {
  const normalized = normalizeUserData(userData);
  await writeJson(userPath(userData.account.id), normalized);
  // Keep the in-memory index in sync. ensureIndex here so the first
  // saveUser of the process primes the index just like the first read-
  // only lookup would.
  const index = await ensureIndex();
  index.set(normalized.account.id, toIndexEntry(normalized));
}

/**
 * Loads every user file into memory. Still used by rankings and the admin
 * dashboard where the full record is needed; for cheap identity/email
 * lookups prefer the index-backed helpers below.
 */
export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(getDataDir(), "users");
  try {
    const files = await fs.readdir(usersDir);
    const users: UserData[] = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const user = await readJson<UserData>(path.join(usersDir, file));
        if (user) users.push(normalizeUserData(user));
      }
    }
    return users;
  } catch {
    return [];
  }
}

export async function findUserByEmail(email: string): Promise<UserData | null> {
  const index = await ensureIndex();
  for (const entry of index.values()) {
    if (entry.gitEmails.includes(email)) {
      // Read the full user record from disk — the index only holds a
      // projection, and callers expect a complete UserData.
      return getUser(entry.uid);
    }
  }
  return null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const index = await ensureIndex();
  for (const entry of index.values()) {
    if (entry.gitEmails.includes(email)) return true;
  }
  return false;
}

export async function searchUsersByIdentity(
  query: string,
  options: {
    excludeUserId?: string;
    limit?: number;
  } = {},
): Promise<Array<{ id: string; nickname: string }>> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const index = await ensureIndex();
  const ranked: Array<{ id: string; nickname: string; score: number }> = [];
  for (const entry of index.values()) {
    if (entry.uid === options.excludeUserId) continue;
    const normalizedId = entry.uid.toLowerCase();
    const normalizedNickname = entry.nickname.toLowerCase();

    let score = -1;
    if (normalizedId === normalizedQuery) score = 100;
    else if (normalizedNickname === normalizedQuery) score = 95;
    else if (normalizedId.startsWith(normalizedQuery)) score = 80;
    else if (normalizedNickname.startsWith(normalizedQuery)) score = 75;
    else if (normalizedId.includes(normalizedQuery)) score = 50;
    else if (normalizedNickname.includes(normalizedQuery)) score = 45;

    if (score >= 0) {
      ranked.push({ id: entry.uid, nickname: entry.nickname, score });
    }
  }
  ranked.sort((left, right) => (
    right.score - left.score
    || left.id.localeCompare(right.id)
  ));

  return ranked
    .slice(0, Math.max(1, options.limit ?? 10))
    .map(({ id, nickname }) => ({ id, nickname }));
}

function normalizeIntegration(integration: Integration): Integration {
  return {
    ...integration,
    failCount: integration.failCount ?? 0,
  };
}

function normalizeOwnedPokemon(pokemon: OwnedPokemon): OwnedPokemon {
  const species = getSpeciesByName(pokemon.species);
  const gender = pokemon.gender ?? resolvePokemonGender(
    species?.genderRate,
    seededGenderRoll(`${pokemon.uid}:${pokemon.species}`),
  );

  return {
    ...pokemon,
    variantId: pokemon.variantId ?? null,
    gender,
    friendship: pokemon.friendship ?? 70,
    heldItem: pokemon.heldItem ?? null,
    abilityId: pokemon.abilityId ?? null,
    moveUsageCounts: normalizeMoveUsageCounts(pokemon.moveUsageCounts),
    damageTakenTotal: normalizeDamageTakenTotal(pokemon.damageTakenTotal),
    nature: pokemon.nature ?? "hardy",
    isShiny: pokemon.isShiny ?? false,
    statusCondition: pokemon.statusCondition ?? null,
  };
}

function normalizeUserData(user: UserData): UserData {
  return {
    ...user,
    currentRegion: user.currentRegion ?? "default",
    pokemon: Array.isArray(user.pokemon) ? user.pokemon.map(normalizeOwnedPokemon) : [],
    storage: Array.isArray(user.storage) ? user.storage.map(normalizeOwnedPokemon) : [],
    eggs: Array.isArray(user.eggs) ? user.eggs : [],
    pendingEvolutions: Array.isArray(user.pendingEvolutions) ? user.pendingEvolutions : [],
    integrations: Array.isArray(user.integrations)
      ? user.integrations.map(normalizeIntegration)
      : [],
  };
}

export async function getUsersForRepoCommit(
  repoUrl: string,
  authorEmail: string,
): Promise<UserData[]> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const index = await ensureIndex();
  // First pass: identify candidate uids from the index (cheap, in memory).
  // Second pass: load the full UserData for only the matched uids — we need
  // to return them to callers (commit-processor reads `user.points`, etc).
  const matchedIds: string[] = [];
  for (const entry of index.values()) {
    const legacyMatch = entry.gitEmails.includes(authorEmail);
    let integrationMatch = false;
    for (const integration of entry.gitIntegrations) {
      if (integration.normalizedRepoUrl !== normalizedRepoUrl) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;
      if (integration.emails.length === 0 || integration.emails.includes(authorEmail)) {
        integrationMatch = true;
        break;
      }
    }
    if (integrationMatch || legacyMatch) matchedIds.push(entry.uid);
  }
  const users: UserData[] = [];
  for (const id of matchedIds) {
    const user = await getUser(id);
    if (user) users.push(user);
  }
  return users;
}

export async function isRepoEmailTaken(
  repoUrl: string,
  email: string,
  excludeUserId?: string,
  excludeIntegrationId?: string,
): Promise<boolean> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const index = await ensureIndex();
  for (const entry of index.values()) {
    for (const integration of entry.gitIntegrations) {
      if (integration.normalizedRepoUrl !== normalizedRepoUrl) continue;
      if (!integration.emails.includes(email)) continue;
      if (excludeUserId && entry.uid === excludeUserId
          && excludeIntegrationId && integration.id === excludeIntegrationId) {
        continue;
      }
      return true;
    }
  }
  return false;
}

export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isGitIntegration(integration: Integration): integration is GitIntegration {
  return integration.provider === "git" || integration.provider === "github" || integration.provider === "gitlab";
}
