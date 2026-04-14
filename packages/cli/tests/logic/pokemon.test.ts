import { describe, it, expect } from "vitest";
import {
  buildPokemonActions,
  filterHoldableItems,
  formatPokemonInfoLine,
  type PokemonSummary,
} from "../../src/logic/pokemon.js";

function makePokemon(overrides: Partial<PokemonSummary> = {}): PokemonSummary {
  return {
    species: "pikachu",
    nickname: null,
    level: 25,
    hp: 60,
    maxHp: 60,
    heldItem: null,
    nature: "adamant",
    gender: "male",
    isShiny: false,
    tradeLocked: false,
    ...overrides,
  };
}

describe("buildPokemonActions", () => {
  it("shows equip when no held item", () => {
    const actions = buildPokemonActions(makePokemon(), false);
    expect(actions.some((a) => a.value === "equip")).toBe(true);
    expect(actions.some((a) => a.value === "unequip")).toBe(false);
  });

  it("shows unequip when holding item", () => {
    const actions = buildPokemonActions(makePokemon({ heldItem: "leftovers" }), false);
    expect(actions.some((a) => a.value === "unequip")).toBe(true);
    expect(actions.some((a) => a.name.includes("leftovers"))).toBe(true);
    expect(actions.some((a) => a.value === "equip")).toBe(false);
  });

  it("shows evolution action when pending", () => {
    const actions = buildPokemonActions(makePokemon(), true);
    expect(actions[0].value).toBe("evolve");
  });

  it("does not show evolution action when not pending", () => {
    const actions = buildPokemonActions(makePokemon(), false);
    expect(actions.some((a) => a.value === "evolve")).toBe(false);
  });

  it("shows lock/unlock trade", () => {
    const unlocked = buildPokemonActions(makePokemon({ tradeLocked: false }), false);
    expect(unlocked.some((a) => a.value === "lock-trade")).toBe(true);

    const locked = buildPokemonActions(makePokemon({ tradeLocked: true }), false);
    expect(locked.some((a) => a.value === "unlock-trade")).toBe(true);
  });

  it("always has back as last action", () => {
    const actions = buildPokemonActions(makePokemon(), false);
    expect(actions[actions.length - 1].value).toBe("back");
  });
});

describe("filterHoldableItems", () => {
  it("returns only held-kind items with positive quantity", () => {
    const inventory = { leftovers: 1, potion: 3, "metal-coat": 2, pokeball: 5 };
    const catalog = {
      leftovers: { kind: "held" },
      potion: { kind: "healing" },
      "metal-coat": { kind: "held" },
      pokeball: { kind: "ball" },
    };
    const result = filterHoldableItems(inventory, catalog);
    expect(result).toEqual(["leftovers", "metal-coat"]);
  });

  it("excludes zero-quantity items", () => {
    const inventory = { leftovers: 0 };
    const catalog = { leftovers: { kind: "held" } };
    expect(filterHoldableItems(inventory, catalog)).toEqual([]);
  });

  it("returns empty for no held items", () => {
    const inventory = { potion: 5 };
    const catalog = { potion: { kind: "healing" } };
    expect(filterHoldableItems(inventory, catalog)).toEqual([]);
  });
});

describe("formatPokemonInfoLine", () => {
  it("includes nature and gender", () => {
    const line = formatPokemonInfoLine(makePokemon({ nature: "jolly", gender: "female" }));
    expect(line).toContain("jolly");
    expect(line).toContain("female");
  });

  it("includes shiny marker", () => {
    const line = formatPokemonInfoLine(makePokemon({ isShiny: true }));
    expect(line).toContain("Shiny");
  });

  it("omits null values", () => {
    const line = formatPokemonInfoLine(makePokemon({ nature: null, gender: null }));
    expect(line).not.toContain("Nature");
    expect(line).not.toContain("Gender");
  });
});
