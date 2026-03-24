// === Account & User ===
export interface GitMatching {
  emails: string[];
}

export interface UserAccount {
  id: string;
  password: string;
  nickname: string;
  createdAt: string;
  matchings: {
    git?: GitMatching;
    [key: string]: unknown;
  };
}

export interface UserCombo {
  count: number;
  lastCommitAt: string | null;
}

export interface EncounterCeiling {
  accumulatedBytes: number;
}

export interface PokemonMove {
  id: string;
  pp: number;
  maxPp: number;
}

export interface PokemonStats {
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export interface OwnedPokemon {
  uid: string;
  species: string;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  caughtAt: string;
}

export interface WildPokemon {
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
}

export interface PendingEvent {
  id: string;
  type: "wild_encounter";
  pokemon: WildPokemon;
  createdAt: string;
  expiresAt: string;
}

export interface BattleState {
  eventId: string;
  myPokemonUid: string;
  turn: number;
  wild: WildPokemon;
}

export interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface UserData {
  account: UserAccount;
  points: number;
  totalExp: number;
  combo: UserCombo;
  encounterCeiling: EncounterCeiling;
  party: string[];
  pokemon: OwnedPokemon[];
  pokedex: string[];
  inventory: Record<string, number>;
  pendingEvents: PendingEvent[];
  battleState: BattleState | null;
  storage: OwnedPokemon[];
  log: LogEntry[];
}

// === Config ===
export interface RepoConfig {
  url: string;
  branches: string[];
}

export interface ComboConfig {
  bytesPerMinute: number;
  multipliers: number[];
  maxMultiplier: number;
}

export interface EncounterConfig {
  baseChance: number;
  ceilingBytes: number;
  timeLimitHours: number;
}

export interface ShopItem {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
}

// === Server Meta ===
export interface ServerMeta {
  serverId: string;
  serverName: string;
  displayName: string;
  apiVersion: string;
  featureFlags: Record<string, boolean>;
}

export interface ServerConfig {
  server: { port: number };
  meta: ServerMeta;
  polling: {
    intervalMinutes: number;
    repos: RepoConfig[];
  };
  rewards: {
    expPerByte: number;
    pointsPerByte: number;
    combo: ComboConfig;
    encounter: EncounterConfig;
  };
  shop: {
    items: Record<string, ShopItem>;
  };
}

// === Sync State ===
export interface SyncState {
  repos: Record<string, Record<string, string>>;
}

// === Game Data (Static) ===
export interface SpeciesData {
  id: number;
  species: string;
  name: string;
  types: string[];
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  catchRate: number;
  expGroup: string;
  learnset: Record<string, string[]>;
  maxMoves: number;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special";
  power: number;
  accuracy: number;
  pp: number;
  description: string;
}

export interface EvolutionData {
  evolvesTo: string;
  condition: { type: "level"; level: number };
}

export interface EncounterEntry {
  species: string;
  weight: number;
  levelRange: [number, number];
}

export interface RegionData {
  name: string;
  encounters: EncounterEntry[];
}

export const MAX_PARTY_SIZE = 6;
export const MAX_MOVES = 4;
export const MAX_LOG_ENTRIES = 200;
export const MAX_LEVEL = 100;
