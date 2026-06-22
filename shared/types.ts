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
    /** Path to a private CA bundle (PEM) for self-hosted GitLab over HTTPS. */
    caCertPath?: string;
    /** Disable TLS verification entirely. Last resort for self-signed certs. */
    insecureSkipTls?: boolean;
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

/** 개체값(IV) — 6스탯 각 0~31. 본가식 스탯 계산에 종족값과 함께 더해진다(없으면 0 취급). */
export interface PokemonIVs {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

/** 노력치(EV) — 각 0~252, 합 ≤510, 스탯에 floor(EV/4) 기여(없으면 0 취급). */
export interface PokemonEVs {
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
  ivs?: PokemonIVs;
  evs?: PokemonEVs;
  // 포켓루스 감염 여부. undefined = 미감염(마이그레이션 불필요). 감염 시 EV 수확량 2배.
  pokerus?: boolean;
  // 테라스탈 시 변경되는 개체의 테라스탈 타입(영문 슬러그). 미설정이면 테라스탈 시점에
  // 종 1차 타입으로 기본값 처리. 영속 개체 속성일 뿐, 전투 중 효과는 BattleState에 담긴다.
  teraType?: string;
}

export type EggTierId = "common" | "rare" | "legend";

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
  // 하품 만료로 잠든 야생의 남은 수면 턴(있을 때만; 미설정이면 종전과 동일하게 무시).
  sleepTurns?: number;
  ivs?: PokemonIVs;
  // 야생은 보통 지닌물건이 없지만(생성 시 미설정), 전투 헬퍼가 일반적으로
  // heldItem을 참조/소모할 수 있도록 선택 필드로 둔다(미지닌이면 no-op).
  heldItem?: string | null;
}

