import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { GitIntegration, Integration, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { normalizeDamageTakenTotal } from "../game/battle-progress.js";
import { resolvePokemonGender, seededGenderRoll } from "../game/pokemon-gender.js";
import { normalizeMoveUsageCounts } from "../game/move-usage.js";

function userPath(userId: string): string {
  return path.join(getDataDir(), "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  const user = await readJson<UserData>(userPath(userId));
  return user ? normalizeUserData(user) : null;
}

export async function saveUser(userData: UserData): Promise<void> {
  await writeJson(userPath(userData.account.id), normalizeUserData(userData));
}

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
  const users = await getAllUsers();
  return users.find((u) => {
    return u.account.matchings.git?.emails.includes(email);
  }) || null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user !== null;
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

  const users = await getAllUsers();
  const ranked = users
    .filter((user) => user.account.id !== options.excludeUserId)
    .map((user) => {
      const id = user.account.id;
      const nickname = user.account.nickname;
      const normalizedId = id.toLowerCase();
      const normalizedNickname = nickname.toLowerCase();

      let score = -1;
      if (normalizedId === normalizedQuery) score = 100;
      else if (normalizedNickname === normalizedQuery) score = 95;
      else if (normalizedId.startsWith(normalizedQuery)) score = 80;
      else if (normalizedNickname.startsWith(normalizedQuery)) score = 75;
      else if (normalizedId.includes(normalizedQuery)) score = 50;
      else if (normalizedNickname.includes(normalizedQuery)) score = 45;

      return {
        id,
        nickname,
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
    tradeLocked: pokemon.tradeLocked ?? false,
    nature: pokemon.nature ?? "hardy",
    isShiny: pokemon.isShiny ?? false,
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
  const users = await getAllUsers();
  return users.filter((user) => {
    const legacyMatch = user.account.matchings.git?.emails.includes(authorEmail) ?? false;
    for (const integration of user.integrations) {
      if (!isGitIntegration(integration)) continue;
      if (normalizeRepoUrl(integration.config.repoUrl) !== normalizedRepoUrl) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;
      const emails = integration.emails ?? [];
      if (emails.length === 0 || emails.includes(authorEmail)) return true;
    }
    return legacyMatch;
  });
}

export async function isRepoEmailTaken(
  repoUrl: string,
  email: string,
  excludeUserId?: string,
  excludeIntegrationId?: string,
): Promise<boolean> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const users = await getAllUsers();
  return users.some((user) => {
    if (excludeUserId && user.account.id === excludeUserId) {
      return user.integrations.some((integration) => {
        if (!isGitIntegration(integration)) return false;
        if (excludeIntegrationId && integration.id === excludeIntegrationId) return false;
        return (
          normalizeRepoUrl(integration.config.repoUrl) === normalizedRepoUrl &&
          (integration.emails ?? []).includes(email)
        );
      });
    }
    return user.integrations.some((integration) => {
      if (!isGitIntegration(integration)) return false;
      return (
        normalizeRepoUrl(integration.config.repoUrl) === normalizedRepoUrl &&
        (integration.emails ?? []).includes(email)
      );
    });
  });
}

export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isGitIntegration(integration: Integration): integration is GitIntegration {
  return integration.provider === "git" || integration.provider === "github" || integration.provider === "gitlab";
}
