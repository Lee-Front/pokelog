import crypto from "node:crypto";
import { calculateDamage, determineTurnOrder, defaultStatStages, applyStatChanges, calculateAccuracy, computeStab } from "../game/battle.js";
import { getEffectiveTypes, getBattleTypes } from "../game/pokemon-state.js";
import { getMoveById } from "../game/data-loader.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile, hasVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "../game/status-conditions.js";
import {
  getWeatherDamage, getWeatherTypeModifier,
  tickWeather, getDefaultWeatherTurns,
} from "../game/weather.js";
import {
  checkPostAttackForm, checkHpThresholdForm, checkTurnForm,
  checkWeatherForm, checkMoveForm,
} from "../game/battle-forms.js";
import {
  triggerOnSwitchIn, triggerOnSwitchOut, getAttackMultiplier, getDefenseMultiplier,
  getMoveModifiers, canReceiveStatus, triggerEndOfTurn, getEffectiveSpeed,
  triggerOpponentStatDrop, triggerContactHit, triggerItemLoss, triggerFaint,
  isStatDropPrevented, hasCritPrevention, getDefenseWithMoveMultiplier,
  triggerOnTerastalize, triggerOnStatBoostTrigger,
  tryActivateParadoxOnFieldChange, hasAbilityFlag,
} from "./pvp-abilities.js";
import {
  getItemAttackMultiplier, getItemDefenseMultiplier,
  triggerAfterAttack, triggerAfterBeingHit,
  triggerItemEndOfTurn, getItemSpeedMultiplier,
  checkItemPreventKO, isItemLockMove, hasItemFlag,
} from "./pvp-items.js";
import {
  hasFlag, getFlag, tryFixedDamage, triggerApplyEffect, triggerHeal,
  triggerOnHit, applyPowerMod, getMoveEffects,
  tryCustomResolve, tryBeforeMove,
  type MoveContext,
} from "./pvp-moves.js";
import {
  POWDER_MOVES, HAZARD_MOVES, TERRAIN_NAMES,
  isGrounded, effectiveHeldItem, applyHazardDamage,
} from "./pvp-field-effects.js";
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

  // ── Yawn countdown: put to sleep (checked BEFORE tickVolatiles) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const yawnVol = player.volatiles.find(v => v.id === "yawn");
    if (yawnVol && yawnVol.turnsRemaining <= 1 && !poke.statusCondition) {
      poke.statusCondition = "sleep";
      poke.sleepTurns = rollSleepTurns();
      room.log.push(`${player.nickname}의 ${poke.species}: 잠들어 버렸다!`);
      player.volatiles = player.volatiles.filter(v => v.id !== "yawn");
    }
  }

  // ── End-of-turn effects (status damage, volatile tick) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const opp = player === room.playerA ? room.playerB : room.playerA;
    const oppPoke = opp.party[opp.activeIndex];

    // ── Ability: Magic Guard skips all indirect damage ──
    const hasMagicGuard = poke.abilityId === "magic-guard";

    // ── Toxic: escalating poison damage (poison-heal skips damage, magic-guard skips damage) ──
    if (poke.statusCondition === "poison" && poke.toxicCounter != null && poke.toxicCounter > 0) {
      if (!hasMagicGuard && poke.abilityId !== "poison-heal") {
        const toxicDmg = Math.max(1, Math.floor(poke.maxHp * poke.toxicCounter / 16));
        poke.hp = Math.max(0, poke.hp - toxicDmg);
        room.log.push(`${player.nickname}의 ${poke.species}: 독 데미지 ${toxicDmg}!`);
      }
      poke.toxicCounter += 1;

      // Still apply non-poison end-of-turn (trap, leech seed, etc.)
      if (!hasMagicGuard) {
        const eot = applyEndOfTurn(null, player.volatiles, poke.maxHp, oppPoke.maxHp);
        const healBlocked = hasVolatile(player.volatiles, "heal-block");
        if (eot.damage > 0) poke.hp = Math.max(0, poke.hp - eot.damage);
        if (eot.healing > 0 && !healBlocked) poke.hp = Math.min(poke.maxHp, poke.hp + eot.healing);
        if (eot.opponentHealing > 0 && oppPoke.hp > 0) {
          oppPoke.hp = Math.min(oppPoke.maxHp, oppPoke.hp + eot.opponentHealing);
        }
        for (const msg of eot.messages) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${msg}`);
        }
      }
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    } else {
      // Normal end-of-turn (existing code)
      if (!hasMagicGuard) {
        const eot = applyEndOfTurn(poke.statusCondition, player.volatiles, poke.maxHp, oppPoke.maxHp);
        const healBlocked = hasVolatile(player.volatiles, "heal-block");
        if (eot.damage > 0) {
          poke.hp = Math.max(0, poke.hp - eot.damage);
        }
        if (eot.healing > 0 && !healBlocked) {
          poke.hp = Math.min(poke.maxHp, poke.hp + eot.healing);
        }
        if (eot.opponentHealing > 0 && oppPoke.hp > 0) {
          oppPoke.hp = Math.min(oppPoke.maxHp, oppPoke.hp + eot.opponentHealing);
        }
        for (const msg of eot.messages) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${msg}`);
        }
      }
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Curse end-of-turn damage (1/4 maxHp for cursed pokemon, unless magic-guard) ──
    if (poke.hp > 0 && !hasMagicGuard && hasVolatile(player.volatiles, "curse")) {
      const curseDmg = Math.max(1, Math.floor(poke.maxHp / 4));
      poke.hp = Math.max(0, poke.hp - curseDmg);
      room.log.push(`${player.nickname}의 ${poke.species}: 저주로 ${curseDmg} 데미지!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Binding Band: extra trap damage so the total becomes 1/6 maxHp (base 1/8 + extra 1/24) ──
    if (poke.hp > 0 && !hasMagicGuard && player.trapDamageBoost && hasVolatile(player.volatiles, "trap")) {
      const extra = Math.max(1, Math.floor(poke.maxHp / 24));
      poke.hp = Math.max(0, poke.hp - extra);
      room.log.push(`${player.nickname}의 ${poke.species}: 바인드밴드로 추가 ${extra} 데미지!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Gen 9: Salt Cure end-of-turn damage (1/8, doubled to 1/4 on Steel/Water) ──
    if (poke.hp > 0 && !hasMagicGuard && hasVolatile(player.volatiles, "salt-cure")) {
      const types = getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
      const denom = types.includes("steel") || types.includes("water") ? 4 : 8;
      const saltDmg = Math.max(1, Math.floor(poke.maxHp / denom));
      poke.hp = Math.max(0, poke.hp - saltDmg);
      room.log.push(`${player.nickname}의 ${poke.species}: 소금절임 데미지 ${saltDmg}!`);
      if (poke.hp <= 0) {
        room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
      }
    }

    // ── Gen 9: Syrup Bomb — speed drops each turn while the volatile ticks ──
    if (poke.hp > 0 && hasVolatile(player.volatiles, "syrup-bomb")) {
      player.statStages = applyStatChanges(player.statStages, [{ stat: "speed", change: -1 }]);
      room.log.push(`${player.nickname}의 ${poke.species}: 시럽폭탄으로 스피드가 내려갔다!`);
    }

    // Tick volatiles
    player.volatiles = tickVolatiles(player.volatiles);

    // ── Clear trap-related side state once the trap volatile is gone ──
    if (!hasVolatile(player.volatiles, "trap") && player.trapDamageBoost) {
      player.trapDamageBoost = false;
    }

    // ── Ability: end-of-turn effects ──
    if (poke.hp > 0) {
      triggerEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }

    // ── Item: end-of-turn effects (leftovers, flame-orb, etc.) ──
    if (poke.hp > 0) {
      triggerItemEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }
  }

  // ── Disable / Encore volatile expiry cleanup ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.disabledMoveId && !hasVolatile(player.volatiles, "disable")) {
      player.disabledMoveId = undefined;
    }
    if (player.encoreMoveId && !hasVolatile(player.volatiles, "encore")) {
      player.encoreMoveId = undefined;
    }
  }

  // ── Weather end-of-turn ──
  if (room.weather) {
    for (const player of [room.playerA, room.playerB]) {
      const poke = player.party[player.activeIndex];
      if (poke.hp <= 0) continue;
      // ── Ability: Magic Guard skips weather damage ──
      if (poke.abilityId === "magic-guard") continue;
      // ── Item: Safety Goggles skips weather damage ──
      if (poke.heldItem === "safety-goggles") continue;
      // ── Item: Utility Umbrella blocks weather effects ──
      if (poke.heldItem === "utility-umbrella") continue;
      const types = getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
      const weatherDmg = getWeatherDamage(room.weather, types, poke.maxHp);
      if (weatherDmg > 0) {
        poke.hp = Math.max(0, poke.hp - weatherDmg);
        room.log.push(`${player.nickname}의 ${poke.species}: 날씨로 ${weatherDmg} 데미지!`);
        if (poke.hp <= 0) {
          room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
        }
      }
    }
    const tick = tickWeather(room.weather, room.weatherTurns);
    room.weather = tick.weather;
    room.weatherTurns = tick.turns;
    if (tick.expired) {
      room.log.push("날씨가 사라졌다!");
    }
  }

  // ── Grassy Terrain: heal grounded pokemon each turn ──
  if (room.terrain === "grassy") {
    for (const player of [room.playerA, room.playerB]) {
      const poke = player.party[player.activeIndex];
      if (poke.hp > 0 && isGrounded(poke, player)) {
        const heal = Math.max(1, Math.floor(poke.maxHp / 16));
        poke.hp = Math.min(poke.maxHp, poke.hp + heal);
        room.log.push(`${player.nickname}의 ${poke.species}: 그래스필드로 HP 회복!`);
      }
    }
  }

  // ── Terrain tick ──
  if (room.terrain && room.terrainTurns != null) {
    room.terrainTurns -= 1;
    if (room.terrainTurns <= 0) {
      room.log.push(`${TERRAIN_NAMES[room.terrain]}이(가) 사라졌다!`);
      room.terrain = undefined;
      room.terrainTurns = undefined;
    }
  }

  // ── Weather-based form changes (Castform, Cherrim) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const weatherForm = checkWeatherForm(poke.species, room.weather, player.battleForm ?? poke.variantId ?? null);
    if (weatherForm) {
      player.battleForm = weatherForm.newForm;
      room.log.push(`${player.nickname}의 ${poke.species}: ${weatherForm.message}`);
    }
  }

  // ── Gigantamax / Dynamax countdown ──
  for (const player of [room.playerA, room.playerB]) {
    if ((player.transformationType === "gigantamax" || player.transformationType === "dynamax") && player.gmaxTurnsRemaining != null) {
      player.gmaxTurnsRemaining -= 1;
      if (player.gmaxTurnsRemaining <= 0) {
        const poke = player.party[player.activeIndex];
        const wasDynamax = player.transformationType === "dynamax";
        if (player.preTransformMaxHp != null && poke.hp > 0) {
          const hpRatio = poke.hp / poke.maxHp;
          poke.maxHp = player.preTransformMaxHp;
          poke.hp = Math.max(1, Math.floor(hpRatio * poke.maxHp));
        } else if (player.preTransformMaxHp != null && poke.hp <= 0) {
          poke.maxHp = player.preTransformMaxHp; // don't resurrect
        }
        player.battleForm = undefined;
        player.transformationType = null;
        player.gmaxTurnsRemaining = undefined;
        player.preTransformMaxHp = undefined;
        if (poke.hp > 0) {
          room.log.push(`${player.nickname}의 ${poke.species}: ${wasDynamax ? "다이맥스" : "기가맥스"}가 풀렸다!`);
        }
      }
    }
  }

  // ── Clear flinch volatiles at end of turn ──
  room.playerA.volatiles = room.playerA.volatiles.filter(v => v.id !== "flinch");
  room.playerB.volatiles = room.playerB.volatiles.filter(v => v.id !== "flinch");

  // ── Perish Song countdown ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const perishVol = player.volatiles.find(v => v.id === "perish-song");
    if (perishVol) {
      if (perishVol.turnsRemaining <= 1) {
        poke.hp = 0;
        room.log.push(`${player.nickname}의 ${poke.species}: 멸망의 카운트가 0이 되었다!`);
        player.volatiles = player.volatiles.filter(v => v.id !== "perish-song");
      } else {
        room.log.push(`${player.nickname}의 ${poke.species}: 멸망의 카운트 ${perishVol.turnsRemaining - 1}!`);
      }
    }
  }

  // ── Screen tick (Reflect, Light Screen, Aurora Veil) ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.screens) {
      if (player.screens.reflect) {
        player.screens.reflect--;
        if (player.screens.reflect <= 0) {
          delete player.screens.reflect;
          room.log.push(`${player.nickname}: 리플렉터가 사라졌다!`);
        }
      }
      if (player.screens.lightScreen) {
        player.screens.lightScreen--;
        if (player.screens.lightScreen <= 0) {
          delete player.screens.lightScreen;
          room.log.push(`${player.nickname}: 빛의장막이 사라졌다!`);
        }
      }
      if (player.screens.auroraVeil) {
        player.screens.auroraVeil--;
        if (player.screens.auroraVeil <= 0) {
          delete player.screens.auroraVeil;
          room.log.push(`${player.nickname}: 오로라베일이 사라졌다!`);
        }
      }
    }
  }

  // ── Trick Room tick ──
  if (room.trickRoom && room.trickRoom > 0) {
    room.trickRoom--;
    if (room.trickRoom <= 0) {
      room.trickRoom = undefined;
      room.log.push("트릭룸이 해제됐다!");
    }
  }

  // ── Magic Room tick ──
  if (room.magicRoom && room.magicRoom > 0) {
    room.magicRoom--;
    if (room.magicRoom <= 0) {
      room.magicRoom = undefined;
      room.log.push("매직룸이 해제됐다!");
    }
  }

  // ── Wonder Room tick ──
  if (room.wonderRoom && room.wonderRoom > 0) {
    room.wonderRoom--;
    if (room.wonderRoom <= 0) {
      room.wonderRoom = undefined;
      room.log.push("원더룸이 해제됐다!");
    }
  }

  // ── Tailwind tick ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.tailwind && player.tailwind > 0) {
      player.tailwind--;
      if (player.tailwind <= 0) {
        player.tailwind = undefined;
        room.log.push(`${player.nickname}: 순풍이 그쳤다!`);
      }
    }
  }

  // ── Wish countdown (heal 2 turns after set) ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.wish) {
      player.wish.turns--;
      if (player.wish.turns <= 0) {
        const targetPoke = player.party[player.wish.targetIndex];
        if (targetPoke && targetPoke.hp > 0) {
          if (hasVolatile(player.volatiles, "heal-block")) {
            room.log.push(`${player.nickname}의 ${targetPoke.species}: 회복봉인으로 회복할 수 없다!`);
          } else {
            targetPoke.hp = Math.min(targetPoke.maxHp, targetPoke.hp + player.wish.healAmount);
            room.log.push(`${player.nickname}의 ${targetPoke.species}: 바라기로 HP를 회복했다!`);
          }
        }
        player.wish = undefined;
      }
    }
  }

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

