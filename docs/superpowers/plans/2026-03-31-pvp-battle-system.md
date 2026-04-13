# PvP Battle System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time PvP battle system with socket.io matchmaking, simultaneous action selection, speed-based execution, 30s turn timeout, and point rewards.

**Architecture:** Socket.IO server runs alongside Express on the same HTTP server. Matchmaking queue pairs users, creates a PvP battle room. Each turn both players submit actions within 30s, then server resolves simultaneously (speed-based order) and broadcasts results. Reuses existing `calculateDamage` and `determineTurnOrder` from `battle.ts`.

**Tech Stack:** socket.io (server + client), existing Express/TypeScript stack

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/pvp/pvp-room.ts` | PvP battle room state machine (turn resolution, timeout, win/lose) |
| `packages/server/src/pvp/matchmaking.ts` | Matchmaking queue (enqueue, dequeue, pair users) |
| `packages/server/src/pvp/pvp-socket.ts` | Socket.IO event handlers (connect, matchmake, action, disconnect) |
| `shared/pvp-types.ts` | Shared PvP type definitions |
| `packages/cli/src/commands/pvp.ts` | CLI PvP command (matchmaking UI + battle UI) |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/package.json` | Add `socket.io` dependency |
| `packages/cli/package.json` | Add `socket.io-client` dependency |
| `packages/server/src/index.ts` | Attach socket.io to HTTP server |
| `packages/server/src/app.ts` | Export HTTP server for socket.io attach |
| `packages/cli/src/interactive.ts` | Register `pvp` command |
| `shared/types.ts` | Add pvp featureFlag |

---

### Task 1: Add Dependencies & Shared Types

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/cli/package.json`
- Create: `shared/pvp-types.ts`

- [ ] **Step 1: Install socket.io dependencies**

```bash
cd packages/server && npm install socket.io
cd ../cli && npm install socket.io-client
```

- [ ] **Step 2: Create shared PvP types**

Create `shared/pvp-types.ts`:

```typescript
import type { OwnedPokemon, PokemonMove, PokemonStats } from "./types.js";

export interface PvpPokemonInfo {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
}

export interface PvpRoomState {
  roomId: string;
  turn: number;
  phase: "select_pokemon" | "action" | "resolved" | "finished";
  players: {
    [userId: string]: {
      oddsId: string;
      nickname: string;
      activePokemon: PvpPokemonInfo | null;
      party: PvpPokemonInfo[];
      ready: boolean;
    };
  };
  turnDeadline: number | null;
  log: string[];
  result?: {
    winner: string | null;
    reason: "ko" | "forfeit" | "timeout";
  };
}

export type PvpAction =
  | { type: "fight"; moveId: string }
  | { type: "switch"; pokemonUid: string }
  | { type: "forfeit" };

// Socket.IO event types
export interface PvpServerEvents {
  "pvp:matched": (data: { roomId: string; opponent: { nickname: string } }) => void;
  "pvp:room_state": (state: PvpRoomState) => void;
  "pvp:turn_result": (data: { log: string[]; state: PvpRoomState }) => void;
  "pvp:error": (data: { message: string }) => void;
  "pvp:opponent_disconnected": () => void;
}

export interface PvpClientEvents {
  "pvp:queue": (data: { token: string }) => void;
  "pvp:queue_cancel": () => void;
  "pvp:select_pokemon": (data: { pokemonUid: string }) => void;
  "pvp:action": (data: { action: PvpAction }) => void;
  "pvp:forfeit": () => void;
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/pvp-types.ts packages/server/package.json packages/cli/package.json package-lock.json
git commit -m "feat(pvp): add socket.io deps and shared PvP types"
```

---

### Task 2: Matchmaking Queue

**Files:**
- Create: `packages/server/src/pvp/matchmaking.ts`

- [ ] **Step 1: Implement matchmaking queue**

Create `packages/server/src/pvp/matchmaking.ts`:

```typescript
interface QueueEntry {
  userId: string;
  socketId: string;
  nickname: string;
  enqueuedAt: number;
}

const queue: QueueEntry[] = [];

export function enqueue(entry: QueueEntry): void {
  // Remove duplicate if user re-queues
  dequeueByUserId(entry.userId);
  queue.push(entry);
}

export function dequeueByUserId(userId: string): void {
  const idx = queue.findIndex((e) => e.userId === userId);
  if (idx >= 0) queue.splice(idx, 1);
}

export function dequeueBySocketId(socketId: string): void {
  const idx = queue.findIndex((e) => e.socketId === socketId);
  if (idx >= 0) queue.splice(idx, 1);
}

export function tryMatch(): [QueueEntry, QueueEntry] | null {
  if (queue.length < 2) return null;
  const a = queue.shift()!;
  const b = queue.shift()!;
  return [a, b];
}

export function getQueueSize(): number {
  return queue.length;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/pvp/matchmaking.ts
git commit -m "feat(pvp): add matchmaking queue"
```

---

### Task 3: PvP Battle Room

**Files:**
- Create: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: Implement PvP room logic**

Create `packages/server/src/pvp/pvp-room.ts`. This handles:
- Room creation with two players' party data
- Pokemon selection phase
- Action collection (both players submit within 30s)
- Turn resolution: speed-based order, apply damage, check faints
- Win/lose detection
- Timeout handling (auto-forfeit)

Key design: reuse `calculateDamage` and `determineTurnOrder` from `packages/server/src/game/battle.ts`. The room stores `PvpPokemonInfo` copies (not references to user data) so PvP doesn't mutate saved user data until the match ends.

The room tracks:
- `actions: Map<string, PvpAction>` - collected actions per turn
- `players` - two entries with party/active pokemon
- `phase` - state machine
- `turnTimer` - 30s timeout per turn

Resolution logic:
1. Both actions collected (or timeout)
2. Switches resolve first (both, then fight)
3. Fight: determine speed order, apply first attacker's damage, check faint, then second attacker
4. If a pokemon faints, that player must switch next turn (forced switch phase)
5. If no alive pokemon remain, that player loses

Reward: winner gets 100 points, loser gets 20 points (participation).

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/pvp/pvp-room.ts
git commit -m "feat(pvp): add PvP battle room state machine"
```

---

### Task 4: Socket.IO Event Handlers

**Files:**
- Create: `packages/server/src/pvp/pvp-socket.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Implement socket event handlers**

Create `packages/server/src/pvp/pvp-socket.ts`:
- `pvp:queue` — verify JWT token, load user, enqueue, attempt match
- `pvp:queue_cancel` — remove from queue
- `pvp:select_pokemon` — set active pokemon for battle start
- `pvp:action` — submit turn action, if both submitted then resolve
- `pvp:forfeit` — forfeit match
- `disconnect` — clean up queue/room, notify opponent

Each socket joins a room (socket.io room) by `roomId` for targeted broadcasts.

- [ ] **Step 2: Attach socket.io to server**

Modify `packages/server/src/index.ts`:

```typescript
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { setupPvpSocket } from "./pvp/pvp-socket.js";

async function main() {
  const config = await getConfig();
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });

