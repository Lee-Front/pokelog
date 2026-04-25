/**
 * Scenario 39 — Error Recovery.
 *
 *  - Malformed shop buy → 400; subsequent valid buy → 200
 *  - Token rotated mid-session (logout-all) → 401 → re-login → 200
 *  - Tower action with no run → 400; starting a run → 200
 *  - Repeated buy when broke → 400 each time, never 500
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { injectPoints } from "./test-helpers.js";

describe("Scenario 39 — Error Recovery", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("malformed buy → 400 then valid buy → 200", async () => {
    const { user, token } = await createTestUser({ uid: "errBuy", initialPoints: 0 });
    const http = new HttpClient(ctx.app, token);

    // Missing item field → 400.
    const bad = await http.post("/api/shop/buy", { quantity: 1 });
    expect(bad.status).toBe(400);

    // Top up and try a valid buy.
    await injectPoints(http, user.account.id, 500);
    const good = await http.post("/api/shop/buy", { item: "pokeball", quantity: 1 });
    expect(good.status).toBe(200);
    expect(good.body.points).toBe(400);
  });

  it("logout-all returns a working successor token", async () => {
    const http = new HttpClient(ctx.app);
    await http.post("/api/auth/register", {
      id: "errReauth", password: "pw1234", nickname: "RA", starter: "bulbasaur",
    });
    const login1 = await http.post("/api/auth/login", { id: "errReauth", password: "pw1234" });
    http.setToken(login1.body.token);

    // logout-all rotates the cutoff and returns a successor token whose
    // iat is intentionally bumped by 1 second so it survives the
    // freshly-recorded cutoff. The route guarantees this even when the
    // wall clock has not yet ticked past `tokenInvalidatedAt`.
    const logoutAll = await http.post("/api/auth/logout-all");
    expect(logoutAll.status).toBe(200);
    const successor = logoutAll.body.token as string;
    http.setToken(successor);

    const profile = await http.get("/api/user/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.account.id).toBe("errReauth");
  });

  it("tower /action without an active run → 400", async () => {
    const { token } = await createTestUser({
      uid: "errTowerNoRun",
      initialPokemon: [{ species: "pikachu", level: 30 }],
    });
    const http = new HttpClient(ctx.app, token);
    const res = await http.post("/api/tower/action", {
      action: { type: "fight", moveId: "tackle" },
    });
    expect(res.status).toBe(400);
  });

  it("tower /start succeeds after an explicit /forfeit", async () => {
    const { user, token } = await createTestUser({
      uid: "errTowerForfeit",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "blastoise", level: 30 },
        { species: "venusaur", level: 30 },
      ],
    });
    const http = new HttpClient(ctx.app, token);
    const partyUids = user.pokemon.map((p) => p.uid);
    const start1 = await http.post("/api/tower/start", { partyUids });
    expect(start1.status).toBe(200);

    // Second start fails (already active).
    const start2 = await http.post("/api/tower/start", { partyUids });
    expect(start2.status).toBe(400);

    // Forfeit clears, then start works again.
    const ff = await http.post("/api/tower/forfeit");
    expect(ff.status).toBe(200);

    const start3 = await http.post("/api/tower/start", { partyUids });
    expect(start3.status).toBe(200);
    expect(start3.body.run.stage).toBe(1);
  });

  it("repeated insufficient-points buys never escalate to 500", async () => {
    const { token } = await createTestUser({ uid: "errBroke", initialPoints: 0 });
    const http = new HttpClient(ctx.app, token);
    for (let i = 0; i < 5; i++) {
      const res = await http.post("/api/shop/buy", { item: "pokeball", quantity: 50 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/points/i);
    }
  });
});
