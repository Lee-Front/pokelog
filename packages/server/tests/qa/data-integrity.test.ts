import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllCaches,
  getAbilities,
  getEvolutions,
  getItems,
  getMoves,
  getNatures,
  getSpecies,
  getVariants,
} from "../../src/game/data-loader.js";

beforeEach(() => clearAllCaches());

/**
 * species.json stores form-suffixed names (e.g. "aegislash-shield",
 * "deoxys-normal") while evolution.json and variants.json reference the
 * base name (e.g. "aegislash", "deoxys"). This helper builds a lookup
 * that includes both exact names and base-name prefixes so cross-file
 * references resolve correctly.
 */
function buildSpeciesLookup(): Set<string> {
  const names = new Set<string>();
  for (const s of getSpecies()) {
    names.add(s.species);
    const dashIndex = s.species.indexOf("-");
    if (dashIndex > 0) {
      names.add(s.species.substring(0, dashIndex));
    }
  }
  return names;
}

describe("QA: Data Integrity", () => {
  it("A1: species.json has 1037 entries with all SpeciesData fields", () => {
    const species = getSpecies();
    expect(species).toHaveLength(1037);

    const baseStatKeys = ["hp", "attack", "defense", "spAttack", "spDefense", "speed"];

    for (const s of species) {
      expect(s.id, s.species + " missing id").toBeTypeOf("number");
      expect(s.species, "entry id=" + s.id + " missing species").toBeTypeOf("string");
      expect(s.name, s.species + " missing name").toBeTypeOf("string");

      expect(Array.isArray(s.types), s.species + " types not array").toBe(true);
      expect(s.types.length, s.species + " has no types").toBeGreaterThanOrEqual(1);

      expect(s.baseStats, s.species + " missing baseStats").toBeDefined();
      for (const key of baseStatKeys) {
        expect(s.baseStats, s.species + " missing baseStats." + key).toHaveProperty(key);
        expect(
          (s.baseStats as Record<string, number>)[key],
          s.species + " baseStats." + key + " not a number",
        ).toBeTypeOf("number");
      }
      expect(
        Object.keys(s.baseStats),
        s.species + " baseStats should have exactly 6 keys",
      ).toHaveLength(6);

      expect(s.catchRate, s.species + " catchRate").toBeTypeOf("number");
      expect(s.catchRate, s.species + " catchRate >= 0").toBeGreaterThanOrEqual(0);
      expect(s.catchRate, s.species + " catchRate <= 1").toBeLessThanOrEqual(1);

      expect(s.rawCaptureRate, s.species + " rawCaptureRate").toBeTypeOf("number");
      expect(s.rawCaptureRate as number, s.species + " rawCaptureRate >= 0").toBeGreaterThanOrEqual(0);
      expect(s.rawCaptureRate as number, s.species + " rawCaptureRate <= 255").toBeLessThanOrEqual(255);

      expect(s.genderRate, s.species + " genderRate").toBeTypeOf("number");
      expect(s.genderRate as number, s.species + " genderRate >= -1").toBeGreaterThanOrEqual(-1);
      expect(s.genderRate as number, s.species + " genderRate <= 8").toBeLessThanOrEqual(8);

      expect(s.abilities, s.species + " missing abilities").toBeDefined();
      expect(
        Array.isArray(s.abilities?.normal),
        s.species + " abilities.normal not array",
      ).toBe(true);

      expect(s.expGroup, s.species + " missing expGroup").toBeTypeOf("string");
      expect(s.maxMoves, s.species + " missing maxMoves").toBeTypeOf("number");

      expect(s.learnset, s.species + " missing learnset").toBeDefined();
      expect(s.learnset.levelUp, s.species + " missing learnset.levelUp").toBeDefined();
      expect(Array.isArray(s.learnset.tm), s.species + " learnset.tm not array").toBe(true);
      expect(Array.isArray(s.learnset.tutor), s.species + " learnset.tutor not array").toBe(true);
      expect(Array.isArray(s.learnset.egg), s.species + " learnset.egg not array").toBe(true);
      expect(Array.isArray(s.learnset.event), s.species + " learnset.event not array").toBe(true);
    }
  });

  it("A2: evolution.json entries match EvolutionBranch schema", () => {
    const evolutions = getEvolutions();
    const validTriggers = new Set(["level-up", "use-item", "trade", "other"]);

    for (const [species, evoData] of Object.entries(evolutions)) {
      expect(
        Array.isArray(evoData.branches),
        species + " evolution missing branches array",
      ).toBe(true);

      for (const branch of evoData.branches) {
        expect(branch.id, species + " branch missing id").toBeTypeOf("string");
        expect(branch.targetSpecies, species + " branch missing targetSpecies").toBeTypeOf("string");
        expect(
          validTriggers.has(branch.trigger),
          species + " branch has invalid trigger: " + branch.trigger,
        ).toBe(true);
        expect(
          Array.isArray(branch.conditions),
          species + " branch missing conditions array",
        ).toBe(true);
      }
    }
  });

  it("A3: all targetSpecies in evolution.json exist in species.json", () => {
    const evolutions = getEvolutions();
    const speciesLookup = buildSpeciesLookup();
    const missing: string[] = [];

    for (const [species, evoData] of Object.entries(evolutions)) {
      for (const branch of evoData.branches) {
        if (!speciesLookup.has(branch.targetSpecies)) {
          missing.push(species + " -> " + branch.targetSpecies);
        }
      }
    }

    // Gen-9+ species not in our gen-8 dataset — known and expected
    const GEN9_EVOLUTION_TARGETS = new Set([
      "annihilape", "archaludon", "clodsire", "dipplin",
      "dudunsparce", "farigiraf", "kingambit",
    ]);

    const unexpectedMissing = missing.filter(ref => {
      const target = ref.split(" -> ")[1];
      return !GEN9_EVOLUTION_TARGETS.has(target);
    });
    expect(unexpectedMissing, "Unexpected missing evolution targets: " + unexpectedMissing.join(", ")).toHaveLength(0);
  });

  it("A4: every species has an evolution entry and vice versa", () => {
    const speciesLookup = buildSpeciesLookup();
    const speciesNames = new Set(getSpecies().map((s) => s.species));
    const evoKeys = new Set(Object.keys(getEvolutions()));

    // A species entry matches if its exact name OR its base-name prefix
    // appears in evolution.json (species.json uses form-suffixed names
    // like "deoxys-normal" while evolution.json uses "deoxys").
    const missingEvolution = [...speciesNames].filter((s) => {
      if (evoKeys.has(s)) return false;
      const dashIndex = s.indexOf("-");
      if (dashIndex > 0 && evoKeys.has(s.substring(0, dashIndex))) return false;
      return true;
    });

    // Form-variant species that live under a PokeAPI-normalized name in
    // species.json (e.g. calyrex-ice-rider → calyrex-ice) but retain the
    // full descriptive slug as the evolution key.
    const FORM_VARIANT_ALIAS_KEYS = new Set([
      "calyrex-ice-rider",
      "calyrex-shadow-rider",
      "necrozma-dawn-wings",
      "necrozma-dusk-mane",
    ]);

    const extraEvolution = [...evoKeys].filter(
      (k) => !speciesLookup.has(k) && !FORM_VARIANT_ALIAS_KEYS.has(k),
    );

    expect(
      missingEvolution,
      "Species without evolution entry: " + missingEvolution.join(", "),
    ).toHaveLength(0);
    expect(
      extraEvolution,
      "Evolution keys without species entry: " + extraEvolution.join(", "),
    ).toHaveLength(0);
  });

  it("A5: all levelUp learnset move IDs exist in moves.json", () => {
    const species = getSpecies();
    const moveIds = new Set(getMoves().map((m) => m.id));
    const missing: string[] = [];

    for (const s of species) {
      const levelUpMoves = Object.values(s.learnset.levelUp).flat();
      for (const moveId of levelUpMoves) {
        if (!moveIds.has(moveId)) {
          missing.push(s.species + ": " + moveId);
        }
      }
    }

    expect(
      missing,
      "LevelUp moves not in moves.json:\n" + missing.join("\n"),
    ).toHaveLength(0);
  });

  it("A6: natures.json has exactly 25 entries matching NatureData", () => {
    const natures = getNatures();
    expect(natures).toHaveLength(25);

    const validStats = new Set(["attack", "defense", "spAttack", "spDefense", "speed"]);

    for (const nature of natures) {
      expect(nature.id, "nature missing id").toBeTypeOf("string");
      expect(nature.name, nature.id + " missing name").toBeTypeOf("string");

      if (nature.increasedStat !== null) {
        expect(
          validStats.has(nature.increasedStat),
          nature.id + " invalid increasedStat: " + nature.increasedStat,
        ).toBe(true);
      }
      if (nature.decreasedStat !== null) {
        expect(
          validStats.has(nature.decreasedStat),
          nature.id + " invalid decreasedStat: " + nature.decreasedStat,
        ).toBe(true);
      }

      const bothNull = nature.increasedStat === null && nature.decreasedStat === null;
      const bothSet = nature.increasedStat !== null && nature.decreasedStat !== null;
      expect(
        bothNull || bothSet,
        nature.id + " must have both stats null or both stats set",
      ).toBe(true);
    }
  });

  it("A7: variants.json has 424 entries with correct VariantData fields and valid baseSpecies", () => {
    const variants = getVariants();
    expect(variants).toHaveLength(424);

    const speciesLookup = buildSpeciesLookup();
    const validKinds = new Set(["regional", "permanent-form", "battle-form"]);
    const invalidBaseSpecies: string[] = [];

    for (const v of variants) {
      expect(v.id, "variant missing id").toBeTypeOf("string");
      expect(v.baseSpecies, v.id + " missing baseSpecies").toBeTypeOf("string");
      expect(v.name, v.id + " missing name").toBeTypeOf("string");
      expect(v.category, v.id + " missing category").toBeTypeOf("string");
      expect(v.sourceArtSlug, v.id + " missing sourceArtSlug").toBeTypeOf("string");
      expect(v.formSuffix, v.id + " missing formSuffix").toBeTypeOf("string");
      expect(
        validKinds.has(v.kind),
        v.id + " invalid kind: " + v.kind,
      ).toBe(true);
      expect(v.encounterEligible, v.id + " encounterEligible").toBeTypeOf("boolean");
      expect(v.eggEligible, v.id + " eggEligible").toBeTypeOf("boolean");

      if (!speciesLookup.has(v.baseSpecies)) {
        invalidBaseSpecies.push(v.id + " -> " + v.baseSpecies);
      }
    }

    expect(
      invalidBaseSpecies,
      "Variants with invalid baseSpecies: " + invalidBaseSpecies.join(", "),
    ).toHaveLength(0);
  });

  it("A8: battle-form variants are never encounter-eligible or egg-eligible", () => {
    const variants = getVariants();
    const violations: string[] = [];

    for (const v of variants) {
      if (v.kind === "battle-form") {
        if (v.encounterEligible) {
          violations.push(v.id + " is battle-form but encounterEligible=true");
        }
        if (v.eggEligible) {
          violations.push(v.id + " is battle-form but eggEligible=true");
        }
      }
    }

    expect(
      violations,
      "Battle-form eligibility violations:\n" + violations.join("\n"),
    ).toHaveLength(0);
  });

  it("A9: abilities.json entries match AbilityData type", () => {
    const abilities = getAbilities();
    expect(abilities.length).toBeGreaterThan(0);

    for (const a of abilities) {
      expect(a.id, "ability missing id").toBeTypeOf("string");
      expect(a.name, a.id + " missing name").toBeTypeOf("string");
      expect(a.shortEffect, a.id + " missing shortEffect").toBeTypeOf("string");
      expect(a.isMainSeries, a.id + " missing isMainSeries").toBeTypeOf("boolean");
    }
  });

  it("A10: items.json entries match ItemData type", () => {
    const items = getItems();
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.id, "item missing id").toBeTypeOf("string");
      expect(item.name, item.id + " missing name").toBeTypeOf("string");
      expect(item.category, item.id + " missing category").toBeTypeOf("string");
      expect(item.cost, item.id + " missing cost").toBeTypeOf("number");
      expect(item.shortEffect, item.id + " missing shortEffect").toBeTypeOf("string");
    }
  });
});
