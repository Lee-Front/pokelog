/**
 * Scenario 1 — Newbie First Hour.
 *
 * The new-user happy path:
 *  - Register a fresh user with seed points and a starter pokemon
 *  - Inject a poke-ball via the admin /test/give-item endpoint
 *  - Force a wild encounter via the admin /test/encounter endpoint
 *  - Verify pendingEvents carries the encounter, then directly hand the
 *    user a captured pokemon via /test/give-pokemon (encounter-routes use
 *    the live capture flow which we exercise more thoroughly elsewhere)
 *  - Confirm the captured pokemon shows up in the party AND the pokedex
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import {
  forceEncounter,
  injectItem,
  injectPokemon,
  getUserState,
  getPartyList,
} from "./test-helpers.js";

describe("Scenario 1 — Newbie First Hour", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("registers a new user with starter bulbasaur Lv.5 and 100k points", async () => {
    const { user, token } = await createTestUser({
      uid: "newbie1",
      initialPoints: 100_000,
      initialPokemon: [{ species: "bulbasaur", level: 5 }],
    });
    expect(user.points).toBe(100_000);
    expect(user.pokemon[0].species).toBe("bulbasaur");
    expect(user.pokemon[0].level).toBe(5);
    expect(user.party).toHaveLength(1);
    expect(token.length).toBeGreaterThan(20);
  });

  it("equips the trainer with poke-balls and forces a wild encounter", async () => {
    const { user, token } = await createTestUser({
      uid: "newbie2",
      initialPoints: 100_000,
      initialPokemon: [{ species: "bulbasaur", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);

    const inv = await injectItem(http, user.account.id, "poke-ball", 5);
    expect(inv["poke-ball"]).toBe(5);

    const event = await forceEncounter(http, user.account.id, {
      species: "rattata",
      level: 3,
    });
    expect(event.species).toBe("rattata");
    expect(event.level).toBe(3);

    const after = await getUserState(http);
    expect(after.pendingEvents.some((e) => e.id === event.id)).toBe(true);
  });

  it("captures the wild pokemon (admin shortcut) and updates party + pokedex", async () => {
    const { user, token } = await createTestUser({
      uid: "newbie3",
      initialPoints: 100_000,
      initialPokemon: [{ species: "bulbasaur", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);

    // Real flow goes through encounter-routes / capture, but the smoke test
    // covers that surface. Here we just want to assert that a successfully-
    // captured pokemon lands in the party and pokedex.
    const captured = await injectPokemon(http, user.account.id, "rattata", 3);
    expect(captured.species).toBe("rattata");

    const party = await getPartyList(http);
    expect(party.some((p) => p.species === "rattata")).toBe(true);

    const after = await getUserState(http);
    expect(after.pokedex).toContain("bulbasaur");
    expect(after.pokedex).toContain("rattata");
  });
});
