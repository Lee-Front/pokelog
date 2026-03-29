import type { NotionIntegration, SyncState, UserData } from "../../../../shared/types.js";
import { getConfig } from "../storage/config-store.js";
import { saveUser } from "../storage/user-store.js";
import { applyIntegrationReward } from "./integration-reward.js";
import { listNotionPages, type NotionPageSnapshot } from "./notion-client.js";

export interface NotionPollResult {
  snapshotCount: number;
  firstSync: boolean;
  detectedEvents: number;
  appliedEvents: number;
}

export async function pollNotionIntegration(
  user: UserData,
  integration: NotionIntegration,
  syncState: SyncState,
): Promise<NotionPollResult> {
  const config = await getConfig();
  const snapshots = await listNotionPages(integration);
  const notionSync = syncState.integrations?.notion ?? {};
  const integrationState = notionSync[integration.id] ?? {};
  const isFirstSync = Object.keys(integrationState).length === 0;
  let changed = false;
  let detectedEvents = 0;
  let appliedEvents = 0;

  for (const snapshot of snapshots) {
    const previous = integrationState[snapshot.id];
    integrationState[snapshot.id] = {
      createdTime: snapshot.createdTime,
      lastEditedTime: snapshot.lastEditedTime,
      archived: snapshot.archived,
      parentType: snapshot.parentType,
      statusValue: snapshot.statusValue,
    };

    if (isFirstSync) {
      continue;
    }

    const baseSummary = snapshot.title || snapshot.id;
    if (!previous) {
      const applied = applyEvent(user, config.rewards.integrations, "notion", classifyCreated(snapshot), snapshot.id, snapshot.lastEditedTime, baseSummary);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
      continue;
    }

    if (!previous.archived && snapshot.archived) {
      const applied = applyEvent(user, config.rewards.integrations, "notion", "page_archived", snapshot.id, snapshot.lastEditedTime, baseSummary);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }

    if (previous.lastEditedTime !== snapshot.lastEditedTime) {
      const applied = applyEvent(user, config.rewards.integrations, "notion", classifyEdited(snapshot), snapshot.id, snapshot.lastEditedTime, baseSummary);
      detectedEvents += 1;
      appliedEvents += applied ? 1 : 0;
      changed ||= applied;
    }

    if ((previous.statusValue ?? "") !== (snapshot.statusValue ?? "") && snapshot.statusValue) {
      const statusApplied = applyEvent(user, config.rewards.integrations, "notion", "status_changed", snapshot.id, snapshot.lastEditedTime, `${baseSummary} -> ${snapshot.statusValue}`);
      detectedEvents += 1;
      appliedEvents += statusApplied ? 1 : 0;
      changed ||= statusApplied;
      if (looksDone(snapshot.statusValue)) {
        const doneApplied = applyEvent(user, config.rewards.integrations, "notion", "status_done", snapshot.id, snapshot.lastEditedTime, `${baseSummary} -> ${snapshot.statusValue}`);
        detectedEvents += 1;
        appliedEvents += doneApplied ? 1 : 0;
        changed ||= doneApplied;
      }
    }
  }

  notionSync[integration.id] = integrationState;
  if (syncState.integrations) {
    syncState.integrations.notion = notionSync;
  }

  if (changed) {
    await saveUser(user);
  }

  return {
    snapshotCount: snapshots.length,
    firstSync: isFirstSync,
    detectedEvents,
    appliedEvents,
  };
}

function classifyCreated(snapshot: NotionPageSnapshot): string {
  return isDatabaseItem(snapshot.parentType) ? "database_item_created" : "page_created";
}

function classifyEdited(snapshot: NotionPageSnapshot): string {
  return isDatabaseItem(snapshot.parentType) ? "database_item_edited" : "page_content_edited";
}

function looksDone(statusValue: string): boolean {
  return ["done", "completed", "complete", "closed", "finished"].includes(statusValue.trim().toLowerCase());
}

function isDatabaseItem(parentType: string): boolean {
  return parentType === "data_source_id" || parentType === "database_id";
}

function applyEvent(
  user: UserData,
  rules: Awaited<ReturnType<typeof getConfig>>["rewards"]["integrations"],
  provider: "notion",
  eventKey: string,
  sourceId: string,
  timestamp: string,
  summary: string,
): boolean {
  const result = applyIntegrationReward(user, rules, {
    provider,
    eventKey,
    sourceId,
    timestamp,
    summary,
  });
  return result.applied;
}
