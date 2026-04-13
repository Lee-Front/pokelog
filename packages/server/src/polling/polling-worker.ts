import { getConfig } from "../storage/config-store.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  cloneBareRepo,
  fetchRepo,
  getNewCommits,
  getLatestHash,
  listRemoteBranches,
  resolveRepoUrl,
} from "./git-client.js";
import { processCommit } from "./commit-processor.js";
import path from "node:path";
import fs from "node:fs/promises";
import { DATA_DIR } from "../paths.js";
import { getAllUsers, isGitIntegration, normalizeRepoUrl, saveUser } from "../storage/user-store.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";
import { pollJiraIntegration } from "../integrations/jira-polling.js";
import { pollSlackIntegration } from "../integrations/slack-polling.js";
import type { GitIntegration, JiraIntegration, SlackIntegration, UserData } from "../../../../shared/types.js";
import { getUser } from "../storage/user-store.js";

const REPOS_DIR = path.join(DATA_DIR, "repos");

function repoLocalDir(url: string): string {
  // Convert URL to safe directory name
  const name = url.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  return path.join(REPOS_DIR, name + ".git");
}

async function ensureBareClone(url: string, authMode?: string, token?: string): Promise<string> {
  const dir = repoLocalDir(url);
  try {
    await fs.access(dir);
  } catch {
    console.log(`Cloning ${url}...`);
    await cloneBareRepo(url, dir, authMode, token);
  }
  return dir;
}

export async function pollAllRepos(): Promise<void> {
  const config = await getConfig();
  const syncState = await getSyncState();
  const users = await getAllUsers();
  const integrationRepoMap = new Map<string, { authMode?: string; token?: string }>();

  for (const user of users) {
    for (const integration of user.integrations) {
      if (!isGitIntegration(integration)) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;
      if (!integration.config.repoUrl?.trim()) continue;
      const normalized = normalizeRepoUrl(integration.config.repoUrl);
      if (!integrationRepoMap.has(normalized)) {
        integrationRepoMap.set(normalized, {
          authMode: (integration as GitIntegration).config.authMode,
          token: (integration as GitIntegration).config.token,
        });
      }
    }
  }

  const reposToPoll = [
    ...config.polling.repos.map((repo) => ({ url: repo.url, branches: repo.branches, source: "admin" as const, authMode: undefined as string | undefined, token: undefined as string | undefined })),
    ...[...integrationRepoMap.entries()]
      .filter(([url]) => !config.polling.repos.some((repo) => normalizeRepoUrl(repo.url) === url))
      .map(([url, auth]) => ({ url, branches: null as string[] | null, source: "integration" as const, authMode: auth.authMode, token: auth.token })),
  ];

  for (const repo of reposToPoll) {
    try {
      const repoDir = await ensureBareClone(repo.url, repo.authMode, repo.token);
      await fetchRepo(repoDir);

      const branches = repo.branches ?? await listRemoteBranches(repoDir);

      if (!syncState.repos[repo.url]) {
        syncState.repos[repo.url] = {};
      }

      for (const branch of branches) {
        const lastHash = syncState.repos[repo.url][branch] || null;
        const commits = await getNewCommits(repoDir, branch, lastHash);

        for (const commit of commits) {
          await processCommit(commit, repoDir, repo.url);
        }

        // Update sync state to latest
        const latestHash = await getLatestHash(repoDir, branch);
        if (latestHash) {
          syncState.repos[repo.url][branch] = latestHash;
        }
      }
    } catch (err) {
      console.error(`Error polling ${repo.url}:`, err);
    }
  }

  for (const user of users) {
    for (const integration of user.integrations) {
      if (!("config" in integration)) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;

      try {
        if (integration.provider === "notion") {
          await pollNotionIntegration(user, integration, syncState);
        } else if (integration.provider === "jira") {
          await pollJiraIntegration(user, integration as JiraIntegration, syncState);
        } else if (integration.provider === "slack") {
          await pollSlackIntegration(user, integration as SlackIntegration, syncState);
        } else {
          continue;
        }

        integration.status = "ok";
        integration.failCount = 0;
        integration.lastCheckedAt = new Date().toISOString();
        delete integration.lastError;
      } catch (err) {
        integration.status = "error";
        integration.failCount += 1;
        integration.lastCheckedAt = new Date().toISOString();
        integration.lastError = err instanceof Error ? err.message : `${integration.provider} polling failed`;
        await saveUser(user);
        console.error(`Error polling ${integration.provider} integration ${integration.id}:`, err);
        continue;
      }
      await saveUser(user);
    }
  }

  await saveSyncState(syncState);
}

/** Poll a single user's non-git integrations (Notion/Jira/Slack) on demand. */
export async function pollUserIntegrations(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user) return;

  const syncState = await getSyncState();
  let changed = false;

  for (const integration of user.integrations) {
    if (!("config" in integration)) continue;
    if (integration.failCount >= 3 || integration.status === "error") continue;

    try {
      if (integration.provider === "notion") {
        await pollNotionIntegration(user, integration, syncState);
      } else if (integration.provider === "jira") {
        await pollJiraIntegration(user, integration as JiraIntegration, syncState);
      } else if (integration.provider === "slack") {
        await pollSlackIntegration(user, integration as SlackIntegration, syncState);
      } else {
        continue;
      }

      integration.status = "ok";
      integration.failCount = 0;
      integration.lastCheckedAt = new Date().toISOString();
      delete integration.lastError;
      changed = true;
    } catch (err) {
      integration.status = "error";
      integration.failCount += 1;
      integration.lastCheckedAt = new Date().toISOString();
      integration.lastError = err instanceof Error ? err.message : `${integration.provider} polling failed`;
      changed = true;
      console.error(`Error polling ${integration.provider} integration ${integration.id}:`, err);
    }
  }

  // Git integrations - poll repos this user uses
  for (const integration of user.integrations) {
    if (!isGitIntegration(integration)) continue;
    if (integration.failCount >= 3 || integration.status === "error") continue;
    if (!integration.config.repoUrl?.trim()) continue;

    try {
      const git = integration as GitIntegration;
      const repoDir = await ensureBareClone(git.config.repoUrl, git.config.authMode, git.config.token);
      await fetchRepo(repoDir);

      if (!syncState.repos[git.config.repoUrl]) {
        syncState.repos[git.config.repoUrl] = {};
      }

      const branches = await listRemoteBranches(repoDir);
      for (const branch of branches) {
        const lastHash = syncState.repos[git.config.repoUrl][branch] || null;
        const commits = await getNewCommits(repoDir, branch, lastHash);
        for (const commit of commits) {
          await processCommit(commit, repoDir, git.config.repoUrl);
        }
        const latestHash = await getLatestHash(repoDir, branch);
        if (latestHash) {
          syncState.repos[git.config.repoUrl][branch] = latestHash;
        }
      }
      changed = true;
    } catch (err) {
      console.error(`Error polling repo for user ${userId}:`, err);
    }
  }

  if (changed) {
    await saveUser(user);
    await saveSyncState(syncState);
  }
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export function startPolling(): void {
  // Poll immediately, then at interval
  pollAllRepos().catch(console.error);

  getConfig().then((config) => {
    const intervalMs = config.polling.intervalMinutes * 60 * 1000;
    pollingInterval = setInterval(() => {
      pollAllRepos().catch(console.error);
    }, intervalMs);
    console.log(`Polling started (every ${config.polling.intervalMinutes} min)`);
  });
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
