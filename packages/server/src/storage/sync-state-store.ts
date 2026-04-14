import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { SyncState } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";

function getSyncStatePath() {
  return path.join(getDataDir(), "sync-state.json");
}

const DEFAULT_SYNC_STATE: SyncState = {
  repos: {},
  integrations: {
    notion: {},
    jira: {},
    slack: {},
  },
};

export async function getSyncState(): Promise<SyncState> {
  const state = await readJson<SyncState>(getSyncStatePath());
  if (!state) return { ...DEFAULT_SYNC_STATE };
  return {
    ...DEFAULT_SYNC_STATE,
    ...state,
    integrations: {
      ...DEFAULT_SYNC_STATE.integrations,
      ...state.integrations,
      notion: state.integrations?.notion ?? {},
      jira: state.integrations?.jira ?? {},
      slack: state.integrations?.slack ?? {},
    },
  };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeJson(getSyncStatePath(), state);
}
