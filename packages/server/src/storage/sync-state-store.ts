import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { SyncState } from "../../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";
const SYNC_STATE_PATH = path.join(DATA_DIR, "sync-state.json");

const DEFAULT_SYNC_STATE: SyncState = {
  repos: {},
};

export async function getSyncState(): Promise<SyncState> {
  const state = await readJson<SyncState>(SYNC_STATE_PATH);
  return state ?? { ...DEFAULT_SYNC_STATE };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeJson(SYNC_STATE_PATH, state);
}
