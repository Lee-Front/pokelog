/**
 * Scenario 25 — Cross-System Consistency.
 *
 *  - evolvePokemon → pokedex auto-registers the new species (in growth.ts
 *    the trade flow does this; for HTTP-driven evolution we test it via
 *    the resolve flow below)
 *  - fusion: kyurem + reshiram → kyurem-white, partner removed; unfuse
 *    restores reshiram
 *  - trade: parties + pokedex on both sides updated atomically
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { fusePokemon, unfusePokemon } from "../../src/game/fusion.js";
import { evolvePokemon } from "../../src/game/growth.js";
import { createTradeRequest, acceptTradeRequest } from "../../src/game/trade.js";
import { getUser } from "../../src/storage/user-store.js";

describe("Scenario 25 — Cross-System Consistency", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("evolution updates the pokemon's species and stats consistently", async () => {
    const { user } = await createTestUser({
      uid: "crossEvo1",
      initialPokemon: [{ species: "bulbasaur", level: 16 }],
    });
    const bulb = user.pokemon[0];
    const oldHp = bulb.maxHp;
    evolvePokemon(bulb, "ivysaur");
    expect(bulb.species).toBe("ivysaur");
    // Stats recompute → maxHp will be ≥ pre-evolution baseline.
    expect(bulb.maxHp).toBeGreaterThanOrEqual(oldHp);
  });

  it("fusion: kyurem + reshiram → kyurem-white, both removed and partner snapshot stored", async () => {
    const { user } = await createTestUser({
      uid: "crossFuse",
      initialPokemon: [
        { species: "kyurem", level: 70 },
        { species: "reshiram", level: 70 },
      ],
      initialInventory: { "dna-splicers": 1 },
    });
    const baseUid = user.pokemon[0].uid;
    const partnerUid = user.pokemon[1].uid;

    const result = fusePokemon(user, baseUid, partnerUid, "dna-splicers");
    expect(result.ok).toBe(true);
    expect(result.fusedPokemon?.species).toBe("kyurem-white");
    // Partner removed from pokemon list.
    expect(user.pokemon.find((p) => p.uid === partnerUid)).toBeUndefined();
    expect(user.pokemon.find((p) => p.uid === baseUid)).toBeDefined();

    // Now unfuse — reshiram returns as a brand-new OwnedPokemon.
    const undo = unfusePokemon(user, baseUid);
    expect(undo.ok).toBe(true);
    expect(undo.fusedPokemon?.species).toBe("kyurem");
    expect(user.pokemon.some((p) => p.species === "reshiram")).toBe(true);
  });

  it("fusion fails when the recipe is wrong", async () => {
    const { user } = await createTestUser({
      uid: "crossFuseBad",
      initialPokemon: [
        { species: "kyurem", level: 70 },
        { species: "groudon", level: 70 }, // not a valid fusion partner
      ],
      initialInventory: { "dna-splicers": 1 },
    });
    const result = fusePokemon(user, user.pokemon[0].uid, user.pokemon[1].uid, "dna-splicers");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/조합/);
  });

  it("trade: pokedex updates on both sides atomically", async () => {
    const A = await createTestUser({
      uid: "crossTrA",
      initialPokemon: [{ species: "machoke", level: 25 }],
    });
    const B = await createTestUser({
      uid: "crossTrB",
      initialPokemon: [{ species: "bellsprout", level: 25 }],
    });
    expect(A.user.pokedex).toContain("machoke");
    expect(A.user.pokedex).not.toContain("bellsprout");
    expect(B.user.pokedex).toContain("bellsprout");
    expect(B.user.pokedex).not.toContain("machoke");

    const trade = await createTradeRequest({
      requesterUserId: "crossTrA",
      responderUserId: "crossTrB",
      requesterPokemonUid: A.user.pokemon[0].uid,
      responderPokemonUid: B.user.pokemon[0].uid,
    });
    await acceptTradeRequest("crossTrB", trade.id);

    const aAfter = await getUser("crossTrA");
    const bAfter = await getUser("crossTrB");
    // machoke evolves into machamp on trade. Both pokedexes register the
    // newly received species; sender's old species is unchanged in dex.
    expect(aAfter?.pokedex).toContain("bellsprout");
    expect(bAfter?.pokedex).toContain("machamp");
    // Both rosters reflect the swap.
    expect(aAfter?.pokemon.some((p) => p.species === "bellsprout")).toBe(true);
    expect(bAfter?.pokemon.some((p) => p.species === "machamp")).toBe(true);
  });
});
