# PvP Battle System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 PvP 대전 + AI 비동기 대전을 포함한 완전한 대전 시스템. 랜덤 매칭, 방 생성, 친구 초대, 레이팅(Elo), 전적 기록 지원.

**Architecture:** Socket.IO를 Express HTTP 서버에 attach하여 실시간 통신. 매칭 큐(랜덤) + 방(초대/직접 생성) 이중 구조. PvP 배틀은 기존 `calculateDamage`/`determineTurnOrder`를 재사용하되, 양쪽 모두 플레이어가 동시에 행동을 제출하는 동시턴 방식. AI 대전은 같은 PvP 엔진에 서버사이드 AI가 한쪽을 조작. 포켓몬 HP/PP는 PvP 중 복사본 사용 (원본 미변경).

**Tech Stack:** socket.io, socket.io-client, 기존 Express/TypeScript/Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `shared/pvp-types.ts` | PvP 공유 타입 (방 상태, 액션, 소켓 이벤트, 레이팅) |
| `packages/server/tests/pvp/pvp-store.test.ts` | 전적 저장소 테스트 |
| `packages/server/src/pvp/matchmaking.ts` | 매칭 큐 (enqueue/dequeue/pair) |
| `packages/server/src/pvp/pvp-room.ts` | PvP 방 상태머신 (턴 해결, 타임아웃, 승패) |
| `packages/server/src/pvp/pvp-ai.ts` | AI 상대 로직 (기술 선택, 교체 판단) |
| `packages/server/src/pvp/pvp-socket.ts` | Socket.IO 이벤트 핸들러 |
| `packages/server/src/pvp/pvp-rating.ts` | Elo 레이팅 계산 |
| `packages/server/src/pvp/pvp-store.ts` | PvP 전적/레이팅 영속화 |
| `packages/server/tests/pvp/matchmaking.test.ts` | 매칭 큐 테스트 |
| `packages/server/tests/pvp/pvp-room.test.ts` | 방 상태머신 테스트 |
| `packages/server/tests/pvp/pvp-ai.test.ts` | AI 로직 테스트 |
| `packages/server/tests/pvp/pvp-rating.test.ts` | Elo 계산 테스트 |
| `packages/cli/src/commands/pvp.ts` | CLI PvP 커맨드 (매칭/배틀 UI) |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/package.json` | `socket.io` 의존성 추가 |
| `packages/cli/package.json` | `socket.io-client` 의존성 추가 |
| `packages/server/src/index.ts` | HTTP 서버에 Socket.IO attach |
| `packages/cli/src/interactive.ts` | PvP 메뉴 항목 추가 |
| `shared/types.ts` | `UserData`에 `pvpStats` 필드 추가 |

---

## Phase 1: 기반 인프라

### Task 1: 의존성 추가 & 공유 타입 정의

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/cli/package.json`
- Create: `shared/pvp-types.ts`

- [ ] **Step 1: socket.io 의존성 설치**

```bash
cd packages/server && npm install socket.io
cd ../cli && npm install socket.io-client
```

- [ ] **Step 2: 공유 PvP 타입 작성**

Create `shared/pvp-types.ts`:

```typescript
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
  activeIndex: number;          // party 내 인덱스
  statStages: StatStages;
  volatiles: VolatileStatus[];
  battleForm?: string | null;
  ready: boolean;               // 포켓몬 선택 완료 여부
  actionSubmitted: boolean;     // 이번 턴 행동 제출 여부
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
  turnDeadline: number | null;   // ms timestamp
  log: string[];
  result?: {
    winnerId: string | null;     // null = 무승부
    loserId: string | null;
    reason: "ko" | "forfeit" | "timeout" | "disconnect";
  };
  isAiBattle: boolean;           // AI 대전 여부
}

// ── 플레이어 액션 ──
export type PvpAction =
  | { type: "fight"; moveId: string }
  | { type: "switch"; pokemonIndex: number }
  | { type: "forfeit" };

// ── 방 설정 ──
export interface PvpRoomConfig {
  levelCap: number;              // 기본 50
  turnTimeoutMs: number;         // 기본 30000
  allowItems: boolean;           // 기본 false
}

// ── 레이팅 ──
export interface PvpStats {
  rating: number;                // Elo, 기본 1000
  wins: number;
  losses: number;
  streak: number;                // 연승
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
    partyHpRatios: number[];     // 0~1, 각 파티원 생존 비율만 공개
    ready: boolean;
    actionSubmitted: boolean;
  };
  weather?: BattleWeather;
  turnDeadline: number | null;
  log: string[];
  result?: PvpRoomState["result"];
  isAiBattle: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/pvp-types.ts packages/server/package.json packages/cli/package.json package-lock.json
git commit -m "feat(pvp): add socket.io deps and shared PvP types"
```

---

### Task 2: 매칭 큐

**Files:**
- Create: `packages/server/src/pvp/matchmaking.ts`
- Test: `packages/server/tests/pvp/matchmaking.test.ts`

- [ ] **Step 1: 매칭 큐 테스트 작성**

Create `packages/server/tests/pvp/matchmaking.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { enqueue, dequeueByUserId, tryMatch, getQueueSize, resetQueue } from "../../src/pvp/matchmaking.js";

describe("matchmaking", () => {
  beforeEach(() => resetQueue());

  it("enqueue increases queue size", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    expect(getQueueSize()).toBe(1);
  });

  it("duplicate userId replaces entry", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "a", socketId: "s2", nickname: "A" });
    expect(getQueueSize()).toBe(1);
  });

  it("tryMatch returns null with < 2 entries", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    expect(tryMatch()).toBeNull();
  });

  it("tryMatch pairs two entries and empties queue", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "b", socketId: "s2", nickname: "B" });
    const pair = tryMatch();
    expect(pair).not.toBeNull();
    expect(pair![0].userId).toBe("a");
    expect(pair![1].userId).toBe("b");
    expect(getQueueSize()).toBe(0);
  });

  it("dequeueByUserId removes correct entry", () => {
    enqueue({ userId: "a", socketId: "s1", nickname: "A" });
    enqueue({ userId: "b", socketId: "s2", nickname: "B" });
    dequeueByUserId("a");
    expect(getQueueSize()).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/matchmaking.test.ts
```

