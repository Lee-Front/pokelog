import crypto from "node:crypto";
import { calculateDamage, determineTurnOrder, defaultStatStages } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getMoveById } from "../game/data-loader.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "../game/status-conditions.js";
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

  if (actionA.type === "switch") applySwitch(room, room.playerA, actionA.pokemonIndex);
  if (actionB.type === "switch") applySwitch(room, room.playerB, actionB.pokemonIndex);

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

  // ── End-of-turn effects (status damage, volatile tick) ──
  for (const player of [room.playerA, room.playerB]) {
    const poke = player.party[player.activeIndex];
    if (poke.hp <= 0) continue;
    const opp = player === room.playerA ? room.playerB : room.playerA;
    const oppPoke = opp.party[opp.activeIndex];

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
    if (poke.hp <= 0) {
      room.log.push(`${player.nickname}의 ${poke.species}이(가) 쓰러졌다!`);
    }

    // Tick volatiles
    player.volatiles = tickVolatiles(player.volatiles);
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

  // ── Execute move ──
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

  // ── Ailment application (only on hit) ──
  if (!result.missed && defPoke.hp > 0) {
    const ailment = moveData.meta?.ailment;
    const chance = moveData.meta?.ailmentChance ?? 0;
    if (ailment && ailment !== "none") {
      const primary = rollAilment(ailment, chance, defPoke.statusCondition);
      if (primary) {
        defPoke.statusCondition = primary;
        if (primary === "sleep") defPoke.sleepTurns = rollSleepTurns();
        const statusNames: Record<string, string> = {
          poison: "독", burn: "화상", paralysis: "마비", sleep: "잠듦", freeze: "얼음",
        };
        room.log.push(`${defender.nickname}의 ${defPoke.species}: ${statusNames[primary] ?? primary} 상태가 되었다!`);
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
      const drainAmount = Math.floor(result.damage * meta.drain / 100);
      atkPoke.hp = Math.min(atkPoke.maxHp, Math.max(0, atkPoke.hp + drainAmount));
      if (drainAmount > 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 체력을 흡수했다!`);
      else if (drainAmount < 0) room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 반동 데미지를 받았다!`);
    }
  }

  if (defPoke.hp <= 0) {
    room.log.push(`${defender.nickname}의 ${defPoke.species}이(가) 쓰러졌다!`);
  }
}
