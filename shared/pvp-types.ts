import type { PokemonMove, PokemonStats, PrimaryStatus, StatStages, VolatileStatus, BattleWeather, PokemonGender } from "./types.js";

export type PvpTransformationType = "mega" | "gigantamax" | "primal" | "dynamax" | "tera" | "ultra-burst";

/** Pre-computed transformation stats (computed at room creation from full OwnedPokemon) */
export interface PvpTransformForm {
  variantId: string;
  maxHp: number;
  stats: PokemonStats;
}

// ── PvP 포켓몬 (원본 복사, PvP 중 변경되어도 원본 미영향) ──
export interface PvpPokemon {
  uid: string;
  species: string;
  variantId?: string | null;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  statusCondition?: PrimaryStatus | null;
  sleepTurns?: number;
  toxicCounter?: number;
  nature?: string;
  abilityId?: string | null;
  isShiny?: boolean;
  heldItem?: string | null;
  hasGigantamaxFactor?: boolean;
  megaForm?: PvpTransformForm | null;
  gmaxForm?: PvpTransformForm | null;
  primalForm?: PvpTransformForm | null;
  ultraForm?: PvpTransformForm | null;
  gender?: PokemonGender | null;
  // ── Gen 9 / Tera ──
  teraType?: string | null;
  originalTypes?: string[];
  stellarTypesUsed?: string[];
  rageFistHits?: number;
  lastEatenBerry?: string | null;
}

// ── 플레이어 사이드 ──
export interface PvpPlayerState {
  userId: string;
  nickname: string;
  party: PvpPokemon[];
  activeIndex: number;
  statStages: StatStages;
  volatiles: VolatileStatus[];
  battleForm?: string | null;
  ready: boolean;
  actionSubmitted: boolean;
  transformationUsed?: boolean;
  transformationType?: PvpTransformationType | null;
  gmaxTurnsRemaining?: number;
  preTransformMaxHp?: number;
  hasKeyStone?: boolean;
  hasDynamaxBand?: boolean;
  protectCount?: number;
  lockedMoveId?: string;
  substitute?: number;                // remaining HP of substitute doll
  chargingMove?: { moveId: string; turn: number };  // two-turn move state
  lastDamageTaken?: { amount: number; category: "physical" | "special" };
  disabledMoveId?: string;
  encoreMoveId?: string;
  lastMoveUsed?: string;
  screens?: {
    reflect?: number;      // turns remaining
    lightScreen?: number;  // turns remaining
    auroraVeil?: number;   // turns remaining
  };
  trapped?: boolean;        // prevented from switching (mean-look, shadow-tag, etc.)
  tailwind?: number;       // turns remaining
  hazards?: {
    stealthRock?: boolean;
    spikes?: number;      // 0-3
    toxicSpikes?: number;  // 0-2
    stickyWeb?: boolean;
  };
  wish?: { turns: number; healAmount: number; targetIndex: number };
  preTransformState?: {
    species: string;
    variantId?: string | null;
    stats: PokemonStats;
    moves: PokemonMove[];
    abilityId?: string | null;
  };
  roostedThisTurn?: boolean;   // flying type removed for the turn (Roost)
  justSwitchedIn?: boolean;    // true for the pokemon's "first action turn" after switch-in (Fake Out)
  switchedInThisTurn?: boolean; // internal: applySwitch ran this turn; promotes to justSwitchedIn at end of turn
  trapDamageBoost?: boolean;   // defender trapped by a binding-band holder (1/6 instead of 1/8 per turn)
  metronomeCount?: number;     // consecutive uses of the same move while holding Metronome item (0-5)
  movesUsed?: string[];        // move IDs this pokemon has used since switching in (for Last Resort)
  wasHitThisTurn?: boolean;    // took damage this turn (for Avalanche / Revenge 2x boost)
  // ── Gen 9 / Tera ──
  teraActive?: boolean;        // active Terastal state for this player
  supersweetSyrupUsed?: boolean;       // 1-per-battle Supersweet Syrup trigger
  boostedStatsThisTurn?: boolean;      // Alluring Voice trigger (opponent boosted stats this turn)
  paradoxBoost?: {                     // Protosynthesis / Quark Drive active state
    stat: "attack" | "defense" | "spAttack" | "spDefense" | "speed";
    source: "weather" | "terrain" | "booster-energy";
  };
}

