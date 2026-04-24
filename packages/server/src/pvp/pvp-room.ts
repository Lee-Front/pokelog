import crypto from "node:crypto";
import { determineTurnOrder, defaultStatStages } from "../game/battle.js";
import { getMoveById } from "../game/data-loader.js";
import { hasVolatile } from "../game/status-conditions.js";
import { checkTurnForm } from "../game/battle-forms.js";
import {
  triggerOnSwitchIn,
  getMoveModifiers, getEffectiveSpeed,
  triggerItemLoss,
  tryActivateParadoxOnFieldChange,
} from "./pvp-abilities.js";
import {
  getItemSpeedMultiplier,
  hasItemFlag,
} from "./pvp-items.js";
import {
  hasFlag,
} from "./pvp-moves.js";
import { applyEndOfTurnEffects } from "./pvp-end-of-turn.js";
import { applySwitch } from "./pvp-switch.js";
import { executeFight } from "./pvp-turn-resolution.js";
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon,
  PvpClientRoomView, PvpRoomConfig, PvpAction,
} from "../../../../shared/pvp-types.js";

export const DEFAULT_CONFIG: PvpRoomConfig = {
  levelCap: 50,
  turnTimeoutMs: 30_000,
  allowItems: false,
};

const rooms = new Map<string, PvpRoomState>();

export function getRoom(roomId: string): PvpRoomState | undefined {
  return rooms.get(roomId);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
  // Drop any queued-but-unresolved actions for this room so the map
  // does not accumulate dead entries across the server's lifetime
  // (each finished match, forfeit, or timeout leaks otherwise).
  pendingActions.delete(roomId);
}

function makePlayer(
  userId: string, nickname: string, party: PvpPokemon[],
  hasKeyStone = false, hasDynamaxBand = false,
): PvpPlayerState {
  return {
    userId, nickname, party,
    activeIndex: 0,
    statStages: defaultStatStages(),
    volatiles: [],
    ready: false,
    actionSubmitted: false,
    hasKeyStone,
    hasDynamaxBand,
    transformationUsed: false,
  };
}

export function createRoom(
  userIdA: string, nickA: string, partyA: PvpPokemon[],
  userIdB: string, nickB: string, partyB: PvpPokemon[],
  isAi = false,
  keysA = { hasKeyStone: false, hasDynamaxBand: false },
  keysB = { hasKeyStone: false, hasDynamaxBand: false },
): PvpRoomState {
  const room: PvpRoomState = {
    roomId: crypto.randomUUID(),
    turn: 0,
    phase: "team_preview",
    playerA: makePlayer(userIdA, nickA, partyA, keysA.hasKeyStone, keysA.hasDynamaxBand),
    playerB: makePlayer(userIdB, nickB, partyB, keysB.hasKeyStone, keysB.hasDynamaxBand),
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

    // ── Primal Reversion (auto at lead select) ──
    for (const p of [room.playerA, room.playerB]) {
      const poke = p.party[p.activeIndex];
      if (poke.primalForm) {
        p.battleForm = poke.primalForm.variantId;
        p.transformationType = "primal";
        // Primal does NOT consume transformationUsed (can still mega evolve another pokemon)
        poke.stats = { ...poke.primalForm.stats };
        const hpRatio = poke.hp / poke.maxHp;
        poke.maxHp = poke.primalForm.maxHp;
        poke.hp = Math.round(hpRatio * poke.maxHp);
        room.log.push(`${p.nickname}의 ${poke.species}: 원시회귀!`);
      }
    }

    // ── Fake Out: leads count as "just switched in" for the first action turn ──
    room.playerA.justSwitchedIn = true;
    room.playerB.justSwitchedIn = true;
    room.playerA.switchedInThisTurn = false;
    room.playerB.switchedInThisTurn = false;

    // ── Ability: onSwitchIn for both leads ──
    triggerOnSwitchIn({ room, player: room.playerA, opponent: room.playerB, pokemon: room.playerA.party[room.playerA.activeIndex] });
    triggerOnSwitchIn({ room, player: room.playerB, opponent: room.playerA, pokemon: room.playerB.party[room.playerB.activeIndex] });
    // ── Paradox: re-check after both leads' abilities resolved (e.g. opponent's drought) ──
    tryActivateParadoxOnFieldChange(room);
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
      transformationType: opp.transformationType,
      gmaxTurnsRemaining: opp.gmaxTurnsRemaining,
      statStages: opp.statStages,
      volatiles: opp.volatiles,
      screens: opp.screens,
      hazards: opp.hazards,
      tailwind: opp.tailwind,
      substitute: opp.substitute,
      teraActive: opp.teraActive,
    },
    weather: room.weather,
    weatherTurns: room.weatherTurns,
    terrain: room.terrain,
    terrainTurns: room.terrainTurns,
    trickRoom: room.trickRoom,
    magicRoom: room.magicRoom,
    wonderRoom: room.wonderRoom,
    lastMoveUsedInBattle: room.lastMoveUsedInBattle,
    turnDeadline: room.turnDeadline,
    log: room.log,
    result: room.result,
    isAiBattle: room.isAiBattle,
    forcedSwitchNeeded: room.forcedSwitchNeeded,
  };
}

