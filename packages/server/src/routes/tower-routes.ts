import { Router, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { startTower, updateTowerRecord, failTower, grantReward } from "../game/tower.js";
import { generateTowerParty } from "../game/tower-ai.js";
import {
  createRoom, selectLead, submitAction, getPlayerView, getRoom, deleteRoom,
} from "../pvp/pvp-room.js";
import { chooseAiAction } from "../pvp/pvp-ai.js";
import { buildPvpPartyFromPokemon } from "../pvp/pvp-party-builder.js";
import type {
  ActiveTowerRun, OwnedPokemon, TowerPartySnapshot, UserData,
} from "../../../../shared/types.js";
import type { PvpAction, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";

export const towerRoutes = Router();
towerRoutes.use(authMiddleware);

const TOWER_AI_USER_ID = "__tower_ai__";

/**
 * Build the user's PvP party from an active tower run. Applies the
 * per-stage HP/PP/status snapshot so canon "no healing between stages"
 * rule is upheld.
 */
function buildUserPartyFromRun(user: UserData, run: ActiveTowerRun): PvpPokemon[] {
  // Preserve the order of the run's partyUids (tower rules: user-chosen
  // lead is always index 0).
  const ordered = run.partyUids
    .map((uid) => user.pokemon.find((p) => p.uid === uid))
    .filter((p): p is OwnedPokemon => p != null);

  // For tower we don't enforce species clause again (already enforced on
  // start); we use a permissive predicate because snapshot may have 0 HP
  // pokemon whose state should still be preserved in the PvP party (they
  // just cannot be the active lead).
  const built = buildPvpPartyFromPokemon(ordered, user.inventory, {
    predicate: () => true,
    enforceSpeciesClause: false,
  });

  // Apply snapshot state
  const snapById = new Map(run.partySnapshot.map((s) => [s.uid, s]));
  for (const pvp of built.party) {
    const snap = snapById.get(pvp.uid);
    if (!snap) continue;
    pvp.hp = Math.min(pvp.maxHp, Math.max(0, snap.currentHp));
    pvp.statusCondition = snap.statusCondition ?? null;
    pvp.sleepTurns = snap.sleepTurns;
    pvp.toxicCounter = snap.toxicCounter;
    for (const move of pvp.moves) {
      const remaining = snap.currentPp[move.id];
      if (typeof remaining === "number") {
        move.pp = Math.max(0, Math.min(move.maxPp, remaining));
      }
    }
  }

  return built.party;
}

/**
 * Convert the AI-generated OwnedPokemon[] into a PvP-ready party. Tower AI
 * parties allow legendaries (which normally aren't in a user inventory),
 * so we use the general builder with species clause disabled (the
 * generator already enforces it).
 */
function buildAiPvpParty(aiParty: OwnedPokemon[]): PvpPokemon[] {
  const built = buildPvpPartyFromPokemon(aiParty, {}, {
    predicate: () => true,
    enforceSpeciesClause: false,
  });
  return built.party;
}

function pickFirstAliveIndex(party: PvpPokemon[]): number {
  const idx = party.findIndex((p) => p.hp > 0);
  return idx >= 0 ? idx : 0;
}

/**
 * Shared helper: after successful startTower / continue, create the PvP
 * room and auto-select leads. Returns the room state.
 */
function createStageRoom(user: UserData, run: ActiveTowerRun): PvpRoomState {
  const userParty = buildUserPartyFromRun(user, run);
  const aiOwned = generateTowerParty(run.stage);
  const aiParty = buildAiPvpParty(aiOwned);

  const room = createRoom(
    user.account.id, user.account.nickname, userParty,
    TOWER_AI_USER_ID, "타워 상대", aiParty,
    true,
  );

  // Auto-select leads (always first alive pokemon — canon battle tower
  // starts with whichever pokemon the player has placed first).
  selectLead(room, user.account.id, pickFirstAliveIndex(userParty));
  selectLead(room, TOWER_AI_USER_ID, pickFirstAliveIndex(aiParty));

  run.roomId = room.roomId;
  return room;
}

function writeSnapshotFromRoom(run: ActiveTowerRun, userParty: PvpPokemon[]): void {
  run.partySnapshot = userParty.map((p) => ({
    uid: p.uid,
    currentHp: p.hp,
    currentPp: Object.fromEntries(p.moves.map((m) => [m.id, m.pp])),
    statusCondition: p.statusCondition ?? null,
    sleepTurns: p.sleepTurns,
    toxicCounter: p.toxicCounter,
  }));
}

towerRoutes.post("/start", async (req: AuthRequest, res: Response) => {
  const { partyUids } = req.body ?? {};
  if (!Array.isArray(partyUids)) {
    res.status(400).json({ error: "partyUids 배열을 입력해주세요" });
    return;
  }

  await withUserLock(req.userId!, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const result = startTower(user, partyUids);
    if (!result.ok || !result.run) {
      res.status(400).json({ error: result.error ?? "타워 시작 실패" });
      return;
    }

    const room = createStageRoom(user, result.run);
    await saveUser(user);

    res.json({
      run: result.run,
      roomState: getPlayerView(room, user.account.id),
    });
  });
});

towerRoutes.get("/status", async (req: AuthRequest, res: Response) => {
  const user = await getUser(req.userId!);
  if (!user) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    return;
  }
  let roomState = null;
  if (user.activeTowerRun?.roomId) {
    const room = getRoom(user.activeTowerRun.roomId);
    if (room) roomState = getPlayerView(room, user.account.id);
  }
  res.json({
    record: user.towerRecord ?? null,
    activeRun: user.activeTowerRun ?? null,
    roomState,
  });
});

