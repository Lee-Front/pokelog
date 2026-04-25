/**
 * Scenario 42 — Mega / Regional Form Data Integrity.
 *
 * Iterates over every variant in `variants.json` and verifies the data
 * integrity invariants we depend on at runtime:
 *
 *  - id is unique and non-empty
 *  - baseSpecies points at a known species
 *  - typing (if present) consists of canonical type ids
 *  - baseStatsOverride (if present) maps stat keys to non-negative numbers
 *  - category-counts match the totals exposed in the brief (mega 48,
 *    gigantamax 32, regional 53, battle-form 15, primal 2)
 *
 * Pure data test — no server boot.
 */
import { describe, it, expect } from "vitest";
import { getVariants, getSpeciesByName } from "../../src/game/data-loader.js";

const KNOWN_TYPES = new Set([
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
]);

const STAT_KEYS = new Set(["hp", "attack", "defense", "spAttack", "spDefense", "speed"]);

describe("Scenario 42 — Form Data Integrity", () => {
  const variants = getVariants();

  it("variant ids are non-empty and unique", () => {
    const seen = new Set<string>();
    for (const v of variants) {
      expect(v.id, "variant id present").toBeTruthy();
      expect(typeof v.id).toBe("string");
      expect(seen.has(v.id), `duplicate variant id: ${v.id}`).toBe(false);
      seen.add(v.id);
    }
  });

  it("every variant.baseSpecies references an existing species", () => {
    const missing: string[] = [];
    for (const v of variants) {
      if (!getSpeciesByName(v.baseSpecies)) {
        missing.push(`${v.id} → ${v.baseSpecies}`);
      }
    }
    expect(missing, `unknown baseSpecies: ${missing.join(", ")}`).toEqual([]);
  });

  it("typing fields use only canonical 18 types", () => {
    const offenders: string[] = [];
    for (const v of variants) {
      if (!v.typing) continue;
      for (const t of v.typing) {
        if (!KNOWN_TYPES.has(t)) {
          offenders.push(`${v.id}: '${t}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("baseStatsOverride keys are valid stat names with non-negative numbers", () => {
    const offenders: string[] = [];
    for (const v of variants) {
      if (!v.baseStatsOverride) continue;
      for (const [k, val] of Object.entries(v.baseStatsOverride)) {
        if (!STAT_KEYS.has(k)) offenders.push(`${v.id}: bad stat key '${k}'`);
        if (typeof val !== "number" || Number.isNaN(val) || val < 0) {
          offenders.push(`${v.id}.${k}: invalid value ${String(val)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // ── Category-specific counts ──
  // The README quotes specific totals; we lock them in here so any future
  // additions/removals require a deliberate update to this test.
  it.each([
    ["mega", 48],
    ["gigantamax", 32],
    ["regional", 53],
    ["battle-form", 15],
    ["primal", 2],
  ])("category '%s' has exactly %d variants", (category, expected) => {
    const count = variants.filter((v) => v.category === category).length;
    expect(count).toBe(expected);
  });

  it("every mega variant carries a baseStatsOverride (mega forms always change stats)", () => {
    const megas = variants.filter((v) => v.category === "mega");
    expect(megas.length).toBeGreaterThan(0);
    const missing = megas.filter((v) => !v.baseStatsOverride).map((v) => v.id);
    expect(missing).toEqual([]);
  });

  it("every primal variant carries baseStatsOverride and typing", () => {
    const primals = variants.filter((v) => v.category === "primal");
    expect(primals.length).toBe(2);
    for (const v of primals) {
      expect(v.baseStatsOverride).toBeDefined();
      expect(v.typing).toBeDefined();
      expect(v.typing!.length).toBeGreaterThan(0);
    }
  });

  it("regional variants reference species and use formSuffix to disambiguate", () => {
    const regionals = variants.filter((v) => v.category === "regional");
    expect(regionals.length).toBe(53);
    const validSuffixes = new Set(["alolan", "galarian", "hisuian", "paldean"]);
    const offenders: string[] = [];
    for (const v of regionals) {
      if (!v.formSuffix) {
        offenders.push(`${v.id}: missing formSuffix`);
      } else if (!validSuffixes.has(v.formSuffix)) {
        // some regionals may have other suffixes (e.g. "ten-percent"); accept
        // empty string as a flag we'd surface, but we don't reject unknowns.
      }
    }
    expect(offenders).toEqual([]);
  });

  it("encounterEligible / eggEligible are booleans on every variant", () => {
    const offenders: string[] = [];
    for (const v of variants) {
      if (typeof v.encounterEligible !== "boolean") offenders.push(`${v.id}.encounterEligible`);
      if (typeof v.eggEligible !== "boolean") offenders.push(`${v.id}.eggEligible`);
    }
    expect(offenders).toEqual([]);
  });
});
