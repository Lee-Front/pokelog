/**
 * Scenario 20 — Permission Isolation.
 *
 * Verifies an authenticated user can only see / mutate their own data:
 *  - User A querying B's pokemon UID via /api/game/pokemon/:uid → 404
 *    (the lookup is scoped to req.userId so B's pokemon are invisible)
 *  - User A using /api/user/judge/:uid against B's pokemon → 404
 *  - Non-admin user on /api/admin/* → 403 (admin key missing)
 *  - Unauthenticated request to authed endpoint → 401
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";

describe("Scenario 20 — Permission Isolation", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("A cannot read B's pokemon detail by UID", async () => {
    const A = await createTestUser({
      uid: "permA",
      initialPokemon: [{ species: "pikachu", level: 25 }],
    });
    const B = await createTestUser({
      uid: "permB",
      initialPokemon: [{ species: "charmander", level: 25 }],
    });

    const bUid = B.user.pokemon[0].uid;
    const httpA = new HttpClient(ctx.app, A.token);
    const res = await httpA.get(`/api/game/pokemon/${bUid}`);
    // The route looks up the pokemon within A's roster only — so B's UID
    // resolves to "not found" rather than a forbidden response.
    expect(res.status).toBe(404);
  });

  it("A cannot judge B's pokemon", async () => {
    const A = await createTestUser({
      uid: "permA2",
      initialPokemon: [{ species: "pikachu", level: 25 }],
    });
    const B = await createTestUser({
      uid: "permB2",
      initialPokemon: [{ species: "charmander", level: 25 }],
    });
    const httpA = new HttpClient(ctx.app, A.token);

    const bUid = B.user.pokemon[0].uid;
    const res = await httpA.get(`/api/user/judge/${bUid}`);
    expect([403, 404]).toContain(res.status);
  });

  it("/api/auth/logout-all does NOT affect other users", async () => {
    const A = await createTestUser({ uid: "permA3" });
    const B = await createTestUser({ uid: "permB3" });

    const httpA = new HttpClient(ctx.app, A.token);
    await httpA.post("/api/auth/logout-all");

    // B's token is still valid — A's cutoff doesn't apply.
    const httpB = new HttpClient(ctx.app, B.token);
    const res = await httpB.get("/api/user/profile");
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe("permB3");
  });

  it("non-admin user hitting /api/admin/* gets 403", async () => {
    const A = await createTestUser({ uid: "permnoadmin" });
    const httpA = new HttpClient(ctx.app, A.token);
    // No admin key set on this client.
    const res = await httpA.get("/api/admin/status");
    expect(res.status).toBe(403);
  });

  it("admin endpoint with invalid key → 403", async () => {
    const A = await createTestUser({ uid: "permadminbad" });
    const httpA = new HttpClient(ctx.app, A.token);
    httpA.setAdminKey("not-the-real-key");
    const res = await httpA.get("/api/admin/status");
    expect(res.status).toBe(403);
  });

  it("unauthenticated request to authed endpoint → 401", async () => {
    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/user/profile");
    expect(res.status).toBe(401);
  });
});
