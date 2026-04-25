/**
 * Scenario 7 — Social Trade.
 *
 * Drives the trade module directly (bypasses HTTP) to validate the
 * end-to-end accept flow:
 *  - Two users A and B
 *  - A has haunter, B has bellsprout
 *  - createTradeRequest from A to B
 *  - acceptTradeRequest from B → swap completed
 *  - haunter, on receipt, evolves into gengar (canon trade evolution)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { createTradeRequest, acceptTradeRequest } from "../../src/game/trade.js";
import { getUser } from "../../src/storage/user-store.js";

describe("Scenario 7 — Social Trade", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("A trades haunter, B trades bellsprout — pokemon swap correctly", async () => {
    const A = await createTestUser({
      uid: "tradeAlpha",
      initialPokemon: [{ species: "haunter", level: 30 }],
    });
    const B = await createTestUser({
      uid: "tradeBravo",
      initialPokemon: [{ species: "bellsprout", level: 20 }],
    });

    const aHaunterUid = A.user.pokemon[0].uid;
    const bBellsproutUid = B.user.pokemon[0].uid;

    const trade = await createTradeRequest({
      requesterUserId: "tradeAlpha",
      responderUserId: "tradeBravo",
      requesterPokemonUid: aHaunterUid,
      responderPokemonUid: bBellsproutUid,
    });
    expect(trade.status).toBe("pending");

    const accepted = await acceptTradeRequest("tradeBravo", trade.id);
    expect(accepted.trade.status).toBe("accepted");

    const aAfter = await getUser("tradeAlpha");
    const bAfter = await getUser("tradeBravo");
    expect(aAfter).not.toBeNull();
    expect(bAfter).not.toBeNull();

    // A should now hold a bellsprout (or its trade evolution if any).
    // bellsprout has no trade evolution → species unchanged.
    expect(aAfter!.pokemon.some((p) => p.species === "bellsprout")).toBe(true);
    // B should now hold gengar (haunter evolves on trade).
    expect(bAfter!.pokemon.some((p) => p.species === "gengar")).toBe(true);

    // Both pokedexes should reflect the new arrivals.
    expect(aAfter!.pokedex).toContain("bellsprout");
    expect(bAfter!.pokedex).toContain("gengar");
  });

  it("a self-trade is rejected by the trade module", async () => {
    const A = await createTestUser({
      uid: "tradeSolo",
      initialPokemon: [
        { species: "machoke", level: 30 },
        { species: "graveler", level: 30 },
      ],
    });

    await expect(
      createTradeRequest({
        requesterUserId: "tradeSolo",
        responderUserId: "tradeSolo",
        requesterPokemonUid: A.user.pokemon[0].uid,
        responderPokemonUid: A.user.pokemon[1].uid,
      }),
    ).rejects.toThrow(/cannot trade with yourself/i);
  });
});
