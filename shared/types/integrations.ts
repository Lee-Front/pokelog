// === Integrations ===
export interface GitMatching {
  emails: string[];
}

export type IntegrationProvider =
  | "github"
  | "gitlab"
  | "git"
  | "notion"
  | "jira"
  | "slack";

export type IntegrationStatus = "untested" | "testing" | "ok" | "error";

export interface IntegrationBase {
  id: string;
  provider: IntegrationProvider;
  label: string;
  status: IntegrationStatus;
  lastError?: string;
  failCount: number;
  addedAt: string;
  lastCheckedAt?: string;
}

export interface GitIntegration extends IntegrationBase {
  provider: "github" | "gitlab" | "git";
  config: {
    repoUrl: string;
    authMode?: "public" | "token";
    token?: string;
  };
  emails?: string[];
}

export interface NotionIntegration extends IntegrationBase {
  provider: "notion";
  config: {
    token: string;
  };
}

export interface JiraIntegration extends IntegrationBase {
  provider: "jira";
  config: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey?: string;
  };
}

export interface SlackIntegration extends IntegrationBase {
  provider: "slack";
  config: {
    botToken: string;
    teamId?: string;
    channelId?: string;
  };
}

export type Integration =
  | GitIntegration
  | NotionIntegration
  | JiraIntegration
  | SlackIntegration
  | IntegrationBase;
