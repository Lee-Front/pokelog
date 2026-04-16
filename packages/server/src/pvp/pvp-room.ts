import crypto from "node:crypto";
import { calculateDamage, determineTurnOrder, defaultStatStages, applyStatChanges, calculateAccuracy } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getMoveById } from "../game/data-loader.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "../game/status-conditions.js";
import {
  getWeatherFromMove, getWeatherDamage, getWeatherTypeModifier,
  tickWeather, getDefaultWeatherTurns,
} from "../game/weather.js";
import {
  checkPostAttackForm, checkHpThresholdForm, checkTurnForm,
  checkWeatherForm, checkMoveForm,
} from "../game/battle-forms.js";
import {
  triggerOnSwitchIn, triggerOnSwitchOut, getAttackMultiplier, getDefenseMultiplier,
  getMoveModifiers, canReceiveStatus, triggerEndOfTurn, getEffectiveSpeed,
} from "./pvp-abilities.js";
import {
  getItemAttackMultiplier, getItemDefenseMultiplier,
  triggerAfterAttack, triggerAfterBeingHit,
  triggerItemEndOfTurn, getItemSpeedMultiplier,
  checkItemPreventKO,
} from "./pvp-items.js";
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon,
  PvpClientRoomView, PvpRoomConfig, PvpAction,
} from "../../../../shared/pvp-types.js";

const FIXED_DAMAGE_MOVES: Record<string, number | "level"> = {
  "dragon-rage": 40,
  "sonic-boom": 20,
  "seismic-toss": "level",
  "night-shade": "level",
  "psywave": "level",
};

const SELF_KO_MOVES = new Set([
  "self-destruct", "explosion", "memento", "final-gambit",
  "healing-wish", "lunar-dance", "misty-explosion",
]);

