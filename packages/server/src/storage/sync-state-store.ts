import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { SyncState } from "../../../../shared/types.js";
import { DATA_DIR } from "../paths.js";
const SYNC_STATE_PATH = path.join(DATA_DIR, "sync-state.json");

const DEFAULT_SYNC_STATE: SyncState = {
  repos: {},
  integrations: {
    notion: {},
  },
};

export async function getSyncState(): Promise<SyncState> {
  const state = await readJson<SyncState>(SYNC_STATE_PATH);
  if (!state) return { ...DEFAULT_SYNC_STATE };
  return {
    ...DEFAULT_SYNC_STATE,
    ...state,
    integrations: {
      ...DEFAULT_SYNC_STATE.integrations,
      ...state.integrations,
      notion: state.integrations?.notion ?? {},
    },
  };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeJson(SYNC_STATE_PATH, state);
}
