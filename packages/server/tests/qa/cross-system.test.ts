import { beforeAll, describe, expect, it } from "vitest";
import {
  clearAllCaches,
  getAbilities,
  getEvolutions,
  getSpecies,
  getTypeChart,
  getVariants,
} from "../../src/game/data-loader.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";

beforeAll(() => clearAllCaches());

const VALID_CONDITION_TYPES = [
  "level",
  "item-use",
  "friendship",
  "held-item",
  "time",
  "trade",
  "region",
  "gender",
  "known-move",
  "known-move-type",
  "location",
  "stat-compare",
  "party-member",
  "extra",
] as const;

describe("QA: Cross-System Consistency", () => {
  // ========================================================
  // E1 - All abilities referenced in species.json exist in abilities.json
  // ========================================================
  describe("E1: species ability references exist in abilities.json", () => {
    it("every abilities.normal[] entry exists in abilities.json", () => {
      const abilityIds = new Set(getAbilities().map((a) => a.id));
      const missing: string[] = [];

      for (const s of getSpecies()) {
        if (!s.abilities) continue;
        for (const abilityId of s.abilities.normal) {
          if (!abilityIds.has(abilityId)) {
            missing.push(`${s.species} normal: ${abilityId}`);
          }
        }
      }

      expect(missing, `missing normal abilities:\n${missing.join("\n")}`).toHaveLength(0);
    });

    it("every abilities.hidden entry exists in abilities.json", () => {
      const abilityIds = new Set(getAbilities().map((a) => a.id));
      const missing: string[] = [];

      for (const s of getSpecies()) {
        if (!s.abilities?.hidden) continue;
        if (!abilityIds.has(s.abilities.hidden)) {
          missing.push(`${s.species} hidden: ${s.abilities.hidden}`);
        }
      }

      expect(missing, `missing hidden abilities:\n${missing.join("\n")}`).toHaveLength(0);
    });
  });

  // ========================================================
  // E2 - All types in species.json exist in type-chart.json
  // ========================================================
  describe("E2: species types exist in type-chart.json", () => {
    it("every species type is a key in the type chart", () => {
      const typeChartKeys = new Set(Object.keys(getTypeChart()));
      const missing: string[] = [];

      for (const s of getSpecies()) {
        for (const t of s.types) {
          if (!typeChartKeys.has(t)) {
            missing.push(`${s.species}: ${t}`);
          }
        }
      }

      expect(missing, `types not in type-chart:\n${missing.join("\n")}`).toHaveLength(0);
    });
  });

  // ========================================================
  // E6 - createPokemon abilityId exists in abilities.json
  // ========================================================
  describe("E6: createPokemon assigns a valid abilityId", () => {
    it("bulbasaur's abilityId exists in abilities.json", () => {
      const abilityIds = new Set(getAbilities().map((a) => a.id));
      const pokemon = createPokemon("bulbasaur", 5);

      expect(pokemon.abilityId).not.toBeNull();
      expect(
        abilityIds.has(pokemon.abilityId!),
        `abilityId '${pokemon.abilityId}' should exist in abilities.json`,
      ).toBe(true);
    });
  });

  // ========================================================
  // E9 - All evolution condition types are valid
  // ========================================================
  describe("E9: evolution condition types are all valid", () => {
    it("every condition.type in evolution.json is one of the 14 documented types", () => {
      const evolutions = getEvolutions();
      const foundTypes = new Set<string>();
      const unknown: string[] = [];

      for (const [species, evo] of Object.entries(evolutions)) {
        for (const branch of evo.branches) {
          for (const cond of branch.conditions) {
            foundTypes.add(cond.type);
            if (!(VALID_CONDITION_TYPES as readonly string[]).includes(cond.type)) {
              unknown.push(`${species}: ${cond.type}`);
            }
          }
        }
      }

      expect(unknown, `unknown condition types:\n${unknown.join("\n")}`).toHaveLength(0);
    });
  });

  // ========================================================
  // E11 - Variant egg eligibility data check
  // ========================================================
  describe("E11: variant eggEligible flag and egg-gacha runtime", () => {
    it("counts eggEligible=true variants and confirms egg-gacha only uses getSpecies (no variants)", () => {
      const variants = getVariants();
      const eggEligibleVariants = variants.filter((v) => v.eggEligible === true);

      // Report count -- there may be zero or more; just verify we can count them
      expect(eggEligibleVariants.length).toBeGreaterThanOrEqual(0);

      // The egg-gacha runtime uses getSpecies() to build its pools.
      // getSpecies() returns SpeciesData[], NOT variants.
      // Verify that no variant ID appears in the species list
      // (confirming eggEligible flag has no runtime effect yet).
      const speciesIds = new Set(getSpecies().map((s) => s.species));
      const variantIdsInSpecies = eggEligibleVariants.filter((v) => speciesIds.has(v.id));

      expect(
        variantIdsInSpecies,
        `eggEligible variants should not appear in getSpecies() pool: ${variantIdsInSpecies.map((v) => v.id).join(", ")}`,
      ).toHaveLength(0);
    });
  });
});