const PROTECT_MOVES = new Set([
  "protect", "detect", "kings-shield", "baneful-bunker",
  "spiky-shield", "obstruct", "silk-trap",
]);

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

    // ── Ability: onSwitchIn for both leads ──
    triggerOnSwitchIn({ room, player: room.playerA, opponent: room.playerB, pokemon: room.playerA.party[room.playerA.activeIndex] });
    triggerOnSwitchIn({ room, player: room.playerB, opponent: room.playerA, pokemon: room.playerB.party[room.playerB.activeIndex] });
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
    },
    weather: room.weather,
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

  if (actionA.type === "fight" && PROTECT_MOVES.has(actionA.moveId)) {
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
  if (actionB.type === "fight" && PROTECT_MOVES.has(actionB.moveId)) {
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
  if (actionA.type !== "fight" || !PROTECT_MOVES.has(actionA.moveId)) {
    room.playerA.protectCount = 0;
  }
  if (actionB.type !== "fight" || !PROTECT_MOVES.has(actionB.moveId)) {
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
    if (pokemonA.statusCondition === "paralysis") speedA = Math.floor(speedA * 0.5);
    if (pokemonB.statusCondition === "paralysis") speedB = Math.floor(speedB * 0.5);

    // ── Ability: priority modifiers ──
    const modsA = getMoveModifiers({ room, attacker: room.playerA, atkPoke: pokemonA, move: moveA! });
    const modsB = getMoveModifiers({ room, attacker: room.playerB, atkPoke: pokemonB, move: moveB! });
    const priorityA = (moveA?.priority ?? 0) + modsA.priorityMod;
    const priorityB = (moveB?.priority ?? 0) + modsB.priorityMod;

    const order = determineTurnOrder(
      speedA, speedB,
      priorityA, priorityB,
    );

    const [first, second] = order === "player"
      ? [{ player: room.playerA, action: actionA, opp: room.playerB, defProtected: protectedB },
         { player: room.playerB, action: actionB, opp: room.playerA, defProtected: protectedA }]
      : [{ player: room.playerB, action: actionB, opp: room.playerA, defProtected: protectedA },
         { player: room.playerA, action: actionA, opp: room.playerB, defProtected: protectedB }];

    executeFight(room, first.player, first.action.moveId, first.opp, first.action.mega, first.action.gigantamax, first.defProtected);
    if (first.opp.party[first.opp.activeIndex].hp > 0) {
      executeFight(room, second.player, second.action.moveId, second.opp, second.action.mega, second.action.gigantamax, second.defProtected);
    }
  } else if (actionA.type === "fight") {
    executeFight(room, room.playerA, actionA.moveId, room.playerB, actionA.mega, actionA.gigantamax, protectedB);
  } else if (actionB.type === "fight") {
    executeFight(room, room.playerB, actionB.moveId, room.playerA, actionB.mega, actionB.gigantamax, protectedA);
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
        if (eot.damage > 0) poke.hp = Math.max(0, poke.hp - eot.damage);
        if (eot.healing > 0) poke.hp = Math.min(poke.maxHp, poke.hp + eot.healing);
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
        if (eot.damage > 0) {
          poke.hp = Math.max(0, poke.hp - eot.damage);
        }
        if (eot.healing > 0) {
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

    // Tick volatiles
    player.volatiles = tickVolatiles(player.volatiles);

    // ── Ability: end-of-turn effects ──
    if (poke.hp > 0) {
      triggerEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }

    // ── Item: end-of-turn effects (leftovers, flame-orb, etc.) ──
    if (poke.hp > 0) {
      triggerItemEndOfTurn({ room, player, opponent: opp, pokemon: poke });
    }
  }

  // ── Weather end-of-turn ──
  if (room.weather) {
    for (const player of [room.playerA, room.playerB]) {
      const poke = player.party[player.activeIndex];
      if (poke.hp <= 0) continue;
      // ── Ability: Magic Guard skips weather damage ──
      if (poke.abilityId === "magic-guard") continue;
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

  // ── Gigantamax countdown ──
  for (const player of [room.playerA, room.playerB]) {
    if (player.transformationType === "gigantamax" && player.gmaxTurnsRemaining != null) {
      player.gmaxTurnsRemaining -= 1;
      if (player.gmaxTurnsRemaining <= 0) {
        const poke = player.party[player.activeIndex];
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
        if (poke.hp > 0) room.log.push(`${player.nickname}의 ${poke.species}: 기가맥스가 풀렸다!`);
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

  // Reset toxic counter on the pokemon being switched out
  if (oldPoke.toxicCounter) oldPoke.toxicCounter = undefined;

  player.activeIndex = index;
  player.statStages = defaultStatStages();
  player.volatiles = [];
  player.battleForm = undefined;

  // Mega form persists when switching back in
  const poke = player.party[index];
  if (poke.megaForm && player.transformationUsed && player.transformationType === "mega") {
    player.battleForm = poke.megaForm.variantId;
  }

  room.log.push(`${player.nickname}: ${player.party[index].species}(으)로 교체!`);

  // ── Ability: onSwitchIn for new pokemon ──
  const opponent = player === room.playerA ? room.playerB : room.playerA;
  triggerOnSwitchIn({ room, player, opponent, pokemon: poke });
}

function executeFight(
  room: PvpRoomState,
  attacker: PvpPlayerState,
  moveId: string,
  defender: PvpPlayerState,
  mega?: boolean,
  gigantamax?: boolean,
  defenderProtected?: boolean,
): void {
  const atkPoke = attacker.party[attacker.activeIndex];
  const defPoke = defender.party[defender.activeIndex];
  const moveData = getMoveById(moveId);
  if (!moveData) return;

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

  // ── Defender protected check ──
  if (defenderProtected) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}: 공격을 막았다!`);
    return;
  }

  // ── Pre-attack status check ──
  // Decrement sleep turns first
  if (atkPoke.statusCondition === "sleep" && atkPoke.sleepTurns != null) {
    atkPoke.sleepTurns -= 1;
    if (atkPoke.sleepTurns <= 0) {
      atkPoke.statusCondition = null;
      atkPoke.sleepTurns = undefined;
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 잠에서 깨어났다!`);
    }
  }

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

  const effectiveMoveData = isStruggle ? {
    id: "struggle", name: "발버둥", type: "typeless", category: "physical" as const,
    power: 50, accuracy: 100, pp: 1, description: "",
  } : moveData;

  // ── Accuracy check with stat stages (before damage calc) ──
  if (effectiveMoveData.accuracy > 0 && effectiveMoveData.accuracy <= 100) {
    const effectiveAcc = calculateAccuracy(effectiveMoveData.accuracy, attacker.statStages.accuracy, defender.statStages.evasion);
    if (Math.random() * 100 >= effectiveAcc) {
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! 빗나갔다!`);
      return;
    }
  }
  // Override accuracy for calculateDamage to prevent double-check
  const moveForCalc = { ...effectiveMoveData, accuracy: 999 };

  // ── Fixed damage moves ──
  const fixedDmg = FIXED_DAMAGE_MOVES[isStruggle ? "" : moveId];
  let isFixedDamage = false;
  let totalDamage = 0;
  let hitsMade = 0;

  if (fixedDmg != null && !isStruggle) {
    isFixedDamage = true;
    const damage = fixedDmg === "level" ? atkPoke.level : fixedDmg;
    defPoke.hp = Math.max(0, defPoke.hp - damage);
    totalDamage = damage;
    hitsMade = 1;
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${effectiveMoveData.name}! ${damage} 데미지!`);
    if (defPoke.hp <= 0) room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
  }

  if (!isFixedDamage) {
    // ── Burn halves physical attack (guts negates) ──
    let effectiveAtkStats = atkPoke.stats;
    if (atkPoke.statusCondition === "burn" && moveForCalc.category === "physical" && atkPoke.abilityId !== "guts") {
      effectiveAtkStats = { ...atkPoke.stats, attack: Math.floor(atkPoke.stats.attack * 0.5) };
    }

    const weatherMod = room.weather ? getWeatherTypeModifier(room.weather, moveForCalc.type) : 1;
    const attackerTypes = getEffectiveTypes(atkPoke.species, atkPoke.variantId, attacker.battleForm);
    const defenderTypes = getEffectiveTypes(defPoke.species, defPoke.variantId, defender.battleForm);

    // ── Multi-hit loop ──
    const minHits = effectiveMoveData.meta?.minHits ?? 1;
    const maxHits = effectiveMoveData.meta?.maxHits ?? 1;
    const hitCount = minHits === maxHits ? minHits : minHits + Math.floor(Math.random() * (maxHits - minHits + 1));

    // ── Ability: build damage mod context ──
    const dmgCtx = { room, attacker, defender, atkPoke, defPoke, move: moveForCalc, damage: 0 };
    const atkMul = getAttackMultiplier(dmgCtx);
    const defMul = getDefenseMultiplier(dmgCtx);
    // ── Item: attack/defense multipliers ──
    const itemAtkMul = getItemAttackMultiplier(dmgCtx);
    const itemDefMul = getItemDefenseMultiplier(dmgCtx);

    // ── Ability: Unaware ignores opponent stat stages ──
    const atkStages = defPoke.abilityId === "unaware" ? defaultStatStages() : attacker.statStages;
    const defStages = atkPoke.abilityId === "unaware" ? defaultStatStages() : defender.statStages;

    let lastResult = { damage: 0, missed: false, effectiveness: 1, message: "", critical: false };
    for (let hit = 0; hit < hitCount; hit++) {
      if (defPoke.hp <= 0) break;
      const result = calculateDamage(
        atkPoke.level, effectiveAtkStats, defPoke.stats, moveForCalc,
        attackerTypes, defenderTypes,
        atkStages, defStages,
        weatherMod,
      );
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
        // ── Item: apply attack/defense multipliers ──
        finalDamage = Math.floor(finalDamage * itemAtkMul);
        finalDamage = Math.floor(finalDamage * itemDefMul);
        // ── Item: prevent KO check (focus-sash etc.) ──
        if (finalDamage >= defPoke.hp && defPoke.hp > 0) {
          const prevented = checkItemPreventKO({ room, defender, defPoke, damage: finalDamage });
          if (prevented) {
            finalDamage = defPoke.hp - 1;
            defPoke.heldItem = null; // consume item
          }
        }
        defPoke.hp = Math.max(0, defPoke.hp - finalDamage);
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
  }

  // ── Self-KO moves ──
  if (SELF_KO_MOVES.has(moveId) && !isStruggle) {
    atkPoke.hp = 0;
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}이(가) 쓰러졌다!`);
  }

  // ── Ailment application (only on hit, not for struggle) ──
  if (!isStruggle && hitsMade > 0 && defPoke.hp > 0) {
    const ailment = moveData.meta?.ailment;
    const chance = moveData.meta?.ailmentChance ?? 0;
    if (ailment && ailment !== "none") {
      // ── Ability: status guard check for primary (non-volatile) ailments ──
      const primaryBlocked = !isVolatileAilment(ailment) && !canReceiveStatus(defPoke, ailment);
      if (primaryBlocked) {
        room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 상태이상을 막았다!`);
      } else {
        const primary = rollAilment(ailment, chance, defPoke.statusCondition);
        if (primary) {
          // ── Ability: check canReceiveStatus for the rolled status too ──
          if (!canReceiveStatus(defPoke, primary)) {
            room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 상태이상을 막았다!`);
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
          }
        }
      }
      if (isVolatileAilment(ailment)) {
        if (chance <= 0 || chance >= 100 || Math.random() * 100 < chance) {
          let turns = -1;
          if (ailment === "confusion") turns = rollConfusionTurns();
          else if (ailment === "trap") turns = rollTrapTurns();
          const newVols = addVolatile(defender.volatiles, ailment, turns);
          if (newVols !== defender.volatiles) {
            defender.volatiles = newVols;
            const volNames: Record<string, string> = {
              confusion: "혼란", trap: "조이기", "leech-seed": "씨뿌리기",
            };
            room.log.push(`${defender.nickname}의 ${defPoke.species}: ${volNames[ailment] ?? ailment} 상태가 되었다!`);
          }
        }
      }
    }

    // ── Drain / healing ──
    const meta = moveData.meta;
    if (meta?.drain && meta.drain !== 0) {
      const drainAmount = Math.floor(totalDamage * meta.drain / 100);
      atkPoke.hp = Math.min(atkPoke.maxHp, Math.max(0, atkPoke.hp + drainAmount));
      if (drainAmount > 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 체력을 흡수했다!`);
      else if (drainAmount < 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 반동 데미지를 받았다!`);
    }
  }

  // ── Stat changes from move (not for struggle) ──
  if (!isStruggle && moveData.statChanges && moveData.statChanges.length > 0) {
    const chance = moveData.meta?.statChance ?? 0;
    const targetsSelf = moveData.target === "user" || (moveData.category === "status" && chance === 0);

    if (targetsSelf) {
      // ── Ability: Contrary reverses stat changes ──
      const selfChanges = atkPoke.abilityId === "contrary"
        ? moveData.statChanges.map((sc) => ({ stat: sc.stat, change: -sc.change }))
        : moveData.statChanges;
      attacker.statStages = applyStatChanges(attacker.statStages, selfChanges);
      for (const sc of selfChanges) {
        const dir = sc.change > 0 ? "올랐다" : "내려갔다";
        const names: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드", accuracy: "명중률", evasion: "회피율" };
        room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${names[sc.stat] ?? sc.stat}이(가) ${dir}!`);
      }
    } else if (hitsMade > 0 && defPoke.hp > 0) {
      const roll = chance === 0 || chance >= 100 || Math.random() * 100 < chance;
      if (roll) {
        // ── Ability: Contrary reverses stat changes ──
        const oppChanges = defPoke.abilityId === "contrary"
          ? moveData.statChanges.map((sc) => ({ stat: sc.stat, change: -sc.change }))
          : moveData.statChanges;
        // ── Ability: Clear Body / White Smoke blocks opponent stat drops ──
        const filteredChanges = oppChanges.filter((sc) => {
          if (sc.change < 0 && !canReceiveStatus(defPoke, "stat-drop")) return false;
          return true;
        });
        if (filteredChanges.length > 0) {
          defender.statStages = applyStatChanges(defender.statStages, filteredChanges);
          for (const sc of filteredChanges) {
            const dir = sc.change > 0 ? "올랐다" : "내려갔다";
            const names: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드", accuracy: "명중률", evasion: "회피율" };
            room.log.push(`${defender.nickname}의 ${defPoke.species}: ${names[sc.stat] ?? sc.stat}이(가) ${dir}!`);
          }
        }
        if (oppChanges.length > filteredChanges.length) {
          room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 능력치 하락을 막았다!`);
        }
      }
    }
  }

  // ── Weather setting from move (not for struggle) ──
  if (!isStruggle) {
    const weather = getWeatherFromMove(moveId);
    if (weather) {
      room.weather = weather;
      room.weatherTurns = getDefaultWeatherTurns();
      const weatherNames: Record<string, string> = {
        sun: "강한 햇살", rain: "비", hail: "우박", sandstorm: "모래바람",
      };
      room.log.push(`${weatherNames[weather] ?? weather} 상태가 되었다!`);
    }
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

  if (!isFixedDamage && defPoke.hp <= 0) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
  }
}