// ── 방 상태 ──
export type PvpPhase = "waiting" | "team_preview" | "action" | "forced_switch" | "finished";

export interface PvpRoomState {
  roomId: string;
  turn: number;
  phase: PvpPhase;
  playerA: PvpPlayerState;
  playerB: PvpPlayerState;
  weather?: BattleWeather;
  weatherTurns?: number;
  terrain?: "electric" | "grassy" | "psychic" | "misty";
  terrainTurns?: number;
  trickRoom?: number;       // turns remaining
  magicRoom?: number;       // turns remaining - disables all items
  wonderRoom?: number;      // turns remaining - swaps defense/spDefense
  lastMoveUsedInBattle?: string;  // last move anyone used (for Copycat)
  turnDeadline: number | null;
  log: string[];
  result?: {
    winnerId: string | null;
    loserId: string | null;
    reason: "ko" | "forfeit" | "timeout" | "disconnect";
  };
  isAiBattle: boolean;
  forcedSwitchNeeded?: { a: boolean; b: boolean };
  pendingSwitchAfterMove?: { a?: boolean; b?: boolean };
  batonPass?: { a?: boolean; b?: boolean };
}

// ── 플레이어 액션 ──
export type PvpAction =
  | { type: "fight"; moveId: string; mega?: boolean; gigantamax?: boolean; dynamax?: boolean; tera?: boolean; ultraBurst?: boolean }
  | { type: "switch"; pokemonIndex: number }
  | { type: "forfeit" };

// ── 방 설정 ──
export interface PvpRoomConfig {
  levelCap: number;
  turnTimeoutMs: number;
  allowItems: boolean;
}

// ── 레이팅 ──
export interface PvpStats {
  rating: number;
  wins: number;
  losses: number;
  streak: number;
}

// ── 매치 기록 ──
export interface PvpMatchRecord {
  id: string;
  playerA: { userId: string; nickname: string; rating: number };
  playerB: { userId: string; nickname: string; rating: number };
  winnerId: string | null;
  reason: string;
  ratingChange: { a: number; b: number };
  createdAt: string;
}

// ── Socket.IO 이벤트 ──
export interface PvpServerEvents {
  "pvp:authenticated": () => void;
  "pvp:queued": (data: { position: number }) => void;
  "pvp:matched": (data: { roomId: string; opponent: string }) => void;
  "pvp:room_state": (state: PvpClientRoomView) => void;
  "pvp:turn_result": (data: { log: string[]; state: PvpClientRoomView }) => void;
  "pvp:error": (data: { message: string }) => void;
  "pvp:opponent_disconnected": () => void;
  "pvp:room_created": (data: { roomId: string }) => void;
}

export interface PvpClientEvents {
  "pvp:auth": (data: { token: string }) => void;
  "pvp:queue": () => void;
  "pvp:queue_cancel": () => void;
  "pvp:create_room": () => void;
  "pvp:join_room": (data: { roomId: string }) => void;
  "pvp:ai_battle": () => void;
  "pvp:select_lead": (data: { pokemonIndex: number }) => void;
  "pvp:action": (data: { action: PvpAction }) => void;
}

// ── 클라이언트에게 보내는 방 뷰 (상대 정보 제한) ──
export interface PvpClientRoomView {
  roomId: string;
  turn: number;
  phase: PvpPhase;
  me: PvpPlayerState;
  opponent: {
    nickname: string;
    activePokemon: PvpPokemon | null;
    partyHpRatios: number[];
    ready: boolean;
    actionSubmitted: boolean;
    transformationType?: PvpTransformationType | null;
    gmaxTurnsRemaining?: number;
    // ── Expanded visible fields (canonically visible in-battle) ──
    statStages?: StatStages;
    volatiles?: VolatileStatus[];
    screens?: PvpPlayerState["screens"];
    hazards?: PvpPlayerState["hazards"];
    tailwind?: number;
    substitute?: number;
    teraActive?: boolean;
  };
  weather?: BattleWeather;
  weatherTurns?: number;
  terrain?: PvpRoomState["terrain"];
  terrainTurns?: number;
  trickRoom?: number;
  magicRoom?: number;
  wonderRoom?: number;
  lastMoveUsedInBattle?: string;
  turnDeadline: number | null;
  log: string[];
  result?: PvpRoomState["result"];
  isAiBattle: boolean;
  forcedSwitchNeeded?: { a: boolean; b: boolean };
}
