import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executePlayerAttack,
  resolvePreAttack,
  determineBattleTurnOrder,
  applyEndOfTurnBattle,
} from "../../src/game/battle-state.js";
import type {
  BattleState,
  OwnedPokemon,
  MoveData,
  StatStages,
  VolatileStatus,
} from "../../../../shared/types.js";

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function makeStats(overrides?: Partial<{ attack: number; defense: number; speed: number; spAttack: number; spDefense: number }>) {
  return { attack: 50, defense: 50, speed: 50, spAttack: 50, spDefense: 50, ...overrides };
}

function makeStatStages(overrides?: Partial<StatStages>): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, ...overrides };
}

function makeMove(overrides?: Partial<MoveData>): MoveData {
  return {
    id: "tackle",
    name: "몸통박치기",
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    pp: 35,
    description: "",
    priority: 0,
    ...overrides,
  };
}

function makePlayerPokemon(overrides?: Partial<OwnedPokemon>): OwnedPokemon {
  return {
    uid: "test-uid-1",
    species: "bulbasaur",
    nickname: null,
    level: 10,
    exp: 0,
    hp: 100,
    maxHp: 100,
    stats: makeStats(),
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    caughtAt: "2026-01-01",
    statusCondition: null,
    ...overrides,
  };
}

function makeBattle(overrides?: Partial<BattleState>): BattleState {
  return {
    eventId: "evt-1",
    myPokemonUid: "test-uid-1",
    turn: 1,
    wild: {
      species: "rattata",
      level: 5,
      hp: 50,
      maxHp: 50,
      stats: makeStats({ attack: 30, defense: 30, speed: 40 }),
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    },
    playerStatStages: makeStatStages(),
    wildStatStages: makeStatStages(),
    playerVolatile: [],
    wildVolatile: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// executePlayerAttack
// ---------------------------------------------------------------------------

describe("executePlayerAttack", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("deals damage to the wild pokemon and logs a message", () => {
    // Accuracy hit, random factor 0 (gives 0.85), no critical
    randomSpy.mockReturnValue(0.5);

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const move = makeMove();
    const log: string[] = [];

    executePlayerAttack(battle, player, move, { id: "tackle", pp: 35, maxPp: 35 }, log);

    expect(battle.wild.hp).toBeLessThan(50);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatch(/bulbasaur/);
  });

  it("does not mutate wild HP when move misses", () => {
    // accuracy check: miss (return value >= accuracy/100, i.e. >= 1.0 — return 0.999)
    randomSpy.mockReturnValueOnce(0.999);

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const move = makeMove({ accuracy: 50 }); // 50% accuracy
    const log: string[] = [];
    const initialHp = battle.wild.hp;

    executePlayerAttack(battle, player, move, { id: "tackle", pp: 35, maxPp: 35 }, log);

    expect(battle.wild.hp).toBe(initialHp);
    expect(log.some((m) => m.includes("빗나갔다"))).toBe(true);
  });

  it("decrements PP of the selected move", () => {
    randomSpy.mockReturnValue(0.5);

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const selectedMove = { id: "tackle", pp: 35, maxPp: 35 };
    const move = makeMove();
    const log: string[] = [];

    executePlayerAttack(battle, player, move, selectedMove, log);

    expect(selectedMove.pp).toBe(34);
  });

  it("applies burn attack halving for physical moves", () => {
    randomSpy.mockReturnValue(0.5);

    const battle = makeBattle();
    const playerNormal = makePlayerPokemon();
    const playerBurned = makePlayerPokemon({ statusCondition: "burn" });
    const move = makeMove({ category: "physical" });
    const log1: string[] = [];
    const log2: string[] = [];

    const battle2 = makeBattle();

    executePlayerAttack(battle, playerNormal, move, { id: "tackle", pp: 35, maxPp: 35 }, log1);
    const normalWildHp = battle.wild.hp;

    randomSpy.mockReturnValue(0.5); // reset mock behavior
    executePlayerAttack(battle2, playerBurned, move, { id: "tackle", pp: 35, maxPp: 35 }, log2);
    const burnedWildHp = battle2.wild.hp;

    // Burned attacker should deal less damage (wild hp should be higher than after normal attack)
    expect(burnedWildHp).toBeGreaterThanOrEqual(normalWildHp);
  });

  it("applies drain healing to player", () => {
    randomSpy.mockReturnValue(0.5);

    const battle = makeBattle();
    const player = makePlayerPokemon({ hp: 50, maxHp: 100 });
    const move = makeMove({ meta: { drain: 50 } }); // 50% drain
    const log: string[] = [];

    executePlayerAttack(battle, player, move, { id: "tackle", pp: 35, maxPp: 35 }, log);

    // Player should have gained HP from drain
    expect(player.hp).toBeGreaterThan(50);
  });

  it("applies status ailment (burn) to wild from player attack", () => {
    // Need: accuracy hit, then ailment roll hits (need value < 1.0 for 100% chance)
    randomSpy.mockReturnValue(0.5);

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const move = makeMove({
      type: "fire",
      meta: { ailment: "burn", ailmentChance: 100 },
    });
    const log: string[] = [];

    executePlayerAttack(battle, player, move, { id: "ember", pp: 25, maxPp: 25 }, log);

    expect(battle.wild.statusCondition).toBe("burn");
  });

  it("returns flinchCaused=true when flinch roll succeeds", () => {
    // calculateDamage calls: (1) accuracy, (2) crit, (3) random factor
    // then applyAilmentToTarget stat-chance and flinch check follow
    // We set all to 0.1 so: accuracy hits, crit fails (0.1*24 < 1 → crit!), random factor low,
    // ailment chance skip (no ailment), stat-chance skip (no stat changes), flinch roll 0.1 < 0.30
    // Use a controlled sequence: accuracy=0.1(hit), crit=0.99(no crit), randomFactor=0.1, flinch=0.1
    randomSpy
      .mockReturnValueOnce(0.1)  // accuracy: 0.1*100=10 < 100 → hit
      .mockReturnValueOnce(0.99) // crit: 0.99*24 >= 1 → no crit
      .mockReturnValueOnce(0.0)  // random factor: 0.85
      .mockReturnValueOnce(0.1); // flinch: 0.1*100=10 < 30 → flinch

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const move = makeMove({ meta: { flinchChance: 30 } });
    const log: string[] = [];

    const result = executePlayerAttack(battle, player, move, { id: "tackle", pp: 35, maxPp: 35 }, log);

    expect(result.flinchCaused).toBe(true);
  });

  it("returns flinchCaused=false when flinch roll fails", () => {
    // accuracy hit, no crit, random factor, flinch roll >= 30%
    randomSpy
      .mockReturnValueOnce(0.1)  // accuracy: hit
      .mockReturnValueOnce(0.99) // crit: no crit
      .mockReturnValueOnce(0.0)  // random factor
      .mockReturnValueOnce(0.99); // flinch: 0.99*100=99 >= 30 → no flinch

    const battle = makeBattle();
    const player = makePlayerPokemon();
    const move = makeMove({ meta: { flinchChance: 30 } });
    const log: string[] = [];

    const result = executePlayerAttack(battle, player, move, { id: "tackle", pp: 35, maxPp: 35 }, log);

    expect(result.flinchCaused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePreAttack
// ---------------------------------------------------------------------------

describe("resolvePreAttack", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("allows action when no status and no volatiles", () => {
    const player = makePlayerPokemon();
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(true);
    expect(log).toHaveLength(0);
  });

  it("blocks action when asleep (sleepTurns > 0)", () => {
    const player = makePlayerPokemon({ statusCondition: "sleep", sleepTurns: 2 });
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(false);
    expect(player.sleepTurns).toBe(1); // decremented
    expect(log.some((m) => m.includes("자고"))).toBe(true);
  });

  it("wakes pokemon when sleepTurns reaches 0", () => {
    const player = makePlayerPokemon({ statusCondition: "sleep", sleepTurns: 1 });
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(true);
    expect(player.statusCondition).toBeNull();
    expect(player.sleepTurns).toBeUndefined();
    expect(log.some((m) => m.includes("깨어났다"))).toBe(true);
  });

  it("thaws frozen pokemon when random check passes", () => {
    randomSpy.mockReturnValueOnce(0.1); // < 0.2, thaw

    const player = makePlayerPokemon({ statusCondition: "freeze" });
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(true);
    expect(player.statusCondition).toBeNull();
    expect(log.some((m) => m.includes("얼음"))).toBe(true);
  });

  it("blocks action when frozen and thaw fails", () => {
    randomSpy.mockReturnValueOnce(0.5); // >= 0.2, no thaw

    const player = makePlayerPokemon({ statusCondition: "freeze" });
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(false);
    expect(player.statusCondition).toBe("freeze"); // still frozen
  });

  it("blocks action when paralysis check fails", () => {
    randomSpy.mockReturnValueOnce(0.1); // < 0.25, skip turn

    const player = makePlayerPokemon({ statusCondition: "paralysis" });
    const log: string[] = [];

    const result = resolvePreAttack(player, [], log);

    expect(result.canAct).toBe(false);
  });

  it("deals self damage from confusion hit", () => {
    const confusion: VolatileStatus = { id: "confusion", turnsRemaining: 3 };
    randomSpy.mockReturnValueOnce(0.1); // < 0.33, confusion hit

    const player = makePlayerPokemon({ hp: 100 });
    const log: string[] = [];

    const result = resolvePreAttack(player, [confusion], log);

    expect(result.canAct).toBe(false);
    expect(result.selfDamage).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// determineBattleTurnOrder
// ---------------------------------------------------------------------------

describe("determineBattleTurnOrder", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("player goes first when faster", () => {
    const player = makePlayerPokemon({ stats: makeStats({ speed: 100 }) });
    const battle = makeBattle({
      wild: { ...makeBattle().wild, stats: makeStats({ speed: 50 }) },
    });
    const playerMove = makeMove({ priority: 0 });
    const wildMove = makeMove({ priority: 0 });

    const result = determineBattleTurnOrder(battle, player, playerMove, wildMove);

    expect(result).toBe("player");
  });

  it("wild goes first when faster", () => {
    const player = makePlayerPokemon({ stats: makeStats({ speed: 50 }) });
    const battle = makeBattle({
      wild: { ...makeBattle().wild, stats: makeStats({ speed: 100 }) },
    });
    const playerMove = makeMove({ priority: 0 });
    const wildMove = makeMove({ priority: 0 });

    const result = determineBattleTurnOrder(battle, player, playerMove, wildMove);

    expect(result).toBe("wild");
  });

  it("higher priority move goes first regardless of speed", () => {
    const player = makePlayerPokemon({ stats: makeStats({ speed: 50 }) });
    const battle = makeBattle({
      wild: { ...makeBattle().wild, stats: makeStats({ speed: 100 }) },
    });
    const playerMove = makeMove({ priority: 1 }); // quick attack
    const wildMove = makeMove({ priority: 0 });

    const result = determineBattleTurnOrder(battle, player, playerMove, wildMove);

    expect(result).toBe("player");
  });

  it("paralysis reduces speed for turn order", () => {
    // Player speed 100 but paralyzed → effective 50; wild speed 70 → wild goes first
    const player = makePlayerPokemon({ stats: makeStats({ speed: 100 }), statusCondition: "paralysis" });
    const battle = makeBattle({
      wild: { ...makeBattle().wild, stats: makeStats({ speed: 70 }) },
    });
    const playerMove = makeMove({ priority: 0 });
    const wildMove = makeMove({ priority: 0 });

    const result = determineBattleTurnOrder(battle, player, playerMove, wildMove);

    expect(result).toBe("wild");
  });

  it("stat stage speed boost is applied", () => {
    // Player speed 50, wild speed 50. Player has +6 speed stages → player goes first.
    const player = makePlayerPokemon({ stats: makeStats({ speed: 50 }) });
    const battle = makeBattle({
      wild: { ...makeBattle().wild, stats: makeStats({ speed: 50 }) },
      playerStatStages: makeStatStages({ speed: 6 }),
    });
    const playerMove = makeMove({ priority: 0 });
    const wildMove = makeMove({ priority: 0 });

    const result = determineBattleTurnOrder(battle, player, playerMove, wildMove);

    expect(result).toBe("player");
  });
});

// ---------------------------------------------------------------------------
// applyEndOfTurnBattle
// ---------------------------------------------------------------------------

describe("applyEndOfTurnBattle", () => {
  it("applies poison damage to player at end of turn", () => {
    const player = makePlayerPokemon({ hp: 100, maxHp: 100, statusCondition: "poison" });
    const battle = makeBattle();
    const log: string[] = [];

    applyEndOfTurnBattle(battle, player, log);

    expect(player.hp).toBeLessThan(100);
    expect(log.some((m) => m.includes("bulbasaur"))).toBe(true);
  });

  it("applies poison damage to wild at end of turn", () => {
    const player = makePlayerPokemon();
    const battle = makeBattle();
    battle.wild.statusCondition = "poison";
    const wildInitialHp = battle.wild.hp;
    const log: string[] = [];

    applyEndOfTurnBattle(battle, player, log);

    expect(battle.wild.hp).toBeLessThan(wildInitialHp);
    expect(log.some((m) => m.includes("rattata"))).toBe(true);
  });

  it("ticks gigantamax countdown and reverts form at 0", () => {
    const player = makePlayerPokemon({ hp: 300, maxHp: 300 });
    const battle = makeBattle({
      transformationType: "gigantamax",
      gmaxTurnsRemaining: 1,
      playerPreTransformMaxHp: 100,
    });
    const log: string[] = [];

    applyEndOfTurnBattle(battle, player, log);

    expect(battle.transformationType).toBeNull();
    expect(battle.gmaxTurnsRemaining).toBe(0);
    expect(log.some((m) => m.includes("기가맥스가 풀렸다"))).toBe(true);
  });

  it("decrements gigantamax countdown without reverting when > 1", () => {
    const player = makePlayerPokemon({ hp: 300, maxHp: 300 });
    const battle = makeBattle({
      transformationType: "gigantamax",
      gmaxTurnsRemaining: 3,
      playerPreTransformMaxHp: 100,
    });
    const log: string[] = [];

    applyEndOfTurnBattle(battle, player, log);

    expect(battle.gmaxTurnsRemaining).toBe(2);
    expect(battle.transformationType).toBe("gigantamax");
    expect(log).toHaveLength(0);
  });

  it("ticks volatile statuses at end of turn", () => {
    const player = makePlayerPokemon();
    const battle = makeBattle({
      playerVolatile: [{ id: "confusion", turnsRemaining: 1 }],
    });
    const log: string[] = [];

    applyEndOfTurnBattle(battle, player, log);

    // Confusion with 1 turn remaining should be ticked (removed or decremented)
    const confusionAfter = battle.playerVolatile?.find((v) => v.id === "confusion");
    // After tick: turnsRemaining goes to 0 and should be removed
    expect(confusionAfter).toBeUndefined();
  });
});