Expected: FAIL (모듈 없음)

- [ ] **Step 3: 매칭 큐 구현**

Create `packages/server/src/pvp/matchmaking.ts`:

```typescript
export interface QueueEntry {
  userId: string;
  socketId: string;
  nickname: string;
}

let queue: QueueEntry[] = [];

export function enqueue(entry: QueueEntry): void {
  dequeueByUserId(entry.userId);
  queue.push(entry);
}

export function dequeueByUserId(userId: string): void {
  queue = queue.filter((e) => e.userId !== userId);
}

export function dequeueBySocketId(socketId: string): void {
  queue = queue.filter((e) => e.socketId !== socketId);
}

export function tryMatch(): [QueueEntry, QueueEntry] | null {
  if (queue.length < 2) return null;
  return [queue.shift()!, queue.shift()!];
}

export function getQueueSize(): number {
  return queue.length;
}

export function resetQueue(): void {
  queue = [];
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd packages/server && npx vitest run tests/pvp/matchmaking.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pvp/matchmaking.ts packages/server/tests/pvp/matchmaking.test.ts
git commit -m "feat(pvp): add matchmaking queue with tests"
```

---

### Task 3: Elo 레이팅 계산

**Files:**
- Create: `packages/server/src/pvp/pvp-rating.ts`
- Test: `packages/server/tests/pvp/pvp-rating.test.ts`

- [ ] **Step 1: 레이팅 테스트 작성**

Create `packages/server/tests/pvp/pvp-rating.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateElo } from "../../src/pvp/pvp-rating.js";

describe("calculateElo", () => {
  it("equal ratings: winner gains ~16, loser loses ~16", () => {
    const { winnerNew, loserNew } = calculateElo(1000, 1000);
    expect(winnerNew).toBe(1016);
    expect(loserNew).toBe(984);
  });

  it("higher rated winner gains less", () => {
    const { winnerNew, loserNew } = calculateElo(1200, 1000);
    expect(winnerNew).toBeLessThan(1200 + 16);
    expect(winnerNew).toBeGreaterThan(1200);
  });

  it("lower rated winner gains more (upset)", () => {
    const { winnerNew, loserNew } = calculateElo(1000, 1200);
    expect(winnerNew - 1000).toBeGreaterThan(16);
  });

  it("rating never goes below 0", () => {
    const { loserNew } = calculateElo(100, 0);
    expect(loserNew).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인 후 구현**

Create `packages/server/src/pvp/pvp-rating.ts`:

```typescript
const K = 32;

export function calculateElo(
  winnerRating: number,
  loserRating: number,
): { winnerNew: number; loserNew: number; winnerDelta: number; loserDelta: number } {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 - expectedWinner;

  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));

  return {
    winnerNew: winnerRating + winnerDelta,
    loserNew: Math.max(0, loserRating + loserDelta),
    winnerDelta,
    loserDelta,
  };
}
```

- [ ] **Step 3: 테스트 통과 확인 & Commit**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-rating.test.ts
git add packages/server/src/pvp/pvp-rating.ts packages/server/tests/pvp/pvp-rating.test.ts
git commit -m "feat(pvp): add Elo rating calculation with tests"
```

---

## Phase 2: PvP 배틀 엔진

### Task 4: PvP 방 상태머신 — 생성 & 포켓몬 선택

**Files:**
- Create: `packages/server/src/pvp/pvp-room.ts`
- Test: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 테스트 작성 — 방 생성 & 리드 선택**

Create `packages/server/tests/pvp/pvp-room.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createRoom, selectLead, getPlayerView } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, level = 50): PvpPokemon {
  return {
    uid: species + "-uid",
    species,
    level,
    hp: 100, maxHp: 100,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
  };
}

const partyA = [makePokemon("pikachu"), makePokemon("charizard")];
const partyB = [makePokemon("bulbasaur"), makePokemon("squirtle")];

describe("pvp-room", () => {
  it("createRoom returns room in team_preview phase", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    expect(room.phase).toBe("team_preview");
    expect(room.playerA.party).toHaveLength(2);
    expect(room.playerB.party).toHaveLength(2);
  });

  it("selectLead sets activeIndex and marks ready", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 1);
    expect(room.playerA.activeIndex).toBe(1);
    expect(room.playerA.ready).toBe(true);
    expect(room.phase).toBe("team_preview"); // B 아직 안 골랐으니까
  });

  it("both leads selected → phase advances to action", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    expect(room.phase).toBe("action");
    expect(room.turn).toBe(1);
  });

  it("getPlayerView hides opponent party details", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const view = getPlayerView(room, "userA");
    expect(view.me.party).toHaveLength(2);
    expect(view.opponent.activePokemon).not.toBeNull();
    expect(view.opponent.partyHpRatios).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 3: pvp-room.ts 구현 — 생성 & 선택**

Create `packages/server/src/pvp/pvp-room.ts`:

```typescript
import crypto from "node:crypto";
import { defaultStatStages } from "../game/battle.js";
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon, PvpAction,
  PvpClientRoomView, PvpRoomConfig,
} from "../../../../shared/pvp-types.js";

export const DEFAULT_CONFIG: PvpRoomConfig = {
  levelCap: 50,
  turnTimeoutMs: 30_000,
  allowItems: false,
};

// ── 활성 방 저장소 ──
const rooms = new Map<string, PvpRoomState>();

