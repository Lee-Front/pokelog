/**
 * Scenario 22 — Edge Cases / Boundary.
 *
 *  - Empty-party tower entry: rejected (need 3 pokemon)
 *  - 7th-pokemon overflow: admin give-pokemon routes the 7th into storage
 *  - Insufficient points → /shop/buy returns 400
 *  - 11th vitamin: useInventoryItem rejects after 10 uses (covered in scenario 8;
 *    we add a complementary tower-clause test here instead)
 *  - Species Clause: tower start refuses two same-species pokemon
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { injectPokemon } from "./test-helpers.js";
import { startTower } from "../../src/game/tower.js";

describe("Scenario 22 — Edge Cases / Boundary", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("empty-party user cannot start the tower", async () => {
    const { user } = await createTestUser({ uid: "edgeEmpty" });
    expect(user.pokemon).toHaveLength(0);
    const res = startTower(user, []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/3마리/);
  });

  it("7th pokemon goes to storage (party cap = 6)", async () => {
    const { user, token } = await createTestUser({
      uid: "edgeOverflow",
      initialPokemon: Array.from({ length: 6 }, () => ({ species: "rattata", level: 5 })),
    });
    const http = new HttpClient(ctx.app, token);

    expect(user.party).toHaveLength(6);
    expect(user.storage).toHaveLength(0);

    const seventh = await injectPokemon(http, user.account.id, "magikarp", 5);
    expect(seventh.species).toBe("magikarp");

    const profile = await http.get("/api/user/profile");
    expect(profile.status).toBe(200);
    // Storage now contains the 7th, party still 6.
    expect(profile.body.party).toHaveLength(6);
    expect(profile.body.storage.length).toBeGreaterThanOrEqual(1);
    expect(profile.body.storage.some((p: { species: string }) => p.species === "magikarp")).toBe(true);
  });

  it("/shop/buy with insufficient points → 400", async () => {
    const { token } = await createTestUser({ uid: "edgePoor", initialPoints: 0 });
    const http = new HttpClient(ctx.app, token);
    const res = await http.post("/api/shop/buy", { item: "pokeball", quantity: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/points/i);
  });

  it("Species Clause: tower rejects two pikachu in the same party", async () => {
    const { user } = await createTestUser({
      uid: "edgeClause",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "pikachu", level: 30 },
        { species: "pikachu", level: 30 },
      ],
    });
    const partyUids = user.pokemon.map((p) => p.uid);
    const res = startTower(user, partyUids);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Species Clause|같은 종족/);
  });

  it("fainted pokemon cannot enter tower", async () => {
    const { user } = await createTestUser({
      uid: "edgeFainted",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "blastoise", level: 30 },
        { species: "venusaur", level: 30 },
      ],
    });
    user.pokemon[0].hp = 0; // KO'd lead
    const partyUids = user.pokemon.map((p) => p.uid);
    const res = startTower(user, partyUids);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/기절/);
  });
});
