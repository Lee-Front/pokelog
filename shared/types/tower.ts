import type { PrimaryStatus } from "./pokemon.js";

// === Battle Tower ===
export interface TowerRecord {
  currentStreak: number;
  bestStreak: number;
  totalClears: number;
  lastPlayedAt?: string;
}

export interface TowerPartySnapshot {
  uid: string;
  currentHp: number;
  currentPp: Record<string, number>;
  statusCondition?: PrimaryStatus | null;
  sleepTurns?: number;
  toxicCounter?: number;
}

export interface ActiveTowerRun {
  stage: number;
  partyUids: string[];
  partySnapshot: TowerPartySnapshot[];
  roomId?: string;
  startedAt: string;
}
