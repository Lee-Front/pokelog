import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import {
  injectPoints,
  injectItem,
  injectPokemon,
  simulateCommit,
  getUserState,
  getPartyList,
} from "./test-helpers.js";

/**
 * Smoke test for the AI playtest infrastructure.
 *
 * Boots an in-process server, creates a test user, and exercises the
 * three primary surfaces the scenario tests rely on:
 *  - HTTP client + bearer-auth (/api/user/profile)
 *  - Admin /test/* endpoints (mint points, items, pokemon, commit)
 *  - Game read endpoints (party listing, profile)
 */
describe("playtest infrastructure smoke", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("starts in-process server with random port", () => {
    expect(ctx.port).toBeGreaterThan(0);
    expect(ctx.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("creates an authenticated test user", async () => {
    const { user, token } = await createTestUser({
      uid: "smokeuserA",
      initialPoints: 1000,
    });
    expect(user.account.id).toBe("smokeuserA");
    expect(user.points).toBe(1000);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const http = new HttpClient(ctx.app, token);
    const profile = await getUserState(http);
    expect(profile.account.id).toBe("smokeuserA");
    expect(profile.points).toBe(1000);
    // Password must NOT be returned by /profile.
    expect((profile.account as { password?: unknown }).password).toBeUndefined();
  });

  it("creates user with starter party and exposes it via /api/game/party", async () => {
    const { token } = await createTestUser({
      uid: "smokeuserB",
      initialPokemon: [{ species: "charmander", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);
    const party = await getPartyList(http);
    expect(party).toHaveLength(1);
    expect(party[0].species).toBe("charmander");
    expect(party[0].level).toBe(5);
  });

  it("admin /test/give-points injects points", async () => {
    const { user, token } = await createTestUser({ uid: "smokeuserC" });
    const http = new HttpClient(ctx.app, token);
    const newTotal = await injectPoints(http, user.account.id, 250);
    expect(newTotal).toBe(250);

    const after = await getUserState(http);
    expect(after.points).toBe(250);
  });

  it("admin /test/give-item injects inventory items", async () => {
    const { user, token } = await createTestUser({ uid: "smokeuserD" });
    const http = new HttpClient(ctx.app, token);
    const inventory = await injectItem(http, user.account.id, "potion", 3);
    expect(inventory.potion).toBe(3);
  });

  it("admin /test/give-pokemon adds a pokemon to the party", async () => {
    const { user, token } = await createTestUser({ uid: "smokeuserE" });
    const http = new HttpClient(ctx.app, token);
    const pokemon = await injectPokemon(http, user.account.id, "pikachu", 10);
    expect(pokemon.species).toBe("pikachu");
    expect(pokemon.level).toBe(10);

    const party = await getPartyList(http);
    expect(party.some((p) => p.species === "pikachu")).toBe(true);
  });

  it("admin /test/commit applies commit-style rewards", async () => {
    const { user, token } = await createTestUser({ uid: "smokeuserF" });
    const http = new HttpClient(ctx.app, token);
    const outcome = await simulateCommit(http, user.account.id, 1000);
    expect(outcome.points).toBeGreaterThan(0);
    expect(outcome.exp).toBeGreaterThan(0);

    const after = await getUserState(http);
    expect(after.points).toBeGreaterThan(0);
  });
});
