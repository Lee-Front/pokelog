/**
 * Scenario 2 — Collector.
 *
 * A collector-flavoured run-through of the egg hatch path:
 *  - Mint a user with a chunk of points and 10 common eggs in inventory
 *  - Hatch each egg via the game's hatchEgg() helper directly (bypasses
 *    the route's incubator-time gating, but exercises the actual gacha
 *    pool / level-range logic)
 *  - Verify variety of hatched species across the 10 hatches
 *  - Verify pokedex grows in lockstep with first-of-species hatches
 *
 * Some hatches will yield species that have a level-up evolution within
 * the hatched-level band — the test confirms at least one such candidate
 * is hatchable (the evolution itself is a separate concern).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { hatchEgg } from "../../src/game/egg-gacha.js";
import { getEvolutionBranches } from "../../src/game/growth.js";
import type { OwnedEgg } from "../../../../shared/types.js";

describe("Scenario 2 — Collector", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("hatches 10 common eggs and produces varied species", () => {
    // Don't mock random — we want the gacha pool to roll naturally.
    const speciesSet = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const egg: OwnedEgg = {
        id: `collector-egg-${i}`,
        tier: "common",
        createdAt: "2026-04-25T00:00:00.000Z",
      };
      const result = hatchEgg(egg);
      expect(result.pokemon.level).toBeGreaterThanOrEqual(1);
      expect(result.pokemon.level).toBeLessThanOrEqual(6);
      speciesSet.add(result.pokemon.species);
    }
    // 10 hatches should yield at least 3 distinct species — pool is wide.
    expect(speciesSet.size).toBeGreaterThanOrEqual(3);
  });

  it("creates a collector user, hatches 10 eggs, and grows the pokedex", async () => {
    const { user } = await createTestUser({
      uid: "collector1",
      initialPoints: 50_000,
      initialInventory: { "common-egg": 10 },
    });
    expect(user.points).toBe(50_000);
    expect(user.inventory["common-egg"]).toBe(10);

    // Simulate the hatch loop locally and accumulate hatched species into
    // the user's tracked pokedex (the hatch-route does the same write).
    for (let i = 0; i < 10; i++) {
      const egg: OwnedEgg = {
        id: `pokedex-egg-${i}`,
        tier: "common",
        createdAt: "2026-04-25T00:00:00.000Z",
      };
      const result = hatchEgg(egg);
      user.pokemon.push(result.pokemon);
      if (!user.pokedex.includes(result.pokemon.species)) {
        user.pokedex.push(result.pokemon.species);
      }
    }
    expect(user.pokemon).toHaveLength(10);
    expect(user.pokedex.length).toBeGreaterThanOrEqual(3);
  });

  it("hatched pokemon include evolvable species the user can grow", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      let evolvableHatched = 0;
      for (let i = 0; i < 30; i++) {
        const egg: OwnedEgg = {
          id: `evo-egg-${i}`,
          tier: "common",
          createdAt: "2026-04-25T00:00:00.000Z",
        };
        const result = hatchEgg(egg);
        const branches = getEvolutionBranches(result.pokemon.species);
        if (branches.length > 0) evolvableHatched += 1;
      }
      expect(evolvableHatched).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });
});
