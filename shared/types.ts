import type { PvpStats } from "./pvp-types.js";

// === Account & User ===
export interface GitMatching {
  emails: string[];
}

export type IntegrationProvider =
  | "github"
  | "gitlab"
  | "git"
  | "notion"
  | "jira"
  | "slack";

export type IntegrationStatus = "untested" | "testing" | "ok" | "error";

export interface IntegrationBase {
  id: string;
  provider: IntegrationProvider;
  label: string;
  status: IntegrationStatus;
  lastError?: string;
  failCount: number;
  addedAt: string;
  lastCheckedAt?: string;
}

export interface GitIntegration extends IntegrationBase {
  provider: "github" | "gitlab" | "git";
  config: {
    repoUrl: string;
    authMode?: "public" | "token";
    token?: string;
  };
  emails?: string[];
}

export interface NotionIntegration extends IntegrationBase {
  provider: "notion";
  config: {
    token: string;
  };
}

export interface JiraIntegration extends IntegrationBase {
  provider: "jira";
  config: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey?: string;
  };
}

export interface SlackIntegration extends IntegrationBase {
  provider: "slack";
  config: {
    botToken: string;
    teamId?: string;
    channelId?: string;
  };
}

export type Integration =
  | GitIntegration
  | NotionIntegration
  | JiraIntegration
  | SlackIntegration
  | IntegrationBase;

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
  /** Number of PP Up (or equivalent) applications. Max 3 per move in canon. */
  ppUpsUsed?: number;
}

