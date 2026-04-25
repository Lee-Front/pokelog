/**
 * Scenario 46 — Critical Hit Stages.
 *
 * Verifies the crit-stage probability table consumed by `calculateDamage`:
 *   stage 0: 1/24
 *   stage 1: 1/8
 *   stage 2: 1/2
 *   stage 3+: always crit (1/1)
 *
 * The implementation lives in battle.ts:
 *     critThresholds = [24, 8, 2, 1]
 *     isCritical = Math.random() * critDenominator < 1
 *
 * We sample over 4000+ trials per stage and assert the empirical
 * proportion lands inside a generous band around the expected rate.
 *
 * Pure damage-formula test — no server boot.
 */
import { describe, it, expect } from "vitest";
import { calculateDamage } from "../../src/game/battle.js";
import type { MoveData, PokemonStats } from "../../../../shared/types.js";

const ATTACKER_STATS: PokemonStats = {
  attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100,
};

function makeMove(overrides: Partial<MoveData> = {}): MoveData {
  return {
    id: "test-move",
    name: "Test",
    type: "normal",
    category: "physical",
    power: 80,
    accuracy: 100, // skip miss; we want every roll to enter the crit branch
    pp: 20,
    description: "",
    priority: 0,
    target: "selected-pokemon",
    meta: { critRate: 0 },
    statChanges: [],
    ...overrides,
  };
}

/**
 * Run `n` damage calcs at the given crit stage and return the empirical
 * crit rate. The damage formula multiplies by 1.5 on crit; we identify
 * crits via `result.critical` flag exposed by calculateDamage.
 */
function empiricalCritRate(critStage: number, n: number): number {
  const move = makeMove({
    meta: { critRate: critStage },
    accuracy: 100, // ensure no miss
  });
  let crits = 0;
  for (let i = 0; i < n; i++) {
    // accuracy uses Math.random() too; use 100% accuracy + low power so
    // we don't blow up; we only care about result.critical.
    const r = calculateDamage(
      50,
      ATTACKER_STATS,
      ATTACKER_STATS,
      move,
      ["normal"],
      ["normal"],
    );
    if (r.critical) crits++;
  }
  return crits / n;
}

describe("Scenario 46 — Critical Hit Stages", () => {
  // Stage 0: expected ~4.17%; tolerate [2%, 7%].
  it("stage 0 crit rate ≈ 1/24 (over 4000 trials)", () => {
    const rate = empiricalCritRate(0, 4000);
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.07);
  });

  // Stage 1: expected 12.5%; tolerate [9%, 17%].
  it("stage 1 crit rate ≈ 1/8 (over 4000 trials)", () => {
    const rate = empiricalCritRate(1, 4000);
    expect(rate).toBeGreaterThan(0.09);
    expect(rate).toBeLessThan(0.17);
  });

  // Stage 2: expected 50%; tolerate [44%, 56%].
  it("stage 2 crit rate ≈ 1/2 (over 4000 trials)", () => {
    const rate = empiricalCritRate(2, 4000);
    expect(rate).toBeGreaterThan(0.44);
    expect(rate).toBeLessThan(0.56);
  });

  // Stage 3+: always crit. Verify exact 1.0.
  it("stage 3 always crits", () => {
    const rate = empiricalCritRate(3, 200);
    expect(rate).toBe(1);
  });

  it("stage 4 (out-of-table) is clamped to stage 3 → always crit", () => {
    // Implementation does Math.min(critStage, 3) — anything >= 3 always crits.
    const rate = empiricalCritRate(4, 200);
    expect(rate).toBe(1);
  });

  it("stage 999 (e.g. Merciless equivalent) → always crit", () => {
    const rate = empiricalCritRate(999, 100);
    expect(rate).toBe(1);
  });

  // ── Combinations: bonusCrit accumulators in pvp-turn-resolution sum
  // discrete +1/+2 contributions. We simulate them by starting at the
  // pre-summed stage. ──

  it("super-luck (+1) on a base move: equivalent to stage 1 ≈ 1/8", () => {
    // super-luck adds +1 to critRate before calculateDamage runs.
    const rate = empiricalCritRate(1, 4000);
    expect(rate).toBeGreaterThan(0.09);
    expect(rate).toBeLessThan(0.17);
  });

  it("focus-energy (+2): equivalent to stage 2 ≈ 1/2", () => {
    const rate = empiricalCritRate(2, 4000);
    expect(rate).toBeGreaterThan(0.44);
    expect(rate).toBeLessThan(0.56);
  });

  it("super-luck + focus-energy (+1+2 = stage 3): always crit", () => {
    const rate = empiricalCritRate(3, 200);
    expect(rate).toBe(1);
  });

  it("scope-lens + super-luck (+1+1 = stage 2): ≈ 1/2", () => {
    const rate = empiricalCritRate(2, 4000);
    expect(rate).toBeGreaterThan(0.44);
    expect(rate).toBeLessThan(0.56);
  });

  it("crit deals ~1.5x damage on hit (no random factor variance: just the formula)", () => {
    // Force always-crit (stage 3) and compare distribution against non-crit.
    // We assert mean damage of crit pool > mean damage of non-crit pool.
    const move = makeMove();
    const critMove = makeMove({ meta: { critRate: 3 } });

    let sumCrit = 0;
    let sumNorm = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      sumCrit += calculateDamage(50, ATTACKER_STATS, ATTACKER_STATS, critMove, ["normal"], ["normal"]).damage;
      sumNorm += calculateDamage(50, ATTACKER_STATS, ATTACKER_STATS, move, ["normal"], ["normal"]).damage;
    }
    const meanCrit = sumCrit / n;
    const meanNorm = sumNorm / n;
    // 1.5× expected; but stage-0 still includes a few crits, so ratio
    // is between ~1.4 and ~1.6.
    expect(meanCrit / meanNorm).toBeGreaterThan(1.3);
    expect(meanCrit / meanNorm).toBeLessThan(1.7);
  });
});
