/**
 * Scenario 48 — Damage Variance.
 *
 * battle.ts uses `randomFactor = 0.85 + Math.random() * 0.15` to spread
 * damage across the canon ±15% band. We verify:
 *   - Min roll (random=0) → ×0.85 of the un-randomized base damage
 *   - Max roll (random=0.999...) → ×1.0 of base
 *   - 1000-trial mean ≈ 0.925 (midpoint)
 *   - Distribution roughly uniform
 *
 * Pure damage-formula test — no server boot.
 */
import { describe, it, expect, vi } from "vitest";
import { calculateDamage } from "../../src/game/battle.js";
import type { MoveData, PokemonStats } from "../../../../shared/types.js";

const STATS: PokemonStats = {
  attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100,
};

const move: MoveData = {
  id: "neutral-physical",
  name: "Test",
  type: "normal",
  category: "physical",
  power: 80,
  accuracy: 100,
  pp: 20,
  description: "",
  priority: 0,
  target: "selected-pokemon",
  meta: { critRate: 0 },
  statChanges: [],
};

// We need to control the three Math.random() calls inside calculateDamage:
//   1. accuracy roll  (move.accuracy = 100 → always passes regardless)
//   2. crit roll      (critRate = 0 → 1/24; control via mock value)
//   3. random factor  (0.85..1.0 spread)
//
// Strategy: mock Math.random to return a sequence per call.

function makeRandomQueue(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function damageWithRandomFactor(rf: number): number {
  // Sequence: [accuracy roll → 0 (always hits), crit roll → 0.99 (no crit at stage 0), random factor → rf]
  const queue = makeRandomQueue([0, 0.99, rf]);
  const spy = vi.spyOn(Math, "random").mockImplementation(queue);
  try {
    const r = calculateDamage(50, STATS, STATS, move, ["fire"], ["water"]);
    expect(r.missed).toBe(false);
    expect(r.critical).toBe(false);
    return r.damage;
  } finally {
    spy.mockRestore();
  }
}

describe("Scenario 48 — Damage Variance", () => {
  it("min random (0) → ~0.85 multiplier (lower bound)", () => {
    const dmgMin = damageWithRandomFactor(0);
    const dmgMax = damageWithRandomFactor(0.999);
    // dmgMin / dmgMax ≈ 0.85; floor truncation makes the ratio slightly
    // off. Use a band [0.83, 0.87] which is robust to ±1 of floor noise on
    // small damage figures.
    const ratio = dmgMin / dmgMax;
    expect(ratio).toBeGreaterThan(0.83);
    expect(ratio).toBeLessThan(0.87);
  });

  it("max random (0.999) damage > min random damage", () => {
    expect(damageWithRandomFactor(0.999)).toBeGreaterThan(damageWithRandomFactor(0));
  });

  it("intermediate random (0.5) lies between min and max", () => {
    const min = damageWithRandomFactor(0);
    const mid = damageWithRandomFactor(0.5);
    const max = damageWithRandomFactor(0.999);
    expect(mid).toBeGreaterThan(min);
    expect(mid).toBeLessThan(max);
  });

  it("1000 trials: mean factor ≈ 0.925 (within ±2%)", () => {
    // Use one big seeded sequence to feed 1000 calls. Each call consumes
    // 3 randoms (accuracy, crit, factor). Build a vector that uses
    // factor = i / 1000 to span [0, 1) uniformly.
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const factor = (i + 0.5) / 1000; // strictly within (0, 1)
      sum += damageWithRandomFactor(factor);
    }
    const meanDmg = sum / 1000;
    const maxDmg = damageWithRandomFactor(0.999);
    const meanFactor = meanDmg / maxDmg;

    // Expected: 0.925 (midpoint of [0.85, 1.0]). Allow ±2% slack.
    expect(meanFactor).toBeGreaterThan(0.905);
    expect(meanFactor).toBeLessThan(0.945);
  });

  it("distribution is roughly uniform: bottom-half mean ≈ 0.8875, top-half mean ≈ 0.9625", () => {
    // Expect bottom half [0.85..0.925] mean ≈ 0.8875 and
    // top half    [0.925..1.0] mean ≈ 0.9625.
    let sumLow = 0;
    let sumHigh = 0;
    for (let i = 0; i < 500; i++) {
      const factorLow = (i + 0.5) / 1000; // [0, 0.5)
      const factorHigh = factorLow + 0.5; // [0.5, 1)
      sumLow += damageWithRandomFactor(factorLow);
      sumHigh += damageWithRandomFactor(factorHigh);
    }
    const meanLow = sumLow / 500;
    const meanHigh = sumHigh / 500;
    expect(meanLow).toBeLessThan(meanHigh);

    const max = damageWithRandomFactor(0.999);
    const lowFactor = meanLow / max;
    const highFactor = meanHigh / max;

    // Loose bands accommodating Math.floor noise.
    expect(lowFactor).toBeGreaterThan(0.86);
    expect(lowFactor).toBeLessThan(0.92);
    expect(highFactor).toBeGreaterThan(0.93);
    expect(highFactor).toBeLessThan(0.99);
  });

  it("no random call returns NaN or zero damage in non-immune matchup", () => {
    for (let i = 0; i < 100; i++) {
      const factor = i / 100;
      const d = damageWithRandomFactor(factor);
      expect(d).toBeGreaterThan(0);
      expect(Number.isFinite(d)).toBe(true);
    }
  });
});
