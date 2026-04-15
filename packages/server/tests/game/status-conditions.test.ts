import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  canApplyPrimaryStatus,
  rollAilment,
  checkPreAttack,
  applyEndOfTurn,
  tickVolatiles,
  addVolatile,
  hasVolatile,
} from "../../src/game/status-conditions.js";
import type { PokemonStats, VolatileStatus } from "../../../../shared/types.js";

const defaultStats: PokemonStats = {
  attack: 50,
  defense: 50,
  speed: 50,
  spAttack: 50,
  spDefense: 50,
};

describe("canApplyPrimaryStatus", () => {
  it("returns true when no status", () => {
    expect(canApplyPrimaryStatus(null)).toBe(true);
    expect(canApplyPrimaryStatus(undefined)).toBe(true);
  });

  it("returns false when already has a status", () => {
    expect(canApplyPrimaryStatus("poison")).toBe(false);
    expect(canApplyPrimaryStatus("burn")).toBe(false);
  });
});

describe("rollAilment", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("returns null for 'none' ailment", () => {
    expect(rollAilment("none", 100, null)).toBeNull();
  });

  it("applies poison when chance succeeds", () => {
    // chance 30: Math.random() * 100 < 30 → 0.1 * 100 = 10 < 30 → success
    randomSpy.mockReturnValueOnce(0.1);
    expect(rollAilment("poison", 30, null)).toBe("poison");
  });

  it("respects ailmentChance - fails when roll is too high", () => {
    // chance 30: Math.random() * 100 >= 30 → 0.5 * 100 = 50 >= 30 → fail
    randomSpy.mockReturnValueOnce(0.5);
    expect(rollAilment("poison", 30, null)).toBeNull();
  });

  it("always applies when chance is 100", () => {
    expect(rollAilment("burn", 100, null)).toBe("burn");
  });

  it("blocks duplicate primary status", () => {
    expect(rollAilment("poison", 100, "burn")).toBeNull();
  });

  it("blocks applying same status again", () => {
    expect(rollAilment("poison", 100, "poison")).toBeNull();
  });

  it("maps ailment strings to correct PrimaryStatus", () => {
    expect(rollAilment("paralysis", 100, null)).toBe("paralysis");
    expect(rollAilment("sleep", 100, null)).toBe("sleep");
    expect(rollAilment("freeze", 100, null)).toBe("freeze");
  });

  it("returns null for volatile ailments (handled separately)", () => {
    expect(rollAilment("confusion", 100, null)).toBeNull();
    expect(rollAilment("trap", 100, null)).toBeNull();
  });
});

describe("checkPreAttack", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("returns canAct=true when no status", () => {
    const result = checkPreAttack(null, [], defaultStats, 50);
    expect(result.canAct).toBe(true);
  });

  it("sleep prevents action", () => {
    const result = checkPreAttack("sleep", [], defaultStats, 50);
    expect(result.canAct).toBe(false);
    expect(result.message).toContain("자고있다");
  });

  it("freeze has 20% thaw chance - thaws", () => {
    randomSpy.mockReturnValueOnce(0.1); // < 0.2 → thaw
    const result = checkPreAttack("freeze", [], defaultStats, 50);
    expect(result.canAct).toBe(true);
    expect(result.statusCleared).toBe("freeze");
    expect(result.message).toContain("풀렸다");
  });

  it("freeze has 20% thaw chance - stays frozen", () => {
    randomSpy.mockReturnValueOnce(0.5); // >= 0.2 → stay frozen
    const result = checkPreAttack("freeze", [], defaultStats, 50);
    expect(result.canAct).toBe(false);
    expect(result.message).toContain("얼어붙어");
  });

  it("paralysis has 25% skip chance - skips", () => {
    randomSpy.mockReturnValueOnce(0.1); // < 0.25 → paralyzed
    const result = checkPreAttack("paralysis", [], defaultStats, 50);
    expect(result.canAct).toBe(false);
    expect(result.message).toContain("마비");
  });

  it("paralysis has 25% skip chance - can act", () => {
    randomSpy.mockReturnValueOnce(0.5); // >= 0.25 → can act
    const result = checkPreAttack("paralysis", [], defaultStats, 50);
    expect(result.canAct).toBe(true);
  });

  it("confusion causes self-damage when roll hits", () => {
    randomSpy.mockReturnValueOnce(0.1); // < 0.33 → self-hit
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 3 }];
    const result = checkPreAttack(null, volatiles, defaultStats, 50);
    expect(result.canAct).toBe(false);
    expect(result.selfDamage).toBeGreaterThan(0);
    expect(result.message).toContain("혼란");
  });

  it("confusion allows action when roll misses", () => {
    randomSpy.mockReturnValueOnce(0.5); // >= 0.33 → can act
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 3 }];
    const result = checkPreAttack(null, volatiles, defaultStats, 50);
    expect(result.canAct).toBe(true);
  });

  it("confusion self-damage scales with level", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 3 }];

    randomSpy.mockReturnValueOnce(0.1); // < 0.33 → self-hit
    const lowLevel = checkPreAttack(null, volatiles, defaultStats, 10);

    randomSpy.mockReturnValueOnce(0.1); // < 0.33 → self-hit
    const highLevel = checkPreAttack(null, volatiles, defaultStats, 80);

    expect(lowLevel.selfDamage).toBeDefined();
    expect(highLevel.selfDamage).toBeDefined();
    expect(highLevel.selfDamage!).toBeGreaterThan(lowLevel.selfDamage!);
  });
});

