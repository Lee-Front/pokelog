/**
 * Scenario 40 — Type Effectiveness Matrix.
 *
 * Verifies the canonical 18×18 Pokemon type chart against `getTypeChart()`.
 * For every (attacker, defender) pair we check the matrix lookup yields the
 * expected multiplier. Also verifies dual-type defender multiplication.
 *
 * Pure data test — no server boot needed.
 */
import { describe, it, expect } from "vitest";
import { getTypeChart } from "../../src/game/data-loader.js";

const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
] as const;

type TypeName = typeof TYPES[number];

/**
 * Canonical Gen 6+ type chart. Entry [attacker][defender] is the
 * multiplier for `attacker` hitting `defender`. Missing entries default
 * to 1.0x in lookup helper below.
 */
const CANONICAL: Record<TypeName, Partial<Record<TypeName, number>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5,
    bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5,
    rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5,
  },
  poison: {
    grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5,
    steel: 0, fairy: 2,
  },
  ground: {
    fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0,
    bug: 0.5, rock: 2, steel: 2,
  },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5,
    psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

function expected(attacker: TypeName, defender: TypeName): number {
  const v = CANONICAL[attacker][defender];
  return v ?? 1;
}

function lookup(chart: Record<string, Record<string, number>>, attacker: string, defender: string): number {
  const row = chart[attacker] ?? {};
  return row[defender] ?? 1;
}

describe("Scenario 40 — Type Effectiveness Matrix", () => {
  const chart = getTypeChart();

  it("type chart contains all 18 attacker rows", () => {
    for (const t of TYPES) {
      expect(chart[t]).toBeDefined();
    }
  });

  it("matches canonical chart for all 324 (attacker, defender) pairs", () => {
    const mismatches: string[] = [];
    for (const att of TYPES) {
      for (const def of TYPES) {
        const got = lookup(chart, att, def);
        const want = expected(att, def);
        if (got !== want) {
          mismatches.push(`${att} → ${def}: expected ${want}, got ${got}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // ── Spot-check famous interactions to make a regression obvious in the
  // event the bulk test starts failing across many pairs. ──
  it.each([
    ["water", "fire", 2.0],
    ["fire", "grass", 2.0],
    ["grass", "water", 2.0],
    ["electric", "water", 2.0],
    ["electric", "ground", 0],
    ["ground", "electric", 2.0],
    ["ground", "flying", 0],
    ["normal", "ghost", 0],
    ["ghost", "normal", 0],
    ["fighting", "ghost", 0],
    ["fighting", "normal", 2.0],
    ["water", "water", 0.5],
    ["fire", "water", 0.5],
    ["psychic", "dark", 0],
    ["ghost", "dark", 0.5],
    ["dark", "fairy", 0.5],
    ["fairy", "dragon", 2.0],
    ["dragon", "fairy", 0],
    ["steel", "fairy", 2.0],
  ])("spot-check %s → %s = %fx", (att, def, expectedMult) => {
    expect(lookup(chart, att, def)).toBe(expectedMult);
  });

  it("dual-type defender: ground vs charizard (fire/flying) = 0", () => {
    // ground → fire = 2.0, ground → flying = 0; product = 0 (immunity wins).
    const types = ["fire", "flying"];
    const total = types.reduce((acc, t) => acc * lookup(chart, "ground", t), 1);
    expect(total).toBe(0);
  });

  it("dual-type defender: ice vs garchomp (dragon/ground) = 4x", () => {
    const types = ["dragon", "ground"];
    const total = types.reduce((acc, t) => acc * lookup(chart, "ice", t), 1);
    expect(total).toBe(4);
  });

  it("dual-type defender: ground vs hypothetical fire/rock mon = 4x", () => {
    // ground → fire = 2, ground → rock = 2; product = 4 (double-x stacking).
    const ground_fire = lookup(chart, "ground", "fire");
    const ground_rock = lookup(chart, "ground", "rock");
    expect(ground_fire * ground_rock).toBe(4);
  });

  it("dual-type defender: rock vs articuno (ice/flying) = 4x", () => {
    const types = ["ice", "flying"];
    const total = types.reduce((acc, t) => acc * lookup(chart, "rock", t), 1);
    expect(total).toBe(4);
  });

  it("dual-type defender: fighting vs sableye (dark/ghost) = 0", () => {
    // fighting → ghost = 0 short-circuits the stack regardless of fighting → dark.
    const types = ["dark", "ghost"];
    const total = types.reduce((acc, t) => acc * lookup(chart, "fighting", t), 1);
    expect(total).toBe(0);
  });

  it("super-effective AND resist on dual-type: water vs swampert (water/ground) = 1x", () => {
    // water → water 0.5, water → ground 2.0; product = 1.0.
    const types = ["water", "ground"];
    const total = types.reduce((acc, t) => acc * lookup(chart, "water", t), 1);
    expect(total).toBe(1);
  });
});