export function getRoom(roomId: string): PvpRoomState | undefined {
  return rooms.get(roomId);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

function makePlayer(userId: string, nickname: string, party: PvpPokemon[]): PvpPlayerState {
  return {
    userId, nickname, party,
    activeIndex: 0,
    statStages: defaultStatStages(),
    volatiles: [],
    ready: false,
    actionSubmitted: false,
  };
}

export function createRoom(
  userIdA: string, nickA: string, partyA: PvpPokemon[],
  userIdB: string, nickB: string, partyB: PvpPokemon[],
  isAi = false,
): PvpRoomState {
  const room: PvpRoomState = {
    roomId: crypto.randomUUID(),
    turn: 0,
    phase: "team_preview",
    playerA: makePlayer(userIdA, nickA, partyA),
    playerB: makePlayer(userIdB, nickB, partyB),
    turnDeadline: null,
    log: [],
    isAiBattle: isAi,
  };
  rooms.set(room.roomId, room);
  return room;
}

export function getPlayerSide(room: PvpRoomState, userId: string): "A" | "B" | null {
  if (room.playerA.userId === userId) return "A";
  if (room.playerB.userId === userId) return "B";
  return null;
}

function getPlayer(room: PvpRoomState, userId: string): PvpPlayerState {
  return room.playerA.userId === userId ? room.playerA : room.playerB;
}

function getOpponent(room: PvpRoomState, userId: string): PvpPlayerState {
  return room.playerA.userId === userId ? room.playerB : room.playerA;
}

export function selectLead(room: PvpRoomState, userId: string, index: number): void {
  if (room.phase !== "team_preview") return;
  const player = getPlayer(room, userId);
  if (index < 0 || index >= player.party.length) return;
  player.activeIndex = index;
  player.ready = true;

  if (room.playerA.ready && room.playerB.ready) {
    room.phase = "action";
    room.turn = 1;
    room.turnDeadline = Date.now() + DEFAULT_CONFIG.turnTimeoutMs;
  }
}

export function getPlayerView(room: PvpRoomState, userId: string): PvpClientRoomView {
  const me = getPlayer(room, userId);
  const opp = getOpponent(room, userId);
  const oppActive = opp.party[opp.activeIndex] ?? null;

  return {
    roomId: room.roomId,
    turn: room.turn,
    phase: room.phase,
    me,
    opponent: {
      nickname: opp.nickname,
      activePokemon: oppActive,
      partyHpRatios: opp.party.map((p) => p.maxHp > 0 ? p.hp / p.maxHp : 0),
      ready: opp.ready,
      actionSubmitted: opp.actionSubmitted,
    },
    weather: room.weather,
    turnDeadline: room.turnDeadline,
    log: room.log,
    result: room.result,
    isAiBattle: room.isAiBattle,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인 & Commit**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
git add packages/server/src/pvp/pvp-room.ts packages/server/tests/pvp/pvp-room.test.ts
git commit -m "feat(pvp): add PvP room creation and lead selection with tests"
```

---

### Task 5: PvP 턴 해결 엔진

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 턴 해결 테스트 추가**

Append to `pvp-room.test.ts`:

```typescript
import { submitAction, resolveTurn } from "../../src/pvp/pvp-room.js";

describe("pvp turn resolution", () => {
  function readyRoom() {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("submitAction marks player as submitted", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    expect(room.playerA.actionSubmitted).toBe(true);
  });

  it("both actions submitted triggers resolution", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    const resolved = submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(resolved).toBe(true);
    // Turn incremented, actions reset
    expect(room.turn).toBe(2);
    expect(room.playerA.actionSubmitted).toBe(false);
    expect(room.log.length).toBeGreaterThan(0);
  });

  it("forfeit ends the match immediately", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "forfeit" });
    expect(room.phase).toBe("finished");
    expect(room.result?.winnerId).toBe("userB");
    expect(room.result?.reason).toBe("forfeit");
  });

  it("switch changes active pokemon", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.activeIndex).toBe(1);
  });

  it("KO triggers forced_switch or finish", () => {
    const room = readyRoom();
    // 상대 HP를 1로 낮추기
    room.playerB.party[0].hp = 1;
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // B의 첫번째 포켓몬이 기절 → forced_switch 또는 finished
    const bAlive = room.playerB.party.filter((p) => p.hp > 0).length;
    if (bAlive > 0) {
      expect(room.phase).toBe("forced_switch");
    } else {
      expect(room.phase).toBe("finished");
    }
  });
});
```

- [ ] **Step 2: 턴 해결 구현**

Add to `pvp-room.ts`:

```typescript
import { calculateDamage, determineTurnOrder } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getMoveById } from "../game/data-loader.js";
import type { PvpAction } from "../../../../shared/pvp-types.js";

// 행동 저장소
const pendingActions = new Map<string, Map<string, PvpAction>>(); // roomId → userId → action

export function submitAction(room: PvpRoomState, userId: string, action: PvpAction): boolean {
  if (room.phase !== "action" && room.phase !== "forced_switch") return false;

  // forfeit은 즉시 처리
  if (action.type === "forfeit") {
    const opp = getOpponent(room, userId);
    room.phase = "finished";
    room.result = { winnerId: opp.userId, loserId: userId, reason: "forfeit" };
    return true;
  }

  const player = getPlayer(room, userId);
  player.actionSubmitted = true;

  if (!pendingActions.has(room.roomId)) pendingActions.set(room.roomId, new Map());
  pendingActions.get(room.roomId)!.set(userId, action);

  // 양쪽 모두 제출했는지 확인
  const actions = pendingActions.get(room.roomId)!;
  if (actions.size < 2) return false;

  // 턴 해결
  const actionA = actions.get(room.playerA.userId)!;
  const actionB = actions.get(room.playerB.userId)!;
  resolveTurn(room, actionA, actionB);

  // 정리
  actions.clear();
  room.playerA.actionSubmitted = false;
  room.playerB.actionSubmitted = false;

  return true;
}