// ── Turn Resolution ──

const pendingActions = new Map<string, Map<string, PvpAction>>();

export function submitAction(room: PvpRoomState, userId: string, action: PvpAction): boolean {
  if (room.phase !== "action" && room.phase !== "forced_switch") return false;

  if (action.type === "forfeit") {
    const opp = getOpponent(room, userId);
    room.phase = "finished";
    room.result = { winnerId: opp.userId, loserId: userId, reason: "forfeit" };
    return true;
  }

  // ── Trapping: prevent switching while trapped or ingrained ──
  if (action.type === "switch" && room.phase === "action") {
    const player = getPlayer(room, userId);
    const poke = player.party[player.activeIndex];
    if (player.trapped && poke.heldItem !== "shed-shell") {
      return false;
    }
    if (hasVolatile(player.volatiles, "ingrain")) {
      return false;
    }
  }

  const player = getPlayer(room, userId);
  player.actionSubmitted = true;

  if (!pendingActions.has(room.roomId)) pendingActions.set(room.roomId, new Map());
  pendingActions.get(room.roomId)!.set(userId, action);

  const actions = pendingActions.get(room.roomId)!;

  if (room.phase === "forced_switch" && room.forcedSwitchNeeded) {
    const needA = room.forcedSwitchNeeded.a;
    const needB = room.forcedSwitchNeeded.b;
    const hasA = !needA || actions.has(room.playerA.userId);
    const hasB = !needB || actions.has(room.playerB.userId);
    if (!hasA || !hasB) return false;

    // Apply switches directly (no resolveTurn needed for forced switches)
    if (needA && actions.has(room.playerA.userId)) {
      const actA = actions.get(room.playerA.userId)!;
      if (actA.type === "switch") applySwitch(room, room.playerA, actA.pokemonIndex);
    }
    if (needB && actions.has(room.playerB.userId)) {
      const actB = actions.get(room.playerB.userId)!;
      if (actB.type === "switch") applySwitch(room, room.playerB, actB.pokemonIndex);
    }

    // Promote switchedInThisTurn -> justSwitchedIn so Fake Out works on next turn
    if (room.playerA.switchedInThisTurn) {
      room.playerA.justSwitchedIn = true;
      room.playerA.switchedInThisTurn = false;
    }
    if (room.playerB.switchedInThisTurn) {
      room.playerB.justSwitchedIn = true;
      room.playerB.switchedInThisTurn = false;
    }

    room.forcedSwitchNeeded = undefined;
    room.phase = "action";
    room.turnDeadline = Date.now() + DEFAULT_CONFIG.turnTimeoutMs;
    room.log = [];

    actions.clear();
    room.playerA.actionSubmitted = false;
    room.playerB.actionSubmitted = false;
    return true;
  }

  if (actions.size < 2) return false;

  const actionA = actions.get(room.playerA.userId)!;
  const actionB = actions.get(room.playerB.userId)!;
  resolveTurn(room, actionA, actionB);

  actions.clear();
  room.playerA.actionSubmitted = false;
  room.playerB.actionSubmitted = false;

  return true;
}

