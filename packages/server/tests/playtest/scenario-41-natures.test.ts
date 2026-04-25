/**
 * Scenario 41 — Nature System.
 *
 * For each of 25 canonical natures (5 of which are neutral): verify
 * `applyNatureModifier` increases the right stat by ×1.1 and decreases
 * the other by ×0.9 (or no change for neutral). Other stats untouched.
 *
 * Pure data + pure-function test — no server boot.
 */
import { describe, it, expect } from "vitest";
import { applyNatureModifier } from "../../src/game/pokemon-stats.js";
import { getNatures } from "../../src/game/data-loader.js";
import type { PokemonStats } from "../../../../shared/types.js";

type StatKey = keyof PokemonStats;

const STAT_KEYS: StatKey[] = ["attack", "defense", "spAttack", "spDefense", "speed"];

const NEUTRAL_NATURE_IDS = new Set(["hardy", "docile", "bashful", "quirky", "serious"]);

function makeStats(): PokemonStats {
  // Use values that survive Math.floor cleanly: 100 → 110 (×1.1), 100 → 90 (×0.9).
  return { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 };
}

describe("Scenario 41 — Nature System", () => {
  const natures = getNatures();

  it("data file contains exactly 25 natures", () => {
    expect(natures).toHaveLength(25);
  });

  it("all 5 canonical neutral natures are present and have null increased/decreased", () => {
    for (const id of NEUTRAL_NATURE_IDS) {
      const n = natures.find((x) => x.id === id);
      expect(n, `nature ${id} should exist`).toBeDefined();
      expect(n?.increasedStat).toBeNull();
      expect(n?.decreasedStat).toBeNull();
    }
  });

  it("non-neutral natures: increasedStat and decreasedStat are both set and refer to canonical stat keys", () => {
    for (const n of natures) {
      if (NEUTRAL_NATURE_IDS.has(n.id)) continue;
      expect(n.increasedStat, `${n.id}.increasedStat`).toBeTruthy();
      expect(n.decreasedStat, `${n.id}.decreasedStat`).toBeTruthy();
      expect(STAT_KEYS).toContain(n.increasedStat as StatKey);
      expect(STAT_KEYS).toContain(n.decreasedStat as StatKey);
      expect(n.increasedStat).not.toBe(n.decreasedStat);
    }
  });

  // ── Per-nature: applies modifier correctly ──
  it.each(
    // Vitest's it.each requires a literal array of tuples; build at module
    // load. Each row: [natureId, expectedIncreased, expectedDecreased].
    (() => getNatures().map((n) => [n.id, n.increasedStat, n.decreasedStat] as const))(),
  )("nature '%s' applies +10%% to %s and -10%% to %s, other stats unchanged", (
    natureId,
    incStat,
    decStat,
  ) => {
    const stats = makeStats();
    applyNatureModifier(stats, natureId);

    for (const key of STAT_KEYS) {
      if (key === incStat) {
        expect(stats[key]).toBe(110);
      } else if (key === decStat) {
        expect(stats[key]).toBe(90);
      } else {
        expect(stats[key]).toBe(100);
      }
    }
  });

  it("unknown nature id is a no-op (defensive default)", () => {
    const stats = makeStats();
    applyNatureModifier(stats, "totallyMadeUpNature");
    expect(stats).toEqual({ attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 });
  });

  it("undefined nature is a no-op", () => {
    const stats = makeStats();
    applyNatureModifier(stats, undefined);
    expect(stats).toEqual({ attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 });
  });

  it("Math.floor truncates fractional results (×1.1 of 75 = 82.5 → 82)", () => {
    const stats: PokemonStats = { attack: 75, defense: 75, spAttack: 75, spDefense: 75, speed: 75 };
    applyNatureModifier(stats, "adamant"); // +attack, -spAttack
    expect(stats.attack).toBe(82); // Math.floor(75 * 1.1) = Math.floor(82.5) = 82
    expect(stats.spAttack).toBe(67); // Math.floor(75 * 0.9) = Math.floor(67.5) = 67
    expect(stats.defense).toBe(75);
    expect(stats.spDefense).toBe(75);
    expect(stats.speed).toBe(75);
  });
});
