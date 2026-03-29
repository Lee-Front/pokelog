import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { GitIntegration, Integration, UserData } from "../../../../shared/types.js";
import { DATA_DIR } from "../paths.js";

function userPath(userId: string): string {
  return path.join(DATA_DIR, "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  const user = await readJson<UserData>(userPath(userId));
  return user ? normalizeUserData(user) : null;
}

export async function saveUser(userData: UserData): Promise<void> {
  await writeJson(userPath(userData.account.id), normalizeUserData(userData));
}

export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(DATA_DIR, "users");
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

function normalizeIntegration(integration: Integration): Integration {
  return {
    ...integration,
    failCount: integration.failCount ?? 0,
  };
}

function normalizeUserData(user: UserData): UserData {
  return {
    ...user,
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
