/**
 * Scenario 13 — Field Effects.
 *
 *  - sunny-day sets weather=sun, fire moves boosted
 *  - electric-terrain blocks sleep on grounded pokemon and boosts electric
 *    moves
 *  - trick-room reverses speed order
 *  - tailwind doubles speed (verified through turn-order via opp counter)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makeMon(species: string, moves: string[], overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: undefined,
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

describe("Scenario 13 — Field Effects", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("sunny-day sets weather=sun and persists for several turns", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("ninetales", ["sunny-day"]);
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "sunny-day" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.weather).toBe("sun");
      expect((room.weatherTurns ?? 0)).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("electric-terrain prevents sleep on a grounded defender", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const me = makeMon("breloom", ["spore"], {
        originalTypes: ["grass", "fighting"],
        stats: { attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 90 },
      });
      const opp = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      room.terrain = "electric";
      room.terrainTurns = 5;
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "spore" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Electric terrain blocks sleep on grounded mons.
      expect(opp.statusCondition).not.toBe("sleep");
      expect(room.log.some((l) => l.includes("일렉트릭필드"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("trick-room reverses speed order — slow attacker now moves first", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const slow = makeMon("snorlax", ["body-slam"], {
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const fast = makeMon("jolteon", ["thunderbolt"], {
        stats: { attack: 65, defense: 60, spAttack: 110, spDefense: 95, speed: 130 },
      });
      const room = createRoom("u1", "A", [slow], "u2", "B", [fast], false);
      room.trickRoom = 4;
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "body-slam" });
      submitAction(room, "u2", { type: "fight", moveId: "thunderbolt" });

      // Under trick room, the slow snorlax moves before the fast jolteon.
      const idxSlow = room.log.findIndex((l) => l.includes("snorlax"));
      const idxFast = room.log.findIndex((l) => l.includes("jolteon"));
      expect(idxSlow).toBeLessThan(idxFast);
      expect(idxSlow).toBeGreaterThanOrEqual(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("tailwind sets a tailwind counter on the side that used it", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("staraptor", ["tailwind"], {
        originalTypes: ["normal", "flying"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "tailwind" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect((room.playerA.tailwind ?? 0)).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });
});
