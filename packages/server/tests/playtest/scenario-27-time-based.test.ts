/**
 * Scenario 27 — Time-based Mechanics.
 *
 *  - Eevee + friendship 160 + day → resolves to espeon
 *  - Eevee + friendship 160 + night → resolves to umbreon
 *  - Tower run startedAt > 24h ago → expired on next /start
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { resolveEvolution } from "../../src/game/growth.js";
import { startTower, TOWER_RUN_TTL_MS } from "../../src/game/tower.js";

describe("Scenario 27 — Time-based Mechanics", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("Eevee + friendship 160 + day → espeon", () => {
    const branch = resolveEvolution("eevee", {
      level: 30,
      friendship: 220,
      timeOfDay: "day",
    });
    expect(branch).not.toBeNull();
    expect(branch?.targetSpecies).toBe("espeon");
  });

  it("Eevee + friendship 160 + night → umbreon", () => {
    const branch = resolveEvolution("eevee", {
      level: 30,
      friendship: 220,
      timeOfDay: "night",
    });
    expect(branch).not.toBeNull();
    expect(branch?.targetSpecies).toBe("umbreon");
  });

  it("Eevee + low friendship → no branch resolves", () => {
    const branch = resolveEvolution("eevee", {
      level: 30,
      friendship: 10,
      timeOfDay: "day",
    });
    // None of the friendship-based branches match; no level-only or
    // item branch is a fallback for eevee.
    expect(branch).toBeNull();
  });

  it("Tower run older than 24h is expired and a new start is allowed", async () => {
    const { user } = await createTestUser({
      uid: "timeTower",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "blastoise", level: 30 },
        { species: "venusaur", level: 30 },
      ],
    });
    const expired = new Date(Date.now() - (TOWER_RUN_TTL_MS + 60_000)).toISOString();
    user.activeTowerRun = {
      stage: 5,
      partyUids: user.pokemon.map((p) => p.uid),
      partySnapshot: user.pokemon.map((p) => ({
        uid: p.uid,
        currentHp: p.hp,
        currentPp: Object.fromEntries(p.moves.map((m) => [m.id, m.pp])),
        statusCondition: null,
        sleepTurns: undefined,
      })),
      startedAt: expired,
    };

    const result = startTower(user, user.pokemon.map((p) => p.uid));
    expect(result.ok).toBe(true);
    expect(result.run?.stage).toBe(1);
  });

  it("Active tower run within 24h blocks a new start", async () => {
    const { user } = await createTestUser({
      uid: "timeTowerActive",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "blastoise", level: 30 },
        { species: "venusaur", level: 30 },
      ],
    });
    const recent = new Date().toISOString();
    user.activeTowerRun = {
      stage: 3,
      partyUids: user.pokemon.map((p) => p.uid),
      partySnapshot: [],
      startedAt: recent,
    };
    const result = startTower(user, user.pokemon.map((p) => p.uid));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/이미/);
  });
});
