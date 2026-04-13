import { Buffer } from "node:buffer";
import type {
  GitIntegration,
  Integration,
  JiraIntegration,
  NotionIntegration,
  SlackIntegration,
} from "../../../../shared/types.js";
import { testRepoAccess } from "../polling/git-client.js";
import { listNotionPages } from "./notion-client.js";
import { isGitIntegration } from "../storage/user-store.js";

export interface ProviderTestResult {
  ok: boolean;
  lastError?: string;
  warning?: string;
  metadata?: Record<string, unknown>;
}

export async function testIntegrationConnection(integration: Integration): Promise<ProviderTestResult> {
  if (isGitIntegration(integration)) {
    return testGitIntegration(integration);
  }

  if (isNotionIntegration(integration)) {
    return testNotionIntegration(integration);
  }
  if (isJiraIntegration(integration)) {
    return testJiraIntegration(integration);
  }
  if (isSlackIntegration(integration)) {
    return testSlackIntegration(integration);
  }

  switch (integration.provider) {
    case "notion":
    case "jira":
    case "slack":
      return { ok: false, lastError: `invalid integration payload for provider: ${integration.provider}` };
    default:
      return { ok: false, lastError: `unsupported provider: ${integration.provider}` };
  }
}

function isNotionIntegration(integration: Integration): integration is NotionIntegration {
  return integration.provider === "notion" && "config" in integration;
}

function isJiraIntegration(integration: Integration): integration is JiraIntegration {
  return integration.provider === "jira" && "config" in integration;
}

function isSlackIntegration(integration: Integration): integration is SlackIntegration {
  return integration.provider === "slack" && "config" in integration;
}

async function testGitIntegration(integration: GitIntegration): Promise<ProviderTestResult> {
  const result = await testRepoAccess(integration.config.repoUrl, integration.config.authMode, integration.config.token);
  return {
    ok: result.ok,
    lastError: result.error,
    warning: (integration.emails ?? []).length === 0
      ? "이 저장소의 모든 작성자 커밋이 집계됩니다."
      : undefined,
    metadata: { branches: result.branches },
  };
}

async function testNotionIntegration(integration: NotionIntegration): Promise<ProviderTestResult> {
  try {
    const res = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${integration.config.token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        lastError: typeof data.message === "string" ? data.message : `Notion API error (${res.status})`,
      };
    }

    const pages = await listNotionPages(integration);

    return {
      ok: true,
      metadata: {
        notionUserId: data.id,
        pageCount: pages.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      lastError: error instanceof Error ? error.message : "Notion API request failed",
    };
  }
}

async function testJiraIntegration(integration: JiraIntegration): Promise<ProviderTestResult> {
  try {
    const auth = Buffer.from(`${integration.config.email}:${integration.config.apiToken}`).toString("base64");
    const baseUrl = integration.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const messages = Array.isArray(data.errorMessages)
        ? data.errorMessages.filter((item): item is string => typeof item === "string")
        : [];
      return {
        ok: false,
        lastError: messages[0] || `Jira API error (${res.status})`,
      };
    }

    return {
      ok: true,
      metadata: {
        displayName: data.displayName,
        projectKey: integration.config.projectKey,
      },
    };
  } catch (error) {
    return {
      ok: false,
      lastError: error instanceof Error ? error.message : "Jira API request failed",
    };
  }
}

async function testSlackIntegration(integration: SlackIntegration): Promise<ProviderTestResult> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.config.botToken}`,
      },
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        lastError: typeof data.error === "string" ? data.error : `Slack API error (${res.status})`,
      };
    }

    return {
      ok: true,
      metadata: {
        team: data.team,
        teamId: data.team_id,
        channelId: integration.config.channelId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      lastError: error instanceof Error ? error.message : "Slack API request failed",
    };
  }
}
