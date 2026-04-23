import { describe, expect, it } from "vitest";
import type { ShopItem, UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { calculateStatsForLevel } from "../../src/game/growth.js";
import { ItemUseError, useInventoryItem } from "../../src/game/item-usage.js";

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

describe("useInventoryItem", () => {
  it("heals a party pokemon and consumes the item", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    pokemon.hp = Math.max(1, pokemon.hp - 15);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { potion: 1 };

    const potion: ShopItem = { name: "Potion", price: 150, healAmount: 20 };
    const result = useInventoryItem(user, "potion", pokemon.uid, potion);

    expect(result.kind).toBe("healing");
    expect(pokemon.hp).toBe(pokemon.maxHp);
    expect(user.inventory.potion).toBeUndefined();
  });

  it("rejects healing items when the pokemon is already at full hp", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { potion: 1 };

    const potion: ShopItem = { name: "Potion", price: 150, healAmount: 20 };

    expect(() => useInventoryItem(user, "potion", pokemon.uid, potion)).toThrow(ItemUseError);
    expect(user.inventory.potion).toBe(1);
  });

  it("evolves a pokemon with a matching item and updates pokedex", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.pokedex = ["pikachu"];
    user.inventory = { "thunder-stone": 1 };

    const result = useInventoryItem(user, "thunder-stone", pokemon.uid);
    const expectedStats = calculateStatsForLevel("raichu", 20, pokemon.nature, pokemon.variantId ?? null, pokemon.ivs);

    expect(result.kind).toBe("evolution");
    expect(result.previousSpecies).toBe("pikachu");
    expect(pokemon.species).toBe("raichu");
    expect(pokemon.maxHp).toBe(expectedStats.maxHp);
    expect(pokemon.stats).toEqual(expectedStats.stats);
    expect(user.inventory["thunder-stone"]).toBeUndefined();
    expect(user.pokedex).toContain("raichu");
  });

  it("rejects evolution items that do not match the pokemon", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "moon-stone": 1 };

    expect(() => useInventoryItem(user, "moon-stone", pokemon.uid)).toThrow(ItemUseError);
    expect(pokemon.species).toBe("pikachu");
    expect(user.inventory["moon-stone"]).toBe(1);
  });

  it("applies a vitamin and boosts the matching stat", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    const originalAttack = pokemon.stats.attack;

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { protein: 1 };

    const protein: ShopItem = { name: "단백질", price: 5000, vitaminStat: "attack" };
    const result = useInventoryItem(user, "protein", pokemon.uid, protein);

    expect(result.kind).toBe("vitamin");
    expect(result.vitaminStat).toBe("attack");
    expect(result.newVitaminCount).toBe(1);
    expect(pokemon.stats.attack).toBeGreaterThan(originalAttack);
    expect(pokemon.appliedVitamins?.attack).toBe(1);
    expect(user.inventory.protein).toBeUndefined();
  });

  it("hp-up increases maxHp and current hp", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    const originalMaxHp = pokemon.maxHp;

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "hp-up": 1 };

    const hpUp: ShopItem = { name: "맥스업", price: 5000, vitaminStat: "hp" };
    const result = useInventoryItem(user, "hp-up", pokemon.uid, hpUp);

    expect(result.kind).toBe("vitamin");
    expect(pokemon.maxHp).toBeGreaterThan(originalMaxHp);
    expect(pokemon.appliedVitamins?.hp).toBe(1);
  });

  it("rejects a vitamin after the canon 10-use cap", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { protein: 11 };
    pokemon.appliedVitamins = { hp: 0, attack: 10, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };

    const protein: ShopItem = { name: "단백질", price: 5000, vitaminStat: "attack" };
    expect(() => useInventoryItem(user, "protein", pokemon.uid, protein)).toThrow(ItemUseError);
    expect(user.inventory.protein).toBe(11);
  });

  it("applies pp-up to a specific move and caps at 3 uses", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    const move = pokemon.moves[0];
    const originalMaxPp = move.maxPp;

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "pp-up": 5 };

    const ppUp: ShopItem = { name: "포인트업", price: 3000, ppBoost: "increment" };

    const first = useInventoryItem(user, "pp-up", pokemon.uid, ppUp, { moveId: move.id });
    expect(first.kind).toBe("pp-boost");
    expect(move.maxPp).toBeGreaterThan(originalMaxPp);
    expect(move.ppUpsUsed).toBe(1);

    useInventoryItem(user, "pp-up", pokemon.uid, ppUp, { moveId: move.id });
    useInventoryItem(user, "pp-up", pokemon.uid, ppUp, { moveId: move.id });
    expect(move.ppUpsUsed).toBe(3);

    expect(() => useInventoryItem(user, "pp-up", pokemon.uid, ppUp, { moveId: move.id })).toThrow(ItemUseError);
  });

  it("pp-max jumps straight to the +3 cap", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    const move = pokemon.moves[0];
    const originalMaxPp = move.maxPp;

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "pp-max": 1 };

    const ppMax: ShopItem = { name: "포인트맥스", price: 8000, ppBoost: "max" };
    const result = useInventoryItem(user, "pp-max", pokemon.uid, ppMax, { moveId: move.id });

    expect(result.kind).toBe("pp-boost");
    expect(move.ppUpsUsed).toBe(3);
    expect(move.maxPp).toBeGreaterThan(originalMaxPp);
  });

  it("pp-up requires a moveId", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "pp-up": 1 };

    const ppUp: ShopItem = { name: "포인트업", price: 3000, ppBoost: "increment" };
    expect(() => useInventoryItem(user, "pp-up", pokemon.uid, ppUp)).toThrow(ItemUseError);
  });
});