function resolveTurn(room: PvpRoomState, actionA: PvpAction, actionB: PvpAction): void {
  room.log = []; // 이번 턴 로그만

  // 1. 교체 먼저 처리
  if (actionA.type === "switch") applySwitch(room, room.playerA, actionA.pokemonIndex);
  if (actionB.type === "switch") applySwitch(room, room.playerB, actionB.pokemonIndex);

  // 2. 공격 처리 (스피드 순서)
  if (actionA.type === "fight" && actionB.type === "fight") {
    const pokemonA = room.playerA.party[room.playerA.activeIndex];
    const pokemonB = room.playerB.party[room.playerB.activeIndex];
    const moveA = getMoveById(actionA.moveId);
    const moveB = getMoveById(actionB.moveId);

    const order = determineTurnOrder(
      pokemonA.stats.speed, pokemonB.stats.speed,
      moveA?.priority ?? 0, moveB?.priority ?? 0,
    );

    const [first, second] = order === "player"
      ? [{ player: room.playerA, action: actionA, opp: room.playerB },
         { player: room.playerB, action: actionB, opp: room.playerA }]
      : [{ player: room.playerB, action: actionB, opp: room.playerA },
         { player: room.playerA, action: actionA, opp: room.playerB }];

    executeFight(room, first.player, first.action.moveId, first.opp);
    if (first.opp.party[first.opp.activeIndex].hp > 0) {
      executeFight(room, second.player, second.action.moveId, second.opp);
    }
  } else if (actionA.type === "fight") {
    executeFight(room, room.playerA, actionA.moveId, room.playerB);
  } else if (actionB.type === "fight") {
    executeFight(room, room.playerB, actionB.moveId, room.playerA);
  }

  // 3. KO 확인
  const koA = room.playerA.party[room.playerA.activeIndex].hp <= 0;
  const koB = room.playerB.party[room.playerB.activeIndex].hp <= 0;
  const aliveA = room.playerA.party.some((p) => p.hp > 0);
  const aliveB = room.playerB.party.some((p) => p.hp > 0);

  if (!aliveA && !aliveB) {
    room.phase = "finished";
    room.result = { winnerId: null, loserId: null, reason: "ko" };
    return;
  }
  if (!aliveA) {
    room.phase = "finished";
    room.result = { winnerId: room.playerB.userId, loserId: room.playerA.userId, reason: "ko" };
    return;
  }
  if (!aliveB) {
    room.phase = "finished";
    room.result = { winnerId: room.playerA.userId, loserId: room.playerB.userId, reason: "ko" };
    return;
  }

  if (koA || koB) {
    room.phase = "forced_switch";
  } else {
    room.phase = "action";
  }
  room.turn += 1;
  room.turnDeadline = Date.now() + DEFAULT_CONFIG.turnTimeoutMs;
}

function applySwitch(room: PvpRoomState, player: PvpPlayerState, index: number): void {
  if (index < 0 || index >= player.party.length) return;
  if (player.party[index].hp <= 0) return;
  const oldSpecies = player.party[player.activeIndex].species;
  player.activeIndex = index;
  player.statStages = defaultStatStages();
  player.volatiles = [];
  player.battleForm = undefined;
  room.log.push(`${player.nickname}: ${player.party[index].species}(으)로 교체!`);
}

function executeFight(
  room: PvpRoomState,
  attacker: PvpPlayerState,
  moveId: string,
  defender: PvpPlayerState,
): void {
  const atkPoke = attacker.party[attacker.activeIndex];
  const defPoke = defender.party[defender.activeIndex];
  const moveData = getMoveById(moveId);
  if (!moveData) return;

  // PP 소모
  const move = atkPoke.moves.find((m) => m.id === moveId);
  if (move && move.pp > 0) move.pp -= 1;

  const result = calculateDamage(
    atkPoke.level, atkPoke.stats, defPoke.stats, moveData,
    getEffectiveTypes(atkPoke.species, atkPoke.variantId, attacker.battleForm),
    getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm),
    attacker.statStages, defender.statStages,
  );

  defPoke.hp = Math.max(0, defPoke.hp - result.damage);
  room.log.push(
    `${attacker.nickname}의 ${atkPoke.species}: ${moveData.name}! ` +
    (result.missed ? "빗나갔다!" : `${result.damage} 데미지!`),
  );
  if (result.message) room.log.push(result.message);
  if (result.critical) room.log.push("급소에 맞았다!");

  if (defPoke.hp <= 0) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
  }
}
```

- [ ] **Step 3: 테스트 통과 확인 & Commit**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
git add packages/server/src/pvp/pvp-room.ts packages/server/tests/pvp/pvp-room.test.ts
git commit -m "feat(pvp): add PvP turn resolution engine with tests"
```

---

### Task 6: AI 상대 로직

**Files:**
- Create: `packages/server/src/pvp/pvp-ai.ts`
- Test: `packages/server/tests/pvp/pvp-ai.test.ts`

- [ ] **Step 1: AI 테스트 작성**

Create `packages/server/tests/pvp/pvp-ai.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chooseAiAction } from "../../src/pvp/pvp-ai.js";
import type { PvpPokemon, PvpPlayerState } from "../../../../shared/pvp-types.js";
import { defaultStatStages } from "../../src/game/battle.js";

function makePoke(species: string, hp = 100, moves = ["tackle"]): PvpPokemon {
  return {
    uid: species, species, level: 50, hp, maxHp: 100,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: moves.map((m) => ({ id: m, pp: 10, maxPp: 10 })),
    statusCondition: null,
  };
}

function makeState(party: PvpPokemon[], active = 0): PvpPlayerState {
  return {
    userId: "ai", nickname: "AI", party, activeIndex: active,
    statStages: defaultStatStages(), volatiles: [],
    ready: true, actionSubmitted: false,
  };
}

describe("pvp-ai", () => {
  it("always returns a valid action", () => {
    const ai = makeState([makePoke("pikachu")]);
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(["fight", "switch"]).toContain(action.type);
  });

  it("uses fight when only one pokemon alive", () => {
    const ai = makeState([makePoke("pikachu")]);
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(action.type).toBe("fight");
  });

  it("never switches to fainted pokemon", () => {
    const ai = makeState([makePoke("pikachu", 50), makePoke("charizard", 0)]);
    const opp = makeState([makePoke("squirtle")]);
    for (let i = 0; i < 20; i++) {
      const action = chooseAiAction(ai, opp);
      if (action.type === "switch") {
        expect(action.pokemonIndex).not.toBe(1);
      }
    }
  });
});
```

- [ ] **Step 2: AI 구현**

Create `packages/server/src/pvp/pvp-ai.ts`:

