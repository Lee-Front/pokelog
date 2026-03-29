import type { IntegrationEventDefinition, IntegrationRewardRules } from "../../../../shared/types.js";

type Catalog = {
  git: IntegrationEventDefinition[];
  notion: IntegrationEventDefinition[];
  jira: IntegrationEventDefinition[];
  slack: IntegrationEventDefinition[];
};

export const INTEGRATION_EVENT_CATALOG: Catalog = {
  git: [
    {
      key: "commit",
      label: "Commit detected",
      description: "A new commit matched the repository and optional email filters.",
      recommended: true,
    },
  ],
  notion: [
    {
      key: "page_created",
      label: "Page created",
      description: "A new page appeared in a tracked workspace or data source.",
      recommended: true,
    },
    {
      key: "page_content_edited",
      label: "Page content edited",
      description: "The page last_edited_time changed and content changed enough to count as work.",
      recommended: true,
    },
    {
      key: "page_archived",
      label: "Page archived",
      description: "A page was archived or restored.",
      recommended: false,
    },
    {
      key: "database_item_created",
      label: "Database item created",
      description: "A new page row was created inside a data source.",
      recommended: true,
    },
    {
      key: "database_item_edited",
      label: "Database item edited",
      description: "An existing data source row changed.",
      recommended: true,
    },
    {
      key: "status_changed",
      label: "Status changed",
      description: "A status/select property changed on a tracked item.",
      recommended: true,
    },
    {
      key: "status_done",
      label: "Status moved to done",
      description: "A tracked item moved into a configured done state.",
      recommended: true,
    },
    {
      key: "comment_created",
      label: "Comment created",
      description: "A page or block comment was added.",
      recommended: false,
      experimental: true,
    },
  ],
  jira: [
    {
      key: "issue_created",
      label: "Issue created",
      description: "A new issue was created in a tracked project.",
      recommended: true,
    },
    {
      key: "issue_updated",
      label: "Issue updated",
      description: "An issue changelog entry was added.",
      recommended: true,
    },
    {
      key: "issue_transitioned",
      label: "Issue transitioned",
      description: "The issue status changed to a different workflow state.",
      recommended: true,
    },
    {
      key: "issue_done",
      label: "Issue moved to done",
      description: "The issue moved into a configured done category or status.",
      recommended: true,
    },
    {
      key: "comment_created",
      label: "Comment created",
      description: "A new comment was added to an issue.",
      recommended: false,
    },
    {
      key: "worklog_created",
      label: "Worklog created",
      description: "A worklog entry was added to an issue.",
      recommended: true,
    },
    {
      key: "assignee_changed",
      label: "Assignee changed",
      description: "The issue assignee changed.",
      recommended: false,
    },
  ],
  slack: [
    {
      key: "message_posted",
      label: "Message posted",
      description: "A message event was received for a tracked conversation.",
      recommended: true,
    },
    {
      key: "app_mention",
      label: "App mention",
      description: "The bot was directly mentioned in a channel.",
      recommended: false,
    },
    {
      key: "reaction_added",
      label: "Reaction added",
      description: "A reaction event was received for a tracked message.",
      recommended: false,
      experimental: true,
    },
    {
      key: "file_shared",
      label: "File shared",
      description: "A file was shared in a tracked conversation.",
      recommended: false,
    },
    {
      key: "thread_reply",
      label: "Thread reply",
      description: "A message was posted as a reply in a thread.",
      recommended: true,
    },
  ],
};

export const DEFAULT_INTEGRATION_REWARD_RULES: IntegrationRewardRules = {
  git: {
    commit: { enabled: true, points: 0, exp: 0 },
  },
  notion: {
    page_created: { enabled: true, points: 30, exp: 0 },
    page_content_edited: { enabled: true, points: 10, exp: 0, cooldownMinutes: 15 },
    page_archived: { enabled: false, points: 0, exp: 0 },
    database_item_created: { enabled: true, points: 20, exp: 0 },
    database_item_edited: { enabled: true, points: 8, exp: 0, cooldownMinutes: 15 },
    status_changed: { enabled: false, points: 0, exp: 0 },
    status_done: { enabled: true, points: 40, exp: 0 },
    comment_created: { enabled: false, points: 0, exp: 0, cooldownMinutes: 30, dailyMax: 10 },
  },
  jira: {
    issue_created: { enabled: true, points: 20, exp: 0 },
    issue_updated: { enabled: true, points: 8, exp: 0, cooldownMinutes: 15 },
    issue_transitioned: { enabled: true, points: 12, exp: 0 },
    issue_done: { enabled: true, points: 50, exp: 0 },
    comment_created: { enabled: false, points: 0, exp: 0, cooldownMinutes: 15, dailyMax: 20 },
    worklog_created: { enabled: true, points: 15, exp: 0 },
    assignee_changed: { enabled: false, points: 0, exp: 0 },
  },
  slack: {
    message_posted: { enabled: false, points: 0, exp: 0, cooldownMinutes: 5, dailyMax: 20 },
    app_mention: { enabled: false, points: 0, exp: 0, cooldownMinutes: 10, dailyMax: 10 },
    reaction_added: { enabled: false, points: 0, exp: 0, cooldownMinutes: 10, dailyMax: 20 },
    file_shared: { enabled: false, points: 0, exp: 0, cooldownMinutes: 10, dailyMax: 10 },
    thread_reply: { enabled: false, points: 0, exp: 0, cooldownMinutes: 5, dailyMax: 20 },
  },
};

export function mergeIntegrationRewardRules(
  current: Partial<IntegrationRewardRules> | undefined,
): IntegrationRewardRules {
  return {
    git: mergeProviderRules(DEFAULT_INTEGRATION_REWARD_RULES.git, current?.git),
    notion: mergeProviderRules(DEFAULT_INTEGRATION_REWARD_RULES.notion, current?.notion),
    jira: mergeProviderRules(DEFAULT_INTEGRATION_REWARD_RULES.jira, current?.jira),
    slack: mergeProviderRules(DEFAULT_INTEGRATION_REWARD_RULES.slack, current?.slack),
  };
}

function mergeProviderRules(
  defaults: Record<string, IntegrationRewardRules[keyof IntegrationRewardRules][string]>,
  current: Record<string, IntegrationRewardRules[keyof IntegrationRewardRules][string]> | undefined,
) {
  const merged = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, { ...value, ...(current?.[key] ?? {}) }]),
  );
  return merged;
}
