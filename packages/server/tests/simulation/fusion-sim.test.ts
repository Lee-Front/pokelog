import { describe, it, expect } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { fusePokemon, unfusePokemon } from "../../src/game/fusion.js";

function createUserData(): UserData {
  return {
    account: {
      id: "fusion-test-user",
      password: "pw",
      nickname: "fusion-tester",
      createdAt: "2026-04-22T00:00:00.000Z",
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

function makeUser(pokes: Array<[string, number]>): UserData {
  const user = createUserData();
  const pokemon = pokes.map(([species, level]) => createPokemon(species, level));
  user.pokemon = pokemon;
  user.party = pokemon.slice(0, 6).map((p) => p.uid);
  user.inventory = {
    "dna-splicers": 1,
    "n-solarizer": 1,
    "n-lunarizer": 1,
    "reins-of-unity": 1,
  };
  return user;
}

describe("Fusion — Kyurem", () => {
  it("kyurem + reshiram via dna-splicers → kyurem-white", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    const base = user.pokemon[0];
    const partner = user.pokemon[1];

    const result = fusePokemon(user, base.uid, partner.uid, "dna-splicers");

    expect(result.ok).toBe(true);
    expect(base.species).toBe("kyurem-white");
    expect(base.abilityId).toBe("turboblaze");
    expect(user.pokemon.length).toBe(1); // partner absorbed
    expect(base.fusedPartnerData).toBeDefined();
    expect(base.fusedPartnerData?.species).toBe("reshiram");
  });

  it("kyurem + zekrom via dna-splicers → kyurem-black", () => {
    const user = makeUser([["kyurem", 70], ["zekrom", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "dna-splicers",
    );
    expect(result.ok).toBe(true);
    expect(user.pokemon[0].species).toBe("kyurem-black");
    expect(user.pokemon[0].abilityId).toBe("teravolt");
  });

  it("does not consume the splicer item on fuse (reusable)", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    const before = user.inventory["dna-splicers"];
    fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "dna-splicers",
    );
    expect(user.inventory["dna-splicers"]).toBe(before);
  });

  it("unfuse restores both pokemon (kyurem + reshiram)", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    const baseUid = user.pokemon[0].uid;
    fusePokemon(user, baseUid, user.pokemon[1].uid, "dna-splicers");
    expect(user.pokemon.length).toBe(1);

    const result = unfusePokemon(user, baseUid);
    expect(result.ok).toBe(true);
    expect(user.pokemon.length).toBe(2);
    const species = user.pokemon.map((p) => p.species).sort();
    expect(species).toEqual(["kyurem", "reshiram"]);
    // Kyurem's fusion data should be cleared.
    const kyurem = user.pokemon.find((p) => p.species === "kyurem")!;
    expect(kyurem.fusedPartnerData).toBeUndefined();
    expect(kyurem.fusedPartnerUid).toBeUndefined();
  });
});

describe("Fusion — Necrozma", () => {
  it("necrozma + solgaleo via n-solarizer → necrozma-dusk", () => {
    const user = makeUser([["necrozma", 70], ["solgaleo", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "n-solarizer",
    );
    expect(result.ok).toBe(true);
    expect(user.pokemon[0].species).toBe("necrozma-dusk");
    expect(user.pokemon[0].abilityId).toBe("prism-armor");
  });

  it("necrozma + lunala via n-lunarizer → necrozma-dawn", () => {
    const user = makeUser([["necrozma", 70], ["lunala", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "n-lunarizer",
    );
    expect(result.ok).toBe(true);
    expect(user.pokemon[0].species).toBe("necrozma-dawn");
    expect(user.pokemon[0].abilityId).toBe("prism-armor");
  });
});

describe("Fusion — Calyrex", () => {
  it("calyrex + glastrier via reins-of-unity → calyrex-ice", () => {
    const user = makeUser([["calyrex", 70], ["glastrier", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "reins-of-unity",
    );
    expect(result.ok).toBe(true);
    expect(user.pokemon[0].species).toBe("calyrex-ice");
    expect(user.pokemon[0].abilityId).toBe("as-one-glastrier");
  });

  it("calyrex + spectrier via reins-of-unity → calyrex-shadow", () => {
    const user = makeUser([["calyrex", 70], ["spectrier", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "reins-of-unity",
    );
    expect(result.ok).toBe(true);
    expect(user.pokemon[0].species).toBe("calyrex-shadow");
    expect(user.pokemon[0].abilityId).toBe("as-one-spectrier");
  });
});

describe("Fusion errors", () => {
  it("rejects wrong item for the pair", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "n-solarizer",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-fusable species pair", () => {
    const user = makeUser([["pikachu", 50], ["bulbasaur", 50]]);
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "dna-splicers",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects fuse when the user does not own the item", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    user.inventory["dna-splicers"] = 0;
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "dna-splicers",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("아이템");
  });

  it("rejects unfuse on a non-fused pokemon", () => {
    const user = makeUser([["kyurem", 70]]);
    const result = unfusePokemon(user, user.pokemon[0].uid);
    expect(result.ok).toBe(false);
  });
});

describe("Fusion — stat recomputation", () => {
  it("recomputes maxHp/stats for the fused form and preserves HP ratio", () => {
    const user = makeUser([["kyurem", 70], ["reshiram", 70]]);
    const base = user.pokemon[0];
    // Simulate partial HP before fusing.
    base.hp = Math.floor(base.maxHp / 2);
    const beforeRatio = base.hp / base.maxHp;

    const result = fusePokemon(user, base.uid, user.pokemon[1].uid, "dna-splicers");
    expect(result.ok).toBe(true);

    const afterRatio = base.hp / base.maxHp;
    // HP ratio should be roughly preserved (within 1 hp of rounding).
    expect(Math.abs(afterRatio - beforeRatio)).toBeLessThan(0.05);
    expect(base.hp).toBeGreaterThan(0);
    expect(base.hp).toBeLessThanOrEqual(base.maxHp);
  });
});
