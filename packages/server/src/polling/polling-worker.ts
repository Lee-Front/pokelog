import { getConfig } from "../storage/config-store.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  cloneBareRepo,
  fetchRepo,
  getNewCommitsAcrossBranches,
  getLatestHash,
  listAuthorEmails,
  listRemoteBranches,
  resolveRepoUrl,
  redactUrlCredentials,
  type GitTlsOptions,
} from "./git-client.js";
import { processCommit } from "./commit-processor.js";
import type { SyncState } from "../../../../shared/types.js";
import path from "node:path";
import fs from "node:fs/promises";
import { getDataDir } from "../paths.js";
import { getAllUsers, isGitIntegration, normalizeRepoUrl, saveUser } from "../storage/user-store.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";
import { pollJiraIntegration } from "../integrations/jira-polling.js";
import { pollSlackIntegration } from "../integrations/slack-polling.js";
import type { GitIntegration, JiraIntegration, SlackIntegration, UserData } from "../../../../shared/types.js";
import { getUser } from "../storage/user-store.js";
import { childLogger } from "../logger.js";
const log = childLogger("polling-worker");


function getReposDir() {
  return path.join(getDataDir(), "repos");
}

function repoLocalDir(url: string): string {
  // Convert URL to safe directory name
  const name = url.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  return path.join(getReposDir(), name + ".git");
}

async function ensureBareClone(
  url: string,
  authMode?: string,
  token?: string,
  tls?: GitTlsOptions,
): Promise<string> {
  const dir = repoLocalDir(url);
  try {
    await fs.access(dir);
  } catch {
    log.info(`Cloning ${url}...`);
    await cloneBareRepo(url, dir, authMode, token, tls);
  }
  return dir;
}

/** Max author emails returned to the integration form. */
const MAX_AUTHOR_EMAILS = 100;

/**
 * Clone (or reuse) a bare mirror of `url` and return its distinct commit author
 * emails with counts, capped at MAX_AUTHOR_EMAILS. Powers the integration form's
 * "load emails" step so users select which of their emails to attribute commits
 * to instead of typing them blindly. Reuses ensureBareClone, so a repo already
 * being polled is not re-cloned.
 */
export async function getRepoAuthorEmails(
  url: string,
  authMode?: string,
  token?: string,
  tls?: GitTlsOptions,
): Promise<{ email: string; count: number }[]> {
  const repoDir = await ensureBareClone(url, authMode, token, tls);
  await fetchRepo(repoDir, tls);
  const emails = await listAuthorEmails(repoDir);
  return emails.slice(0, MAX_AUTHOR_EMAILS);
}

function gitTlsOptions(config: GitIntegration["config"]): GitTlsOptions {
  if (config.insecureSkipTls) {
    log.warn(
      { repoUrl: config.repoUrl },
      "polling a git repo with insecureSkipTls — TLS verification is disabled; use caCertPath in production",
    );
  }
  return {
    caCertPath: config.caCertPath,
    insecureSkipTls: config.insecureSkipTls,
  };
}

/**
 * Process new commits for one repo across all its branches, deduplicated by
 * commit so a commit shared by several branches is rewarded only once. Updates
 * syncState per-branch tips in place. Returns the number of commits processed.
 */
async function pollRepoCommits(
  repoDir: string,
  repoUrl: string,
  branches: string[],
  syncState: SyncState,
): Promise<number> {
  if (!syncState.repos[repoUrl]) {
    syncState.repos[repoUrl] = {};
  }
  const branchState = syncState.repos[repoUrl];

  // Previously-processed tips (per-branch lastHash) to exclude from this poll.
  const previousTips = [...new Set(Object.values(branchState).filter(Boolean))];

  // Current tip hash for each branch; skip branches that do not resolve.
  const currentTips = new Map<string, string>();
  for (const branch of branches) {
    const tip = await getLatestHash(repoDir, branch);
    if (tip) currentTips.set(branch, tip);
  }
  if (currentTips.size === 0) return 0;

  const commits = await getNewCommitsAcrossBranches(
    repoDir,
    [...currentTips.keys()].map((branch) => `origin/${branch}`),
    previousTips,
  );

  for (const commit of commits) {
    await processCommit(commit, repoDir, repoUrl);
  }

  // Advance every branch tip so subsequent polls only see newer commits.
  for (const [branch, tip] of currentTips) {
    branchState[branch] = tip;
  }

  return commits.length;
}

