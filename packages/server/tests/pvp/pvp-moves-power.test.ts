import { describe, it, expect } from "vitest";
import { applyPowerMod, getMoveEffects, type MoveContext } from "../../src/pvp/pvp-moves.js";
import type { MoveData } from "../../../../shared/types.js";
import type { PvpPlayerState, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";

function makeMove(id: string, overrides: Partial<MoveData> = {}): MoveData {
  return {
    id,
    name: id,
    type: "normal",
    category: "physical",
    power: 50,
    accuracy: 100,
    pp: 20,
    description: "",
    ...overrides,
  };
}

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    ...overrides,
  };
}

function makePlayer(userId: string, nickname: string, pokemon: PvpPokemon, overrides: Partial<PvpPlayerState> = {}): PvpPlayerState {
  return {
    userId,
    nickname,
    party: [pokemon],
    activeIndex: 0,
    statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    volatiles: [],
    ready: true,
    actionSubmitted: false,
    ...overrides,
  };
}

function makeCtx(
  moveId: string,
  atkPoke: PvpPokemon,
  defPoke: PvpPokemon,
  moveOverrides: Partial<MoveData> = {},
  playerOverrides: { attacker?: Partial<PvpPlayerState>; defender?: Partial<PvpPlayerState> } = {},
): MoveContext {
  const attacker = makePlayer("userA", "A", atkPoke, playerOverrides.attacker);
  const defender = makePlayer("userB", "B", defPoke, playerOverrides.defender);
  const room: PvpRoomState = {
    roomId: "test-room",
    turn: 1,
    phase: "action",
    playerA: attacker,
    playerB: defender,
    turnDeadline: null,
    log: [],
    isAiBattle: false,
  };
  return {
    room, attacker, defender, atkPoke, defPoke,
    move: makeMove(moveId, moveOverrides),
    moveId,
  };
}

