/**
 * Scenario 31 — Pokedex System.
 *
 *  - New user with empty pokedex
 *  - Catching (admin shortcut) registers the species
 *  - Trade-receiving a new species registers it
 *  - GET /api/game/pokedex returns count + entries
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { injectPokemon, getUserState } from "./test-helpers.js";
import { createTradeRequest, acceptTradeRequest } from "../../src/game/trade.js";
import { evolvePokemon } from "../../src/game/growth.js";
import { saveUser, getUser } from "../../src/storage/user-store.js";

describe("Scenario 31 — Pokedex System", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("new user starts with the pokedex containing only the starter species", async () => {
    const { user } = await createTestUser({
      uid: "dexNew",
      initialPokemon: [{ species: "bulbasaur", level: 5 }],
    });
    expect(user.pokedex).toEqual(["bulbasaur"]);
  });

  it("catching a new species via admin endpoint registers it", async () => {
    const { user, token } = await createTestUser({
      uid: "dexCatch",
      initialPokemon: [{ species: "bulbasaur", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);
    await injectPokemon(http, user.account.id, "rattata", 5);
    const after = await getUserState(http);
    expect(after.pokedex).toContain("bulbasaur");
    expect(after.pokedex).toContain("rattata");
    expect(new Set(after.pokedex).size).toBe(after.pokedex.length); // no dupes
  });

  it("trade receive registers new species in the receiver's pokedex", async () => {
    const A = await createTestUser({
      uid: "dexTrA",
      initialPokemon: [{ species: "bellsprout", level: 25 }],
    });
    const B = await createTestUser({
      uid: "dexTrB",
      initialPokemon: [{ species: "ekans", level: 25 }],
    });
    expect(A.user.pokedex).not.toContain("ekans");
    expect(B.user.pokedex).not.toContain("bellsprout");

    const trade = await createTradeRequest({
      requesterUserId: "dexTrA",
      responderUserId: "dexTrB",
      requesterPokemonUid: A.user.pokemon[0].uid,
      responderPokemonUid: B.user.pokemon[0].uid,
    });
    await acceptTradeRequest("dexTrB", trade.id);

    const aAfter = await getUser("dexTrA");
    const bAfter = await getUser("dexTrB");
    expect(aAfter?.pokedex).toContain("ekans");
    expect(bAfter?.pokedex).toContain("bellsprout");
  });

  it("evolution doesn't auto-add to pokedex (handled by commit-rewards/trade flows)", async () => {
    // The pokedex registration of evolution targets happens in the
    // commit-rewards / trade flows, NOT in evolvePokemon itself. This
    // pins the lower-level invariant.
    const { user } = await createTestUser({
      uid: "dexEvo",
      initialPokemon: [{ species: "bulbasaur", level: 16 }],
    });
    const bulb = user.pokemon[0];
    evolvePokemon(bulb, "ivysaur");
    // Pokedex still only has bulbasaur unless the calling layer adds it.
    expect(user.pokedex).toEqual(["bulbasaur"]);
  });

  it("GET /api/game/pokedex returns species entries", async () => {
    const { user, token } = await createTestUser({
      uid: "dexGet",
      initialPokemon: [
        { species: "pikachu", level: 25 },
        { species: "charmander", level: 25 },
        { species: "squirtle", level: 25 },
      ],
    });
    const http = new HttpClient(ctx.app, token);
    const res = await http.get("/api/game/pokedex");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.seen)).toBe(true);
    expect(Array.isArray(res.body.caught)).toBe(true);
    expect(Array.isArray(res.body.allSpecies)).toBe(true);
    for (const want of ["pikachu", "charmander", "squirtle"]) {
      expect(res.body.seen).toContain(want);
      expect(res.body.caught).toContain(want);
    }
    expect(user.pokedex.length).toBeGreaterThanOrEqual(3);
  });
});
