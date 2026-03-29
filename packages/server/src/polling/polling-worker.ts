import { getConfig } from "../storage/config-store.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  cloneBareRepo,
  fetchRepo,
  getNewCommits,
  getLatestHash,
  listRemoteBranches,
} from "./git-client.js";
import { processCommit } from "./commit-processor.js";
import path from "node:path";
import fs from "node:fs/promises";
import { DATA_DIR } from "../paths.js";
import { getAllUsers, isGitIntegration, normalizeRepoUrl, saveUser } from "../storage/user-store.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";

const REPOS_DIR = path.join(DATA_DIR, "repos");

function repoLocalDir(url: string): string {
  // Convert URL to safe directory name
  const name = url.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  return path.join(REPOS_DIR, name + ".git");
}

async function ensureBareClone(url: string): Promise<string> {
  const dir = repoLocalDir(url);
  try {
    await fs.access(dir);
  } catch {
    console.log(`Cloning ${url}...`);
    await cloneBareRepo(url, dir);
  }
  return dir;
}

export async function pollAllRepos(): Promise<void> {
  const config = await getConfig();
  const syncState = await getSyncState();
  const users = await getAllUsers();
  const integrationRepoUrls = new Set<string>();

  for (const user of users) {
    for (const integration of user.integrations) {
      if (!isGitIntegration(integration)) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;
      if (!integration.config.repoUrl?.trim()) continue;
      integrationRepoUrls.add(normalizeRepoUrl(integration.config.repoUrl));
    }
  }

  const reposToPoll = [
    ...config.polling.repos.map((repo) => ({ url: repo.url, branches: repo.branches, source: "admin" as const })),
    ...[...integrationRepoUrls]
      .filter((url) => !config.polling.repos.some((repo) => normalizeRepoUrl(repo.url) === url))
      .map((url) => ({ url, branches: null as string[] | null, source: "integration" as const })),
  ];

  for (const repo of reposToPoll) {
    try {
      const repoDir = await ensureBareClone(repo.url);
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
      if (integration.provider !== "notion" || !("config" in integration)) continue;
      if (integration.failCount >= 3 || integration.status === "error") continue;
      try {
        await pollNotionIntegration(user, integration, syncState);
        integration.status = "ok";
        integration.failCount = 0;
        integration.lastCheckedAt = new Date().toISOString();
        delete integration.lastError;
      } catch (err) {
        integration.status = "error";
        integration.failCount += 1;
        integration.lastCheckedAt = new Date().toISOString();
        integration.lastError = err instanceof Error ? err.message : "Notion polling failed";
        await saveUser(user);
        console.error(`Error polling Notion integration ${integration.id}:`, err);
        continue;
      }
      await saveUser(user);
    }
  }

  await saveSyncState(syncState);
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