export interface PendingEvent {
  id: string;
  type: "wild_encounter";
  pokemon: WildPokemon;
  createdAt: string;
  // 야생 조우는 더 이상 만료되지 않는다. 과거 저장 데이터 호환을 위해 선택 필드로 남긴다.
  expiresAt?: string;
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

// 레벨업으로 기술을 배우려는데 이미 4개를 모두 가진 포켓몬이 있을 때 쌓이는 대기 결정.
// 진화 대기(PendingEvolution)와 동일한 패턴 — 플레이어가 어떤 기술을 잊고 배울지(또는
// 안 배울지) /moves/resolve로 직접 고른다. (pokemonUid, moveId)당 최대 1건만 쌓인다.
export interface PendingMoveLearn {
  id: string;
  pokemonUid: string;
  moveId: string;      // the new move offered to learn
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
  isShiny: boolean;
  location: "party" | "storage";
}

export interface StatStages {
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
  // 명중/회피 단계(−6~+6). 데미지용 2기반 표가 아니라 명중판정용 3기반 표를 쓴다.
  accuracy: number;
  evasion: number;
}

export type BattleWeather = "sun" | "rain" | "hail" | "sandstorm";

export type BattleTerrain = "electric" | "grassy" | "misty" | "psychic";

export interface BattleState {
  eventId: string;
  myPokemonUid: string;
  // 전투 중 한 번이라도 필드에 나온 내 포켓몬 uid 집합(클래식 EXP 분배용). 시작 시 첫
  // 포켓몬, 교체 때마다 들어온 포켓몬을 추가. 승리 시 이 중 살아있는 개체가 풀 EXP를 받는다.
  participantUids?: string[];
  turn: number;
  wild: WildPokemon;
  playerStatStages?: StatStages;
  wildStatStages?: StatStages;
  playerVolatile?: VolatileStatus[];
  wildVolatile?: VolatileStatus[];
  weather?: BattleWeather;
  weatherTurns?: number;
  terrain?: BattleTerrain;
  terrainTurns?: number;
  playerBattleForm?: string | null;
  wildBattleForm?: string | null;
  transformationType?: "mega" | "gigantamax" | "primal" | null;
  transformationUsed?: boolean;
  gmaxTurnsRemaining?: number;
  playerPreTransformMaxHp?: number;
  // 테라스탈(플레이어 전용·배틀당 1회). 메가/거다이 게이트(transformationUsed)와 독립.
  // playerTerastallized=true면 공격 STAB 계산이 teraType 기반으로 바뀌고, 방어 시 유효
  // 타입이 [playerTeraType]로 치환된다. 스탯은 안 바뀌므로 전투 종료 시 그냥 사라진다(되돌릴 것 없음).
  playerTeraType?: string | null;
  playerTerastallized?: boolean;
  // Z기술(플레이어 전용·배틀당 1회). 메가/거다이/테라와 독립 게이트. true면 이번 전투에서
  // 이미 Z기술을 썼다는 뜻. (단순화 MVP: 크리스탈 타입 매칭·Z상태기 없음 — Z파워 위력 증폭만.)
  zMoveUsed?: boolean;
  // 야생이 선공해 풀죽음(flinch)을 유발했는지 알리는 1턴짜리 임시 플래그.
  // doWildAttackAndCheck가 설정하고, 야생 선공 분기에서 소비 즉시 해제한다(영속 저장 안 함).
  playerFlinched?: boolean;
}

export interface BattleDroppedItem {
  item: string;
  qty: number;
}

/**
 * Rewards granted on a wild-battle win. Attached as `rewards` on the battle
 * action response when `result === "win"`. Consumed by the CLI and web client
 * to show the post-battle reward summary.
 */
// 전투에 참여(필드에 나옴)해 EXP를 받은 포켓몬 1마리의 결과.
export interface BattlePartyExp {
  uid: string;
  species: string;
  exp: number;
  leveledUp: boolean;
  newLevel: number;
  evolvedInto: string | null;
}

export interface BattleRewards {
  exp: number;
  gameMoney: number;
  droppedItems: BattleDroppedItem[];
  leveledUp?: boolean;
  newLevel?: number;
  evolvedInto?: string | null;
  // 참여 포켓몬별 EXP 결과(클래식 방식). 참여해 살아있는 개체는 각자 풀 EXP를 받고,
  // 기절(hp<=0)한 참여자는 제외된다. 단일 포켓몬 전투면 그 한 마리만.
  partyExp?: BattlePartyExp[];
}

export interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface UserData {
  account: UserAccount;
  currentRegion?: string;
  points: number;
  // Game-money currency, earned from winning wild battles. Kept separate from
  // `points` (commit-earned). Lives at the top level for now; the planned
  // UserData split (#7) will move it into the GameProgress sub-type.
  gameMoney: number;
  totalExp: number;
  combo: UserCombo;
  party: string[];
  pokemon: OwnedPokemon[];
  eggs: OwnedEgg[];
  // 영구 "잡은적"(포획·획득) 종 집합. 획득 시 추가, 방생해도 유지(현재 보유에서 파생 금지).
  pokedex: string[];
  // 영구 "만난적"(발견) 종 집합. 전투에서 야생을 마주하면 추가. normalize가 caught(pokedex) ⊇ 포함을 보장.
  seenSpecies?: string[];
  inventory: Record<string, number>;
  pendingEvents: PendingEvent[];
  pendingEvolutions?: PendingEvolution[];
  pendingMoveLearns?: PendingMoveLearn[];
  battleState: BattleState | null;
  storage: OwnedPokemon[];
  log: LogEntry[];
  integrations: Integration[];
  // 운영자 공지 중 이 유저가 닫은(dismiss) 공지 id 목록. /game/announcements/active가
  // active이면서 여기 없는 공지만 내려준다. 게임 초기화(reset-game) 시에도 보존하지 않고
  // 비운다(공지는 진행 데이터가 아니라 표시 상태일 뿐).
  dismissedAnnouncementIds?: string[];
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
  /** 무료 "탐색" 1회가 생성하는 야생 조우 개수(일괄 롤). 기본 12. */
  rollCount: number;
}

export interface ShopItem {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
  guaranteedCatch?: boolean;
  // 카테고리 탭 분류(게임머니 상점 전용): "potion"|"ball"|"special". 포인트 상점은 미지정.
  category?: string;
}

export interface BattleDropEntry {
  item: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface BattleRewardConfig {
  // EXP = floor(baseExpYield * wildLevel / 7) * expMultiplier (main-series yield)
  expMultiplier: number;
  // gameMoney = floor(wildLevel * moneyPerLevel) + moneyBase
  moneyPerLevel: number;
  moneyBase: number;
  // Single weighted roll across the table; total chance < 1 means "no drop".
  dropTable: BattleDropEntry[];
}

// 알 가챠 티어별 튜닝 — cost/레벨 범위 + 등급 버킷 등장확률. 모든 알이 단일 풀(전 종)을
// 공유하되, 티어마다 legendary/rare 버킷의 등장확률이 달라 희귀도를 가른다. common 버킷
// 확률은 1 - legendaryChance - rareChance로 파생된다(별도 필드 없음).
export interface EggTierConfig {
  cost: number;
  minLevel: number;
  maxLevel: number;
  // 전설/환상 버킷 등장확률(0~1). legendaryChance + rareChance ≤ 1.
  legendaryChance: number;
  // 희귀(베이비·저포획률) 버킷 등장확률(0~1).
  rareChance: number;
}

export interface EggConfig {
  common: EggTierConfig;
  rare: EggTierConfig;
  legend: EggTierConfig;
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
  server: {
    port: number;
    /**
     * Allowed browser origins for CORS (e.g. "https://portal.corp.example").
     * Empty/unset disables CORS entirely (no headers emitted) — same-origin and
     * non-browser clients such as the CLI are unaffected.
     */
    corsAllowedOrigins?: string[];
  };
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
  battle: BattleRewardConfig;
  battleShop: {
    items: Record<string, ShopItem>;
  };
  egg: EggConfig;
  // 이로치(shiny) 확률 — 알 부화·야생·스타터 등 createPokemon 공통. 0~1 (기본 1/4096).
  shinyRate: number;
  pvp: PvpConfig;
}

// === PvP 설정(Phase 2) ===
export interface PvpConfig {
  /** ELO: 시작 레이팅 start(>0), K 계수 k(>0). 모든 매치에 적용. */
  elo: { start: number; k: number };
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

// === User PvP (유저간 전투) ===
// Phase 1: 친선전(무보상) 실시간 턴제. 베팅/에스크로·랭킹은 Phase 2, 웹 UI는 Phase 3.
// 매치는 파일 기반 저장소(pokelog-data/pvp/{matchId}.json)에 영속되며 폴링으로 동기화된다.

/** 전투 규모: single=각자 1마리, party=파티 전체(기절 시 교체). */
export type PvpMode = "single" | "party";

/**
 * 매치 상태머신:
 *  pending  — 도전 생성됨, 상대 수락 대기(만료시간 있음). 자동 대기열 페어링은 곧장 active.
 *  active   — 진행 중. 라운드마다 양측 행동 제출.
 *  finished — 종료. result로 승패/기권/무효 구분.
 */
export type PvpMatchStatus = "pending" | "active" | "finished";

/** 매치 종료 사유. forfeit=기권, expired=수락 만료, declined=거절, voided=무효(상대 이탈 등). */
export type PvpResultKind = "decided" | "forfeit" | "expired" | "declined" | "voided";

/** 매칭 방식: challenge=지정 도전, queue=자동 대기열 페어링. */
export type PvpMatchOrigin = "challenge" | "queue";

/** 전투용 포켓몬 스냅샷 — 매치 시작 시 OwnedPokemon에서 복제. 원본과 분리되어 매치 안에서만 변한다. */
export interface PvpCombatant {
  /** 원본 OwnedPokemon.uid (참조·표시용; 매치는 스냅샷으로 진행). */
  uid: string;
  species: string;
  variantId?: string | null;
  nickname: string | null;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  statusCondition?: PrimaryStatus | null;
  sleepTurns?: number;
  volatile: VolatileStatus[];
  statStages: StatStages;
}

/** 한쪽 진영(유저)의 매치 내 상태. */
export interface PvpSide {
  userId: string;
  nickname: string;
  /** 전투 파티(스냅샷). single 모드면 길이 1. */
  team: PvpCombatant[];
  /** 현재 출전 중인 team 인덱스. */
  activeIndex: number;
  /** 이번 라운드 제출한 행동. 미제출이면 null. 양측 모두 제출되면 라운드 해결. */
  pendingAction: PvpAction | null;
  /** 기권 여부. */
  forfeited: boolean;
}

/** 라운드 행동 — 기술 사용 / 교체 / 가방 아이템 사용.
 *  item: itemId는 config.shop.items 인벤토리 키(전투 사용가능=healAmount 보유).
 *  targetUid 생략 시 활성 포켓몬에 사용. 메인시리즈식으로 아이템은 기술보다 먼저 처리된다. */
export type PvpAction =
  | { kind: "move"; moveId: string }
  | { kind: "switch"; teamIndex: number }
  | { kind: "item"; itemId: string; targetUid?: string };

/** 인배틀 채팅 메시지. */
export interface PvpChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  at: string;
}

/**
 * 한쪽이 거는 자산 명세(에스크로에 락될 대상). 포인트·아이템·포켓몬을 조합 가능.
 * 도전 생성 시 challenger가, 수락 시 opponent가 자기 stake를 지정한다. 비대칭 허용.
 * **빈 stake(전부 0/없음)도 유효** — 그게 친선전이다(정산은 no-op).
 *  - points: 거는 포인트(0 가능).
 *  - items: { 아이템id: 수량 }. 보유 수량 이내.
 *  - pokemonUids: 거는 포켓몬 uid 목록(파티/보관함에서 제거해 에스크로 보관).
 */
export interface PvpStakeSpec {
  points: number;
  /** 거는 게임머니(0 가능). points와 동일 취급. */
  gameMoney: number;
  items: Record<string, number>;
  pokemonUids: string[];
}

/**
 * 에스크로에 실제로 락된 자산 스냅샷. stake 확정 시점에 유저 데이터에서 빼서 여기로 옮긴다
 * (소유권 이전). 포켓몬은 OwnedPokemon 전체를 복제 보관해 정산 시 승자에게 그대로 지급/원소유자
 * 반환이 가능하다. 각 측의 에스크로는 한 번만 잠기고(locked) 한 번만 해제된다(released).
 * 빈 stake면 전 필드가 0/빈 채로 locked=true가 된다(정산 시 no-op).
 */
export interface PvpEscrow {
  /** 자산이 유저 데이터에서 빠져 에스크로로 이동 완료됐는지(이중 락 방지). */
  locked: boolean;
  points: number;
  /** 락된 게임머니 스냅샷. */
  gameMoney: number;
  items: Record<string, number>;
  /** 거치된 포켓몬 전체 스냅샷(원본은 유저 데이터에서 제거됨). */
  pokemon: OwnedPokemon[];
}

/**
 * 도전자가 상대에게 요구하는 자산(합의형 내기). 도전 생성 시 challenger가 자기 stake와 함께
 * 지정한다. points/items는 정확한 양/종류를 요구하고(상대가 보유하면 수락 시 자동 차감),
 * 포켓몬은 도전 생성 시 challenger가 **상대의 실제 보유 목록에서 특정 개체(uid)**를 직접 골라
 * 요구한다 — 상대는 수락 시 지정된 그 포켓몬을 내놓는 데 동의할 뿐(고르지 않음). pokemonUids는
 * 상대(opponent) 소유여야 하며, 수락 시점에도 여전히 상대 소유인지 재확인 후 락한다.
 * 전 필드 0/빈이면 요구 없음(친선 또는 일방 stake).
 */
export interface PvpDemand {
  points: number;
  /** 상대에게 요구하는 게임머니(0 가능). points와 동일 취급. */
  gameMoney: number;
  items: Record<string, number>;
  /** 상대(opponent)에게 요구하는 특정 포켓몬 uid 목록. 상대 보유여야 함. */
  pokemonUids: string[];
}

/**
 * 스테이크/에스크로 메타. 모든 매치는 단일 에스크로(내기) 경로를 따른다 — 별도 보상모드 없음.
 * 합의형: challenger가 자기 stake(challengerStake)와 상대 요구(demand)를 정하고, opponent는
 * 수락 시 demand를 충족(points/items 자동 차감 + challenger가 지정한 특정 포켓몬 락)해 opponentEscrow를 채운다.
 * challengerStake 비고 demand 빈 것 = 친선전(정산 no-op). settled 플래그로 정산 멱등성 보장.
 */
export interface PvpStakes {
  /** challenger가 걸기로 확정한 명세(도전 생성 시 락). */
  challengerStake?: PvpStakeSpec | null;
  /** challenger가 opponent에게 요구한 자산(수락 시 충족 검증·차감 기준). 빈/없음이면 친선. */
  demand?: PvpDemand | null;
  /** 각 측의 락된 에스크로. opponentEscrow는 demand 충족분을 수락 시점에 락한 것. */
  challengerEscrow?: PvpEscrow | null;
  opponentEscrow?: PvpEscrow | null;
  /**
   * 정산 완료 여부(멱등 가드). finishMatch에서 보상 훅이 한 번 실행되면 true로 찍고,
   * 이미 true면 재정산하지 않는다(이중지급·복제 방지).
   */
  settled?: boolean;
}

export interface PvpMatch {
  id: string;
  status: PvpMatchStatus;
  mode: PvpMode;
  origin: PvpMatchOrigin;
  challenger: PvpSide;
  /** 도전 대상/페어링된 상대. pending(지정 도전)에서는 수락 전이라도 채워진다. */
  opponent: PvpSide;
  /** 현재 라운드 번호(1부터). pending이면 0. */
  round: number;
  /** 라운드별 해결 로그(메시지 배열). 폴링 클라가 새 라운드 로그를 받아 표시. */
  roundLogs: PvpRoundLog[];
  chat: PvpChatMessage[];
  stakes: PvpStakes;
  /** 종료 시 채워짐. */
  result: PvpResult | null;
  createdAt: string;
  updatedAt: string;
  /** pending(지정 도전) 수락 만료 시각. queue/active는 생략. */
  expiresAt?: string;
}

/** 라운드 해결 결과 로그. */
export interface PvpRoundLog {
  round: number;
  /** 사람이 읽는 메시지(데미지·상태·교체·기절 등). */
  messages: string[];
  /** 라운드 종료 후 양측 활성 포켓몬 HP 스냅샷(클라 표시용). */
  challengerHp: number;
  opponentHp: number;
}

export interface PvpResult {
  kind: PvpResultKind;
  /** 승자 userId. 무승부/무효면 null. */
  winnerUserId: string | null;
  loserUserId: string | null;
  finishedAt: string;
}

/** 자동 대기열 엔트리. 큐는 에스크로 협상이 없으므로 항상 빈 stake(친선)로 페어링된다. */
export interface PvpQueueEntry {
  userId: string;
  nickname: string;
  mode: PvpMode;
  /** 전투에 쓸 파티 포켓몬 uid 목록(스냅샷은 페어링 시점에 생성). */
  teamUids: string[];
  enqueuedAt: string;
}

export interface PvpQueueState {
  entries: PvpQueueEntry[];
}

/**
 * 유저별 PvP 누적 전적·레이팅(Phase 2). pvp/stats/{userId}.json에 영속.
 * decided/forfeit 결과에 양측 ELO·전적을 갱신한다(무승부 포함). expired/declined/voided는 불변.
 */
export interface PvpStats {
  userId: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
}

/** 리더보드 한 줄(닉네임·ELO·전적). */
export interface PvpRankingEntry {
  userId: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

// === Announcements (운영자 공지/팝업) ===
// 운영자가 만들어 유저에게 노출하는 공지. pokelog-data/announcements.json에 배열로 영속.
// active=true인 공지만 유저에게 노출되며, 유저가 닫으면 UserData.dismissedAnnouncementIds에
// 기록되어 다시 뜨지 않는다.
export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** 노출 여부. 운영자가 토글(PATCH)하거나 삭제(DELETE)로 내린다. */
  active: boolean;
  createdAt: string;
}

// === System Activity Log ===
// 모든 사용자의 시스템 활동을 영속 기록(JSONL)해 운영자가 에러 원인을 추적한다.
// type은 문자열로 확장 가능 — 전투/포인트 외에도 점진적으로 늘릴 수 있다.
export type EventLogType =
  | "battle_start"
  | "battle_end"
  | "point_gain"
  | (string & {});

export interface EventLogEntry {
  /** 랜덤 식별자 (조회 결과의 안정적 key) */
  id: string;
  /** 기록 시각 (ISO 8601) */
  timestamp: string;
  /** 이벤트 종류 */
  type: EventLogType;
  /** 대상 사용자 계정 id (시스템 이벤트면 생략) */
  userId?: string;
  /** 이벤트별 상세 — 자유 형식 JSON */
  detail?: Record<string, unknown>;
}
