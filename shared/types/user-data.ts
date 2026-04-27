import type { PvpStats } from "../pvp-types.js";
import type { UserAccount, UserCombo, EncounterCeiling } from "./account.js";
import type { Integration } from "./integrations.js";
import type { OwnedPokemon, OwnedEgg } from "./pokemon.js";
import type { PendingEvent, PendingEvolution } from "./wild-encounter.js";
import type { BattleState, LogEntry } from "./battle.js";
import type { TowerRecord, ActiveTowerRun } from "./tower.js";

// === Aggregated user state ===
export interface UserData {
  account: UserAccount;
  currentRegion?: string;
  points: number;
  /** Battle Points earned from Tower clears, spendable in the BP shop. */
  bp?: number;
  totalExp: number;
  combo: UserCombo;
  encounterCeiling: EncounterCeiling;
  party: string[];
  pokemon: OwnedPokemon[];
  eggs: OwnedEgg[];
  pokedex: string[];
  inventory: Record<string, number>;
  pendingEvents: PendingEvent[];
  pendingEvolutions?: PendingEvolution[];
  battleState: BattleState | null;
  storage: OwnedPokemon[];
  log: LogEntry[];
  integrations: Integration[];
  pvpStats?: PvpStats;
  towerRecord?: TowerRecord;
  activeTowerRun?: ActiveTowerRun;
  /**
   * ISO timestamp. Tokens whose `iat` is strictly older than this value
   * are rejected by the auth middleware. Set by the "logout all
   * sessions" admin endpoint when a user suspects a token leak.
   */
  tokenInvalidatedAt?: string;
}