```typescript
import type { PvpAction, PvpPlayerState } from "../../../../shared/pvp-types.js";
import { getMoveById, getTypeChart } from "../game/data-loader.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";

export function chooseAiAction(ai: PvpPlayerState, opponent: PvpPlayerState): PvpAction {
  const myPoke = ai.party[ai.activeIndex];
  const oppPoke = opponent.party[opponent.activeIndex];
  const oppTypes = getEffectiveTypes(oppPoke.species, oppPoke.variantId, undefined);
  const typeChart = getTypeChart();

  // PP가 있는 기술만
  const usable = myPoke.moves.filter((m) => m.pp > 0);
  if (usable.length === 0) {
    return { type: "fight", moveId: myPoke.moves[0]?.id ?? "tackle" };
  }

  // 각 기술의 타입 상성 점수 계산
  const scored = usable.map((m) => {
    const data = getMoveById(m.id);
    if (!data || data.power === 0) return { moveId: m.id, score: 0 };
    let mult = 1;
    const moveChart = typeChart[data.type] ?? {};
    for (const t of oppTypes) {
      mult *= moveChart[t] ?? 1;
    }
    return { moveId: m.id, score: data.power * mult };
  });

  scored.sort((a, b) => b.score - a.score);

  // 20% 확률로 교체 시도 (HP 낮을 때)
  if (myPoke.hp < myPoke.maxHp * 0.3) {
    const aliveOthers = ai.party
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== ai.activeIndex && p.hp > 0);
    if (aliveOthers.length > 0 && Math.random() < 0.2) {
      const pick = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      return { type: "switch", pokemonIndex: pick.i };
    }
  }

  return { type: "fight", moveId: scored[0].moveId };
}
```

- [ ] **Step 3: 테스트 통과 확인 & Commit**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-ai.test.ts
git add packages/server/src/pvp/pvp-ai.ts packages/server/tests/pvp/pvp-ai.test.ts
git commit -m "feat(pvp): add AI opponent logic with tests"
```

---

## Phase 3: 서버 연결

### Task 7: PvP 전적 저장소

**Files:**
- Create: `packages/server/src/pvp/pvp-store.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: UserData에 pvpStats 추가**

In `shared/types.ts`, add to `UserData` interface:

```typescript
pvpStats?: PvpStats;
```

And add import:
```typescript
import type { PvpStats } from "./pvp-types.js";
```

- [ ] **Step 2: pvp-store 구현**

Create `packages/server/src/pvp/pvp-store.ts`:

```typescript
import path from "node:path";
import { readJson, writeJson } from "../storage/json-store.js";
import { getDataDir } from "../paths.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { calculateElo } from "./pvp-rating.js";
import type { PvpMatchRecord } from "../../../../shared/pvp-types.js";
import crypto from "node:crypto";

function matchHistoryPath(): string {
  return path.join(getDataDir(), "pvp-history.json");
}

export async function getMatchHistory(limit = 50): Promise<PvpMatchRecord[]> {
  const data = await readJson<PvpMatchRecord[]>(matchHistoryPath());
  const records = data ?? [];
  return records.slice(-limit);
}

export async function recordMatch(
  winnerUserId: string | null,
  loserUserId: string | null,
  reason: string,
): Promise<PvpMatchRecord | null> {
  if (!winnerUserId || !loserUserId) return null;

  const winner = await getUser(winnerUserId);
  const loser = await getUser(loserUserId);
  if (!winner || !loser) return null;

  const wStats = winner.pvpStats ?? { rating: 1000, wins: 0, losses: 0, streak: 0 };
  const lStats = loser.pvpStats ?? { rating: 1000, wins: 0, losses: 0, streak: 0 };

  const elo = calculateElo(wStats.rating, lStats.rating);

  wStats.rating = elo.winnerNew;
  wStats.wins += 1;
  wStats.streak += 1;
  lStats.rating = elo.loserNew;
  lStats.losses += 1;
  lStats.streak = 0;

  // 포인트 보상
  winner.points += 100;
  loser.points += 20;

  winner.pvpStats = wStats;
  loser.pvpStats = lStats;
  await saveUser(winner);
  await saveUser(loser);

  const record: PvpMatchRecord = {
    id: crypto.randomUUID(),
    playerA: { userId: winnerUserId, nickname: winner.account.nickname, rating: elo.winnerNew },
    playerB: { userId: loserUserId, nickname: loser.account.nickname, rating: elo.loserNew },
    winnerId: winnerUserId,
    reason,
    ratingChange: { a: elo.winnerDelta, b: elo.loserDelta },
    createdAt: new Date().toISOString(),
  };

  const history = await readJson<PvpMatchRecord[]>(matchHistoryPath()) ?? [];
  history.push(record);
  if (history.length > 500) history.splice(0, history.length - 500);
  await writeJson(matchHistoryPath(), history);

  return record;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pvp/pvp-store.ts shared/types.ts
git commit -m "feat(pvp): add PvP stats persistence and match history"
```

---

### Task 8: Socket.IO 이벤트 핸들러

**Files:**
- Create: `packages/server/src/pvp/pvp-socket.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 소켓 핸들러 구현**

Create `packages/server/src/pvp/pvp-socket.ts`:

```typescript
import type { Server, Socket } from "socket.io";
import { verifyToken } from "../auth/auth.js";
import { getUser } from "../storage/user-store.js";
import { enqueue, dequeueBySocketId, tryMatch } from "./matchmaking.js";
import {
  createRoom, selectLead, submitAction, getPlayerView,
  getRoom, deleteRoom, getPlayerSide,
} from "./pvp-room.js";
import { chooseAiAction } from "./pvp-ai.js";
import { recordMatch } from "./pvp-store.js";
import type { PvpPokemon, PvpAction, PvpRoomState } from "../../../../shared/pvp-types.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

// socketId → { userId, roomId }
const socketState = new Map<string, { userId: string; roomId?: string }>();

function userPartyToPvp(user: { pokemon: OwnedPokemon[]; party: string[] }): PvpPokemon[] {
  const partyPokemon = user.party
    .map((uid) => user.pokemon.find((p) => p.uid === uid))
    .filter((p): p is OwnedPokemon => p != null && p.hp > 0);
  return partyPokemon
    .map((p) => ({
      uid: p.uid, species: p.species, variantId: p.variantId,
      level: Math.min(p.level, 50),
      hp: p.maxHp, maxHp: p.maxHp, // PvP는 풀 HP로 시작
      stats: { ...p.stats }, moves: p.moves.map((m) => ({ ...m, pp: m.maxPp })),
      statusCondition: null, nature: p.nature, abilityId: p.abilityId, isShiny: p.isShiny,
    }));
}

