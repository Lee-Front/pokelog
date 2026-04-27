import type { VolatileStatus } from "./pokemon.js";
import type { WildPokemon } from "./wild-encounter.js";

// === PvE Battle State ===
export interface StatStages {
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
  accuracy: number;
  evasion: number;
}

export type BattleWeather = "sun" | "rain" | "hail" | "sandstorm";

export interface BattleState {
  eventId: string;
  myPokemonUid: string;
  turn: number;
  wild: WildPokemon;
  playerStatStages?: StatStages;
  wildStatStages?: StatStages;
  playerVolatile?: VolatileStatus[];
  wildVolatile?: VolatileStatus[];
  weather?: BattleWeather;
  weatherTurns?: number;
  playerBattleForm?: string | null;
  wildBattleForm?: string | null;
  transformationType?: "mega" | "gigantamax" | "primal" | null;
  transformationUsed?: boolean;
  gmaxTurnsRemaining?: number;
  playerPreTransformMaxHp?: number;
}

export interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}