function resolveTurn(room: PvpRoomState, actionA: PvpAction, actionB: PvpAction): void {
  room.log = [];

  // ── Expose pending actions on the room so effect hooks can inspect them.
  // Upper Hand (and any future move that branches on opponent intent) reads
  // these to decide whether it should succeed this turn.
  (room as unknown as { _lastActionA?: PvpAction; _lastActionB?: PvpAction })._lastActionA = actionA;
  (room as unknown as { _lastActionA?: PvpAction; _lastActionB?: PvpAction })._lastActionB = actionB;

  // ── Reset lastDamageTaken at start of each turn ──
  room.playerA.lastDamageTaken = undefined;
  room.playerB.lastDamageTaken = undefined;

  // ── Reset wasHitThisTurn at start of each turn (Avalanche / Revenge) ──
  room.playerA.wasHitThisTurn = false;
  room.playerB.wasHitThisTurn = false;

  // ── Reset boostedStatsThisTurn at start of each turn (Alluring Voice) ──
  room.playerA.boostedStatsThisTurn = false;
  room.playerB.boostedStatsThisTurn = false;

  // ── Snapshot heldItem state for unburden detection ──
  const prevHeldA = room.playerA.party[room.playerA.activeIndex].heldItem ?? null;
  const prevHeldB = room.playerB.party[room.playerB.activeIndex].heldItem ?? null;

  // ── Reset switchedInThisTurn at start of turn (applySwitch calls during this turn will set it again) ──
  room.playerA.switchedInThisTurn = false;
  room.playerB.switchedInThisTurn = false;

  // ── Auto-submit charging move (two-turn moves) ──
  if (room.playerA.chargingMove && actionA.type === "fight") {
    actionA = { type: "fight", moveId: room.playerA.chargingMove.moveId };
  }
  if (room.playerB.chargingMove && actionB.type === "fight") {
    actionB = { type: "fight", moveId: room.playerB.chargingMove.moveId };
  }

  // ── Turn-based form changes (Morpeko) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const turnForm = checkTurnForm(poke.species, room.turn, player.battleForm ?? poke.variantId ?? null);
    if (turnForm) {
      player.battleForm = turnForm.newForm;
      room.log.push(`${player.nickname}의 ${poke.species}: ${turnForm.message}`);
    }
  }

  if (actionA.type === "switch") applySwitch(room, room.playerA, actionA.pokemonIndex);
  if (actionB.type === "switch") applySwitch(room, room.playerB, actionB.pokemonIndex);

  // ── Protect handling ──
  let protectedA = false;
  let protectedB = false;

  if (actionA.type === "fight" && hasFlag(actionA.moveId, "isProtect")) {
    const rate = 1 / Math.pow(3, room.playerA.protectCount ?? 0);
    if (Math.random() < rate) {
      protectedA = true;
      room.playerA.protectCount = (room.playerA.protectCount ?? 0) + 1;
      room.log.push(`${room.playerA.nickname}의 ${room.playerA.party[room.playerA.activeIndex].species}: 방어 태세!`);
    } else {
      room.log.push(`${room.playerA.nickname}의 ${room.playerA.party[room.playerA.activeIndex].species}: 방어에 실패했다!`);
      room.playerA.protectCount = 0;
    }
  }
  if (actionB.type === "fight" && hasFlag(actionB.moveId, "isProtect")) {
    const rate = 1 / Math.pow(3, room.playerB.protectCount ?? 0);
    if (Math.random() < rate) {
      protectedB = true;
      room.playerB.protectCount = (room.playerB.protectCount ?? 0) + 1;
      room.log.push(`${room.playerB.nickname}의 ${room.playerB.party[room.playerB.activeIndex].species}: 방어 태세!`);
    } else {
      room.log.push(`${room.playerB.nickname}의 ${room.playerB.party[room.playerB.activeIndex].species}: 방어에 실패했다!`);
      room.playerB.protectCount = 0;
    }
  }

  // Reset protect count if NOT using protect this turn
  if (actionA.type !== "fight" || !hasFlag(actionA.moveId, "isProtect")) {
    room.playerA.protectCount = 0;
  }
  if (actionB.type !== "fight" || !hasFlag(actionB.moveId, "isProtect")) {
    room.playerB.protectCount = 0;
  }

  if (actionA.type === "fight" && actionB.type === "fight") {
    const pokemonA = room.playerA.party[room.playerA.activeIndex];
    const pokemonB = room.playerB.party[room.playerB.activeIndex];
    const moveA = getMoveById(actionA.moveId);
    const moveB = getMoveById(actionB.moveId);

    // ── Ability: speed modifiers (before paralysis) ──
    let speedA = getEffectiveSpeed(pokemonA.stats.speed, pokemonA, room.weather);
    let speedB = getEffectiveSpeed(pokemonB.stats.speed, pokemonB, room.weather);
    // ── Item: speed modifiers ──
    speedA = getItemSpeedMultiplier(speedA, pokemonA);
    speedB = getItemSpeedMultiplier(speedB, pokemonB);
    // ── Paradox Boost on speed ──
    if (room.playerA.paradoxBoost?.stat === "speed") speedA = Math.floor(speedA * 1.5);
    if (room.playerB.paradoxBoost?.stat === "speed") speedB = Math.floor(speedB * 1.5);
    // ── Tailwind: 2x speed ──
    if (room.playerA.tailwind && room.playerA.tailwind > 0) speedA *= 2;
    if (room.playerB.tailwind && room.playerB.tailwind > 0) speedB *= 2;
    if (pokemonA.statusCondition === "paralysis") speedA = Math.floor(speedA * 0.5);
    if (pokemonB.statusCondition === "paralysis") speedB = Math.floor(speedB * 0.5);

    // ── Ability: priority modifiers ──
    const modsA = getMoveModifiers({ room, attacker: room.playerA, atkPoke: pokemonA, move: moveA! });
    const modsB = getMoveModifiers({ room, attacker: room.playerB, atkPoke: pokemonB, move: moveB! });
    let priorityA = (moveA?.priority ?? 0) + modsA.priorityMod;
    let priorityB = (moveB?.priority ?? 0) + modsB.priorityMod;

    // ── Item: Quick Claw (20% chance to gain +1 priority) ──
    if (hasItemFlag(pokemonA, "quickClaw") && Math.random() < 0.2) {
      priorityA += 1;
      room.log.push(`${room.playerA.nickname}의 ${pokemonA.species}: 선제의발톱 발동!`);
    }
    if (hasItemFlag(pokemonB, "quickClaw") && Math.random() < 0.2) {
      priorityB += 1;
      room.log.push(`${room.playerB.nickname}의 ${pokemonB.species}: 선제의발톱 발동!`);
    }

    let order = determineTurnOrder(
      speedA, speedB,
      priorityA, priorityB,
    );

    // ── Trick Room: reverse speed order (only when priorities are equal) ──
    if (room.trickRoom && room.trickRoom > 0 && priorityA === priorityB) {
      order = order === "player" ? "wild" : "player";
    }

    // ── Item: Lagging Tail / Full Incense — force holder to move last within same priority ──
    if (priorityA === priorityB) {
      const aLast = hasItemFlag(pokemonA, "alwaysLast");
      const bLast = hasItemFlag(pokemonB, "alwaysLast");
      if (aLast && !bLast) order = "wild";
      else if (bLast && !aLast) order = "player";
    }

    const [first, second] = order === "player"
      ? [{ player: room.playerA, action: actionA, opp: room.playerB, defProtected: protectedB },
         { player: room.playerB, action: actionB, opp: room.playerA, defProtected: protectedA }]
      : [{ player: room.playerB, action: actionB, opp: room.playerA, defProtected: protectedA },
         { player: room.playerA, action: actionA, opp: room.playerB, defProtected: protectedB }];

    executeFight(room, first.player, first.action.moveId, first.opp, first.action.mega, first.action.gigantamax, first.defProtected, first.action.dynamax, first.action.tera, first.action.ultraBurst);
    if (first.opp.party[first.opp.activeIndex].hp > 0) {
      executeFight(room, second.player, second.action.moveId, second.opp, second.action.mega, second.action.gigantamax, second.defProtected, second.action.dynamax, second.action.tera, second.action.ultraBurst);
    }
  } else if (actionA.type === "fight") {
    executeFight(room, room.playerA, actionA.moveId, room.playerB, actionA.mega, actionA.gigantamax, protectedB, actionA.dynamax, actionA.tera, actionA.ultraBurst);
  } else if (actionB.type === "fight") {
    executeFight(room, room.playerB, actionB.moveId, room.playerA, actionB.mega, actionB.gigantamax, protectedA, actionB.dynamax, actionB.tera, actionB.ultraBurst);
  }

  // ── Pending switch after move (U-Turn, Volt Switch, Flip Turn, Parting Shot, Baton Pass) ──
  if (room.pendingSwitchAfterMove) {
    const needA = room.pendingSwitchAfterMove.a ?? false;
    const needB = room.pendingSwitchAfterMove.b ?? false;
    if (needA || needB) {
      const koA = room.playerA.party[room.playerA.activeIndex].hp <= 0;
      const koB = room.playerB.party[room.playerB.activeIndex].hp <= 0;
      room.phase = "forced_switch";
      room.forcedSwitchNeeded = { a: needA || koA, b: needB || koB };
      room.pendingSwitchAfterMove = undefined;
      room.turn += 1;
      room.turnDeadline = Date.now() + DEFAULT_CONFIG.turnTimeoutMs;
      return;
    }
    room.pendingSwitchAfterMove = undefined;
  }

  applyEndOfTurnEffects(room);

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


  // ── Ability: Unburden — trigger when heldItem went from non-null to null this turn ──
  {
    const curA = room.playerA.party[room.playerA.activeIndex];
    const curB = room.playerB.party[room.playerB.activeIndex];
    if (prevHeldA && !curA.heldItem && curA.hp > 0) {
      triggerItemLoss(room.playerA, curA, room);
    }
    if (prevHeldB && !curB.heldItem && curB.hp > 0) {
      triggerItemLoss(room.playerB, curB, room);
    }
  }

  // ── Promote switchedInThisTurn to justSwitchedIn for next turn. Clear justSwitchedIn
  // for sides that didn't switch this turn (their first action turn is now over).
  room.playerA.justSwitchedIn = room.playerA.switchedInThisTurn ?? false;
  room.playerB.justSwitchedIn = room.playerB.switchedInThisTurn ?? false;
  room.playerA.switchedInThisTurn = false;
  room.playerB.switchedInThisTurn = false;

  // ── Reset roostedThisTurn at end of each turn (flying type returns) ──
  room.playerA.roostedThisTurn = false;
  room.playerB.roostedThisTurn = false;

  if (koA || koB) {
    room.phase = "forced_switch";
    room.forcedSwitchNeeded = { a: koA, b: koB };
  } else {
    room.phase = "action";
    room.forcedSwitchNeeded = undefined;
  }
  room.turn += 1;
  room.turnDeadline = Date.now() + DEFAULT_CONFIG.turnTimeoutMs;
}