describe("power-formula moves", () => {
  it("gyro-ball: slower user → higher power, capped at 150", () => {
    const atk = makePokemon("shuckle", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 5 } });
    const def = makePokemon("jolteon", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 } });
    const ctx = makeCtx("gyro-ball", atk, def, { power: 1 });
    const p = applyPowerMod(ctx);
    expect(p).toBe(150);
  });

  it("gyro-ball: equal speeds → 25 base power", () => {
    const atk = makePokemon("alakazam", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 } });
    const def = makePokemon("alakazam2", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 } });
    const ctx = makeCtx("gyro-ball", atk, def, { power: 1 });
    expect(applyPowerMod(ctx)).toBe(25);
  });

  it("electro-ball: speed ratio brackets produce correct power tiers", () => {
    const slow = makePokemon("a", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 } });
    // attacker 4x faster -> 150
    const atk4x = makePokemon("atk", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 400 } });
    expect(applyPowerMod(makeCtx("electro-ball", atk4x, slow))).toBe(150);
    // 3x -> 120
    const atk3x = makePokemon("atk", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 300 } });
    expect(applyPowerMod(makeCtx("electro-ball", atk3x, slow))).toBe(120);
    // 2x -> 80
    const atk2x = makePokemon("atk", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 } });
    expect(applyPowerMod(makeCtx("electro-ball", atk2x, slow))).toBe(80);
    // 1x (equal) -> 60
    const atk1x = makePokemon("atk", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 } });
    expect(applyPowerMod(makeCtx("electro-ball", atk1x, slow))).toBe(60);
    // slower attacker -> 40
    const atkSlow = makePokemon("atk", { stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 50 } });
    expect(applyPowerMod(makeCtx("electro-ball", atkSlow, slow))).toBe(40);
  });

  it("hex: doubles power when defender has a status condition", () => {
    const atk = makePokemon("gengar");
    const defPoisoned = makePokemon("snorlax", { statusCondition: "poison" });
    const defHealthy = makePokemon("snorlax");
    expect(applyPowerMod(makeCtx("hex", atk, defPoisoned, { power: 65 }))).toBe(130);
    expect(applyPowerMod(makeCtx("hex", atk, defHealthy, { power: 65 }))).toBe(65);
  });

  it("venoshock: doubles only when defender is poisoned", () => {
    const atk = makePokemon("toxapex");
    const poisoned = makePokemon("d", { statusCondition: "poison" });
    const burned = makePokemon("d", { statusCondition: "burn" });
    expect(applyPowerMod(makeCtx("venoshock", atk, poisoned, { power: 65 }))).toBe(130);
    expect(applyPowerMod(makeCtx("venoshock", atk, burned, { power: 65 }))).toBe(65);
  });

  it("facade: doubles when attacker has a status", () => {
    const atkBurn = makePokemon("swellow", { statusCondition: "burn" });
    const atkHealthy = makePokemon("swellow");
    const def = makePokemon("target");
    expect(applyPowerMod(makeCtx("facade", atkBurn, def, { power: 70 }))).toBe(140);
    expect(applyPowerMod(makeCtx("facade", atkHealthy, def, { power: 70 }))).toBe(70);
  });

  it("acrobatics: doubles when attacker holds no item", () => {
    const atkNoItem = makePokemon("hawlucha", { heldItem: null });
    const atkWithItem = makePokemon("hawlucha", { heldItem: "life-orb" });
    const def = makePokemon("d");
    expect(applyPowerMod(makeCtx("acrobatics", atkNoItem, def, { power: 55 }))).toBe(110);
    expect(applyPowerMod(makeCtx("acrobatics", atkWithItem, def, { power: 55 }))).toBe(55);
  });

  it("flail / reversal: HP brackets produce correct power", () => {
    const def = makePokemon("d");
    // p = 0.03 -> 200
    const atkNearDead = makePokemon("a", { hp: 6, maxHp: 200 });
    expect(applyPowerMod(makeCtx("flail", atkNearDead, def))).toBe(200);
    // p = 0.08 -> 150
    const atkLow = makePokemon("a", { hp: 16, maxHp: 200 });
    expect(applyPowerMod(makeCtx("reversal", atkLow, def))).toBe(150);
    // p = 0.18 -> 100
    const atkMidLow = makePokemon("a", { hp: 36, maxHp: 200 });
    expect(applyPowerMod(makeCtx("flail", atkMidLow, def))).toBe(100);
    // p = 0.30 -> 80
    const atkMid = makePokemon("a", { hp: 60, maxHp: 200 });
    expect(applyPowerMod(makeCtx("flail", atkMid, def))).toBe(80);
    // full hp -> 20
    const atkFull = makePokemon("a", { hp: 200, maxHp: 200 });
    expect(applyPowerMod(makeCtx("flail", atkFull, def))).toBe(20);
  });

  it("water-spout / eruption: scales with attacker HP ratio", () => {
    const def = makePokemon("d");
    const atkFull = makePokemon("a", { hp: 200, maxHp: 200 });
    expect(applyPowerMod(makeCtx("water-spout", atkFull, def))).toBe(150);
    expect(applyPowerMod(makeCtx("eruption", atkFull, def))).toBe(150);
    const atkHalf = makePokemon("a", { hp: 100, maxHp: 200 });
    expect(applyPowerMod(makeCtx("water-spout", atkHalf, def))).toBe(75);
    const atkSliver = makePokemon("a", { hp: 1, maxHp: 200 });
    expect(applyPowerMod(makeCtx("water-spout", atkSliver, def))).toBeGreaterThanOrEqual(1);
  });

  it("stored-power / power-trip: 20 base + 20 per positive boost", () => {
    const atk = makePokemon("a");
    const def = makePokemon("d");
    const ctxNoBoost = makeCtx("stored-power", atk, def);
    expect(applyPowerMod(ctxNoBoost)).toBe(20);

    const ctxBoosted = makeCtx("stored-power", atk, def, {}, {
      attacker: { statStages: { attack: 2, defense: 1, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 } },
    });
    expect(applyPowerMod(ctxBoosted)).toBe(20 + 3 * 20);

    const ctxTrip = makeCtx("power-trip", atk, def, {}, {
      attacker: { statStages: { attack: 6, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 } },
    });
    expect(applyPowerMod(ctxTrip)).toBe(20 + 6 * 20);

    // negative stages do not count
    const ctxNegative = makeCtx("stored-power", atk, def, {}, {
      attacker: { statStages: { attack: -3, defense: 2, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 } },
    });
    expect(applyPowerMod(ctxNegative)).toBe(20 + 2 * 20);
  });

  it("punishment: 60 + 20 per defender positive boost, capped at 200", () => {
    const atk = makePokemon("a");
    const def = makePokemon("d");
    const ctxBase = makeCtx("punishment", atk, def);
    expect(applyPowerMod(ctxBase)).toBe(60);

    const ctxBoosted = makeCtx("punishment", atk, def, {}, {
      defender: { statStages: { attack: 3, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 } },
    });
    expect(applyPowerMod(ctxBoosted)).toBe(60 + 3 * 20);

    // cap at 200
    const ctxCap = makeCtx("punishment", atk, def, {}, {
      defender: { statStages: { attack: 6, defense: 6, spAttack: 6, spDefense: 6, speed: 6, accuracy: 0, evasion: 0 } },
    });
    expect(applyPowerMod(ctxCap)).toBe(200);
  });

  it("payback: doubles power when defender has already submitted an action", () => {
    const atk = makePokemon("a");
    const def = makePokemon("d");
    const ctxAfter = makeCtx("payback", atk, def, { power: 50 }, {
      defender: { actionSubmitted: true },
    });
    expect(applyPowerMod(ctxAfter)).toBe(100);

    const ctxBefore = makeCtx("payback", atk, def, { power: 50 }, {
      defender: { actionSubmitted: false },
    });
    expect(applyPowerMod(ctxBefore)).toBe(50);
  });

  it("wake-up-slap: double power vs sleep and cures it on hit", () => {
    const atk = makePokemon("a");
    const defAsleep = makePokemon("d", { statusCondition: "sleep", sleepTurns: 3 });
    const ctx = makeCtx("wake-up-slap", atk, defAsleep, { power: 70 });
    expect(applyPowerMod(ctx)).toBe(140);

    // The onHit clears sleep — invoke effects directly
    // (we only test the registry contract here; executor integration lives in pvp-room)
    const effects = getMoveEffects("wake-up-slap");
    effects?.onHit?.(ctx);
    expect(defAsleep.statusCondition).toBeNull();
    expect(defAsleep.sleepTurns).toBeUndefined();
  });

  it("smelling-salts: double power vs paralysis and cures it on hit", () => {
    const atk = makePokemon("a");
    const defParalyzed = makePokemon("d", { statusCondition: "paralysis" });
    const ctx = makeCtx("smelling-salts", atk, defParalyzed, { power: 70 });
    expect(applyPowerMod(ctx)).toBe(140);

    const effects = getMoveEffects("smelling-salts");
    effects?.onHit?.(ctx);
    expect(defParalyzed.statusCondition).toBeNull();
  });
});