  setupPvpSocket(io);

  httpServer.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pvp/pvp-socket.ts packages/server/src/index.ts
git commit -m "feat(pvp): add socket.io handlers and attach to server"
```

---

### Task 5: CLI PvP Command

**Files:**
- Create: `packages/cli/src/commands/pvp.ts`
- Modify: `packages/cli/src/interactive.ts`

- [ ] **Step 1: Implement CLI PvP command**

Create `packages/cli/src/commands/pvp.ts`. Three phases:

**Phase 1: Matchmaking**
- Connect to server via socket.io-client
- Send `pvp:queue` with auth token
- Show "매칭 대기 중..." with spinner/dots
- On `pvp:matched`, show opponent nickname, proceed to phase 2
- ESC to cancel (`pvp:queue_cancel`)

**Phase 2: Pokemon Selection**
- Fetch party from local battle state
- Show party list (reuse party display pattern)
- User selects lead pokemon
- Send `pvp:select_pokemon`
- Wait for `pvp:room_state` with phase="action"

**Phase 3: Battle Loop**
- Display battle scene (similar to encounter.ts but with opponent's pokemon instead of wild)
- Show both pokemon with HP bars side by side
- Menu: 싸운다 / 포켓몬 (no catch/bag/run in PvP)
- Fight: select move, send `pvp:action { type: "fight", moveId }`
- Switch: select pokemon, send `pvp:action { type: "switch", pokemonUid }`
- Show "상대 행동 대기 중..." while waiting
- On `pvp:turn_result`: animate log messages, update HP bars
- If forced switch (pokemon fainted): show party selector
- On finish: show result (승리!/패배...), points earned, disconnect

**Key differences from encounter.ts:**
- No catch/item/run options
- Wait for opponent between turns
- 30s turn timer shown on screen
- Forfeit option (ESC → confirm)

- [ ] **Step 2: Register pvp command in interactive.ts**

Add to HELP_PAGES Game section:
```typescript
{ cmd: "pvp", desc: "PvP 대전" },
```

Add to AUTH_COMMANDS, ALL_COMMANDS, and switch statement:
```typescript
case "pvp":
  await pvpCommand();
  break;
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/pvp.ts packages/cli/src/interactive.ts
git commit -m "feat(pvp): add CLI PvP command with matchmaking and battle UI"
```

---

### Task 6: Point Rewards & Feature Flag

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts` (add reward application)
- Modify: `shared/types.ts` (ensure pvp flag exists)

- [ ] **Step 1: Apply point rewards on match end**

In `pvp-room.ts`, when match ends:
- Winner: `user.points += 100`
- Loser: `user.points += 20`
- Log entry: `{ type: "pvp", result: "win"/"lose", opponent, points, timestamp }`
- Save both users

Note: PvP does NOT affect pokemon HP/PP persistently. The room uses copies. Only points are applied.

- [ ] **Step 2: Enable pvp feature flag**

In config defaults, set `featureFlags.pvp: true`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pvp/pvp-room.ts shared/types.ts packages/server/src/storage/config-store.ts
git commit -m "feat(pvp): add point rewards and enable feature flag"
```

---

### Task 7: Type-check & Integration Test

- [ ] **Step 1: Run type-check**

```bash
npx tsc --noEmit --project packages/server/tsconfig.json
npx tsc --noEmit --project packages/cli/tsconfig.json
```

- [ ] **Step 2: Manual integration test**

1. Start server
2. Open two CLI terminals, login as different users
3. Both run `pvp`
4. Verify: matchmaking pairs them, pokemon selection works, turns resolve, winner gets points

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(pvp): complete PvP battle system with socket.io matchmaking"
```