export function setupPvpSocket(io: Server): void {
  io.on("connection", (socket: Socket) => {
    // ── 인증 ──
    socket.on("pvp:auth", async (data: { token: string }) => {
      const payload = verifyToken(data.token);
      if (!payload) { socket.emit("pvp:error", { message: "인증 실패" }); return; }
      socketState.set(socket.id, { userId: payload.userId });
      socket.emit("pvp:authenticated");
    });

    // ── 랜덤 매칭 ──
    socket.on("pvp:queue", async () => {
      const state = socketState.get(socket.id);
      if (!state) { socket.emit("pvp:error", { message: "인증이 필요합니다" }); return; }
      const user = await getUser(state.userId);
      if (!user) { socket.emit("pvp:error", { message: "유저를 찾을 수 없습니다" }); return; }

      enqueue({ userId: state.userId, socketId: socket.id, nickname: user.account.nickname });
      socket.emit("pvp:queued", { position: 0 });

      const pair = tryMatch();
      if (pair) {
        const [a, b] = pair;
        const userA = await getUser(a.userId);
        const userB = await getUser(b.userId);
        if (!userA || !userB) return;

        const room = createRoom(
          a.userId, a.nickname, userPartyToPvp(userA),
          b.userId, b.nickname, userPartyToPvp(userB),
        );

        const sockA = io.sockets.sockets.get(a.socketId);
        const sockB = io.sockets.sockets.get(b.socketId);
        sockA?.join(room.roomId);
        sockB?.join(room.roomId);

        const stA = socketState.get(a.socketId);
        const stB = socketState.get(b.socketId);
        if (stA) stA.roomId = room.roomId;
        if (stB) stB.roomId = room.roomId;

        sockA?.emit("pvp:matched", { roomId: room.roomId, opponent: b.nickname });
        sockB?.emit("pvp:matched", { roomId: room.roomId, opponent: a.nickname });
        sockA?.emit("pvp:room_state", getPlayerView(room, a.userId));
        sockB?.emit("pvp:room_state", getPlayerView(room, b.userId));
      }
    });

    socket.on("pvp:queue_cancel", () => {
      dequeueBySocketId(socket.id);
    });

    // ── 방 생성 (친구 초대용) ──
    socket.on("pvp:create_room", async () => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      // 임시 방 생성 — playerB는 빈 상태, 누군가 join하면 채움
      const room = createRoom(
        state.userId, user.account.nickname, userPartyToPvp(user),
        "__waiting__", "대기 중...", [],
      );
      state.roomId = room.roomId;
      socket.join(room.roomId);
      socket.emit("pvp:room_created", { roomId: room.roomId });
    });

    // ── 방 참가 ──
    socket.on("pvp:join_room", async (data: { roomId: string }) => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      const room = getRoom(data.roomId);
      if (!room || room.playerB.userId !== "__waiting__") {
        socket.emit("pvp:error", { message: "방을 찾을 수 없습니다" });
        return;
      }

      room.playerB.userId = state.userId;
      room.playerB.nickname = user.account.nickname;
      room.playerB.party = userPartyToPvp(user);
      state.roomId = room.roomId;
      socket.join(room.roomId);

      // 각 플레이어에게 개별 뷰 전송
      for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
        const s = socketState.get(sid);
        if (s) io.to(sid).emit("pvp:room_state", getPlayerView(room, s.userId));
      }
    });

    // ── AI 대전 ──
    socket.on("pvp:ai_battle", async () => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      const myParty = userPartyToPvp(user);
      // AI 파티 = 유저 파티 복사 (미러 매치)
      const aiParty = myParty.map((p) => ({
        ...p, uid: "ai-" + p.uid,
        stats: { ...p.stats },
        moves: p.moves.map((m) => ({ ...m })),
      }));

      const room = createRoom(
        state.userId, user.account.nickname, myParty,
        "__ai__", "AI 트레이너", aiParty, true,
      );
      state.roomId = room.roomId;
      socket.join(room.roomId);
      socket.emit("pvp:matched", { roomId: room.roomId, opponent: "AI 트레이너" });
      socket.emit("pvp:room_state", getPlayerView(room, state.userId));

      // AI 자동 리드 선택
      selectLead(room, "__ai__", 0);
    });

    // ── 리드 선택 ──
    socket.on("pvp:select_lead", (data: { pokemonIndex: number }) => {
      const state = socketState.get(socket.id);
      if (!state?.roomId) return;
      const room = getRoom(state.roomId);
      if (!room) return;

      selectLead(room, state.userId, data.pokemonIndex);

      // 양쪽 다 준비되면 상태 전송
      if (room.phase === "action") {
        emitRoomState(io, room);
      }
    });

    // ── 행동 제출 ──
    socket.on("pvp:action", async (data: { action: PvpAction }) => {
      const state = socketState.get(socket.id);
      if (!state?.roomId) return;
      const room = getRoom(state.roomId);
      if (!room) return;

      const resolved = submitAction(room, state.userId, data.action);

      // AI 대전이면 AI도 행동 자동 제출
      if (room.isAiBattle && !resolved && room.phase === "action") {
        const aiAction = chooseAiAction(room.playerB, room.playerA);
        submitAction(room, "__ai__", aiAction);
      }

      // 결과 전송
      if (room.phase === "finished" && room.result) {
        await recordMatch(room.result.winnerId, room.result.loserId, room.result.reason);
        emitTurnResult(io, room);
        deleteRoom(room.roomId);
      } else {
        emitTurnResult(io, room);
        // forced_switch에서 AI 자동 교체
        if (room.isAiBattle && room.phase === "forced_switch") {
          const aiAlive = room.playerB.party.findIndex((p, i) => p.hp > 0 && i !== room.playerB.activeIndex);
          if (aiAlive >= 0) {
            submitAction(room, "__ai__", { type: "switch", pokemonIndex: aiAlive });
          }
        }
      }
    });

    // ── 연결 해제 ──
    socket.on("disconnect", async () => {
      const state = socketState.get(socket.id);
      if (state) {
        dequeueBySocketId(socket.id);
        if (state.roomId) {
          const room = getRoom(state.roomId);
          if (room && room.phase !== "finished") {
            const opp = room.playerA.userId === state.userId ? room.playerB : room.playerA;
            room.phase = "finished";
            room.result = { winnerId: opp.userId, loserId: state.userId, reason: "disconnect" };
            if (!room.isAiBattle) {
              await recordMatch(opp.userId, state.userId, "disconnect");
            }
            io.to(room.roomId).emit("pvp:opponent_disconnected");
            deleteRoom(room.roomId);
          }
        }
      }
      socketState.delete(socket.id);
    });
  });
}

