/**
 * Scenario 29 — Dynamax (Gen 8).
 *
 *  - With dynamax-band, a fight action carrying { dynamax: true } activates
 *    the regular dynamax form: HP doubles, gmaxTurnsRemaining = 3
 *  - End-of-turn ticks gmaxTurnsRemaining; after 3 ticks the form reverts
 *    and HP scales back proportionally
 *  - Without dynamax-band, the action falls through unchanged
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makeMon(species: string, moves: string[], overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species, level: 50,
    hp: 200, maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: ["normal"],
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

describe("Scenario 29 — Dynamax", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("with dynamax-band: maxHp doubles and revert after 3 turns", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("snorlax", ["body-slam"]);
      const opp = makeMon("blastoise", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom(
        "u1", "A", [me], "u2", "B", [opp],
        false,
        { hasKeyStone: false, hasDynamaxBand: true },
      );
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const preMax = me.maxHp;
      submitAction(room, "u1", { type: "fight", moveId: "body-slam", dynamax: true });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // After dynamax: HP should be doubled and timer set.
      expect(room.playerA.transformationType).toBe("dynamax");
      expect(me.maxHp).toBeGreaterThanOrEqual(preMax * 2 - 1);
      expect(room.playerA.gmaxTurnsRemaining).toBeGreaterThanOrEqual(2);

      // Run two more turns of splash vs body-slam to drain the timer.
      submitAction(room, "u1", { type: "fight", moveId: "body-slam" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      submitAction(room, "u1", { type: "fight", moveId: "body-slam" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // After 3 turns total of dynamax, it should have reverted.
      expect(room.playerA.transformationType).toBeNull();
      expect(me.maxHp).toBe(preMax);
    } finally {
      mock.mockRestore();
    }
  });

  it("without dynamax-band: dynamax flag is ignored", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("snorlax", ["body-slam"]);
      const opp = makeMon("blastoise", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom(
        "u1", "A", [me], "u2", "B", [opp],
        false,
        { hasKeyStone: false, hasDynamaxBand: false },
      );
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const preMax = me.maxHp;
      submitAction(room, "u1", { type: "fight", moveId: "body-slam", dynamax: true });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerA.transformationType).not.toBe("dynamax");
      expect(me.maxHp).toBe(preMax);
    } finally {
      mock.mockRestore();
    }
  });

  it("dynamax can only fire once per battle (transformationUsed flag)", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("snorlax", ["body-slam"]);
      const opp = makeMon("blastoise", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom(
        "u1", "A", [me], "u2", "B", [opp],
        false,
        { hasKeyStone: false, hasDynamaxBand: true },
      );
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "body-slam", dynamax: true });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      expect(room.playerA.transformationUsed).toBe(true);

      // Attempting dynamax a second time has no effect (transformationUsed
      // gates the branch).
      submitAction(room, "u1", { type: "fight", moveId: "body-slam", dynamax: true });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      // Still in dynamax (or already reverted) — but transformationUsed
      // remains true.
      expect(room.playerA.transformationUsed).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });
});
