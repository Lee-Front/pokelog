import type { SlackIntegration, SlackSyncSnapshot, SyncState, UserData } from "../../../../shared/types.js";
import { getConfig } from "../storage/config-store.js";
import { saveUser } from "../storage/user-store.js";
import { applyIntegrationReward } from "./integration-reward.js";

export interface SlackPollResult {
  messageCount: number;
  firstSync: boolean;
  detectedEvents: number;
  appliedEvents: number;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  files?: unknown[];
  reactions?: Array<{ name: string; count: number }>;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  has_more?: boolean;
  error?: string;
}

async function fetchConversationHistory(
  integration: SlackIntegration,
  oldest?: string,
): Promise<SlackMessage[]> {
  const channelId = integration.config.channelId;
  if (!channelId) return [];

  const params = new URLSearchParams({
    channel: channelId,
    limit: "200",
  });
  if (oldest) params.set("oldest", oldest);

  const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${integration.config.botToken}`,
    },
  });

  const data = (await res.json()) as SlackHistoryResponse;
  if (!data.ok) {
    throw new Error(data.error || `Slack API error`);
  }

  return (data.messages ?? []).filter((m) => m.type === "message" && !m.subtype);
}

export async function pollSlackIntegration(
  user: UserData,
  integration: SlackIntegration,
  syncState: SyncState,
): Promise<SlackPollResult> {
  if (!integration.config.channelId) {
    return { messageCount: 0, firstSync: false, detectedEvents: 0, appliedEvents: 0 };
  }

  const config = await getConfig();
  const slackSync = syncState.integrations?.slack ?? {};
  const integrationState: SlackSyncSnapshot | undefined = slackSync[integration.id];
  const isFirstSync = !integrationState;
  const oldest = integrationState?.lastMessageTs;

  const messages = await fetchConversationHistory(integration, oldest);

  let changed = false;
  let detectedEvents = 0;
  let appliedEvents = 0;

  if (!isFirstSync) {
    for (const msg of messages) {
      if (msg.ts === oldest) continue;

      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const summary = (msg.text ?? "").slice(0, 80) || "(message)";

      if (msg.thread_ts && msg.thread_ts !== msg.ts) {
        const applied = applyEvent(user, config.rewards.integrations, "thread_reply", msg.ts, timestamp, summary);
        detectedEvents += 1;
        appliedEvents += applied ? 1 : 0;
        changed ||= applied;
      } else {
        const applied = applyEvent(user, config.rewards.integrations, "message_posted", msg.ts, timestamp, summary);
        detectedEvents += 1;
        appliedEvents += applied ? 1 : 0;
        changed ||= applied;
      }

      if (msg.files && msg.files.length > 0) {
        const fileApplied = applyEvent(user, config.rewards.integrations, "file_shared", msg.ts, timestamp, `${summary} (file)`);
        detectedEvents += 1;
        appliedEvents += fileApplied ? 1 : 0;
        changed ||= fileApplied;
      }
    }
  }

  const latestTs = messages.length > 0
    ? messages.reduce((max, m) => (m.ts > max ? m.ts : max), oldest ?? "0")
    : oldest ?? "0";

  slackSync[integration.id] = { lastMessageTs: latestTs };
  if (syncState.integrations) {
    syncState.integrations.slack = slackSync;
  }

  if (changed) {
    await saveUser(user);
  }

  return {
    messageCount: messages.length,
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
    provider: "slack",
    eventKey,
    sourceId,
    timestamp,
    summary,
  });
  return result.applied;
}
