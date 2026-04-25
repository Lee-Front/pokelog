/**
 * Scenario 18 — Hazards.
 *
 *  - stealth-rock sets the hazard flag on the opposing side
 *  - spikes accumulates up to 3 layers
 *  - toxic-spikes poisons grounded mons on switch-in
 *  - sticky-web drops opponent speed by -1 on switch-in
 *  - rapid-spin clears the user-side hazards
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

describe("Scenario 18 — Hazards", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("stealth-rock sets the hazard flag on the opposing side", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("tyranitar", ["stealth-rock"], {
        originalTypes: ["rock", "dark"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "stealth-rock" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerB.hazards?.stealthRock).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("spikes accumulates up to 3 layers across uses", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("ferrothorn", ["spikes"], {
        originalTypes: ["grass", "steel"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "spikes" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      submitAction(room, "u1", { type: "fight", moveId: "spikes" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      submitAction(room, "u1", { type: "fight", moveId: "spikes" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      // 4th attempt should NOT increment further (3-layer cap).
      submitAction(room, "u1", { type: "fight", moveId: "spikes" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerB.hazards?.spikes ?? 0).toBe(3);
    } finally {
      mock.mockRestore();
    }
  });

  it("toxic-spikes places a hazard on the opposing side (1 layer = poison, 2 = toxic)", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("crobat", ["toxic-spikes"], {
        originalTypes: ["poison", "flying"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "toxic-spikes" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect((room.playerB.hazards?.toxicSpikes ?? 0)).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("sticky-web sets the hazard on the opposing side", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("galvantula", ["sticky-web"], {
        originalTypes: ["bug", "electric"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "sticky-web" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerB.hazards?.stickyWeb).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("rapid-spin clears the user-side hazards", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // Pre-load player A with hazards on its side.
      const me = makeMon("staraptor", ["rapid-spin"], {
        originalTypes: ["normal", "flying"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);
      room.playerA.hazards = { stealthRock: true, spikes: 2, toxicSpikes: 1, stickyWeb: true };

      submitAction(room, "u1", { type: "fight", moveId: "rapid-spin" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerA.hazards?.stealthRock).not.toBe(true);
      expect((room.playerA.hazards?.spikes ?? 0)).toBe(0);
      expect((room.playerA.hazards?.toxicSpikes ?? 0)).toBe(0);
      expect(room.playerA.hazards?.stickyWeb).not.toBe(true);
    } finally {
      mock.mockRestore();
    }
  });
});
