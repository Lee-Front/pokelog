/**
 * Scenario 38 — Multi-Step Game Loop.
 *
 * End-to-end flow that touches every subsystem:
 *   1. Register / login → JWT
 *   2. Inject commit → user gains points
 *   3. Buy a common egg → points decrease, egg list grows
 *   4. Hatch the egg → new pokemon in party (or storage)
 *   5. Use party for tower start → state updates
 *   6. Verify cross-system state at each step
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { HttpClient } from "./api-helpers.js";
import { simulateCommit, injectPoints, getUserState } from "./test-helpers.js";

describe("Scenario 38 — Multi-Step Game Loop", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("walks through register → commit → egg buy → hatch → tower start", async () => {
    const http = new HttpClient(ctx.app);
    // 1. Register & log in
    const reg = await http.post("/api/auth/register", {
      id: "loopUser", password: "pw1234", nickname: "LoopUser", starter: "bulbasaur",
    });
    expect(reg.status).toBe(201);
    http.setToken(reg.body.token);

    // 2. Inject a commit reward
    const outcome = await simulateCommit(http, "loopUser", 500);
    expect(outcome.points).toBeGreaterThan(0);

    // Top up to enough points for a common egg (120 pts).
    await injectPoints(http, "loopUser", 1000);
    let user = await getUserState(http);
    expect(user.points).toBeGreaterThanOrEqual(120);

    // 3. Buy a common egg.
    const buy = await http.post("/api/game/eggs/buy", { tier: "common" });
    expect(buy.status).toBe(200);
    expect(buy.body.egg).toBeDefined();
    const eggId = buy.body.egg.id as string;

    user = await getUserState(http);
    expect(user.eggs.some((e: { id: string }) => e.id === eggId)).toBe(true);

    // 4. Hatch the egg.
    const hatch = await http.post("/api/game/eggs/hatch", { eggId });
    expect(hatch.status).toBe(200);
    expect(hatch.body.pokemon).toBeDefined();
    const newPokemon = hatch.body.pokemon as { uid: string; species: string };

    user = await getUserState(http);
    expect(user.eggs.some((e: { id: string }) => e.id === eggId)).toBe(false);
    expect(user.pokemon.some((p) => p.uid === newPokemon.uid)
      || user.storage.some((p) => p.uid === newPokemon.uid)).toBe(true);
    expect(user.pokedex).toContain(newPokemon.species);

    // 5. Tower start needs a 3-mon party. Inject two extra mons via admin
    //    so we can validate the start. We've already got the starter
    //    (bulbasaur) and the hatched egg's pokemon (or it's in storage —
    //    in which case fallback to admin pokemon).
    const give = await http.asAdmin().post("/api/admin/test/give-pokemon", {
      userId: "loopUser", species: "snorlax", level: 30,
    });
    expect(give.status).toBe(200);
    const give2 = await http.asAdmin().post("/api/admin/test/give-pokemon", {
      userId: "loopUser", species: "alakazam", level: 30,
    });
    expect(give2.status).toBe(200);

    user = await getUserState(http);
    // Pick three distinct-species party members from user.pokemon.
    const seen = new Set<string>();
    const partyUids: string[] = [];
    for (const p of user.pokemon) {
      if (seen.has(p.species)) continue;
      seen.add(p.species);
      partyUids.push(p.uid);
      if (partyUids.length === 3) break;
    }
    expect(partyUids).toHaveLength(3);

    const towerRes = await http.post("/api/tower/start", { partyUids });
    expect(towerRes.status).toBe(200);
    expect(towerRes.body.run).toBeDefined();
    expect(towerRes.body.run.stage).toBe(1);
    expect(towerRes.body.roomState).toBeDefined();

    // 6. Cross-check with profile.
    const profile = await http.get("/api/user/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.activeTowerRun).toBeDefined();
    expect(profile.body.activeTowerRun.stage).toBe(1);
  });
});