function applySwitch(room: PvpRoomState, player: PvpPlayerState, index: number): void {
  if (index < 0 || index >= player.party.length) return;
  if (player.party[index].hp <= 0) return;

  // ── Ability: onSwitchOut for old pokemon ──
  const oldPoke = player.party[player.activeIndex];
  if (oldPoke.hp > 0) {
    triggerOnSwitchOut({ player, pokemon: oldPoke });
  }

  // ── Transform: restore original species/stats/moves on switch out ──
  if (player.preTransformState) {
    oldPoke.species = player.preTransformState.species;
    oldPoke.variantId = player.preTransformState.variantId ?? null;
    oldPoke.stats = player.preTransformState.stats;
    oldPoke.moves = player.preTransformState.moves;
    oldPoke.abilityId = player.preTransformState.abilityId ?? null;
    player.preTransformState = undefined;
  }

  // Reset toxic counter on the pokemon being switched out
  if (oldPoke.toxicCounter) oldPoke.toxicCounter = undefined;

  // Reset choice lock on switch
  player.lockedMoveId = undefined;

  // Reset trapping on switch
  player.trapped = false;

  // Reset new mechanic state on switch
  player.substitute = undefined;
  player.chargingMove = undefined;
  player.disabledMoveId = undefined;
  player.encoreMoveId = undefined;
  player.lastMoveUsed = undefined;
  player.lastDamageTaken = undefined;
  player.trapDamageBoost = false;
  player.metronomeCount = 0;
  player.movesUsed = [];
  player.wasHitThisTurn = false;
  // Paradox boost does NOT persist across switches (canon behavior).
  player.paradoxBoost = undefined;

  player.activeIndex = index;

  // ── Baton Pass: keep stat stages and volatiles ──
  const side = room.playerA === player ? "a" : "b";
  const isBaton = room.batonPass?.[side];
  if (!isBaton) {
    player.statStages = defaultStatStages();
    player.volatiles = [];
  } else {
    // Baton Pass: KEEP stat stages and volatiles, clear the flag
    if (room.batonPass) delete room.batonPass[side];
  }
  player.battleForm = undefined;

  // Mega form persists when switching back in
  const poke = player.party[index];
  if (poke.megaForm && player.transformationUsed && player.transformationType === "mega") {
    player.battleForm = poke.megaForm.variantId;
  }

  // ── Fake Out: mark that a switch-in happened this turn. At end of turn,
  // this promotes to justSwitchedIn=true, which Fake Out checks on the NEXT turn.
  player.switchedInThisTurn = true;

  room.log.push(`${player.nickname}: ${player.party[index].species}(으)로 교체!`);

  // ── Ability: onSwitchIn for new pokemon ──
  const opponent = player === room.playerA ? room.playerB : room.playerA;
  triggerOnSwitchIn({ room, player, opponent, pokemon: poke });
  // ── Paradox: re-check if weather/terrain was just changed by the new lead ──
  tryActivateParadoxOnFieldChange(room);

  // ── Entry hazard damage on switch-in ──
  if (poke.hp > 0) {
    applyHazardDamage(room, player, poke);
  }
}

