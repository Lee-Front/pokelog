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
    gameMoney: 0,
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
    const expectedStats = calculateStatsForLevel("raichu", 20, pokemon.nature, pokemon.variantId, pokemon.ivs);

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

  it("applies a vitamin (+10 EV), recomputes stats, and consumes it", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 50);
    pokemon.evs = undefined; // 미초기화 개체도 안전하게 처리되어야 한다.

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { protein: 1 };

    const result = useInventoryItem(user, "protein", pokemon.uid);

    expect(result.kind).toBe("vitamin");
    expect(pokemon.evs?.attack).toBe(10);
    expect(user.inventory.protein).toBeUndefined();
  });

  it("rejects a vitamin when the stat is already at the 252 cap", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 50);
    pokemon.evs = { hp: 0, attack: 252, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { protein: 1 };

    expect(() => useInventoryItem(user, "protein", pokemon.uid)).toThrow(ItemUseError);
    expect(pokemon.evs.attack).toBe(252);
    expect(user.inventory.protein).toBe(1);
  });

  it("evolves the new Gen-9 item lines (applin→dipplin, duraludon→archaludon, bisharp→kingambit)", () => {
    const cases = [
      { from: "applin", item: "syrupy-apple", to: "dipplin" },
      { from: "duraludon", item: "metal-alloy", to: "archaludon" },
      { from: "bisharp", item: "leaders-crest", to: "kingambit" },
    ];

    for (const { from, item, to } of cases) {
      const user = createUserData();
      const pokemon = createPokemon(from, 40);
      user.party = [pokemon.uid];
      user.pokemon = [pokemon];
      user.pokedex = [from];
      user.inventory = { [item]: 1 };

      const result = useInventoryItem(user, item, pokemon.uid);

      expect(result.kind, `${from} + ${item}`).toBe("evolution");
      expect(result.previousSpecies).toBe(from);
      expect(pokemon.species).toBe(to);
      expect(user.inventory[item]).toBeUndefined();
      expect(user.pokedex).toContain(to);
    }
  });

  it("rejects a vitamin when the 510 total is already reached", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 50);
    pokemon.evs = { hp: 6, attack: 252, defense: 0, spAttack: 0, spDefense: 0, speed: 252 };

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { iron: 1 };

    expect(() => useInventoryItem(user, "iron", pokemon.uid)).toThrow(ItemUseError);
    expect(user.inventory.iron).toBe(1);
  });

  it("cures the matching status condition and consumes the cure item", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    pokemon.statusCondition = "poison";

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { antidote: 1 };

    const antidote: ShopItem = { name: "Antidote", price: 10, category: "potion", curesStatus: "poison" };
    const result = useInventoryItem(user, "antidote", pokemon.uid, antidote);

    expect(result.kind).toBe("status-cure");
    expect(pokemon.statusCondition).toBeNull();
    expect(user.inventory.antidote).toBeUndefined();
  });

  it("rejects a cure item when the status does not match (and keeps the item)", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    pokemon.statusCondition = "burn";

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { antidote: 1 };

    const antidote: ShopItem = { name: "Antidote", price: 10, category: "potion", curesStatus: "poison" };

    expect(() => useInventoryItem(user, "antidote", pokemon.uid, antidote)).toThrow(ItemUseError);
    expect(pokemon.statusCondition).toBe("burn");
    expect(user.inventory.antidote).toBe(1);
  });

  it("rejects a cure item when the pokemon has no status condition", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    pokemon.statusCondition = null;

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "full-heal": 1 };

    const fullHeal: ShopItem = { name: "Full Heal", price: 40, category: "potion", curesStatus: "all" };

    expect(() => useInventoryItem(user, "full-heal", pokemon.uid, fullHeal)).toThrow(ItemUseError);
    expect(user.inventory["full-heal"]).toBe(1);
  });

  it("full-heal cures any status condition", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    pokemon.statusCondition = "paralysis";

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "full-heal": 1 };

    const fullHeal: ShopItem = { name: "Full Heal", price: 40, category: "potion", curesStatus: "all" };
    const result = useInventoryItem(user, "full-heal", pokemon.uid, fullHeal);

    expect(result.kind).toBe("status-cure");
    expect(pokemon.statusCondition).toBeNull();
    expect(user.inventory["full-heal"]).toBeUndefined();
  });

  it("linking-cord triggers a trade evolution (machoke → machamp) and updates pokedex", () => {
    const user = createUserData();
    const pokemon = createPokemon("machoke", 40);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.pokedex = ["machoke"];
    user.inventory = { "linking-cord": 1 };

    const result = useInventoryItem(user, "linking-cord", pokemon.uid);

    expect(result.kind).toBe("evolution");
    expect(result.previousSpecies).toBe("machoke");
    expect(pokemon.species).toBe("machamp");
    expect(user.inventory["linking-cord"]).toBeUndefined();
    expect(user.pokedex).toContain("machamp");
  });

  it("linking-cord rejects a pokemon with no trade evolution", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 40);

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "linking-cord": 1 };

    expect(() => useInventoryItem(user, "linking-cord", pokemon.uid)).toThrow(ItemUseError);
    expect(pokemon.species).toBe("pikachu");
    expect(user.inventory["linking-cord"]).toBe(1);
  });
});