function emitRoomState(io: Server, room: PvpRoomState): void {
  for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
    const st = socketState.get(sid);
    if (st) {
      io.to(sid).emit("pvp:room_state", getPlayerView(room, st.userId));
    }
  }
}

function emitTurnResult(io: Server, room: PvpRoomState): void {
  for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
    const st = socketState.get(sid);
    if (st) {
      io.to(sid).emit("pvp:turn_result", {
        log: room.log,
        state: getPlayerView(room, st.userId),
      });
    }
  }
}
```

- [ ] **Step 2: index.ts에 Socket.IO 연결**

Modify `packages/server/src/index.ts`:

```typescript
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { createApp } from "./app.js";
import { getConfig } from "./storage/config-store.js";
import { startPolling } from "./polling/polling-worker.js";
import { setupPvpSocket } from "./pvp/pvp-socket.js";

if (!process.env.POKELOG_JWT_SECRET) {
  console.error("FATAL: POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}

async function main() {
  const config = await getConfig();
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });

  if (config.meta.featureFlags.pvp !== false) {
    setupPvpSocket(io);
  }

  httpServer.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });
}

main().catch(console.error);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pvp/pvp-socket.ts packages/server/src/index.ts
git commit -m "feat(pvp): add Socket.IO event handlers and attach to server"
```

---

## Phase 4: CLI 클라이언트

### Task 9: CLI PvP 커맨드

**Files:**
- Create: `packages/cli/src/commands/pvp.ts`
- Modify: `packages/cli/src/interactive.ts`

- [ ] **Step 1: PvP CLI 커맨드 구현**

Create `packages/cli/src/commands/pvp.ts`.

세 가지 모드:
1. **랜덤 매칭** — `pvp:queue` → 대기 → `pvp:matched` → 배틀
2. **방 생성/참가** — `pvp:create_room` 또는 `pvp:join_room`
3. **AI 대전** — `pvp:ai_battle`

배틀 UI:
- 기존 `encounter.ts`의 `buildBattleScene` 패턴 재사용
- 메뉴: 싸운다 / 포켓몬 (교체) / 기권
- 기술 선택 → `pvp:action` 전송 → "상대 대기 중..." → `pvp:turn_result` 수신 → 로그 표시
- 30초 타이머 표시
- 기절 시 교체 강제 (`forced_switch`)
- 종료 시 승패/레이팅 변동 표시

```typescript
import { io as socketIo } from "socket.io-client";
import { getToken, getCurrentServer } from "../config.js";
import { BLD, CYN, DIM, GRN, RED, YEL, R } from "../ui/colors.js";
import { renderHpBar } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { redraw, clearScreen } from "../ui/screen.js";
import { padRight } from "../ui/text.js";
import type { PvpClientRoomView, PvpAction, PvpPokemon } from "../../../../shared/pvp-types.js";

export async function pvpCommand(): Promise<void> {
  const server = await getCurrentServer();
  const token = await getToken();
  if (!server || !token) {
    console.log(`${RED}서버에 로그인되어 있지 않습니다${R}`);
    return;
  }

  // 모드 선택
  const mode = await selectMode();
  if (!mode) return;

  const socket = socketIo(server.url, { autoConnect: false });
  socket.connect();

  return new Promise<void>((resolve) => {
    socket.emit("pvp:auth", { token });

    socket.on("pvp:authenticated", () => {
      if (mode === "random") socket.emit("pvp:queue");
      else if (mode === "create") socket.emit("pvp:create_room");
      else if (mode === "ai") socket.emit("pvp:ai_battle");
    });

    socket.on("pvp:queued", () => {
      console.log(`${CYN}매칭 대기 중...${R} (ESC로 취소)`);
    });

    socket.on("pvp:room_created", (data) => {
      console.log(`${GRN}방 생성됨: ${BLD}${data.roomId}${R}`);
      console.log(`${DIM}상대에게 이 코드를 공유하세요${R}`);
    });

    socket.on("pvp:matched", (data) => {
      console.log(`${GRN}매칭 완료! 상대: ${BLD}${data.opponent}${R}`);
    });

    socket.on("pvp:room_state", async (state: PvpClientRoomView) => {
      if (state.phase === "team_preview") {
        await handleTeamPreview(socket, state);
      } else if (state.phase === "action") {
        await handleBattleTurn(socket, state);
      } else if (state.phase === "forced_switch") {
        await handleForcedSwitch(socket, state);
      } else if (state.phase === "finished") {
        handleFinish(state);
        socket.disconnect();
        resolve();
      }
    });

    socket.on("pvp:turn_result", async (data) => {
      // 로그 출력
      for (const msg of data.log) console.log(`  ${msg}`);
      // 다음 상태 처리
      const state = data.state;
      if (state.phase === "finished") {
        handleFinish(state);
        socket.disconnect();
        resolve();
      } else if (state.phase === "forced_switch") {
        await handleForcedSwitch(socket, state);
      } else if (state.phase === "action") {
        await handleBattleTurn(socket, state);
      }
    });

    socket.on("pvp:opponent_disconnected", () => {
      console.log(`${YEL}상대가 연결을 끊었습니다${R}`);
      socket.disconnect();
      resolve();
    });

    socket.on("pvp:error", (data) => {
      console.log(`${RED}에러: ${data.message}${R}`);
    });

    socket.on("disconnect", () => resolve());
  });
}

async function selectMode(): Promise<"random" | "create" | "join" | "ai" | null> {
  // 간단한 메뉴 선택 (기존 패턴 사용)
  const options = ["랜덤 매칭", "방 생성", "방 참가", "AI 대전", "취소"];
  // ... 키보드 선택 구현 (encounter.ts 패턴)
  // 간략화 - 실제 구현시 enterRaw + waitKey 패턴 사용
  return "random";
}