function executeFight(
  room: PvpRoomState,
  attacker: PvpPlayerState,
  moveId: string,
  defender: PvpPlayerState,
  mega?: boolean,
  gigantamax?: boolean,
  defenderProtected?: boolean,
  dynamax?: boolean,
  tera?: boolean,
  ultraBurst?: boolean,
): void {
  const atkPoke = attacker.party[attacker.activeIndex];
  const defPoke = defender.party[defender.activeIndex];
  let moveData = getMoveById(moveId);
  if (!moveData) return;

  // ── Battle Clauses ──
  // OHKO Clause: block one-hit KO moves
  if (hasFlag(moveId, "isOHKO")) {
    room.log.push(`${moveData.name}: 일격기 조항으로 사용할 수 없다!`);
    return;
  }
  // Evasion Clause: block evasion-boosting moves
  if (hasFlag(moveId, "isEvasion")) {
    room.log.push(`${moveData.name}: 회피 조항으로 사용할 수 없다!`);
    return;
  }

  // ── Psychic Terrain: block priority moves targeting grounded defenders ──
  if (room.terrain === "psychic" && (moveData.priority ?? 0) > 0 && isGrounded(defPoke, defender)) {
    room.log.push(`사이코필드가 선제공격 기술을 막았다!`);
    return;
  }

  // ── Armor Tail (Farigiraf) / Queenly Majesty / Dazzling: block priority moves ──
  if ((moveData.priority ?? 0) > 0 && defPoke.abilityId
      && hasAbilityFlag(defPoke.abilityId, "blocksPriorityMoves")) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 선제공격을 막았다!`);
    return;
  }

  // ── Good as Gold (Gholdengo): block opposing status moves ──
  if (moveData.category === "status" && defPoke.abilityId
      && hasAbilityFlag(defPoke.abilityId, "blocksStatusMoves")
      // Self-targeting status moves (target === "user") still work.
      && moveData.target !== "user") {
    room.log.push(`${defender.nickname}의 ${defPoke.species}: 황금몸! 상태기술이 막혔다!`);
    return;
  }

  // ── Item: Safety Goggles blocks powder-type moves ──
  if (POWDER_MOVES.has(moveId) && hasItemFlag(defPoke, "powderImmune")) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}: 방진고글로 가루 기술을 막았다!`);
    attacker.lastMoveUsed = moveId;
    return;
  }

  // ── Mega Evolution ──
  if (mega && !attacker.transformationUsed) {
    const poke = attacker.party[attacker.activeIndex];
    if (poke.megaForm) {
      const needsKeyStone = poke.species !== "rayquaza";
      if (!needsKeyStone || attacker.hasKeyStone) {
        attacker.battleForm = poke.megaForm.variantId;
        attacker.transformationType = "mega";
        attacker.transformationUsed = true;
        poke.stats = { ...poke.megaForm.stats };
        const hpRatio = poke.hp / poke.maxHp;
        poke.maxHp = poke.megaForm.maxHp;
        poke.hp = Math.round(hpRatio * poke.maxHp);
        room.log.push(`${attacker.nickname}의 ${poke.species}: 메가진화!`);
      }
    }
  }

  // ── Gigantamax ──
  if (gigantamax && !attacker.transformationUsed && attacker.hasDynamaxBand) {
    const poke = attacker.party[attacker.activeIndex];
    if (poke.gmaxForm) {
      attacker.battleForm = poke.gmaxForm.variantId;
      attacker.transformationType = "gigantamax";
      attacker.transformationUsed = true;
      attacker.gmaxTurnsRemaining = 3;
      attacker.preTransformMaxHp = poke.maxHp;
      poke.stats = { ...poke.gmaxForm.stats };
      const hpRatio = poke.hp / poke.maxHp;
      poke.maxHp = poke.gmaxForm.maxHp;
      poke.hp = Math.ceil(hpRatio * poke.maxHp);
      room.log.push(`${attacker.nickname}의 ${poke.species}: 기가맥스!`);
    }
  }

  // ── Dynamax (regular) ──
  if (dynamax && !attacker.transformationUsed && attacker.hasDynamaxBand) {
    const poke = attacker.party[attacker.activeIndex];
    attacker.transformationType = "dynamax";
    attacker.transformationUsed = true;
    attacker.gmaxTurnsRemaining = 3;
    attacker.preTransformMaxHp = poke.maxHp;
    const hpRatio = poke.hp / poke.maxHp;
    poke.maxHp = Math.ceil(poke.maxHp * 2);
    poke.hp = Math.ceil(hpRatio * poke.maxHp);
    room.log.push(`${attacker.nickname}의 ${poke.species}: 다이맥스!`);
  }

  // ── Ultra Burst ──
  // Necrozma Dusk Mane / Dawn Wings holding Ultra Necrozium Z transforms into
  // Ultra Necrozma mid-battle. Consumes the same transformation slot as
  // mega/gmax/dynamax/tera (once per battle, mutually exclusive).
  if (ultraBurst && !attacker.transformationUsed && atkPoke.ultraForm) {
    attacker.battleForm = atkPoke.ultraForm.variantId;
    attacker.transformationType = "ultra-burst";
    attacker.transformationUsed = true;
    atkPoke.stats = { ...atkPoke.ultraForm.stats };
    const hpRatio = atkPoke.hp / atkPoke.maxHp;
    atkPoke.maxHp = atkPoke.ultraForm.maxHp;
    atkPoke.hp = Math.round(hpRatio * atkPoke.maxHp);
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 울트라버스트!`);
  }

  // ── Terastallize ──
  // Consumes the shared `transformationUsed` slot (mutually exclusive with
  // mega/gmax/dynamax). Tera persists until the holder faints — it is NOT
  // reset on switch-out. The effective types become [teraType] via getBattleTypes.
  if (tera && !attacker.transformationUsed && atkPoke.teraType) {
    attacker.teraActive = true;
    attacker.transformationType = "tera";
    attacker.transformationUsed = true;
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 테라스탈! (${atkPoke.teraType}타입)`);
    // Ability hook: Embody Aspect (Ogerpon)
    triggerOnTerastalize({ attacker, atkPoke, room });
  }

  // ── Flinch check (applied by faster attacker, consumed here) ──
  if (hasVolatile(attacker.volatiles, "flinch")) {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 풀이 죽어 움직일 수 없다!`);
    attacker.volatiles = attacker.volatiles.filter(v => v.id !== "flinch");
    return;
  }

  // ── Infatuation: 50% chance to be unable to act ──
  if (hasVolatile(attacker.volatiles, "infatuation")) {
    if (Math.random() < 0.5) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 헤롱헤롱으로 움직일 수 없다!`);
      attacker.lastMoveUsed = moveId;
      return;
    }
  }

  // ── Disable: can't use disabled move ──
  if (attacker.disabledMoveId && moveId === attacker.disabledMoveId && hasVolatile(attacker.volatiles, "disable")) {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveId}은(는) 사용할 수 없다!`);
    return;
  }
  // ── Encore: forced to use encored move ──
  if (attacker.encoreMoveId && hasVolatile(attacker.volatiles, "encore")) {
    moveId = attacker.encoreMoveId;
    const encoreMoveData = getMoveById(moveId);
    if (encoreMoveData) moveData = encoreMoveData;
  }
  // ── Taunt: can't use status moves ──
  if (hasVolatile(attacker.volatiles, "taunt") && moveData.category === "status") {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 도발 때문에 ${moveData.name}을(를) 사용할 수 없다!`);
    return;
  }
  // ── Torment: can't use same move as last turn ──
  if (hasVolatile(attacker.volatiles, "torment") && attacker.lastMoveUsed === moveId) {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 트집 때문에 같은 기술을 쓸 수 없다!`);
    return;
  }

  // ── Defender protected check ──
  if (defenderProtected) {
    // ── Gen 9: Hyper Drill bypasses Protect ──
    if (hasFlag(moveId, "ignoresProtect")) {
      // Continue past the protect check — the move lands normally.
    } else {
      room.log.push(`${defender.nickname}의 ${defPoke.species}: 공격을 막았다!`);
      // ── Gen 9: Burning Bulwark — contact attacker gets burned ──
      if (hasVolatile(defender.volatiles, "burning-bulwark")
          && hasFlag(moveId, "contact")
          && atkPoke.heldItem !== "protective-pads"
          && atkPoke.abilityId !== "long-reach") {
        const atkTypes = getEffectiveTypes(atkPoke.species, atkPoke.variantId, attacker.battleForm);
        const burnImmune = atkTypes.includes("fire");
        if (!atkPoke.statusCondition && !burnImmune && canReceiveStatus(atkPoke, "burn")) {
          atkPoke.statusCondition = "burn";
          room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 불꽃방벽에 데어 화상 상태가 되었다!`);
        }
      }
      // ── Gen 9: Silk Trap — contact attacker's speed drops ──
      if (hasVolatile(defender.volatiles, "silk-trap")
          && hasFlag(moveId, "contact")
          && atkPoke.heldItem !== "protective-pads"
          && atkPoke.abilityId !== "long-reach") {
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "speed", change: -1 }]);
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 거미집에 걸려 스피드가 내려갔다!`);
      }
      return;
    }
  }

  // ── Choice Lock: enforce locked move (applied before struggle check) ──
  if (attacker.lockedMoveId) {
    moveId = attacker.lockedMoveId;
    const lockedMoveData = getMoveById(moveId);
    if (lockedMoveData) moveData = lockedMoveData;
  }

  // Copycat, Mimic, Metronome migrated to registry customResolve.
  // Copycat/Metronome use the { redirectTo } return form to swap to another move,
  // which is handled by the registry-dispatch block below.

  // ── Sleep Talk / Snore: bypass sleep block ──
  let bypassSleep = false;
  if (atkPoke.statusCondition === "sleep") {
    if (moveId === "snore") {
      bypassSleep = true;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 코골기!`);
    } else if (moveId === "sleep-talk") {
      const others = atkPoke.moves.filter((m) => m.id !== "sleep-talk" && m.pp > 0);
      if (others.length > 0) {
        const picked = others[Math.floor(Math.random() * others.length)];
        const pickedData = getMoveById(picked.id);
        if (pickedData) {
          moveId = picked.id;
          moveData = pickedData;
          bypassSleep = true;
          room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 잠꼬대! ${pickedData.name}을(를) 사용!`);
        }
      } else {
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 잠꼬대 실패!`);
        attacker.lastMoveUsed = "sleep-talk";
        return;
      }
    }
  }

  // ── Pre-attack status check ──
  // Decrement sleep turns first (unless sleep-talk/snore bypass)
  if (!bypassSleep && atkPoke.statusCondition === "sleep" && atkPoke.sleepTurns != null) {
    atkPoke.sleepTurns -= 1;
    if (atkPoke.sleepTurns <= 0) {
      atkPoke.statusCondition = null;
      atkPoke.sleepTurns = undefined;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 잠에서 깨어났다!`);
    }
  }

  if (!bypassSleep) {
    const preCheck = checkPreAttack(
      atkPoke.statusCondition, attacker.volatiles, atkPoke.stats, atkPoke.level,
    );
    if (preCheck.statusCleared) {
      atkPoke.statusCondition = null;
    }
    if (preCheck.message) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${preCheck.message}`);
    }
    if (preCheck.selfDamage) {
      atkPoke.hp = Math.max(0, atkPoke.hp - preCheck.selfDamage);
    }
    if (!preCheck.canAct) return;
  }

  // ── Two-Turn Moves: charge phase ──
  if (hasFlag(moveId, "twoTurn") && !attacker.chargingMove) {
    // Solar Beam skips charge in sun
    const skipChargeSun = moveId === "solar-beam" && room.weather === "sun";
    // Power Herb: consume to skip charge
    const powerHerb = atkPoke.heldItem === "power-herb";
    if (!skipChargeSun && !powerHerb) {
      attacker.chargingMove = { moveId, turn: 1 };
      if (hasFlag(moveId, "semiInvulnerable")) {
        attacker.volatiles = addVolatile(attacker.volatiles, "semi-invulnerable", 1);
      }
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveData.name} 준비 중!`);
      attacker.lastMoveUsed = moveId;
      return; // Don't execute yet
    }
    if (powerHerb) {
      atkPoke.heldItem = null;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 파워허브로 바로 발동!`);
    }
  }
  // Two-Turn Moves: execute phase (turn 2)
  if (attacker.chargingMove && attacker.chargingMove.moveId === moveId) {
    attacker.chargingMove = undefined;
    attacker.volatiles = attacker.volatiles.filter(v => v.id !== "semi-invulnerable");
    // Continue with normal execution
  }

  // ── Registry: try customResolve first (fully handles the move). ──
  // Registered customResolve moves either set their own state and return true,
  // or return { redirectTo } to swap execution to a different move id
  // (used by copycat, metronome). In that case we continue the normal flow
  // below with the swapped move data — we do NOT re-run customResolve on the
  // redirected move (this matches the prior hardcoded behavior and prevents
  // infinite recursion if a redirect target also has a customResolve).
  {
    const registryCtx: MoveContext = {
      room, attacker, defender, atkPoke, defPoke,
      move: moveData, moveId,
    };
    const custom = tryCustomResolve(registryCtx);
    if (custom === true) {
      attacker.lastMoveUsed = moveId;
      room.lastMoveUsedInBattle = moveId;
      return;
    }
    if (custom && typeof custom === "object" && "redirectTo" in custom) {
      const newMoveId = custom.redirectTo;
      const newMoveData = getMoveById(newMoveId);
      if (!newMoveData) {
        // Redirect target doesn't exist — treat as a failed move.
        attacker.lastMoveUsed = moveId;
        room.lastMoveUsedInBattle = moveId;
        return;
      }
      moveId = newMoveId;
      moveData = newMoveData;
      // Fall through to continue execution with the swapped move.
      // Skip the beforeMove gate since the original move's gate shouldn't
      // apply to the redirected move.
    } else if (custom && typeof custom === "object" && "overrideMove" in custom) {
      // customResolve requested partial move overrides (Tera Blast, Ivy Cudgel, etc.)
      // Merge into moveData; meta is shallow-merged on top to preserve unrelated fields.
      const override = custom.overrideMove;
      moveData = { ...moveData, ...override };
      if (override.meta) {
        moveData.meta = { ...(moveData.meta ?? {}), ...override.meta };
      }
      // Keep the beforeMove gate running — override doesn't imply a new move identity.
      const gate = tryBeforeMove({ ...registryCtx, move: moveData });
      if (gate?.cancel) {
        if (gate.message) room.log.push(gate.message);
        attacker.lastMoveUsed = moveId;
        return;
      }
    } else {
      const gate = tryBeforeMove(registryCtx);
      if (gate?.cancel) {
        if (gate.message) room.log.push(gate.message);
        attacker.lastMoveUsed = moveId;
        return;
      }
    }
  }

  // ── Magic Room: disable all items (toggle) ──
  if (moveId === "magic-room") {
    if (room.magicRoom && room.magicRoom > 0) {
      room.magicRoom = undefined;
      room.log.push("매직룸이 해제됐다!");
    } else {
      room.magicRoom = 5;
      room.log.push("매직룸! 도구 효과가 사라졌다!");
    }
    attacker.lastMoveUsed = moveId;
    room.lastMoveUsedInBattle = moveId;
    return;
  }

  // ── Wonder Room: swap defense/spDefense (toggle) ──
  if (moveId === "wonder-room") {
    if (room.wonderRoom && room.wonderRoom > 0) {
      room.wonderRoom = undefined;
      room.log.push("원더룸이 해제됐다!");
    } else {
      room.wonderRoom = 5;
      room.log.push("원더룸! 방어가 교환됐다!");
    }
    attacker.lastMoveUsed = moveId;
    room.lastMoveUsedInBattle = moveId;
    return;
  }

  // pain-split / endeavor / attract migrated to registry customResolve.

  // ── Magic Coat / Magic Bounce: reflect status moves back to attacker ──
  // (Checked BEFORE the move's effect is applied. MVP: block the move and log reflect.)
  if (moveData.category === "status" && defPoke.hp > 0) {
    const defReflects = hasVolatile(defender.volatiles, "magic-coat")
      || defPoke.abilityId === "magic-bounce";
    // Only reflect moves that target the opponent. Self-targeting status moves pass through.
    const targetsOpponent = moveData.target === "selected-pokemon" || moveData.target === "all-opponents"
      || moveData.target === "all-other-pokemon";
    if (defReflects && targetsOpponent) {
      const source = defPoke.abilityId === "magic-bounce" ? "매직미러" : "매직코트";
      room.log.push(`${defender.nickname}의 ${defPoke.species}: ${source}! 기술을 되받았다!`);
      attacker.lastMoveUsed = moveId;
      room.lastMoveUsedInBattle = moveId;
      return;
    }
  }

  // ── Trick / Switcheroo: swap held items (delegated to registry onHit) ──
  if (moveId === "trick" || moveId === "switcheroo") {
    triggerOnHit({ room, attacker, defender, atkPoke, defPoke, move: moveData, moveId });
    attacker.lastMoveUsed = moveId;
    room.lastMoveUsedInBattle = moveId;
    return;
  }

  // curse / fake-out migrated to registry (customResolve / beforeMove).

  // ── Unified applyEffect dispatcher ──
  // Catches all registered status moves (power 0, no customResolve) whose only
  // runtime logic is an applyEffect callback. Replaces what were previously
  // individual moveId === "..." dispatch blocks for: destiny-bond, magic-coat,
  // ingrain, foresight/odor-sleuth, heal-block, embargo, leech-seed,
  // safeguard/mist/lucky-chant/endure, focus-energy, perish-song.
  //
  // Exclusions (still handled elsewhere):
  //   - taunt/disable/encore/torment: run at the post-damage stage (line ~2137)
  //     so they fire alongside lastMoveUsed updates in the expected order.
  //   - yawn: applied via the ailment pipeline, not a direct dispatcher.
  {
    const effects = getMoveEffects(moveId);
    const deferredApplyEffects = new Set([
      "taunt", "disable", "encore", "torment", "yawn",
    ]);
    if (
      effects?.applyEffect
      && moveData.power === 0
      && !effects.customResolve
      && !deferredApplyEffects.has(moveId)
    ) {
      triggerApplyEffect({ room, attacker, defender, atkPoke, defPoke, move: moveData, moveId });
      attacker.lastMoveUsed = moveId;
      room.lastMoveUsedInBattle = moveId;
      return;
    }
  }

  // wish migrated to registry customResolve.

  // ── Healing moves (registry-driven: heal hook) ──
  if (getMoveEffects(moveId)?.heal) {
    if (hasVolatile(attacker.volatiles, "heal-block")) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 회복봉인으로 회복할 수 없다!`);
      attacker.lastMoveUsed = moveId;
      return;
    }
    triggerHeal({ room, attacker, defender, atkPoke, defPoke, move: moveData, moveId });
    attacker.lastMoveUsed = moveId;
    return;
  }

  // belly-drum migrated to registry customResolve.
  // focus-energy handled by the unified applyEffect dispatcher above.

  // Transform migrated to registry customResolve.

  // ── Execute move (with Struggle fallback) ──
  const move = atkPoke.moves.find((m) => m.id === moveId);
  const allPpDepleted = atkPoke.moves.every((m) => m.pp <= 0);
  let isStruggle = false;

  if (!move || move.pp <= 0 || allPpDepleted) {
    isStruggle = true;
  } else {
    // ── Ability: Pressure doubles PP cost ──
    const ppCost = defPoke.abilityId === "pressure" ? 2 : 1;
    move.pp = Math.max(0, move.pp - ppCost);
  }

  let effectiveMoveData = isStruggle ? {
    id: "struggle", name: "발버둥", type: "typeless", category: "physical" as const,
    power: 50, accuracy: 100, pp: 1, description: "",
  } : moveData;

  // ── Metronome (item): track consecutive same-move usage for the attacker's power boost ──
  // Update BEFORE damage calc so onAttack item hook sees the correct count.
  if (!isStruggle && atkPoke.heldItem === "metronome") {
    if (attacker.lastMoveUsed === moveId) {
      attacker.metronomeCount = Math.min(5, (attacker.metronomeCount ?? 0) + 1);
    } else {
      attacker.metronomeCount = 0;
    }
  } else if (!isStruggle) {
    // Not holding metronome: keep count at 0 so switching to the item later starts clean.
    attacker.metronomeCount = 0;
  }

  // ── Last Resort: record non-Struggle moves as "used" for the active pokemon ──
  if (!isStruggle) {
    if (!attacker.movesUsed) attacker.movesUsed = [];
    if (!attacker.movesUsed.includes(moveId)) attacker.movesUsed.push(moveId);
  }

  // ── Ability: -ate type conversion (applied before accuracy + damage calc) ──
  if (!isStruggle) {
    let moveTypeOverride: string | undefined;
    let applyAteBoost = false;
    if (atkPoke.abilityId === "pixilate" && effectiveMoveData.type === "normal") {
      moveTypeOverride = "fairy"; applyAteBoost = true;
    } else if (atkPoke.abilityId === "refrigerate" && effectiveMoveData.type === "normal") {
      moveTypeOverride = "ice"; applyAteBoost = true;
    } else if (atkPoke.abilityId === "aerilate" && effectiveMoveData.type === "normal") {
      moveTypeOverride = "flying"; applyAteBoost = true;
    } else if (atkPoke.abilityId === "galvanize" && effectiveMoveData.type === "normal") {
      moveTypeOverride = "electric"; applyAteBoost = true;
    } else if (atkPoke.abilityId === "normalize") {
      moveTypeOverride = "normal";
    }
    if (moveTypeOverride) {
      const newPower = applyAteBoost ? Math.floor(effectiveMoveData.power * 1.2) : effectiveMoveData.power;
      effectiveMoveData = { ...effectiveMoveData, type: moveTypeOverride, power: newPower };
    }
  }

  // ── Registry modifyPower hook (Knock Off's 1.5x boost when defender holds an item) ──
  if (!isStruggle) {
    const powerCtx: MoveContext = {
      room, attacker, defender, atkPoke, defPoke,
      move: effectiveMoveData, moveId,
    };
    const modifiedPower = applyPowerMod(powerCtx);
    if (modifiedPower !== effectiveMoveData.power) {
      effectiveMoveData = { ...effectiveMoveData, power: Math.floor(modifiedPower) };
    }
  }

  // ── Ability / Item: effective crit rate modifiers ──
  if (!isStruggle) {
    let bonusCrit = 0;
    if (atkPoke.abilityId === "super-luck") bonusCrit += 1;
    if (atkPoke.heldItem === "scope-lens" || atkPoke.heldItem === "razor-claw") bonusCrit += 1;
    if (hasVolatile(attacker.volatiles, "focus-energy")) bonusCrit += 2;
    // ── Ability: Merciless — always crit vs poisoned targets ──
    if (atkPoke.abilityId === "merciless" && defPoke.statusCondition === "poison") {
      bonusCrit = Math.max(bonusCrit, 999);
    }
    if (bonusCrit > 0) {
      const baseCrit = effectiveMoveData.meta?.critRate ?? 0;
      effectiveMoveData = {
        ...effectiveMoveData,
        meta: { ...(effectiveMoveData.meta ?? {}), critRate: baseCrit + bonusCrit },
      };
    }
  }

  // ── Semi-invulnerable: most moves miss against semi-invulnerable defender ──
  if (hasVolatile(defender.volatiles, "semi-invulnerable")) {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! 빗나갔다!`);
    attacker.lastMoveUsed = moveId;
    return;
  }

  // ── Accuracy check with stat stages (before damage calc) ──
  // No Guard: always hits
  const noGuardActive = atkPoke.abilityId === "no-guard" || defPoke.abilityId === "no-guard";
  if (!noGuardActive && effectiveMoveData.accuracy > 0 && effectiveMoveData.accuracy <= 100) {
    let accMult = 1;
    // Ability: compound-eyes (accuracy * 1.3)
    if (atkPoke.abilityId === "compound-eyes") accMult *= 1.3;
    // Item: wide-lens (+10%)
    if (atkPoke.heldItem === "wide-lens") accMult *= 1.1;
    const effectiveAcc = calculateAccuracy(
      effectiveMoveData.accuracy * accMult,
      attacker.statStages.accuracy,
      defender.statStages.evasion,
    );
    if (Math.random() * 100 >= effectiveAcc) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! 빗나갔다!`);
      // ── Item: Blunder Policy on miss ──
      if (atkPoke.heldItem === "blunder-policy") {
        atkPoke.heldItem = null;
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "speed", change: 2 }]);
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 실수보험! 스피드가 크게 올랐다!`);
      }
      attacker.lastMoveUsed = moveId;
      return;
    }
  }
  // Override accuracy for calculateDamage to prevent double-check
  const moveForCalc = { ...effectiveMoveData, accuracy: 999 };

  // ── Fixed damage moves ──
  const fixedCtx: MoveContext = {
    room, attacker, defender, atkPoke, defPoke,
    move: effectiveMoveData, moveId,
  };
  const fixedDmg = isStruggle ? null : tryFixedDamage(fixedCtx);
  let isFixedDamage = false;
  let totalDamage = 0;
  let hitsMade = 0;

  if (fixedDmg != null && !isStruggle) {
    isFixedDamage = true;
    let damage = fixedDmg;
    // ── Substitute absorption for fixed damage ──
    if (defender.substitute && defender.substitute > 0) {
      defender.substitute -= damage;
      if (defender.substitute <= 0) {
        defender.substitute = undefined;
        room.log.push(`${defender.nickname}의 대타 인형이 부서졌다!`);
      } else {
        room.log.push(`대타 인형이 대신 맞았다!`);
      }
      totalDamage = damage;
      hitsMade = 1;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! ${damage} 데미지!`);
    } else {
      // ── Endure: fixed-damage moves also leave defender at 1 HP on a would-be KO ──
      if (hasVolatile(defender.volatiles, "endure") && damage >= defPoke.hp && defPoke.hp > 0) {
        damage = defPoke.hp - 1;
        room.log.push(`${defender.nickname}의 ${defPoke.species}: 버티기로 버텼다!`);
      }
      defPoke.hp = Math.max(0, defPoke.hp - damage);
      totalDamage = damage;
      hitsMade = 1;
      // ── Record lastDamageTaken for Counter / Mirror Coat ──
      if (damage > 0) {
        defender.lastDamageTaken = { amount: damage, category: effectiveMoveData.category as "physical" | "special" };
        defender.wasHitThisTurn = true;
      }
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! ${damage} 데미지!`);
      if (defPoke.hp <= 0) {
        // ── Destiny Bond: if defender faints with destiny-bond, attacker also faints ──
        if (hasVolatile(defender.volatiles, "destiny-bond")) {
          atkPoke.hp = 0;
          room.log.push(`${atkPoke.species}: 운명의끈에 의해 쓰러졌다!`);
        }
        room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
      }
    }
  }

  if (!isFixedDamage) {
    // ── Burn halves physical attack (guts negates) ──
    let effectiveAtkStats = atkPoke.stats;
    if (atkPoke.statusCondition === "burn" && moveForCalc.category === "physical" && atkPoke.abilityId !== "guts") {
      effectiveAtkStats = { ...atkPoke.stats, attack: Math.floor(atkPoke.stats.attack * 0.5) };
    }

    // ── Paradox Boost (Protosynthesis / Quark Drive) on attacker's offensive stat ──
    if (attacker.paradoxBoost && moveForCalc.category !== "status") {
      const stat = attacker.paradoxBoost.stat;
      // Only apply to the offensive stat actually used by this move.
      const appliesOffensively =
        (stat === "attack" && moveForCalc.category === "physical") ||
        (stat === "spAttack" && moveForCalc.category === "special");
      if (appliesOffensively) {
        const mult = 1.3;
        effectiveAtkStats = {
          ...effectiveAtkStats,
          [stat]: Math.floor(effectiveAtkStats[stat] * mult),
        };
      }
    }

    // ── Wonder Room: swap defender's defense and spDefense ──
    let effectiveDefStats = defPoke.stats;
    if (room.wonderRoom && room.wonderRoom > 0) {
      effectiveDefStats = {
        ...defPoke.stats,
        defense: defPoke.stats.spDefense,
        spDefense: defPoke.stats.defense,
      };
    }

    // ── Paradox Boost on defender's defensive stat ──
    if (defender.paradoxBoost) {
      const stat = defender.paradoxBoost.stat;
      const appliesDefensively =
        (stat === "defense" && moveForCalc.category === "physical") ||
        (stat === "spDefense" && moveForCalc.category === "special");
      if (appliesDefensively) {
        const mult = 1.3;
        effectiveDefStats = {
          ...effectiveDefStats,
          [stat]: Math.floor(effectiveDefStats[stat] * mult),
        };
      }
    }

    // ── Sandstorm: Rock-types get 1.5x SpDef when attacked by a special move ──
    if (room.weather === "sandstorm" && moveForCalc.category === "special") {
      const defTypes = getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm);
      if (defTypes.includes("rock")) {
        effectiveDefStats = { ...effectiveDefStats, spDefense: Math.floor(effectiveDefStats.spDefense * 1.5) };
      }
    }

    const weatherMod = room.weather ? getWeatherTypeModifier(room.weather, moveForCalc.type) : 1;
    const attackerTypes = getBattleTypes(atkPoke, attacker);
    let defenderTypes = getBattleTypes(defPoke, defender);

    // ── Scrappy / Mind's Eye / Foresight / Odor Sleuth: ignore ghost immunity to normal/fighting ──
    const scrappyActive = (atkPoke.abilityId === "scrappy" || atkPoke.abilityId === "minds-eye")
      && (moveForCalc.type === "normal" || moveForCalc.type === "fighting");
    const foresightActive = hasVolatile(defender.volatiles, "foresight");
    if ((scrappyActive || foresightActive) && defenderTypes.includes("ghost")) {
      defenderTypes = defenderTypes.filter((t) => t !== "ghost");
      if (defenderTypes.length === 0) defenderTypes = ["normal"];
    }

    // ── Roost: flying-type pokemon lose flying type for the turn (ground moves hit normally) ──
    if (defender.roostedThisTurn && defenderTypes.includes("flying")) {
      defenderTypes = defenderTypes.filter((t) => t !== "flying");
      if (defenderTypes.length === 0) defenderTypes = ["normal"];
    }

    // ── Multi-hit loop ──
    const minHits = effectiveMoveData.meta?.minHits ?? 1;
    const maxHits = effectiveMoveData.meta?.maxHits ?? 1;
    let hitCount: number;
    if (atkPoke.abilityId === "skill-link" && maxHits > 1) {
      hitCount = maxHits;
    } else if (atkPoke.heldItem === "loaded-dice" && maxHits > 1) {
      // Loaded Dice: 4 or 5 hits (capped by maxHits)
      hitCount = Math.min(maxHits, 4 + Math.floor(Math.random() * 2));
      hitCount = Math.max(hitCount, minHits);
    } else {
      hitCount = minHits === maxHits ? minHits : minHits + Math.floor(Math.random() * (maxHits - minHits + 1));
    }

    // ── Ability: build damage mod context ──
    const dmgCtx = { room, attacker, defender, atkPoke, defPoke, move: moveForCalc, damage: 0 };
    const atkMul = getAttackMultiplier(dmgCtx);
    const defMul = getDefenseMultiplier(dmgCtx);
    const defWithMoveMul = getDefenseWithMoveMultiplier(dmgCtx);
    // ── Item: attack/defense multipliers (disabled by Magic Room / Embargo) ──
    const atkItemsActive = effectiveHeldItem(atkPoke, attacker, room) !== null;
    const defItemsActive = effectiveHeldItem(defPoke, defender, room) !== null;
    const itemAtkMul = atkItemsActive ? getItemAttackMultiplier(dmgCtx) : 1;
    const itemDefMul = defItemsActive ? getItemDefenseMultiplier(dmgCtx) : 1;

    // ── Ability: Unaware ignores opponent stat stages ──
    const atkStages = defPoke.abilityId === "unaware" ? defaultStatStages() : attacker.statStages;
    const defStages = atkPoke.abilityId === "unaware" ? defaultStatStages() : defender.statStages;

    // ── Lucky Chant: defender cannot be crit this turn ──
    const luckyChant = hasVolatile(defender.volatiles, "lucky-chant");

    // ── STAB (Tera-aware, computed externally) ──
    // Uses the attacker's originalTypes + teraActive/teraType + Adaptability to
    // derive the STAB multiplier. Passed as the final parameter to calculateDamage
    // (which no longer computes STAB internally).
    const stabMul = computeStab(
      moveForCalc.type,
      atkPoke.originalTypes ?? getEffectiveTypes(atkPoke.species, atkPoke.variantId, attacker.battleForm),
      attacker.teraActive ?? false,
      atkPoke.teraType ?? null,
      atkPoke.abilityId === "adaptability",
    );

    let lastResult = { damage: 0, missed: false, effectiveness: 1, message: "", critical: false };
    for (let hit = 0; hit < hitCount; hit++) {
      if (defPoke.hp <= 0) break;
      const result = calculateDamage(
        atkPoke.level, effectiveAtkStats, effectiveDefStats, moveForCalc,
        attackerTypes, defenderTypes,
        atkStages, defStages,
        weatherMod,
        stabMul,
      );
      // ── Lucky Chant: downgrade any crit result and undo the 1.5x damage multiplier ──
      if (luckyChant && result.critical) {
        result.critical = false;
        result.damage = Math.floor(result.damage / 1.5);
      }
      // ── Ability: Battle Armor / Shell Armor prevent crits ──
      if (hasCritPrevention(defPoke) && result.critical) {
        result.critical = false;
        result.damage = Math.floor(result.damage / 1.5);
      }
      lastResult = result;
      if (!result.missed) {
        // ── Ability: apply attack/defense multipliers ──
        let finalDamage = Math.floor(result.damage * atkMul);
        if (defMul === -1) {
          // Sturdy-like: if this would KO from full HP, survive at 1 HP
          if (defPoke.hp === defPoke.maxHp && finalDamage >= defPoke.hp) {
            finalDamage = defPoke.hp - 1;
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 버텼다!`);
          }
        } else {
          finalDamage = Math.floor(finalDamage * defMul);
        }
        // ── Ability: onDefenseWithMove (Fluffy, Disguise) ──
        finalDamage = Math.floor(finalDamage * defWithMoveMul);
        // ── Item: apply attack/defense multipliers ──
        finalDamage = Math.floor(finalDamage * itemAtkMul);
        finalDamage = Math.floor(finalDamage * itemDefMul);
        // ── Ability: Sniper boosts crit damage by 1.5x (1.5 -> 2.25 total) ──
        if (result.critical && atkPoke.abilityId === "sniper") {
          finalDamage = Math.floor(finalDamage * 1.5);
        }
        // ── Stellar Tera (simplified) ──
        // Terapagos-Stellar attacking while Terastallized: first use of each move type
        // gets +1.2x (tracked in atkPoke.stellarTypesUsed). Vs a Terastallized target,
        // the attack additionally gets a flat 2.0x super-effective multiplier.
        // Applied here on the per-hit damage; tracking updates on the first hit only.
        if (attacker.teraActive && atkPoke.species === "terapagos-stellar") {
          const moveType = moveForCalc.type;
          const used = atkPoke.stellarTypesUsed ?? [];
          if (!used.includes(moveType)) {
            finalDamage = Math.floor(finalDamage * 1.2);
            if (hit === 0) {
              atkPoke.stellarTypesUsed = [...used, moveType];
            }
          }
          if (defender.teraActive) {
            finalDamage = Math.floor(finalDamage * 2);
          }
        }
        // ── Terrain damage modifiers ──
        if (room.terrain) {
          let terrainMod = 1;
          if (isGrounded(atkPoke, attacker)) {
            if (room.terrain === "electric" && moveForCalc.type === "electric") terrainMod = 1.3;
            if (room.terrain === "grassy" && moveForCalc.type === "grass") terrainMod = 1.3;
            if (room.terrain === "psychic" && moveForCalc.type === "psychic") terrainMod = 1.3;
          }
          if (room.terrain === "misty" && isGrounded(defPoke, defender) && moveForCalc.type === "dragon") {
            terrainMod *= 0.5;
          }
          if (terrainMod !== 1) finalDamage = Math.floor(finalDamage * terrainMod);
        }
        // ── Screen damage reduction (critical hits ignore screens) ──
        if (!result.critical && defender.screens) {
          const hasReflect = moveForCalc.category === "physical" && (defender.screens.reflect ?? 0) > 0;
          const hasLightScreen = moveForCalc.category === "special" && (defender.screens.lightScreen ?? 0) > 0;
          const hasAuroraVeil = (defender.screens.auroraVeil ?? 0) > 0;
          if (hasReflect || hasLightScreen || hasAuroraVeil) {
            finalDamage = Math.floor(finalDamage * 0.5);
          }
        }
        // ── Substitute absorption ──
        if (defender.substitute && defender.substitute > 0) {
          defender.substitute -= finalDamage;
          if (defender.substitute <= 0) {
            defender.substitute = undefined;
            room.log.push(`${defender.nickname}의 대타 인형이 부서졌다!`);
          } else {
            room.log.push(`대타 인형이 대신 맞았다!`);
          }
          totalDamage += finalDamage;
          hitsMade++;
          if (result.critical) room.log.push("급소에 맞았다!");
          continue; // skip actual HP damage and status application
        }
        // ── Item: prevent KO check (focus-sash etc.) ──
        if (finalDamage >= defPoke.hp && defPoke.hp > 0) {
          const prevented = checkItemPreventKO({ room, defender, defPoke, damage: finalDamage });
          if (prevented) {
            finalDamage = defPoke.hp - 1;
            defPoke.heldItem = null; // consume item
          }
        }
        // ── Endure: if damage would KO, leave defender at 1 HP ──
        if (hasVolatile(defender.volatiles, "endure") && finalDamage >= defPoke.hp && defPoke.hp > 0) {
          finalDamage = defPoke.hp - 1;
          room.log.push(`${defender.nickname}의 ${defPoke.species}: 버티기로 버텼다!`);
        }
        defPoke.hp = Math.max(0, defPoke.hp - finalDamage);
        // ── Record lastDamageTaken for Counter / Mirror Coat ──
        if (finalDamage > 0) {
          defender.lastDamageTaken = { amount: finalDamage, category: effectiveMoveData.category as "physical" | "special" };
          defender.wasHitThisTurn = true;
        }
        totalDamage += finalDamage;
        hitsMade++;
        if (result.critical) room.log.push("급소에 맞았다!");
      }
    }

    if (hitCount > 1) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveForCalc.name}! ${hitsMade}번 맞았다! 총 ${totalDamage} 데미지!`);
    } else {
      room.log.push(
        `${attacker.nickname}의 ${atkPoke.species}: ${moveForCalc.name}! ` +
        (lastResult.missed ? "빗나갔다!" : `${totalDamage} 데미지!`),
      );
    }
    if (lastResult.message) room.log.push(lastResult.message);

    // ── Struggle recoil ──
    if (isStruggle && hitsMade > 0) {
      const recoil = Math.max(1, Math.floor(atkPoke.maxHp / 4));
      atkPoke.hp = Math.max(0, atkPoke.hp - recoil);
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 반동으로 ${recoil} 데미지!`);
    }

    // ── Item: after-attack effects (life-orb recoil, shell-bell) ──
    if (hitsMade > 0 && totalDamage > 0) {
      const afterCtx = { room, attacker, defender, atkPoke, defPoke, move: effectiveMoveData, damage: totalDamage };
      triggerAfterAttack(afterCtx);
      triggerAfterBeingHit(afterCtx);
    }

    // ── Gen 9: Rage Fist hit counter ──
    // Increment when the holder takes damage from an attacking move (once per use).
    if (hitsMade > 0 && totalDamage > 0 && defPoke.hp > 0) {
      defPoke.rageFistHits = (defPoke.rageFistHits ?? 0) + 1;
    }

    // ── Batch 3: Ability stat-boost when being hit ──
    if (hitsMade > 0 && totalDamage > 0 && defPoke.hp > 0) {
      if (defPoke.abilityId === "justified" && effectiveMoveData.type === "dark") {
        defender.statStages = applyStatChanges(defender.statStages, [{ stat: "attack", change: 1 }]);
        room.log.push(`${defPoke.species}의 정의의마음! 공격이 올랐다!`);
      }
      if (defPoke.abilityId === "rattled" && ["dark", "bug", "ghost"].includes(effectiveMoveData.type)) {
        defender.statStages = applyStatChanges(defender.statStages, [{ stat: "speed", change: 1 }]);
        room.log.push(`${defPoke.species}의 도망태세! 스피드가 올랐다!`);
      }
      if (defPoke.abilityId === "stamina") {
        defender.statStages = applyStatChanges(defender.statStages, [{ stat: "defense", change: 1 }]);
        room.log.push(`${defPoke.species}의 지구력! 방어가 올랐다!`);
      }
      if (defPoke.abilityId === "water-compaction" && effectiveMoveData.type === "water") {
        defender.statStages = applyStatChanges(defender.statStages, [{ stat: "defense", change: 2 }]);
        room.log.push(`${defPoke.species}의 수분! 방어가 크게 올랐다!`);
      }
    }

    // ── Batch 3: Ability KO-triggered stat boost ──
    if (hitsMade > 0 && defPoke.hp <= 0 && atkPoke.hp > 0) {
      if (atkPoke.abilityId === "moxie") {
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "attack", change: 1 }]);
        room.log.push(`${atkPoke.species}의 자기과신! 공격이 올랐다!`);
      } else if (atkPoke.abilityId === "beast-boost") {
        const stats = atkPoke.stats;
        let highest: "attack" | "defense" | "spAttack" | "spDefense" | "speed" = "attack";
        let maxVal = stats.attack;
        for (const s of ["defense", "spAttack", "spDefense", "speed"] as const) {
          if (stats[s] > maxVal) { maxVal = stats[s]; highest = s; }
        }
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: highest, change: 1 }]);
        room.log.push(`${atkPoke.species}의 비스트부스트! 가장 높은 능력이 올랐다!`);
      } else if (atkPoke.abilityId === "soul-heart") {
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "spAttack", change: 1 }]);
        room.log.push(`${atkPoke.species}의 소울하트! 특수공격이 올랐다!`);
      } else if (atkPoke.abilityId === "as-one-glastrier") {
        // Combines Unnerve (passive) + Chilling Neigh (attack on KO).
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "attack", change: 1 }]);
        room.log.push(`${atkPoke.species}의 혼일체! 공격이 올랐다!`);
      } else if (atkPoke.abilityId === "as-one-spectrier") {
        // Combines Unnerve (passive) + Grim Neigh (spAttack on KO).
        attacker.statStages = applyStatChanges(attacker.statStages, [{ stat: "spAttack", change: 1 }]);
        room.log.push(`${atkPoke.species}의 혼일체! 특수공격이 올랐다!`);
      }
    }
  }

  // ── Registry onHit hook (Knock Off item drop, Brick Break / Psychic Fangs screen break, etc.) ──
  if (!isStruggle && hitsMade > 0 && defPoke.hp > 0) {
    triggerOnHit({
      room, attacker, defender, atkPoke, defPoke,
      move: effectiveMoveData, moveId, damage: totalDamage,
    });
  }

  // ── Flinch application (faster attacker flinches slower defender) ──
  // Covert Cloak blocks secondary effects; Serene Grace doubles secondary chances.
  if (!isStruggle && hitsMade > 0 && defPoke.hp > 0 && moveData.meta?.flinchChance
      && defPoke.heldItem !== "covert-cloak") {
    const graceMul = atkPoke.abilityId === "serene-grace" ? 2 : 1;
    const chance = Math.min(100, moveData.meta.flinchChance * graceMul);
    if (Math.random() * 100 < chance) {
      if (canReceiveStatus(defPoke, "flinch")) {
        defender.volatiles = addVolatile(defender.volatiles, "flinch", 1);
      }
    }
  }

  // ── Contact ability effects (after physical hit on defender) ──
  // Protective Pads: skip all contact-triggered ability effects on attacker
  // Long Reach: attacker's moves are non-contact, so contact abilities don't trigger
  // Contact is inferred as physical (until individual moves are tagged with the `contact` flag).
  const effectiveContact = moveData.category === "physical" && atkPoke.abilityId !== "long-reach";
  if (hitsMade > 0 && defPoke.hp > 0 && atkPoke.hp > 0
      && atkPoke.heldItem !== "protective-pads" && effectiveContact) {
    if (defPoke.abilityId === "static" && !atkPoke.statusCondition && Math.random() < 0.3) {
      if (canReceiveStatus(atkPoke, "paralysis")) {
        atkPoke.statusCondition = "paralysis";
        room.log.push(`${defPoke.species}의 정전기! ${atkPoke.species}이(가) 마비됐다!`);
      }
    }
    if (defPoke.abilityId === "poison-point" && !atkPoke.statusCondition && Math.random() < 0.3) {
      // Steel/poison types are immune to poison (a pokemon with poison-point cannot also have
      // corrosion, so no bypass is available here).
      const atkTypes = getEffectiveTypes(atkPoke.species, atkPoke.variantId, attacker.battleForm);
      const atkPoisonImmune = atkTypes.includes("steel") || atkTypes.includes("poison");
      if (!atkPoisonImmune && canReceiveStatus(atkPoke, "poison")) {
        atkPoke.statusCondition = "poison";
        room.log.push(`${defPoke.species}의 독가시! ${atkPoke.species}이(가) 독에 걸렸다!`);
      }
    }
    if (defPoke.abilityId === "flame-body" && !atkPoke.statusCondition && Math.random() < 0.3) {
      if (canReceiveStatus(atkPoke, "burn")) {
        atkPoke.statusCondition = "burn";
        room.log.push(`${defPoke.species}의 불꽃몸! ${atkPoke.species}이(가) 화상을 입었다!`);
      }
    }
    if (defPoke.abilityId === "rough-skin" || defPoke.abilityId === "iron-barbs") {
      const contactDmg = Math.max(1, Math.floor(atkPoke.maxHp / 8));
      atkPoke.hp = Math.max(0, atkPoke.hp - contactDmg);
      room.log.push(`${defPoke.species}의 ${defPoke.abilityId === "rough-skin" ? "까칠한피부" : "철가시"}! ${atkPoke.species}에게 ${contactDmg} 데미지!`);
    }
    // ── Ability: onContactHit hook (cursed-body etc.) ──
    triggerContactHit({ attacker, defender, atkPoke, defPoke, move: moveData, room });
    // ── Ability: Lingering Aroma (Slither Wing): contact attackers gain lingering-aroma ──
    if (defPoke.abilityId === "lingering-aroma" && atkPoke.abilityId !== "lingering-aroma") {
      atkPoke.abilityId = "lingering-aroma";
      room.log.push(`${defPoke.species}의 악취! ${atkPoke.species}의 특성이 악취로 변했다!`);
    }
    // ── Ability: Poison Touch (attacker poisons defender on contact hit) ──
    if (atkPoke.abilityId === "poison-touch" && !defPoke.statusCondition && Math.random() < 0.3) {
      // Steel/poison types are immune to poison (a pokemon with poison-touch cannot also have
      // corrosion, so no bypass is available here).
      const defTypesPT = getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm);
      const defPoisonImmunePT = defTypesPT.includes("steel") || defTypesPT.includes("poison");
      if (!defPoisonImmunePT && canReceiveStatus(defPoke, "poison")) {
        defPoke.statusCondition = "poison";
        room.log.push(`${atkPoke.species}의 독수! ${defPoke.species}이(가) 독에 걸렸다!`);
      }
    }
  }

  // ── Ability: Toxic Debris (Glimmora) — physical hit on holder sets toxic-spikes on attacker's side ──
  if (hitsMade > 0 && totalDamage > 0
      && defPoke.abilityId === "toxic-debris"
      && moveData.category === "physical") {
    if (!attacker.hazards) attacker.hazards = {};
    if ((attacker.hazards.toxicSpikes ?? 0) < 2) {
      attacker.hazards.toxicSpikes = (attacker.hazards.toxicSpikes ?? 0) + 1;
      room.log.push(`${defPoke.species}의 톡소채! ${attacker.nickname}의 발 밑에 독압정이 깔렸다!`);
    }
  }

  // ── Ability: Toxic Chain (Pecharunt) — 30% to badly poison defender on damaging hit ──
  if (hitsMade > 0 && totalDamage > 0 && defPoke.hp > 0
      && atkPoke.abilityId === "toxic-chain"
      && !defPoke.statusCondition
      && moveData.power > 0
      && Math.random() < 0.3) {
    const defTypes = getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm);
    const poisonImmune = defTypes.includes("steel") || defTypes.includes("poison");
    if (!poisonImmune && canReceiveStatus(defPoke, "poison")) {
      defPoke.statusCondition = "poison";
      defPoke.toxicCounter = 1;
      room.log.push(`${atkPoke.species}의 독사슬! ${defPoke.species}이(가) 맹독에 걸렸다!`);
    }
  }

  // ── Ability: Weak Armor — physical hit triggers DEF -1 / SPD +2 ──
  if (hitsMade > 0 && totalDamage > 0 && defPoke.hp > 0
      && defPoke.abilityId === "weak-armor"
      && moveData.category === "physical") {
    defender.statStages = applyStatChanges(defender.statStages, [
      { stat: "defense", change: -1 },
      { stat: "speed", change: 2 },
    ]);
    room.log.push(`${defPoke.species}의 약한갑옷! 방어가 내려가고 스피드가 크게 올랐다!`);
  }

  // ── Ability: Magician — attacker steals defender's item after a damaging hit ──
  if (hitsMade > 0 && totalDamage > 0 && !isStruggle
      && atkPoke.abilityId === "magician"
      && !atkPoke.heldItem && defPoke.heldItem
      && moveData.power > 0) {
    atkPoke.heldItem = defPoke.heldItem;
    const lostItem = defPoke.heldItem;
    defPoke.heldItem = null;
    room.log.push(`${atkPoke.species}의 매지션! ${defPoke.species}의 도구(${lostItem})를 훔쳤다!`);
    triggerItemLoss(defender, defPoke, room);
  }

  // ── Ability: Aftermath — if defender KO'd by a physical (contact) hit, attacker takes 1/4 maxHp ──
  if (hitsMade > 0 && defPoke.hp <= 0 && atkPoke.hp > 0
      && defPoke.abilityId === "aftermath"
      && moveData.category === "physical" && atkPoke.abilityId !== "long-reach"
      && atkPoke.heldItem !== "protective-pads") {
    triggerFaint({ attacker, atkPoke, fainter: defPoke, room, fromContact: true });
  }

  // ── Choice Lock: lock into move after using it ──
  if (!isStruggle && isItemLockMove(atkPoke)) {
    attacker.lockedMoveId = moveId;
  }

  // ── Self-KO moves ──
  if (hasFlag(moveId, "selfKO") && !isStruggle) {
    atkPoke.hp = 0;
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}이(가) 쓰러졌다!`);
  }

  // ── Ailment application (only on hit, not for struggle) ──
  if (!isStruggle && hitsMade > 0 && defPoke.hp > 0) {
    const ailment = moveData.meta?.ailment;
    const baseChance = moveData.meta?.ailmentChance ?? 0;
    // Covert Cloak blocks secondary ailments that are only a chance (not guaranteed by the move).
    const covertBlocks = defPoke.heldItem === "covert-cloak" && baseChance > 0 && baseChance < 100;
    // Serene Grace doubles ailment chance (capped at 100).
    const graceMul = atkPoke.abilityId === "serene-grace" ? 2 : 1;
    const chance = Math.min(100, baseChance * graceMul);
    if (ailment && ailment !== "none" && !covertBlocks) {
      // ── Misty Terrain: block all primary status on grounded defenders ──
      const mistyBlocked = room.terrain === "misty" && isGrounded(defPoke, defender) && !isVolatileAilment(ailment);
      // ── Safeguard: blocks primary (non-volatile) status conditions on the defender's side ──
      const safeguardBlocked = !isVolatileAilment(ailment) && hasVolatile(defender.volatiles, "safeguard");
      // ── Ability: status guard check for primary (non-volatile) ailments ──
      const primaryBlocked = !isVolatileAilment(ailment) && !canReceiveStatus(defPoke, ailment);
      // ── Type immunity: steel/poison types are immune to poison (unless attacker has Corrosion) ──
      let poisonTypeBlocked = false;
      if ((ailment === "poison" || ailment === "toxic") && atkPoke.abilityId !== "corrosion") {
        const defTypes = getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm);
        if (defTypes.includes("steel") || defTypes.includes("poison")) {
          poisonTypeBlocked = true;
        }
      }
      if (mistyBlocked) {
        room.log.push(`미스트필드가 상태이상을 막았다!`);
      } else if (safeguardBlocked) {
        room.log.push(`몸지킴이 상태이상을 막았다!`);
      } else if (primaryBlocked) {
        room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 상태이상을 막았다!`);
      } else if (poisonTypeBlocked) {
        room.log.push(`${defender.nickname}의 ${defPoke.species}: 독이 통하지 않았다!`);
      } else {
        const primary = rollAilment(ailment, chance, defPoke.statusCondition);
        if (primary) {
          // ── Ability: check canReceiveStatus for the rolled status too ──
          if (!canReceiveStatus(defPoke, primary)) {
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 상태이상을 막았다!`);
          } else if (room.terrain === "electric" && isGrounded(defPoke, defender) && primary === "sleep") {
            // Electric Terrain: prevents sleep on grounded pokemon
            room.log.push(`일렉트릭필드가 잠듦을 막았다!`);
          } else if (primary === "sleep" && defender.party.some((p, i) => i !== defender.activeIndex && p.statusCondition === "sleep")) {
            // Sleep Clause: only one opposing pokemon asleep at a time
            room.log.push(`잠듦 조항! 이미 잠든 포켓몬이 있다!`);
          } else {
            defPoke.statusCondition = primary;
            if (primary === "sleep") defPoke.sleepTurns = rollSleepTurns();
            if (primary === "poison" && moveData.id === "toxic") {
              defPoke.toxicCounter = 1;
            }
            const statusNames: Record<string, string> = {
              poison: "독", burn: "화상", paralysis: "마비", sleep: "잠듦", freeze: "얼음",
            };
            room.log.push(`${defender.nickname}의 ${defPoke.species}: ${statusNames[primary] ?? primary} 상태가 되었다!`);
            // ── Ability: Synchronize reflects primary status to attacker ──
            if (defPoke.abilityId === "synchronize"
                && ["burn", "poison", "paralysis"].includes(primary)
                && !atkPoke.statusCondition
                && canReceiveStatus(atkPoke, primary)) {
              atkPoke.statusCondition = primary;
              if (primary === "poison" && moveData.id === "toxic") {
                atkPoke.toxicCounter = 1;
              }
              room.log.push(`${defPoke.species}의 싱크로! ${atkPoke.species}에게 상태이상을 전염시켰다!`);
            }
          }
        }
      }
      if (isVolatileAilment(ailment)) {
        // Yawn: skip if defender already has a status condition
        if (ailment === "yawn" && defPoke.statusCondition) {
          // No effect
        // Perish Song: handled separately (applies to both sides)
        } else if (ailment === "perish-song") {
          // Skip: handled in dedicated perish-song section below
        } else if (chance <= 0 || chance >= 100 || Math.random() * 100 < chance) {
          let turns = -1;
          if (ailment === "confusion") turns = rollConfusionTurns();
          else if (ailment === "trap") {
            // Grip Claw (held by the attacker) extends trap duration to 7 turns.
            turns = atkPoke.heldItem === "grip-claw" ? 7 : rollTrapTurns();
          }
          else if (ailment === "yawn") turns = 2;
          const newVols = addVolatile(defender.volatiles, ailment, turns);
          if (newVols !== defender.volatiles) {
            defender.volatiles = newVols;
            const volNames: Record<string, string> = {
              confusion: "혼란", trap: "조이기", "leech-seed": "씨뿌리기", yawn: "졸음",
            };
            room.log.push(`${defender.nickname}의 ${defPoke.species}: ${volNames[ailment] ?? ailment} 상태가 되었다!`);
            // ── Binding Band (attacker's item): trap damage boost (1/6 instead of 1/8) ──
            if (ailment === "trap" && atkPoke.heldItem === "binding-band") {
              defender.trapDamageBoost = true;
            }
          }
        }
      }
    }

    // ── Drain / healing ──
    const meta = moveData.meta;
    if (meta?.drain && meta.drain !== 0) {
      const drainAmount = Math.floor(totalDamage * meta.drain / 100);
      // Heal Block only blocks the positive (healing) part of drain; recoil still applies.
      if (drainAmount > 0 && hasVolatile(attacker.volatiles, "heal-block")) {
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 회복봉인으로 회복할 수 없다!`);
      } else {
        atkPoke.hp = Math.min(atkPoke.maxHp, Math.max(0, atkPoke.hp + drainAmount));
        if (drainAmount > 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 체력을 흡수했다!`);
        else if (drainAmount < 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 반동 데미지를 받았다!`);
      }
    }
  }

  // ── Stat changes from move (not for struggle) ──
  if (!isStruggle && moveData.statChanges && moveData.statChanges.length > 0) {
    const baseStatChance = moveData.meta?.statChance ?? 0;
    const graceStatMul = atkPoke.abilityId === "serene-grace" ? 2 : 1;
    const chance = Math.min(100, baseStatChance * graceStatMul);
    const targetsSelf = moveData.target === "user" || (moveData.category === "status" && baseStatChance === 0);

    if (targetsSelf) {
      // ── Ability: Contrary reverses stat changes ──
      const selfChanges = atkPoke.abilityId === "contrary"
        ? moveData.statChanges.map((sc) => ({ stat: sc.stat, change: -sc.change }))
        : moveData.statChanges;
      attacker.statStages = applyStatChanges(attacker.statStages, selfChanges);
      // ── Gen 9: Alluring Voice trigger — mark side as having boosted stats this turn ──
      if (selfChanges.some((sc) => sc.change > 0)) {
        attacker.boostedStatsThisTurn = true;
      }
      for (const sc of selfChanges) {
        const dir = sc.change > 0 ? "올랐다" : "내려갔다";
        const names: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드", accuracy: "명중률", evasion: "회피율" };
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${names[sc.stat] ?? sc.stat}이(가) ${dir}!`);
      }
      // ── Item: White Herb resets negative self stages ──
      if (atkPoke.heldItem === "white-herb") {
        const stages = attacker.statStages;
        const keys = ["attack", "defense", "spAttack", "spDefense", "speed", "accuracy", "evasion"] as const;
        const hasNeg = keys.some(k => stages[k] < 0);
        if (hasNeg) {
          for (const k of keys) {
            if (stages[k] < 0) stages[k] = 0;
          }
          atkPoke.heldItem = null;
          room.log.push(`${atkPoke.species}의 하양허브! 능력 하락이 리셋됐다!`);
        }
      }
      // ── Opportunist: copy attacker's positive boosts to the defender (opportunist holder) ──
      if (selfChanges.some((sc) => sc.change > 0)) {
        triggerOnStatBoostTrigger({
          player: defender,
          opponent: attacker,
          changes: selfChanges,
          room,
        });
      }
    } else if (hitsMade > 0 && defPoke.hp > 0) {
      // Covert Cloak blocks secondary stat drops that are chance-gated.
      const covertBlocks = defPoke.heldItem === "covert-cloak" && baseStatChance > 0 && baseStatChance < 100;
      const roll = !covertBlocks && (baseStatChance === 0 || chance >= 100 || Math.random() * 100 < chance);
      if (roll) {
        // ── Ability: Contrary reverses stat changes ──
        const oppChanges = defPoke.abilityId === "contrary"
          ? moveData.statChanges.map((sc) => ({ stat: sc.stat, change: -sc.change }))
          : moveData.statChanges;
        // ── Ability / Item: Clear Body / White Smoke / Clear Amulet block opponent stat drops ──
        const blockDrops = !canReceiveStatus(defPoke, "stat-drop") || defPoke.heldItem === "clear-amulet";
        // ── Mist: blocks opponent-caused stat drops on defender's side ──
        const mistBlocked = hasVolatile(defender.volatiles, "mist");
        // ── Per-stat ability block (hyper-cutter, keen-eye, big-pecks) ──
        const filteredChanges = oppChanges.filter((sc) => {
          if (sc.change >= 0) return true;
          if (blockDrops || mistBlocked) return false;
          if (isStatDropPrevented(defPoke, sc.stat, true)) return false;
          return true;
        });
        // Per-stat block logs
        for (const sc of oppChanges) {
          if (sc.change < 0 && !blockDrops && !mistBlocked && isStatDropPrevented(defPoke, sc.stat, true)) {
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 ${sc.stat} 하락을 막았다!`);
          }
        }
        if (mistBlocked && oppChanges.some((sc) => sc.change < 0)) {
          room.log.push(`흰안개가 능력 하락을 막았다!`);
        }
        if (filteredChanges.length > 0) {
          defender.statStages = applyStatChanges(defender.statStages, filteredChanges);
          for (const sc of filteredChanges) {
            const dir = sc.change > 0 ? "올랐다" : "내려갔다";
            const names: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드", accuracy: "명중률", evasion: "회피율" };
            room.log.push(`${defender.nickname}의 ${defPoke.species}: ${names[sc.stat] ?? sc.stat}이(가) ${dir}!`);
          }
          // ── Ability: Defiant / Competitive reactive boost on opponent-caused drops ──
          const drops = filteredChanges.filter((sc) => sc.change < 0);
          if (drops.length > 0) {
            const reactiveAll: Array<{ stat: string; change: number }> = [];
            for (const drop of drops) {
              const reactive = triggerOpponentStatDrop(defender, defPoke, drop.stat, Math.abs(drop.change), room);
              for (const r of reactive) reactiveAll.push(r);
            }
            if (reactiveAll.length > 0) {
              defender.statStages = applyStatChanges(defender.statStages, reactiveAll);
              const abilityName = defPoke.abilityId === "defiant" ? "오기"
                : defPoke.abilityId === "competitive" ? "승기" : defPoke.abilityId;
              room.log.push(`${defPoke.species}의 ${abilityName}! 능력이 올랐다!`);
            }
          }
        }
        const blockedBy = oppChanges.length - filteredChanges.length;
        if (blockedBy > 0) {
          if (defPoke.heldItem === "clear-amulet") {
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 클리어액세서리로 능력 하락을 막았다!`);
          } else if (blockDrops) {
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 능력치 하락을 막았다!`);
          }
        }
        // ── Item: White Herb resets negative stages (for the defender) ──
        if (defPoke.heldItem === "white-herb") {
          const stages = defender.statStages;
          const keys = ["attack", "defense", "spAttack", "spDefense", "speed", "accuracy", "evasion"] as const;
          const hasNeg = keys.some(k => stages[k] < 0);
          if (hasNeg) {
            for (const k of keys) {
              if (stages[k] < 0) stages[k] = 0;
            }
            defPoke.heldItem = null;
            room.log.push(`${defPoke.species}의 하양허브! 능력 하락이 리셋됐다!`);
          }
        }
      }
    }
  }

  // ── Weather setting from move (not for struggle) ──
  if (!isStruggle) {
    const weather = getFlag(moveId, "setsWeather");
    if (weather) {
      room.weather = weather;
      room.weatherTurns = getDefaultWeatherTurns();
      const weatherNames: Record<string, string> = {
        sun: "강한 햇살", rain: "비", hail: "우박", sandstorm: "모래바람",
      };
      room.log.push(`${weatherNames[weather] ?? weather} 상태가 되었다!`);
      // Paradox: re-evaluate activation (Protosynthesis on sun)
      tryActivateParadoxOnFieldChange(room);
    }
  }

  // ── Terrain setting from move (not for struggle) ──
  if (!isStruggle) {
    const terrainType = getFlag(moveId, "setsTerrain");
    if (terrainType) {
      room.terrain = terrainType;
      room.terrainTurns = 5;
      room.log.push(`${TERRAIN_NAMES[terrainType]}이(가) 펼쳐졌다!`);
      // Paradox: re-evaluate activation (Quark Drive on electric terrain)
      tryActivateParadoxOnFieldChange(room);
    }
  }

  // ── Trapping moves: prevent opponent from switching ──
  if (!isStruggle && hasFlag(moveId, "isTrapping") && hitsMade >= 0 && defPoke.hp > 0) {
    // Most trapping moves land; bind the defender so they can't switch out.
    defender.trapped = true;
    room.log.push(`${defender.nickname}의 ${defPoke.species}: 도망칠 수 없다!`);
  }

  // ── Post-attack form change (Aegislash stance change) ──
  if (!isStruggle && hitsMade > 0) {
    const atkFormResult = checkPostAttackForm(atkPoke.species, effectiveMoveData.category, attacker.battleForm ?? atkPoke.variantId ?? null);
    if (atkFormResult) {
      attacker.battleForm = atkFormResult.newForm;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${atkFormResult.message}`);
    }
  }

  // ── Move-based form change (Meloetta relic-song) ──
  if (!isStruggle) {
    const moveFormResult = checkMoveForm(atkPoke.species, moveId, attacker.battleForm ?? atkPoke.variantId ?? null);
    if (moveFormResult) {
      attacker.battleForm = moveFormResult.newForm;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveFormResult.message}`);
    }
  }

  // ── HP threshold form changes (Wishiwashi, Darmanitan, Minior, Zygarde) ──
  for (const [pl, po] of [[attacker, atkPoke], [defender, defPoke]] as [PvpPlayerState, PvpPokemon][]) {
    if (po.hp > 0) {
      const hpForm = checkHpThresholdForm(po.species, po.hp, po.maxHp, po.level, pl.battleForm ?? po.variantId ?? null);
      if (hpForm) {
        pl.battleForm = hpForm.newForm;
        room.log.push(`${pl.nickname}의 ${po.species}: ${hpForm.message}`);
      }
    }
  }

  // ── Hazard-setting moves ──
  if (!isStruggle) {
    const hazardType = getFlag(moveId, "setsHazard");
    if (hazardType) {
      const hazardFn = HAZARD_MOVES[hazardType];
      if (hazardFn) {
        if (!defender.hazards) defender.hazards = {};
        const applied = hazardFn(defender.hazards);
        if (applied) {
          const hazardNames: Record<string, string> = {
            "stealth-rock": "스텔스록", "spikes": "압정", "toxic-spikes": "독압정", "sticky-web": "끈적끈적네트",
          };
          room.log.push(`${defender.nickname} 필드에 ${hazardNames[hazardType] ?? hazardType}이(가) 깔렸다!`);
        }
      }
    }
  }

  // ── Hazard-clearing moves (Rapid Spin: own; Defog: both + screens) ──
  if (!isStruggle) {
    const clears = getFlag(moveId, "clearsHazards");
    if (clears === "own" && hitsMade > 0) {
      if (attacker.hazards) {
        attacker.hazards = {};
        room.log.push(`${attacker.nickname} 필드의 hazard가 제거되었다!`);
      }
    } else if (clears === "both") {
      let cleared = false;
      if (attacker.hazards && Object.keys(attacker.hazards).some(k => (attacker.hazards as Record<string, unknown>)[k])) {
        attacker.hazards = {};
        cleared = true;
      }
      if (defender.hazards && Object.keys(defender.hazards).some(k => (defender.hazards as Record<string, unknown>)[k])) {
        defender.hazards = {};
        cleared = true;
      }
      // Defog also removes screens
      if (defender.screens) {
        defender.screens = undefined;
        cleared = true;
      }
      if (cleared) {
        room.log.push(`안개제거로 필드의 hazard가 제거되었다!`);
      }
      // Defog drops opponent's evasion by 1
      defender.statStages = applyStatChanges(defender.statStages, [{ stat: "evasion", change: -1 }]);
    }
  }

  // ── Screen-setting moves (Reflect, Light Screen, Aurora Veil) ──
  if (!isStruggle) {
    const screenFlag = getFlag(moveId, "setsScreen");
    // Registry uses kebab-case ("light-screen", "aurora-veil"); player.screens uses camelCase keys.
    const screenKey: "reflect" | "lightScreen" | "auroraVeil" | undefined =
      screenFlag === "reflect" ? "reflect"
      : screenFlag === "light-screen" ? "lightScreen"
      : screenFlag === "aurora-veil" ? "auroraVeil"
      : undefined;
    if (screenKey) {
      if (screenKey === "auroraVeil" && room.weather !== "hail") {
        room.log.push(`${attacker.nickname}: 오로라베일 실패! (우박이 아닙니다)`);
      } else {
        if (!attacker.screens) attacker.screens = {};
        attacker.screens[screenKey] = 5;
        const names: Record<string, string> = { reflect: "리플렉터", lightScreen: "빛의장막", auroraVeil: "오로라베일" };
        room.log.push(`${attacker.nickname}: ${names[screenKey]}!`);
      }
    }
  }

  // ── Trick Room ──
  if (!isStruggle && moveId === "trick-room") {
    if (room.trickRoom && room.trickRoom > 0) {
      room.trickRoom = 0;
      room.log.push("트릭룸이 해제됐다!");
    } else {
      room.trickRoom = 5;
      room.log.push("트릭룸! 느린 포켓몬이 먼저 움직인다!");
      // ── Item: Room Service triggers when Trick Room goes up ──
      for (const p of [room.playerA, room.playerB]) {
        const poke = p.party[p.activeIndex];
        if (poke.hp > 0 && poke.heldItem === "room-service") {
          p.statStages = applyStatChanges(p.statStages, [{ stat: "speed", change: -1 }]);
          poke.heldItem = null;
          room.log.push(`${poke.species}의 룸서비스! 스피드가 내려갔다!`);
        }
      }
    }
  }

  // ── Tailwind ──
  if (!isStruggle && moveId === "tailwind") {
    attacker.tailwind = 4;
    room.log.push(`${attacker.nickname}: 순풍! 스피드가 올랐다!`);
  }

  // perish-song handled by the unified applyEffect dispatcher earlier in executeFight.

  // ── Switch-after-move (U-Turn, Volt Switch, Flip Turn, Parting Shot) ──
  // baton-pass also has forcesSwitch="user"; handled by its dedicated block below.
  if (!isStruggle && getFlag(moveId, "forcesSwitch") === "user" && moveId !== "baton-pass") {
    const missed = hitsMade === 0 && !isFixedDamage;
    // parting-shot is status (power 0), so hitsMade will be 0 and isFixedDamage false
    // but parting-shot has accuracy 100 and its stat changes already applied means it succeeded
    const partingShotSucceeded = moveId === "parting-shot" && moveData.statChanges && moveData.statChanges.length > 0;
    if ((!missed || partingShotSucceeded) && atkPoke.hp > 0) {
      const hasOtherAlive = attacker.party.some((p, i) => i !== attacker.activeIndex && p.hp > 0);
      if (hasOtherAlive) {
        const atkSide = attacker === room.playerA ? "a" : "b";
        if (!room.pendingSwitchAfterMove) room.pendingSwitchAfterMove = {};
        room.pendingSwitchAfterMove[atkSide] = true;
      }
    }
  }

  // ── Baton Pass ──
  if (!isStruggle && moveId === "baton-pass") {
    if (atkPoke.hp > 0) {
      const hasOtherAlive = attacker.party.some((p, i) => i !== attacker.activeIndex && p.hp > 0);
      if (hasOtherAlive) {
        const atkSide = attacker === room.playerA ? "a" : "b";
        if (!room.pendingSwitchAfterMove) room.pendingSwitchAfterMove = {};
        room.pendingSwitchAfterMove[atkSide] = true;
        if (!room.batonPass) room.batonPass = {};
        room.batonPass[atkSide] = true;
      }
    }
  }

  if (!isFixedDamage && defPoke.hp <= 0) {
    // ── Destiny Bond: if defender faints with destiny-bond, attacker also faints ──
    if (hasVolatile(defender.volatiles, "destiny-bond")) {
      atkPoke.hp = 0;
      room.log.push(`${atkPoke.species}: 운명의끈에 의해 쓰러졌다!`);
    }
    room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
  }

  // ── Phazing (Whirlwind, Roar, Dragon Tail, Circle Throw) ──
  if (!isStruggle && getFlag(moveId, "forcesSwitch") === "target" && hitsMade >= 0 && defPoke.hp > 0) {
    // Ingrain: rooted defender cannot be phazed.
    if (hasVolatile(defender.volatiles, "ingrain")) {
      room.log.push(`${defender.nickname}의 ${defPoke.species}: 뿌리내리기로 버텼다!`);
    } else if (defPoke.abilityId === "suction-cups") {
      room.log.push(`${defender.nickname}의 ${defPoke.species}: 흡반으로 버텼다!`);
    } else {
      // whirlwind/roar are status moves so hitsMade may be 0, but they still phaze
      const aliveOthers = defender.party
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => i !== defender.activeIndex && p.hp > 0);
      if (aliveOthers.length > 0) {
        const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
        applySwitch(room, defender, target.i);
        room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 끌려나갔다!`);
      }
    }
  }

  // ── Disable / Encore / Taunt / Torment application ──
  if (!isStruggle && (moveId === "disable" || moveId === "encore" || moveId === "taunt" || moveId === "torment")) {
    triggerApplyEffect({ room, attacker, defender, atkPoke, defPoke, move: moveData, moveId });
  }

  // ── Record last move used ──
  attacker.lastMoveUsed = moveId;
  room.lastMoveUsedInBattle = moveId;
}
