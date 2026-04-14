import { describe, it, expect } from "vitest";
import {
  checkPrimalReversion,
  canMegaEvolve,
  canGigantamax,
  applyGmaxHp,
  revertGmaxHp,
  getMegaVariantForItem,
} from "../../src/game/battle-transformations.js";
import type { OwnedPokemon, BattleState } from "../../../../shared/types.js";

function makePokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "pikachu",
    variantId: null,
    nickname: null,
    level: 50,
    exp: 0,
    hp: 100,
    maxHp: 100,
    stats: { attack: 50, defense: 50, speed: 50, spAttack: 50, spDefense: 50 },
    moves: [{ id: "thunderbolt", pp: 15, maxPp: 15 }],
    caughtAt: new Date().toISOString(),
    gender: "male",
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: "hardy",
    isShiny: false,
    ...overrides,
  };
}

function makeBattle(overrides: Partial<BattleState> = {}): BattleState {
  return {
    eventId: "test-event",
    myPokemonUid: "test-uid",
    turn: 1,
    wild: {
      species: "rattata",
      variantId: null,
      level: 10,
      hp: 30,
      maxHp: 30,
      stats: { attack: 20, defense: 20, speed: 20, spAttack: 20, spDefense: 20 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    },
    ...overrides,
  };
}

describe("battle-transformations", () => {
  describe("checkPrimalReversion", () => {
    it("returns groudon-primal for groudon + red-orb", () => {
      const pokemon = makePokemon({ species: "groudon", heldItem: "red-orb" });
      expect(checkPrimalReversion(pokemon)).toBe("groudon-primal");
    });

    it("returns kyogre-primal for kyogre + blue-orb", () => {
      const pokemon = makePokemon({ species: "kyogre", heldItem: "blue-orb" });
      expect(checkPrimalReversion(pokemon)).toBe("kyogre-primal");
    });

    it("returns null for groudon without red-orb", () => {
      const pokemon = makePokemon({ species: "groudon", heldItem: null });
      expect(checkPrimalReversion(pokemon)).toBeNull();
    });

    it("returns null for groudon with wrong item", () => {
      const pokemon = makePokemon({ species: "groudon", heldItem: "blue-orb" });
      expect(checkPrimalReversion(pokemon)).toBeNull();
    });

    it("returns null for non-primal species", () => {
      const pokemon = makePokemon({ species: "pikachu", heldItem: "red-orb" });
      expect(checkPrimalReversion(pokemon)).toBeNull();
    });
  });

  describe("canMegaEvolve", () => {
    it("returns ok for valid mega stone + key-stone", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: "charizardite-x" });
      const battle = makeBattle();
      const inventory = { "key-stone": 1 };
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(true);
      expect(result.variantId).toBe("charizard-mega-x");
    });

    it("returns error when transformation already used", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: "charizardite-x" });
      const battle = makeBattle({ transformationUsed: true });
      const inventory = { "key-stone": 1 };
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns error when already transformed", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: "charizardite-x" });
      const battle = makeBattle({ transformationType: "mega" });
      const inventory = { "key-stone": 1 };
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });

    it("returns error without key-stone", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: "charizardite-x" });
      const battle = makeBattle();
      const inventory = {};
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("키스톤");
    });

    it("returns error with wrong mega stone", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: "venusaurite" });
      const battle = makeBattle();
      const inventory = { "key-stone": 1 };
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("메가스톤");
    });

    it("returns error with no held item", () => {
      const pokemon = makePokemon({ species: "charizard", heldItem: null });
      const battle = makeBattle();
      const inventory = { "key-stone": 1 };
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });

    it("allows rayquaza mega without stone but with dragon-ascent", () => {
      const pokemon = makePokemon({
        species: "rayquaza",
        heldItem: null,
        moves: [{ id: "dragon-ascent", pp: 5, maxPp: 5 }],
      });
      const battle = makeBattle();
      const inventory = {};
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(true);
      expect(result.variantId).toBe("rayquaza-mega");
    });

    it("rejects rayquaza mega without dragon-ascent", () => {
      const pokemon = makePokemon({
        species: "rayquaza",
        heldItem: null,
        moves: [{ id: "outrage", pp: 10, maxPp: 10 }],
      });
      const battle = makeBattle();
      const inventory = {};
      const result = canMegaEvolve(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });
  });

  describe("canGigantamax", () => {
    it("returns ok for pokemon with gmax factor + dynamax-band", () => {
      const pokemon = makePokemon({
        species: "charizard",
        hasGigantamaxFactor: true,
      });
      const battle = makeBattle();
      const inventory = { "dynamax-band": 1 };
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(true);
      expect(result.variantId).toBe("charizard-gmax");
    });

    it("returns error without gmax factor", () => {
      const pokemon = makePokemon({ species: "charizard" });
      const battle = makeBattle();
      const inventory = { "dynamax-band": 1 };
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("팩터");
    });

    it("returns error without dynamax-band", () => {
      const pokemon = makePokemon({
        species: "charizard",
        hasGigantamaxFactor: true,
      });
      const battle = makeBattle();
      const inventory = {};
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("다이맥스밴드");
    });

    it("returns error when transformation already used", () => {
      const pokemon = makePokemon({
        species: "charizard",
        hasGigantamaxFactor: true,
      });
      const battle = makeBattle({ transformationUsed: true });
      const inventory = { "dynamax-band": 1 };
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });

    it("returns error when already transformed", () => {
      const pokemon = makePokemon({
        species: "charizard",
        hasGigantamaxFactor: true,
      });
      const battle = makeBattle({ transformationType: "mega" });
      const inventory = { "dynamax-band": 1 };
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });

    it("returns error for species without gmax variant", () => {
      const pokemon = makePokemon({
        species: "pikachu-not-real",
        hasGigantamaxFactor: true,
      });
      const battle = makeBattle();
      const inventory = { "dynamax-band": 1 };
      const result = canGigantamax(pokemon, battle, inventory);
      expect(result.ok).toBe(false);
    });
  });

  describe("getMegaVariantForItem", () => {
    it("maps charizard + charizardite-x to charizard-mega-x", () => {
      expect(getMegaVariantForItem("charizard", "charizardite-x")).toBe("charizard-mega-x");
    });

    it("maps charizard + charizardite-y to charizard-mega-y", () => {
      expect(getMegaVariantForItem("charizard", "charizardite-y")).toBe("charizard-mega-y");
    });

    it("maps venusaur + venusaurite to venusaur-mega", () => {
      expect(getMegaVariantForItem("venusaur", "venusaurite")).toBe("venusaur-mega");
    });

    it("returns null for wrong species", () => {
      expect(getMegaVariantForItem("pikachu", "charizardite-x")).toBeNull();
    });

    it("returns null for wrong stone", () => {
      expect(getMegaVariantForItem("charizard", "venusaurite")).toBeNull();
    });
  });

  describe("applyGmaxHp", () => {
    it("multiplies HP by 1.5", () => {
      const result = applyGmaxHp(100, 100);
      expect(result.hp).toBe(150);
      expect(result.maxHp).toBe(150);
    });

    it("applies 1.5x with ceiling for odd numbers", () => {
      const result = applyGmaxHp(77, 77);
      expect(result.maxHp).toBe(Math.ceil(77 * 1.5));
      expect(result.hp).toBe(Math.ceil(77 * 1.5));
    });

    it("handles partial HP correctly", () => {
      const result = applyGmaxHp(50, 100);
      expect(result.hp).toBe(75);
      expect(result.maxHp).toBe(150);
    });
  });

  describe("revertGmaxHp", () => {
    it("proportionally reverts HP", () => {
      // Started at 100/100, gmaxed to 150/150, took 30 damage → 120/150
      const result = revertGmaxHp(120, 150, 100);
      expect(result.hp).toBe(Math.floor((120 * 100) / 150)); // 80
      expect(result.maxHp).toBe(100);
    });

    it("reverts full HP to full", () => {
      const result = revertGmaxHp(150, 150, 100);
      expect(result.hp).toBe(100);
      expect(result.maxHp).toBe(100);
    });

    it("reverts 0 HP to 0", () => {
      const result = revertGmaxHp(0, 150, 100);
      expect(result.hp).toBe(0);
      expect(result.maxHp).toBe(100);
    });
  });
});
