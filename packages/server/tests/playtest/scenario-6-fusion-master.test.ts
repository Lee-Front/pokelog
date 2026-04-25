/**
 * Scenario 6 — Fusion Master.
 *
 * Drives the kyurem fusion lifecycle:
 *  - User has kyurem, reshiram, and 1 dna-splicers
 *  - fusePokemon → kyurem becomes kyurem-white, reshiram is absorbed
 *  - Verify fused stats and abilityId (turboblaze)
 *  - unfusePokemon → both species restored to inventory
 *  - Try fusing with the wrong item → rejected
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { fusePokemon, unfusePokemon } from "../../src/game/fusion.js";
import type { UserData } from "../../../../shared/types.js";

function makeUser(): UserData {
  const kyurem = createPokemon("kyurem", 70);
  const reshiram = createPokemon("reshiram", 70);
  return {
    account: {
      id: "fusionMaster",
      password: "pw",
      nickname: "fusion",
      createdAt: "2026-04-25T00:00:00.000Z",
      matchings: {},
    },
    currentRegion: "default",
    points: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [kyurem.uid, reshiram.uid],
    pokemon: [kyurem, reshiram],
    eggs: [],
    pokedex: ["kyurem", "reshiram"],
    inventory: { "dna-splicers": 1 },
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

describe("Scenario 6 — Fusion Master", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("kyurem + reshiram via dna-splicers becomes kyurem-white", () => {
    const user = makeUser();
    const kyurem = user.pokemon[0];
    const reshiram = user.pokemon[1];
    const result = fusePokemon(user, kyurem.uid, reshiram.uid, "dna-splicers");

    expect(result.ok).toBe(true);
    expect(kyurem.species).toBe("kyurem-white");
    expect(kyurem.abilityId).toBe("turboblaze");
    expect(user.pokemon).toHaveLength(1);
    expect(kyurem.fusedPartnerData?.species).toBe("reshiram");
  });

  it("unfusing restores both kyurem and reshiram to the user's pokemon list", () => {
    const user = makeUser();
    const kyurem = user.pokemon[0];
    const reshiram = user.pokemon[1];
    fusePokemon(user, kyurem.uid, reshiram.uid, "dna-splicers");
    expect(user.pokemon).toHaveLength(1);

    const unfused = unfusePokemon(user, kyurem.uid);
    expect(unfused.ok).toBe(true);
    expect(user.pokemon).toHaveLength(2);
    const speciesList = user.pokemon.map((p) => p.species).sort();
    expect(speciesList).toEqual(["kyurem", "reshiram"]);
    expect(user.pokemon.find((p) => p.species === "kyurem")?.fusedPartnerData).toBeUndefined();
  });

  it("fusing with the wrong item is rejected", () => {
    const user = makeUser();
    user.inventory["n-solarizer"] = 1;
    const result = fusePokemon(
      user,
      user.pokemon[0].uid,
      user.pokemon[1].uid,
      "n-solarizer",
    );
    expect(result.ok).toBe(false);
  });

  it("dna-splicers is reusable — its count does not decrement on a successful fuse", () => {
    const user = makeUser();
    const before = user.inventory["dna-splicers"];
    fusePokemon(user, user.pokemon[0].uid, user.pokemon[1].uid, "dna-splicers");
    expect(user.inventory["dna-splicers"]).toBe(before);
  });
});
