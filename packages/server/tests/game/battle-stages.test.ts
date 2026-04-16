import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyStatStageMultiplier,
  applyStatChanges,
  calculateDamage,
  defaultStatStages,
} from "../../src/game/battle.js";
import type { PokemonStats, MoveData, StatStages } from "../../../../shared/types.js";

describe("applyStatStageMultiplier", () => {
  it("increases stat at positive stages", () => {
    // stage +1: floor(100 * 3/2) = 150
    expect(applyStatStageMultiplier(100, 1)).toBe(150);
    // stage +2: floor(100 * 4/2) = 200
    expect(applyStatStageMultiplier(100, 2)).toBe(200);
    // stage +4: floor(100 * 6/2) = 300
    expect(applyStatStageMultiplier(100, 4)).toBe(300);
    // stage +6: floor(100 * 8/2) = 400
    expect(applyStatStageMultiplier(100, 6)).toBe(400);
  });

  it("decreases stat at negative stages", () => {
    // stage -1: floor(100 * 2/3) = 66
    expect(applyStatStageMultiplier(100, -1)).toBe(66);
    // stage -2: floor(100 * 2/4) = 50
    expect(applyStatStageMultiplier(100, -2)).toBe(50);
    // stage -4: floor(100 * 2/6) = 33
    expect(applyStatStageMultiplier(100, -4)).toBe(33);
    // stage -6: floor(100 * 2/8) = 25
    expect(applyStatStageMultiplier(100, -6)).toBe(25);
  });

  it("clamps at -6 and +6", () => {
    // stage +10 should behave like +6
    expect(applyStatStageMultiplier(100, 10)).toBe(applyStatStageMultiplier(100, 6));
    // stage -10 should behave like -6
    expect(applyStatStageMultiplier(100, -10)).toBe(applyStatStageMultiplier(100, -6));
  });

  it("returns base stat at stage 0", () => {
    expect(applyStatStageMultiplier(100, 0)).toBe(100);
    expect(applyStatStageMultiplier(73, 0)).toBe(73);
  });
});

describe("applyStatChanges", () => {
  it("accumulates changes", () => {
    const stages = defaultStatStages();
    const result = applyStatChanges(stages, [
      { stat: "attack", change: 1 },
      { stat: "defense", change: -1 },
    ]);
    expect(result.attack).toBe(1);
    expect(result.defense).toBe(-1);
    expect(result.speed).toBe(0);

    // Apply another round
    const result2 = applyStatChanges(result, [
      { stat: "attack", change: 2 },
      { stat: "defense", change: -2 },
    ]);
    expect(result2.attack).toBe(3);
    expect(result2.defense).toBe(-3);
  });

  it("clamps at boundaries", () => {
    const stages: StatStages = { attack: 5, defense: -5, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };

    const result = applyStatChanges(stages, [
      { stat: "attack", change: 3 },    // 5+3=8 -> clamped to 6
      { stat: "defense", change: -3 },   // -5-3=-8 -> clamped to -6
    ]);
    expect(result.attack).toBe(6);
    expect(result.defense).toBe(-6);
  });

  it("ignores unknown stat names", () => {
    const stages = defaultStatStages();
    const result = applyStatChanges(stages, [
      { stat: "foobar", change: 1 },
    ]);
    expect(result).toEqual(defaultStatStages());
  });

  it("applies accuracy and evasion changes", () => {
    const stages = defaultStatStages();
    const result = applyStatChanges(stages, [
      { stat: "accuracy", change: 1 },
      { stat: "evasion", change: -1 },
    ]);
    expect(result.accuracy).toBe(1);
    expect(result.evasion).toBe(-1);
  });

  it("does not mutate original stages", () => {
    const stages = defaultStatStages();
    applyStatChanges(stages, [{ stat: "attack", change: 2 }]);
    expect(stages.attack).toBe(0);
  });
});

describe("calculateDamage with stat stages", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("applies stat stages to attack and defense", () => {
    // random() call 1: accuracy check → 0.5 (hit for accuracy 100)
    // random() call 2: randomFactor → 0.0 (gives 0.85)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    // Baseline: no stages
    const baseline = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    // With +2 attack stage: attack effectively doubles (50 -> 100)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const boosted = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      { attack: 2, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    );
    expect(boosted.damage).toBeGreaterThan(baseline.damage);

    // With +2 defense stage on defender: defense doubles (40 -> 80)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const walled = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      undefined,
      { attack: 0, defense: 2, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    );
    expect(walled.damage).toBeLessThan(baseline.damage);
  });

  it("works without stat stages (backward compatible)", () => {
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    // Without stages — STAB 1.5x applies (normal move + normal attacker)
    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);
    expect(result.missed).toBe(false);
    expect(result.damage).toBe(10);
  });

  it("uses spAttack/spDefense stages for special moves", () => {
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 60, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "ember",
      name: "불꽃세례",
      type: "fire",
      category: "special",
      power: 40,
      accuracy: 100,
      pp: 25,
      description: "",
    };

    // Baseline with no stages
    const baseline = calculateDamage(10, attackerStats, defenderStats, move, ["fire"], ["normal"]);

    // With +2 spAttack stage
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const boosted = calculateDamage(
      10, attackerStats, defenderStats, move, ["fire"], ["normal"],
      { attack: 0, defense: 0, spAttack: 2, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    );
    expect(boosted.damage).toBeGreaterThan(baseline.damage);
  });
});
