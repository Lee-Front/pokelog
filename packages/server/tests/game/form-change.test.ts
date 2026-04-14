import { describe, expect, it } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import {
  canChangeForm,
  getAvailableForms,
  getFormChangeRules,
  hasFormChangeRules,
  resolveFormChange,
  applyFormChange,
  FormChangeError,
} from "../../src/game/form-change.js";

function createUserData(): UserData {
  return {
    account: {
      id: "test-user",
      password: "pw",
      nickname: "tester",
      createdAt: "2026-01-01T00:00:00.000Z",
      matchings: {},
    },
    points: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon: [],
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
    pendingEvolutions: [],
    currentRegion: "default",
  };
}

describe("form-change", () => {
  describe("getFormChangeRules", () => {
    it("loads rules from data file", () => {
      const rules = getFormChangeRules();
      expect(rules).toBeDefined();
      expect(rules.rotom).toBeDefined();
      expect(rules.rotom.type).toBe("catalog");
    });

    it("contains all 20 species", () => {
      const rules = getFormChangeRules();
      const expectedSpecies = [
        "rotom", "shaymin", "giratina", "dialga", "palkia",
        "tornadus", "thundurus", "landorus", "enamorus", "hoopa",
        "deoxys", "genesect", "arceus", "silvally", "oricorio",
        "furfrou", "zacian", "zamazenta",
      ];
      for (const species of expectedSpecies) {
        expect(rules[species], `Missing rules for ${species}`).toBeDefined();
      }
    });
  });

  describe("hasFormChangeRules", () => {
    it("returns true for species with rules", () => {
      expect(hasFormChangeRules("rotom")).toBe(true);
      expect(hasFormChangeRules("arceus")).toBe(true);
    });

    it("returns false for species without rules", () => {
      expect(hasFormChangeRules("pikachu")).toBe(false);
      expect(hasFormChangeRules("charmander")).toBe(false);
    });
  });

  describe("getAvailableForms", () => {
    it("returns 5 forms for rotom", () => {
      const forms = getAvailableForms("rotom");
      expect(forms).toHaveLength(5);
      expect(forms).toContain("rotom-heat");
      expect(forms).toContain("rotom-wash");
      expect(forms).toContain("rotom-frost");
      expect(forms).toContain("rotom-fan");
      expect(forms).toContain("rotom-mow");
    });

    it("returns 17 type forms for arceus", () => {
      const forms = getAvailableForms("arceus");
      expect(forms).toHaveLength(17);
      expect(forms).toContain("arceus-fire");
      expect(forms).toContain("arceus-water");
      expect(forms).toContain("arceus-dragon");
    });

    it("returns 17 type forms for silvally", () => {
      const forms = getAvailableForms("silvally");
      expect(forms).toHaveLength(17);
      expect(forms).toContain("silvally-fire");
      expect(forms).toContain("silvally-water");
    });

    it("returns 3 forms for deoxys", () => {
      const forms = getAvailableForms("deoxys");
      expect(forms).toHaveLength(3);
      expect(forms).toContain("deoxys-attack");
      expect(forms).toContain("deoxys-defense");
      expect(forms).toContain("deoxys-speed");
    });

    it("returns empty array for species without rules", () => {
      expect(getAvailableForms("pikachu")).toEqual([]);
    });
  });

  describe("canChangeForm", () => {
    it("returns ok for valid rotom forms", () => {
      const pokemon = createPokemon("rotom", 30);
      const result = canChangeForm(pokemon, "rotom-heat");
      expect(result.ok).toBe(true);
      expect(result.rule).toBeDefined();
      expect(result.rule!.type).toBe("catalog");
    });

    it("returns ok for reverting to base form (null)", () => {
      const pokemon = createPokemon("rotom", 30);
      pokemon.variantId = "rotom-heat";
      const result = canChangeForm(pokemon, null);
      expect(result.ok).toBe(true);
    });

    it("returns ok for reverting to base form (species name)", () => {
      const pokemon = createPokemon("rotom", 30);
      pokemon.variantId = "rotom-heat";
      const result = canChangeForm(pokemon, "rotom");
      expect(result.ok).toBe(true);
    });

    it("rejects invalid form for species", () => {
      const pokemon = createPokemon("rotom", 30);
      const result = canChangeForm(pokemon, "giratina-origin");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not a valid form");
    });

    it("rejects form change for species without rules", () => {
      const pokemon = createPokemon("pikachu", 30);
      const result = canChangeForm(pokemon, "rotom-heat");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("cannot change forms");
    });
  });

  describe("resolveFormChange", () => {
    it("returns correct variantId for rotom form", () => {
      const pokemon = createPokemon("rotom", 30);
      const result = resolveFormChange(pokemon, "rotom-wash");
      expect(result.variantId).toBe("rotom-wash");
      expect(result.consumeItem).toBeUndefined();
    });

    it("returns null variantId when reverting", () => {
      const pokemon = createPokemon("rotom", 30);
      pokemon.variantId = "rotom-heat";
      const result = resolveFormChange(pokemon, null);
      expect(result.variantId).toBeNull();
    });

    it("returns consumeItem for nectar type", () => {
      const pokemon = createPokemon("oricorio", 30);
      const result = resolveFormChange(pokemon, "oricorio-sensu");
      expect(result.variantId).toBe("oricorio-sensu");
      expect(result.consumeItem).toBe("purple-nectar");
    });

    it("does not set consumeItem for catalog type", () => {
      const pokemon = createPokemon("rotom", 30);
      const result = resolveFormChange(pokemon, "rotom-heat");
      expect(result.consumeItem).toBeUndefined();
    });

    it("does not set consumeItem for toggle type", () => {
      const pokemon = createPokemon("shaymin", 30);
      const result = resolveFormChange(pokemon, "shaymin-sky");
      expect(result.consumeItem).toBeUndefined();
    });
  });

  describe("applyFormChange", () => {
    it("changes rotom form (catalog, no item needed)", () => {
      const user = createUserData();
      const pokemon = createPokemon("rotom", 30);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];

      const result = applyFormChange(user, pokemon.uid, "rotom-heat");
      expect(result.pokemon.variantId).toBe("rotom-heat");
      expect(result.previousVariantId).toBeNull();
    });

    it("reverts form to base", () => {
      const user = createUserData();
      const pokemon = createPokemon("rotom", 30);
      pokemon.variantId = "rotom-heat";
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];

      const result = applyFormChange(user, pokemon.uid, null);
      expect(result.pokemon.variantId).toBeNull();
      expect(result.previousVariantId).toBe("rotom-heat");
    });

    it("equips held item for held-item type (giratina)", () => {
      const user = createUserData();
      const pokemon = createPokemon("giratina", 50);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];
      user.inventory = { "griseous-orb": 1 };

      const result = applyFormChange(user, pokemon.uid, "giratina-origin");
      expect(result.pokemon.variantId).toBe("giratina-origin");
      expect(result.pokemon.heldItem).toBe("griseous-orb");
      expect(user.inventory["griseous-orb"]).toBeUndefined();
    });

    it("returns held item when reverting held-item type", () => {
      const user = createUserData();
      const pokemon = createPokemon("giratina", 50);
      pokemon.variantId = "giratina-origin";
      pokemon.heldItem = "griseous-orb";
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];

      const result = applyFormChange(user, pokemon.uid, null);
      expect(result.pokemon.variantId).toBeNull();
      expect(result.pokemon.heldItem).toBeNull();
      expect(user.inventory["griseous-orb"]).toBe(1);
    });

    it("throws when held-item is not in inventory", () => {
      const user = createUserData();
      const pokemon = createPokemon("giratina", 50);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];
      user.inventory = {};

      expect(() => applyFormChange(user, pokemon.uid, "giratina-origin")).toThrow(FormChangeError);
    });

    it("does not consume toggle items (shaymin)", () => {
      const user = createUserData();
      const pokemon = createPokemon("shaymin", 30);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];
      user.inventory = { gracidea: 1 };

      applyFormChange(user, pokemon.uid, "shaymin-sky");
      expect(user.inventory.gracidea).toBe(1);
      expect(pokemon.variantId).toBe("shaymin-sky");
    });

    it("throws when toggle item is not in inventory", () => {
      const user = createUserData();
      const pokemon = createPokemon("shaymin", 30);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];
      user.inventory = {};

      expect(() => applyFormChange(user, pokemon.uid, "shaymin-sky")).toThrow(FormChangeError);
    });

    it("consumes nectar for oricorio", () => {
      const user = createUserData();
      const pokemon = createPokemon("oricorio", 30);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];
      user.inventory = { "purple-nectar": 2 };

      applyFormChange(user, pokemon.uid, "oricorio-sensu");
      expect(pokemon.variantId).toBe("oricorio-sensu");
      expect(user.inventory["purple-nectar"]).toBe(1);
    });

    it("throws when pokemon not found", () => {
      const user = createUserData();
      expect(() => applyFormChange(user, "nonexistent", "rotom-heat")).toThrow(FormChangeError);
    });

    it("throws when species has no form change rules", () => {
      const user = createUserData();
      const pokemon = createPokemon("pikachu", 30);
      user.pokemon = [pokemon];
      user.party = [pokemon.uid];

      expect(() => applyFormChange(user, pokemon.uid, "rotom-heat")).toThrow(FormChangeError);
    });
  });
});