export async function pollAllRepos(): Promise<void> {
  const config = await getConfig();
  const syncState = await getSyncState();
  const users = await getAllUsers();
  const integrationRepoMap = new Map<string, { authMode?: string; token?: string; tls?: GitTlsOptions }>();

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
          tls: gitTlsOptions((integration as GitIntegration).config),
        });
      }
    }
  }

  const reposToPoll = [
    ...config.polling.repos.map((repo) => ({ url: repo.url, branches: repo.branches, source: "admin" as const, authMode: undefined as string | undefined, token: undefined as string | undefined, tls: undefined as GitTlsOptions | undefined })),
    ...[...integrationRepoMap.entries()]
      .filter(([url]) => !config.polling.repos.some((repo) => normalizeRepoUrl(repo.url) === url))
      .map(([url, auth]) => ({ url, branches: null as string[] | null, source: "integration" as const, authMode: auth.authMode, token: auth.token, tls: auth.tls })),
  ];

  for (const repo of reposToPoll) {
    try {
      const repoDir = await ensureBareClone(repo.url, repo.authMode, repo.token, repo.tls);
      await fetchRepo(repoDir, repo.tls);

      const branches = repo.branches ?? await listRemoteBranches(repoDir);
      await pollRepoCommits(repoDir, repo.url, branches, syncState);
    } catch (err) {
      // Git errors can embed the token-bearing URL; redact before logging.
      const message = redactUrlCredentials(err instanceof Error ? err.message : String(err));
      log.error({ err: message }, `Error polling ${repo.url}`);
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
        log.error({ err }, `Error polling ${integration.provider} integration ${integration.id}`);
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
      log.error({ err }, `Error polling ${integration.provider} integration ${integration.id}`);
    }
  }

  // Git integrations - poll repos this user uses
  for (const integration of user.integrations) {
    if (!isGitIntegration(integration)) continue;
    if (integration.failCount >= 3 || integration.status === "error") continue;
    if (!integration.config.repoUrl?.trim()) continue;

    try {
      const git = integration as GitIntegration;
      const tls = gitTlsOptions(git.config);
      const repoDir = await ensureBareClone(git.config.repoUrl, git.config.authMode, git.config.token, tls);
      await fetchRepo(repoDir, tls);

      const branches = await listRemoteBranches(repoDir);
      await pollRepoCommits(repoDir, git.config.repoUrl, branches, syncState);
      changed = true;
    } catch (err) {
      // Git errors can embed the token-bearing URL; redact before logging.
      const message = redactUrlCredentials(err instanceof Error ? err.message : String(err));
      log.error({ err: message }, `Error polling repo for user ${userId}`);
    }
  }

  if (changed) {
    await saveUser(user);
    await saveSyncState(syncState);
  }
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export function startPolling(): void {
  if (pollingInterval) return;

  // Poll immediately, then at interval
  pollAllRepos().catch((err) => log.error({ err }, "Initial poll failed"));

  getConfig().then((config) => {
    if (pollingInterval) return;
    const intervalMs = config.polling.intervalMinutes * 60 * 1000;
    pollingInterval = setInterval(() => {
      pollAllRepos().catch((err) => log.error({ err }, "Scheduled poll failed"));
    }, intervalMs);
    log.info(`Polling started (every ${config.polling.intervalMinutes} min)`);
  });
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
