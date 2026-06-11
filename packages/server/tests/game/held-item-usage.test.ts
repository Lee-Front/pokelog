import { describe, expect, it } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { equipHeldItem, HeldItemError, unequipHeldItem } from "../../src/game/held-item-usage.js";

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

describe("held-item-usage", () => {
  it("equips a holdable item from inventory", () => {
    const user = createUserData();
    const pokemon = createPokemon("slowpoke", 20);
    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "kings-rock": 1 };

    const result = equipHeldItem(user, pokemon.uid, "kings-rock");

    expect(result.item).toBe("kings-rock");
    expect(result.previousHeldItem).toBeNull();
    expect(pokemon.heldItem).toBe("kings-rock");
    expect(user.inventory["kings-rock"]).toBeUndefined();
  });

  it("replaces the previous held item and returns it to inventory", () => {
    const user = createUserData();
    const pokemon = createPokemon("scyther", 20);
    pokemon.heldItem = "metal-coat";

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "razor-claw": 1 };

    const result = equipHeldItem(user, pokemon.uid, "razor-claw");

    expect(result.previousHeldItem).toBe("metal-coat");
    expect(pokemon.heldItem).toBe("razor-claw");
    expect(user.inventory["razor-claw"]).toBeUndefined();
    expect(user.inventory["metal-coat"]).toBe(1);
  });

  it("rejects non-holdable items", () => {
    const user = createUserData();
    const pokemon = createPokemon("pikachu", 20);
    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { potion: 1 };

    expect(() => equipHeldItem(user, pokemon.uid, "potion")).toThrow(HeldItemError);
    expect(user.inventory.potion).toBe(1);
    expect(pokemon.heldItem).toBeNull();
  });

  it("unequips a held item back into inventory", () => {
    const user = createUserData();
    const pokemon = createPokemon("seadra", 20);
    pokemon.heldItem = "dragon-scale";

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];

    const result = unequipHeldItem(user, pokemon.uid);

    expect(result.item).toBe("dragon-scale");
    expect(pokemon.heldItem).toBeNull();
    expect(user.inventory["dragon-scale"]).toBe(1);
  });
});
