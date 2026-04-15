import type { PokemonMove, PokemonStats, PrimaryStatus, StatStages, VolatileStatus, BattleWeather } from "./types.js";

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
  nature?: string;
  abilityId?: string | null;
  isShiny?: boolean;
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
  turnDeadline: number | null;
  log: string[];
  result?: {
    winnerId: string | null;
    loserId: string | null;
    reason: "ko" | "forfeit" | "timeout" | "disconnect";
  };
  isAiBattle: boolean;
}

// ── 플레이어 액션 ──
export type PvpAction =
  | { type: "fight"; moveId: string }
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
  };
  weather?: BattleWeather;
  turnDeadline: number | null;
  log: string[];
  result?: PvpRoomState["result"];
  isAiBattle: boolean;
}
