import { Buffer } from "node:buffer";
import type { JiraIntegration, JiraSyncSnapshot, SyncState, UserData } from "../../../../shared/types.js";
import { getConfig } from "../storage/config-store.js";
import { saveUser } from "../storage/user-store.js";
import { applyIntegrationReward } from "./integration-reward.js";

export interface JiraPollResult {
  issueCount: number;
  firstSync: boolean;
  detectedEvents: number;
  appliedEvents: number;
}

interface JiraIssue {
  key: string;
  fields: {
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { accountId?: string; displayName?: string } | null;
    updated?: string;
    comment?: { total?: number };
    worklog?: { total?: number };
    summary?: string;
  };
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  total?: number;
  startAt?: number;
  maxResults?: number;
}

async function searchJiraIssues(integration: JiraIntegration): Promise<JiraIssue[]> {
  const auth = Buffer.from(`${integration.config.email}:${integration.config.apiToken}`).toString("base64");
  const baseUrl = integration.config.baseUrl.replace(/\/+$/, "");
  const issues: JiraIssue[] = [];
  let startAt = 0;

  while (true) {
    const jql = integration.config.projectKey
      ? `project = "${integration.config.projectKey}" ORDER BY updated DESC`
      : "ORDER BY updated DESC";

    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: "100",
      fields: "status,assignee,updated,comment,worklog,summary",
    });

    const res = await fetch(`${baseUrl}/rest/api/3/search?${params}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const messages = Array.isArray(data.errorMessages)
        ? data.errorMessages.filter((item): item is string => typeof item === "string")
        : [];
      throw new Error(messages[0] || `Jira API error (${res.status})`);
    }

    const data = (await res.json()) as JiraSearchResponse;
    for (const issue of data.issues ?? []) {
      issues.push(issue);
    }

    const total = data.total ?? 0;
    startAt += data.maxResults ?? 100;
    if (startAt >= total) break;
  }

  return issues;
}

function toSnapshot(issue: JiraIssue): JiraSyncSnapshot {
  return {
    issueKey: issue.key,
    statusName: issue.fields.status?.name ?? "",
    statusCategory: issue.fields.status?.statusCategory?.key ?? "",
    assignee: issue.fields.assignee?.accountId,
    updated: issue.fields.updated ?? "",
    commentCount: issue.fields.comment?.total ?? 0,
    worklogCount: issue.fields.worklog?.total ?? 0,
  };
}

const DONE_CATEGORIES = new Set(["done"]);

export async function pollJiraIntegration(
  user: UserData,
  integration: JiraIntegration,
  syncState: SyncState,
): Promise<JiraPollResult> {
  const config = await getConfig();
  const issues = await searchJiraIssues(integration);
  const jiraSync = syncState.integrations?.jira ?? {};
  const integrationState: Record<string, JiraSyncSnapshot> = jiraSync[integration.id] ?? {};
  const isFirstSync = Object.keys(integrationState).length === 0;
  let changed = false;
  let detectedEvents = 0;
  let appliedEvents = 0;

  for (const issue of issues) {
    const snapshot = toSnapshot(issue);
    const previous = integrationState[issue.key];
    integrationState[issue.key] = snapshot;

    if (isFirstSync) continue;

    const summary = issue.fields.summary || issue.key;

    if (!previous) {
      const applied = applyEvent(user, config.rewards.integrations, "issue_created", issue.key, snapshot.updated, summary);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
      continue;
    }

    if (previous.updated !== snapshot.updated) {
      const applied = applyEvent(user, config.rewards.integrations, "issue_updated", issue.key, snapshot.updated, summary);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }

    if (previous.statusName !== snapshot.statusName) {
      const applied = applyEvent(user, config.rewards.integrations, "issue_transitioned", issue.key, snapshot.updated, `${summary}: ${previous.statusName} -> ${snapshot.statusName}`);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;

      if (DONE_CATEGORIES.has(snapshot.statusCategory.toLowerCase())) {
        const doneApplied = applyEvent(user, config.rewards.integrations, "issue_done", issue.key, snapshot.updated, `${summary}: ${snapshot.statusName}`);
        detectedEvents += 1;
        appliedEvents += doneApplied ? 1 : 0;
        changed ||= doneApplied;
      }
    }

    if (snapshot.commentCount > previous.commentCount) {
      const applied = applyEvent(user, config.rewards.integrations, "comment_created", issue.key, snapshot.updated, `${summary} (comment)`);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }

    if (snapshot.worklogCount > previous.worklogCount) {
      const applied = applyEvent(user, config.rewards.integrations, "worklog_created", issue.key, snapshot.updated, `${summary} (worklog)`);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }

    if ((previous.assignee ?? "") !== (snapshot.assignee ?? "") && snapshot.assignee) {
      const applied = applyEvent(user, config.rewards.integrations, "assignee_changed", issue.key, snapshot.updated, `${summary} (assignee)`);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }
  }

  jiraSync[integration.id] = integrationState;
  if (syncState.integrations) {
    syncState.integrations.jira = jiraSync;
  }

  if (changed) {
    await saveUser(user);
  }

  return {
    issueCount: issues.length,
    firstSync: isFirstSync,
    detectedEvents,
    appliedEvents,
  };
}

function applyEvent(
  user: UserData,
  rules: Awaited<ReturnType<typeof getConfig>>["rewards"]["integrations"],
  eventKey: string,
  sourceId: string,
  timestamp: string,
  summary: string,
): boolean {
  const result = applyIntegrationReward(user, rules, {
    provider: "jira",
    eventKey,
    sourceId,
    timestamp,
    summary,
  });
  return result.applied;
}