describe("applyEndOfTurn", () => {
  it("poison damage = maxHp/8", () => {
    const result = applyEndOfTurn("poison", [], 100, 100);
    expect(result.damage).toBe(12); // floor(100/8) = 12
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain("독");
  });

  it("burn damage = maxHp/16", () => {
    const result = applyEndOfTurn("burn", [], 100, 100);
    expect(result.damage).toBe(6); // floor(100/16) = 6
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain("화상");
  });

  it("trap damage = maxHp/8", () => {
    const volatiles: VolatileStatus[] = [{ id: "trap", turnsRemaining: 3 }];
    const result = applyEndOfTurn(null, volatiles, 80, 100);
    expect(result.damage).toBe(10); // floor(80/8) = 10
    expect(result.messages[0]).toContain("조이기");
  });

  it("leech-seed drains maxHp/8 and heals opponent", () => {
    const volatiles: VolatileStatus[] = [{ id: "leech-seed", turnsRemaining: -1 }];
    const result = applyEndOfTurn(null, volatiles, 80, 100);
    expect(result.damage).toBe(10); // floor(80/8)
    expect(result.opponentHealing).toBe(10);
    expect(result.messages[0]).toContain("씨뿌리기");
  });

  it("nightmare only deals damage when sleeping", () => {
    const volatiles: VolatileStatus[] = [{ id: "nightmare", turnsRemaining: -1 }];
    // Not sleeping -- no nightmare damage
    const result1 = applyEndOfTurn(null, volatiles, 100, 100);
    expect(result1.damage).toBe(0);

    // Sleeping -- nightmare deals maxHp/4
    const result2 = applyEndOfTurn("sleep", volatiles, 100, 100);
    expect(result2.damage).toBe(25); // floor(100/4) = 25
  });

  it("returns no effects when no status", () => {
    const result = applyEndOfTurn(null, [], 100, 100);
    expect(result.damage).toBe(0);
    expect(result.healing).toBe(0);
    expect(result.opponentHealing).toBe(0);
    expect(result.messages).toHaveLength(0);
  });

  it("minimum damage is 1 for low maxHp", () => {
    const result = applyEndOfTurn("poison", [], 1, 100);
    expect(result.damage).toBe(1);
  });
});

describe("tickVolatiles", () => {
  it("decrements turnsRemaining", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 3 }];
    const result = tickVolatiles(volatiles);
    expect(result).toHaveLength(1);
    expect(result[0].turnsRemaining).toBe(2);
  });

  it("removes expired volatiles (turnsRemaining reaches 0)", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 1 }];
    const result = tickVolatiles(volatiles);
    expect(result).toHaveLength(0);
  });

  it("keeps permanent volatiles (turnsRemaining = -1)", () => {
    const volatiles: VolatileStatus[] = [{ id: "leech-seed", turnsRemaining: -1 }];
    const result = tickVolatiles(volatiles);
    expect(result).toHaveLength(1);
    expect(result[0].turnsRemaining).toBe(-1);
  });

  it("handles mixed volatiles correctly", () => {
    const volatiles: VolatileStatus[] = [
      { id: "confusion", turnsRemaining: 1 }, // will be removed
      { id: "trap", turnsRemaining: 3 },      // will decrement
      { id: "leech-seed", turnsRemaining: -1 }, // will stay
    ];
    const result = tickVolatiles(volatiles);
    expect(result).toHaveLength(2);
    expect(result.find(v => v.id === "confusion")).toBeUndefined();
    expect(result.find(v => v.id === "trap")?.turnsRemaining).toBe(2);
    expect(result.find(v => v.id === "leech-seed")?.turnsRemaining).toBe(-1);
  });
});

describe("addVolatile", () => {
  it("adds new volatile status", () => {
    const result = addVolatile([], "confusion", 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "confusion", turnsRemaining: 3 });
  });

  it("prevents duplicates", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 2 }];
    const result = addVolatile(volatiles, "confusion", 4);
    expect(result).toHaveLength(1);
    expect(result[0].turnsRemaining).toBe(2); // keeps original turns
    expect(result).toBe(volatiles); // returns same reference
  });

  it("allows different volatiles", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 2 }];
    const result = addVolatile(volatiles, "trap", 4);
    expect(result).toHaveLength(2);
  });
});

describe("hasVolatile", () => {
  it("returns true when volatile exists", () => {
    const volatiles: VolatileStatus[] = [{ id: "confusion", turnsRemaining: 2 }];
    expect(hasVolatile(volatiles, "confusion")).toBe(true);
  });

  it("returns false when volatile does not exist", () => {
    expect(hasVolatile([], "confusion")).toBe(false);
    const volatiles: VolatileStatus[] = [{ id: "trap", turnsRemaining: 2 }];
    expect(hasVolatile(volatiles, "confusion")).toBe(false);
  });
});
