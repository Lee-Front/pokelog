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
    battleMoney: 0,
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
    const expectedStats = calculateStatsForLevel("raichu", 20, pokemon.nature);

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
});