towerRoutes.post("/action", async (req: AuthRequest, res: Response) => {
  await withUserLock(req.userId!, async () => {
  const user = await getUser(req.userId!);
  if (!user) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    return;
  }
  const run = user.activeTowerRun;
  if (!run || !run.roomId) {
    res.status(400).json({ error: "진행 중인 타워 배틀이 없습니다" });
    return;
  }
  const room = getRoom(run.roomId);
  if (!room) {
    res.status(400).json({ error: "배틀 방을 찾을 수 없습니다" });
    return;
  }

  const action = req.body?.action as PvpAction | undefined;
  if (!action) {
    res.status(400).json({ error: "action 을 입력해주세요" });
    return;
  }

  submitAction(room, user.account.id, action);

  // Immediately submit AI counter-action for the same phase.
  if (room.phase === "action" && !room.playerB.actionSubmitted) {
    const aiAction = chooseAiAction(room.playerB, room.playerA);
    submitAction(room, TOWER_AI_USER_ID, aiAction);
  }

  // Handle forced_switch phase for AI after the turn resolves.
  while (room.phase === "forced_switch" && room.forcedSwitchNeeded?.b) {
    const aliveIdx = room.playerB.party.findIndex(
      (p, i) => p.hp > 0 && i !== room.playerB.activeIndex,
    );
    if (aliveIdx < 0) break;
    submitAction(room, TOWER_AI_USER_ID, { type: "switch", pokemonIndex: aliveIdx });
    // If user is also required to switch, stop — they must respond via a
    // new POST /action.
    if (room.phase === "forced_switch" && room.forcedSwitchNeeded?.a) break;
  }

  if (room.phase === "finished") {
    const isVictory = room.result?.winnerId === user.account.id;
    if (isVictory) {
      const clearedStage = run.stage;
      const reward = grantReward(user, clearedStage);
      updateTowerRecord(user, clearedStage);
      writeSnapshotFromRoom(run, room.playerA.party);
      run.stage += 1;
      run.roomId = undefined;
      deleteRoom(room.roomId);
      await saveUser(user);
      res.json({
        victory: true,
        clearedStage,
        nextStage: run.stage,
        reward,
        roomState: getPlayerView(room, user.account.id),
      });
      return;
    }
    // Defeat / draw / forfeit
    const finalStreak = run.stage - 1;
    const runRoomId = run.roomId;
    failTower(user);
    if (runRoomId) deleteRoom(runRoomId);
    await saveUser(user);
    res.json({
      victory: false,
      finalStreak,
      roomState: getPlayerView(room, user.account.id),
    });
    return;
  }

  await saveUser(user);
  res.json({ roomState: getPlayerView(room, user.account.id) });
  });
});

towerRoutes.post("/continue", async (req: AuthRequest, res: Response) => {
  await withUserLock(req.userId!, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    const run = user.activeTowerRun;
    if (!run) {
      res.status(400).json({ error: "진행 중인 타워 도전이 없습니다" });
      return;
    }
    if (run.roomId) {
      res.status(400).json({ error: "현재 배틀이 아직 진행 중입니다" });
      return;
    }
    // If every snapshotted pokemon is fainted, reject.
    const anyAlive = run.partySnapshot.some((s) => s.currentHp > 0);
    if (!anyAlive) {
      res.status(400).json({ error: "싸울 수 있는 포켓몬이 없습니다" });
      return;
    }

    const room = createStageRoom(user, run);
    await saveUser(user);
    res.json({
      run,
      roomState: getPlayerView(room, user.account.id),
    });
  });
});

towerRoutes.post("/forfeit", async (req: AuthRequest, res: Response) => {
  await withUserLock(req.userId!, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    const run = user.activeTowerRun;
    if (!run) {
      res.status(400).json({ error: "진행 중인 타워 도전이 없습니다" });
      return;
    }
    if (run.roomId) deleteRoom(run.roomId);
    const finalStreak = run.stage - 1;
    failTower(user);
    await saveUser(user);
    res.json({ forfeited: true, finalStreak });
  });
});

// Used in tests: pass-through snapshot writer (internal helper for
// unused exports). Not re-exported in runtime.
export const _testing = {
  buildUserPartyFromRun,
  buildAiPvpParty,
  writeSnapshotFromRoom,
  TOWER_AI_USER_ID,
  writeSnapshot(run: ActiveTowerRun, party: PvpPokemon[]): void {
    writeSnapshotFromRoom(run, party);
  },
};

// Compatibility export: for explicit use cases the caller may want to
// know the AI user id without referring to internals.
export const TOWER_AI_USER = TOWER_AI_USER_ID;
// export unused type for public API reference
export type { TowerPartySnapshot };
