import crypto from "node:crypto";
import { calculateDamage, determineTurnOrder, defaultStatStages } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getMoveById } from "../game/data-loader.js";
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