async function handleTeamPreview(socket: any, state: PvpClientRoomView): Promise<void> {
  console.log(`\n${BLD}── 출전 포켓몬 선택 ──${R}`);
  state.me.party.forEach((p, i) => {
    const hp = renderHpBar(p.hp, p.maxHp, 10);
    console.log(`  ${i + 1}. ${padRight(p.species, 14)} Lv.${p.level} ${hp}`);
  });
  // 키보드 선택 → pvp:select_lead 전송
  // 간략화: 첫번째 포켓몬 선택
  socket.emit("pvp:select_lead", { pokemonIndex: 0 });
}

async function handleBattleTurn(socket: any, state: PvpClientRoomView): Promise<void> {
  const my = state.me.party[state.me.activeIndex];
  const opp = state.opponent.activePokemon;
  if (!opp) return;

  clearScreen();
  console.log(`\n  ${BLD}Turn ${state.turn}${R}`);
  console.log(`  ${my.species} Lv.${my.level}  ${renderHpBar(my.hp, my.maxHp, 12)}`);
  console.log(`  vs`);
  console.log(`  ${opp.species} Lv.${opp.level}  ${renderHpBar(opp.hp, opp.maxHp, 12)}`);
  console.log();
  console.log(`  ${BLD}1${R} 싸운다  ${BLD}2${R} 교체  ${BLD}3${R} 기권`);

  // 키입력 처리 → pvp:action 전송
  // 실제 구현시 enterRaw + waitKey 패턴
}

async function handleForcedSwitch(socket: any, state: PvpClientRoomView): Promise<void> {
  const alive = state.me.party
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.hp > 0 && i !== state.me.activeIndex);

  if (alive.length === 0) return; // 게임 끝

  console.log(`\n${YEL}포켓몬이 쓰러졌다! 교체할 포켓몬을 선택하세요${R}`);
  alive.forEach(({ p, i }) => {
    console.log(`  ${i + 1}. ${p.species} HP: ${p.hp}/${p.maxHp}`);
  });

  // 키보드 선택 → pvp:action { type: "switch" } 전송
}

function handleFinish(state: PvpClientRoomView): void {
  if (!state.result) return;
  const isWinner = state.result.winnerId === state.me.userId;
  if (state.result.winnerId === null) {
    console.log(`\n${YEL}${BLD}무승부!${R}`);
  } else if (isWinner) {
    console.log(`\n${GRN}${BLD}승리!${R} (+100P)`);
  } else {
    console.log(`\n${RED}${BLD}패배...${R} (+20P)`);
  }
}
```

- [ ] **Step 2: interactive.ts에 PvP 메뉴 추가**

`packages/cli/src/interactive.ts`에 추가:

```typescript
import { pvpCommand } from "./commands/pvp.js";
```

MENU_TREE에 추가 (야생 다음):
```typescript
{ label: "대전", cmd: "pvp", desc: "PvP 대전", auth: true, server: true },
```

커맨드 실행부에 추가:
```typescript
case "pvp": await pvpCommand(); break;
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/pvp.ts packages/cli/src/interactive.ts
git commit -m "feat(pvp): add CLI PvP command with matchmaking and battle UI"
```

---

## Phase 5: 마무리

### Task 10: Feature Flag 활성화 & 타입 체크

**Files:**
- Modify: `packages/server/src/storage/config-store.ts`

- [ ] **Step 1: pvp feature flag 활성화**

In `config-store.ts` DEFAULT_CONFIG:
```typescript
featureFlags: {
  pvp: true,  // false → true
  ...
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd packages/server && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

- [ ] **Step 3: 전체 테스트**

```bash
cd packages/server && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/storage/config-store.ts
git commit -m "feat(pvp): enable PvP feature flag"
```

---

### Task 11: PvP 랭킹 API

**Files:**
- Modify: `packages/server/src/routes/social-routes.ts`

- [ ] **Step 1: PvP 랭킹 엔드포인트 추가**

```typescript
socialRoutes.get("/ranking/pvp", async (req, res) => {
  try {
    const users = await getAllUsers();
    const ranked = users
      .filter((u) => u.pvpStats && (u.pvpStats.wins + u.pvpStats.losses) > 0)
      .map((u) => ({
        nickname: u.account.nickname,
        rating: u.pvpStats!.rating,
        wins: u.pvpStats!.wins,
        losses: u.pvpStats!.losses,
        streak: u.pvpStats!.streak,
      }))
      .sort((a, b) => b.rating - a.rating);
    res.json({ ranking: ranked });
  } catch (err) {
    console.error("PvP ranking error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/routes/social-routes.ts
git commit -m "feat(pvp): add PvP ranking API endpoint"
```

---

## Known Limitations (MVP 이후 개선 사항)

아래 항목들은 MVP에서 의도적으로 제외하며, 이후 반복 개발에서 추가:

1. **상태이상 미구현** — PvP 엔진에서 화상/독/마비/수면/얼음 데미지/효과 미처리. PvE `battle-state.ts`의 `resolvePreAttack`, `applyEndOfTurnBattle` 로직을 PvP 엔진에 이식 필요.
2. **날씨 시스템 미구현** — `PvpRoomState`에 `weather` 필드는 있으나 기술로 날씨 설정/해제/데미지 적용 로직 없음.
3. **턴 타임아웃 서버 강제** — `turnDeadline`은 설정하지만 `setTimeout`으로 자동 기권/랜덤 행동 처리 미구현. 클라이언트 타이머만 존재.
4. **양측 동시 기절 시 forced_switch** — 양쪽 모두 기절할 때 누가 교체해야 하는지 추적 (`forcedSwitchNeeded: { a: boolean; b: boolean }`) 미구현.
5. **메가진화/기가맥스** — PvP 배틀에서 변신 시스템 미지원.
6. **종족값 제한 (Species Clause)** — 같은 종 중복 출전 방지 미구현.
7. **CLI 키보드 UI 스텁** — `selectMode`, `handleTeamPreview`, `handleBattleTurn` 등 키보드 입력 처리가 스텁. `encounter.ts`의 `enterRaw`+`waitKey` 패턴으로 완성 필요.
