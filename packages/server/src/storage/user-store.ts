import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { GitIntegration, Integration, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { normalizeDamageTakenTotal } from "../game/battle-progress.js";
import { resolvePokemonGender, seededGenderRoll } from "../game/pokemon-gender.js";
import { normalizeMoveUsageCounts } from "../game/move-usage.js";
import {
  ensureUserIndex,
  removeFromUserIndex,
  updateUserIndex,
  type UserIndexEntry,
} from "./user-index.js";
import { childLogger } from "../logger.js";

const log = childLogger("user-store");

/** Name of the identity index file; excluded from full-user iteration. */
const USER_INDEX_FILENAME = "_index.json";

function userPath(userId: string): string {
  return path.join(getDataDir(), "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  const user = await readJson<UserData>(userPath(userId));
  return user ? normalizeUserData(user) : null;
}

/**
 * Persist a user. `reason` labels the call site so intentional balance drops
 * (shop purchases, admin adjustments) can opt out of the regression warning
 * below; omit it for the polling/reward paths where a drop is never expected.
 */
export async function saveUser(userData: UserData, reason?: string): Promise<void> {
  const normalized = normalizeUserData(userData);
  await warnOnBalanceRegression(normalized, reason);
  await writeJson(userPath(normalized.account.id), normalized);
  // The user file is the source of truth; the index is a rebuildable cache.
  // If the index update fails we keep the successful save but surface the
  // drift, since lookups (email/repo) may be stale until the index is rebuilt.
  try {
    await updateUserIndex(normalized);
  } catch (err) {
    log.warn(
      { err, userId: normalized.account.id },
      "User saved but identity index update failed; index may be stale",
    );
  }
}

/** Call sites that legitimately reduce points/exp; skip the regression warning. */
const INTENTIONAL_DEBIT_REASONS = new Set(["shop-purchase", "admin-adjust"]);

/**
 * Diagnostic guard for the stale-save class of bug (#19): a save that lowers a
 * user's points or totalExp below what is already on disk almost always means a
 * stale in-memory object is overwriting a fresh reward. Read the current file
 * and emit a WARNING (with a stack) on any regression so it surfaces in logs
 * instead of silently zeroing balances. Intentional debits pass a `reason`.
 */
async function warnOnBalanceRegression(next: UserData, reason?: string): Promise<void> {
  if (reason && INTENTIONAL_DEBIT_REASONS.has(reason)) return;
  const existing = await readJson<UserData>(userPath(next.account.id));
  if (!existing) return;

  for (const field of ["points", "totalExp"] as const) {
    const before = existing[field];
    const after = next[field];
    if (typeof before === "number" && typeof after === "number" && after < before) {
      log.warn(
        {
          userId: next.account.id,
          field,
          before,
          after,
          reason,
          stack: new Error("balance regression").stack,
        },
        `saveUser regression: ${field} ${before} -> ${after} (possible stale-save overwrite)`,
      );
    }
  }
}

/** Delete a user's file and drop it from the identity index. */
export async function deleteUser(userId: string): Promise<void> {
  try {
    await fs.unlink(userPath(userId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await removeFromUserIndex(userId);
}

/**
 * Loads every user file into memory. This does not scale beyond a few hundred
 * users, so it is reserved for whole-population operations only (admin tooling,
 * rankings, polling sweeps). For identity lookups use the index-backed helpers
 * (findUserByEmail, searchUsersByIdentity, getUsersForRepoCommit,
 * isRepoEmailTaken); for single-user lookups by id use getUser(id).
 */
export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(getDataDir(), "users");
  try {
    const files = await fs.readdir(usersDir);
    const users: UserData[] = [];
    for (const file of files) {
      if (file === USER_INDEX_FILENAME) continue;
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
  const index = await ensureUserIndex(getUser);
  for (const [userId, entry] of Object.entries(index.users)) {
    if (entry.emails.includes(email)) {
      const user = await getUser(userId);
      if (user) return user;
    }
  }
  return null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const index = await ensureUserIndex(getUser);
  return Object.values(index.users).some((entry) => entry.emails.includes(email));
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

  const index = await ensureUserIndex(getUser);
  const ranked = Object.entries(index.users)
    .filter(([userId]) => userId !== options.excludeUserId)
    .map(([userId, entry]) => {
      const normalizedId = entry.id;
      const normalizedNickname = entry.nickname;

      let score = -1;
      if (normalizedId === normalizedQuery) score = 100;
      else if (normalizedNickname === normalizedQuery) score = 95;
      else if (normalizedId.startsWith(normalizedQuery)) score = 80;
      else if (normalizedNickname.startsWith(normalizedQuery)) score = 75;
      else if (normalizedId.includes(normalizedQuery)) score = 50;
      else if (normalizedNickname.includes(normalizedQuery)) score = 45;

      return {
        id: userId,
        nickname: entry.nicknameDisplay,
        score,
      };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => (
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
    battleMoney: user.battleMoney ?? 0,
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
  const index = await ensureUserIndex(getUser);

  // Narrow to users whose index records either the repo (any of its
  // integrations, since an empty email list is a wildcard match) or a legacy
  // git email match. The full integration filter still runs on each candidate.
  const candidates = candidateUserIds(index.users, (entry) =>
    normalizedRepoUrl in entry.repoEmails || entry.emails.includes(authorEmail),
  );

  const matched: UserData[] = [];
  for (const userId of candidates) {
    const user = await getUser(userId);
    if (!user) continue;
    if (userMatchesRepoCommit(user, normalizedRepoUrl, authorEmail)) {
      matched.push(user);
    }
  }
  return matched;
}

function userMatchesRepoCommit(
  user: UserData,
  normalizedRepoUrl: string,
  authorEmail: string,
): boolean {
  const legacyMatch = user.account.matchings.git?.emails.includes(authorEmail) ?? false;
  for (const integration of user.integrations) {
    if (!isGitIntegration(integration)) continue;
    if (normalizeRepoUrl(integration.config.repoUrl) !== normalizedRepoUrl) continue;
    if (integration.failCount >= 3 || integration.status === "error") continue;
    const emails = integration.emails ?? [];
    if (emails.length === 0 || emails.includes(authorEmail)) return true;
  }
  return legacyMatch;
}

function candidateUserIds(
  users: Record<string, UserIndexEntry>,
  predicate: (entry: UserIndexEntry) => boolean,
): string[] {
  const ids: string[] = [];
  for (const [userId, entry] of Object.entries(users)) {
    if (predicate(entry)) ids.push(userId);
  }
  return ids;
}

export async function isRepoEmailTaken(
  repoUrl: string,
  email: string,
  excludeUserId?: string,
  excludeIntegrationId?: string,
): Promise<boolean> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const index = await ensureUserIndex(getUser);

  // Only users whose index already records this email under this repo can
  // possibly match; load just those and apply the exact exclusion rules.
  const candidates = candidateUserIds(index.users, (entry) =>
    (entry.repoEmails[normalizedRepoUrl] ?? []).includes(email),
  );

  for (const userId of candidates) {
    const user = await getUser(userId);
    if (!user) continue;
    const isExcludedUser = excludeUserId !== undefined && user.account.id === excludeUserId;
    const taken = user.integrations.some((integration) => {
      if (!isGitIntegration(integration)) return false;
      if (isExcludedUser && excludeIntegrationId && integration.id === excludeIntegrationId) {
        return false;
      }
      return (
        normalizeRepoUrl(integration.config.repoUrl) === normalizedRepoUrl &&
        (integration.emails ?? []).includes(email)
      );
    });
    if (taken) return true;
  }
  return false;
}

export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isGitIntegration(integration: Integration): integration is GitIntegration {
  return integration.provider === "git" || integration.provider === "github" || integration.provider === "gitlab";
}
