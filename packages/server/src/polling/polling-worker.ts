import { getConfig } from "../storage/config-store.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  cloneBareRepo,
  fetchRepo,
  getNewCommits,
  getLatestHash,
} from "./git-client.js";
import { processCommit } from "./commit-processor.js";
import path from "node:path";
import fs from "node:fs/promises";

const REPOS_DIR = path.join(
  process.env.POKELOG_DATA_DIR || "pokelog-data",
  "repos",
);

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

  for (const repo of config.polling.repos) {
    try {
      const repoDir = await ensureBareClone(repo.url);
      await fetchRepo(repoDir);

      if (!syncState.repos[repo.url]) {
        syncState.repos[repo.url] = {};
      }

      for (const branch of repo.branches) {
        const lastHash = syncState.repos[repo.url][branch] || null;
        const commits = await getNewCommits(repoDir, branch, lastHash);

        for (const commit of commits) {
          await processCommit(commit, repoDir);
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