export interface PokemonStats {
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export interface IndividualValues {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export type PrimaryStatus = "poison" | "burn" | "paralysis" | "sleep" | "freeze";

export interface VolatileStatus {
  id: string;
  turnsRemaining: number;
}

export type PokemonGender = "male" | "female" | "genderless";

export interface OwnedPokemon {
  uid: string;
  species: string;
  variantId?: string | null;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  caughtAt: string;
  gender?: PokemonGender | null;
  friendship?: number;
  heldItem?: string | null;
  abilityId?: string | null;
  moveUsageCounts?: Record<string, number>;
  damageTakenTotal?: number;
  nature?: string;
  isShiny?: boolean;
  statusCondition?: PrimaryStatus | null;
  sleepTurns?: number;
  hasGigantamaxFactor?: boolean;
  /**
   * Count of vitamins applied per stat (0–10 each). We do not model the full
   * canon EV system; instead each application directly boosts the final stat
   * (see `applyVitamin` in item-usage). This counter enforces the canon cap
   * of 10 uses per stat (equivalent to +100 EV).
   */
  appliedVitamins?: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  // ── Individual Values (0-31 each) ──
  ivs?: IndividualValues;
  // ── Gen 9 / Tera ──
  teraType?: string | null;
  /**
   * A move id queued to be learned but blocked because the pokemon
   * already knows {@link MAX_MOVES} moves. The user must explicitly call
   * the "learn pending move" endpoint and pick a move to forget before
   * this slot can be filled. Cleared once the user resolves it (or
   * declines the move). Canon: a level-up move that can't fit prompts
   * the player to forget another move; we model that prompt as queued
   * server state rather than blocking commit-rewards mid-flight.
   */
  pendingMoveLearn?: string;
  // ── Fusion (Kyurem/Necrozma/Calyrex) ──
  fusedPartnerUid?: string;
  fusedPartnerData?: {
    species: string;
    level: number;
    stats: PokemonStats;
    moves: PokemonMove[];
    abilityId?: string | null;
    nature?: string;
    heldItem?: string | null;
    gender?: PokemonGender | null;
    ivs?: IndividualValues;
  };
}

export type EggTierId = "common" | "rare" | "epic" | "legend" | "manaphy";

export interface OwnedEgg {
  id: string;
  tier: EggTierId;
  createdAt: string;
}

export interface WildPokemon {
  species: string;
  variantId?: string | null;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  nature?: string;
  gender?: PokemonGender;
  ability?: string;
  isShiny?: boolean;
  statusCondition?: PrimaryStatus | null;
  teraType?: string | null;
  ivs?: IndividualValues;
}

export interface PendingEvent {
  id: string;
  type: "wild_encounter";
  pokemon: WildPokemon;
  createdAt: string;
  expiresAt: string;
}

export interface PendingEvolutionOption {
  branchId: string;
  targetSpecies: string;
  targetVariantId?: string;
  targetName: string;
}

export interface PendingEvolution {
  id: string;
  pokemonUid: string;
  sourceSpecies: string;
  sourceName: string;
  trigger: EvolutionTrigger;
  options: PendingEvolutionOption[];
  createdAt: string;
}

export type TradeStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface TradeRecord {
  id: string;
  requesterUserId: string;
  requesterPokemonUid: string;
  responderUserId: string;
  responderPokemonUid: string;
  status: TradeStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface TradePokemonCandidate {
  uid: string;
  species: string;
  speciesName: string;
  nickname: string | null;
  level: number;
  location: "party" | "storage";
}

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

export type VitaminStatKey = "hp" | "attack" | "defense" | "spAttack" | "spDefense" | "speed";
export type PpBoostKind = "increment" | "max";

export interface ShopItem {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
  guaranteedCatch?: boolean;
  /** If set, using this item boosts the target pokemon's given stat (vitamin). */
  vitaminStat?: VitaminStatKey;
  /** If set, using this item modifies a move's maxPp. */
  ppBoost?: PpBoostKind;
}

export interface IntegrationRewardRule {
  enabled: boolean;
  points: number;
  exp?: number;
  cooldownMinutes?: number;
  dailyMax?: number;
}

export interface IntegrationEventDefinition {
  key: string;
  label: string;
  description: string;
  recommended: boolean;
  experimental?: boolean;
}

export interface IntegrationRewardRules {
  git: Record<string, IntegrationRewardRule>;
  notion: Record<string, IntegrationRewardRule>;
  jira: Record<string, IntegrationRewardRule>;
  slack: Record<string, IntegrationRewardRule>;
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
    integrations: IntegrationRewardRules;
  };
  shop: {
    items: Record<string, ShopItem>;
  };
}

// === Sync State ===
export interface NotionSyncSnapshot {
  createdTime: string;
  lastEditedTime: string;
  archived: boolean;
  parentType: string;
  statusValue?: string;
}

export interface JiraSyncSnapshot {
  issueKey: string;
  statusName: string;
  statusCategory: string;
  assignee?: string;
  updated: string;
  commentCount: number;
  worklogCount: number;
}

export interface SlackSyncSnapshot {
  lastMessageTs: string;
}

export interface SyncState {
  repos: Record<string, Record<string, string>>;
  integrations?: {
    notion?: Record<string, Record<string, NotionSyncSnapshot>>;
    jira?: Record<string, Record<string, JiraSyncSnapshot>>;
    slack?: Record<string, SlackSyncSnapshot>;
  };
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
  rawCaptureRate?: number;
  expGroup: string;
  baseExpYield?: number;
  weight?: number; // in hectograms (kg * 10)
  learnset: SpeciesLearnset;
  maxMoves: number;
  abilities?: {
    normal: string[];
    hidden?: string;
  };
  eggGroups?: string[];
  genderRate?: number;
  baseHappiness?: number;
  isBaby?: boolean;
  isLegendary?: boolean;
  isMythical?: boolean;
}

export interface SpeciesLearnset {
  levelUp: Record<string, string[]>;
  tm: string[];
  tutor: string[];
  egg: string[];
  event: string[];
}

export type VariantKind = "regional" | "permanent-form" | "battle-form";

export interface VariantData {
  id: string;
  baseSpecies: string;
  kind: VariantKind;
  name: string;
  category: string;
  sourceArtSlug: string;
  formSuffix: string;
  encounterEligible: boolean;
  eggEligible: boolean;
  typing?: string[];
  baseStatsOverride?: Partial<SpeciesData["baseStats"]>;
  learnsetOverride?: Partial<SpeciesLearnset>;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special" | "status";
  power: number;
  accuracy: number;
  pp: number;
  description: string;
  priority?: number;
  target?: string;
  meta?: {
    ailment?: string;
    ailmentChance?: number;
    critRate?: number;
    drain?: number;
    flinchChance?: number;
    healing?: number;
    statChance?: number;
    minHits?: number;
    maxHits?: number;
  };
  statChanges?: Array<{ stat: string; change: number }>;
}

export type EvolutionTrigger = "level-up" | "use-item" | "trade" | "other";

export type EvolutionTimeOfDay = "day" | "night";

export interface EvolutionConditionLevel {
  type: "level";
  level: number;
}

export interface EvolutionConditionItemUse {
  type: "item-use";
  item: string;
}

export interface EvolutionConditionFriendship {
  type: "friendship";
  min: number;
}

export interface EvolutionConditionHeldItem {
  type: "held-item";
  item: string;
}

export interface EvolutionConditionTime {
  type: "time";
  value: EvolutionTimeOfDay;
}

export interface EvolutionConditionTrade {
  type: "trade";
}

export interface EvolutionConditionRegion {
  type: "region";
  region: string;
}

export interface EvolutionConditionGender {
  type: "gender";
  value: "male" | "female";
}

export interface EvolutionConditionKnownMove {
  type: "known-move";
  moveId: string;
}

export interface EvolutionConditionKnownMoveType {
  type: "known-move-type";
  moveType: string;
}

export interface EvolutionConditionLocation {
  type: "location";
  location: string;
}

export interface EvolutionConditionStatCompare {
  type: "stat-compare";
  stat: "attack-vs-defense";
  op: "gt" | "eq" | "lt";
}

export interface EvolutionConditionPartyMember {
  type: "party-member";
  species?: string;
  pokemonType?: string;
}

export interface EvolutionConditionExtra {
  type: "extra";
  key: string;
  value: unknown;
}

export type EvolutionCondition =
  | EvolutionConditionLevel
  | EvolutionConditionItemUse
  | EvolutionConditionFriendship
  | EvolutionConditionHeldItem
  | EvolutionConditionTime
  | EvolutionConditionTrade
  | EvolutionConditionRegion
  | EvolutionConditionGender
  | EvolutionConditionKnownMove
  | EvolutionConditionKnownMoveType
  | EvolutionConditionLocation
  | EvolutionConditionStatCompare
  | EvolutionConditionPartyMember
  | EvolutionConditionExtra;

export interface EvolutionBranch {
  id: string;
  targetSpecies: string;
  targetVariantId?: string;
  trigger: EvolutionTrigger;
  conditions: EvolutionCondition[];
  consumeItem?: string | null;
}

export interface EvolutionData {
  branches: EvolutionBranch[];
}

export interface AbilityData {
  id: string;
  name: string;
  shortEffect: string;
  isMainSeries: boolean;
}

export type StatName = "attack" | "defense" | "spAttack" | "spDefense" | "speed";

export interface NatureData {
  id: string;
  name: string;
  increasedStat: StatName | null;
  decreasedStat: StatName | null;
}

export interface ItemData {
  id: string;
  name: string;
  category: string;
  cost: number;
  shortEffect: string;
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
