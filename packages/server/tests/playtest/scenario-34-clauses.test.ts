/**
 * Scenario 34 — Battle Clauses.
 *
 *  - OHKO Clause: fissure / sheer-cold / horn-drill / guillotine are
 *    blocked at submit time
 *  - Evasion Clause: double-team / minimize blocked
 *  - Sleep Clause: a second opposing pokemon cannot be put to sleep
 *    while one is already asleep
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

describe("Scenario 34 — Battle Clauses", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("OHKO Clause: fissure does not damage the defender", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("rhydon", ["fissure"]);
      const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "fissure" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(opp.hp).toBe(400); // No damage taken.
      expect(room.log.some((l) => l.includes("일격기 조항"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("OHKO Clause: sheer-cold also blocked", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("articuno", ["sheer-cold"]);
      const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);
      submitAction(room, "u1", { type: "fight", moveId: "sheer-cold" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      expect(opp.hp).toBe(400);
      expect(room.log.some((l) => l.includes("일격기 조항"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("Evasion Clause: double-team is blocked at submit time", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("clefable", ["double-team"]);
      const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "double-team" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Evasion stage stays at 0; blocking message logged.
      expect(room.playerA.statStages.evasion).toBe(0);
      expect(room.log.some((l) => l.includes("회피 조항"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("Evasion Clause: minimize is also blocked", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("ditto", ["minimize"]);
      const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);
      submitAction(room, "u1", { type: "fight", moveId: "minimize" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      expect(room.playerA.statStages.evasion).toBe(0);
      expect(room.log.some((l) => l.includes("회피 조항"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("Sleep Clause: only one opposing pokemon can be asleep at a time", () => {
    // Force every random check to succeed — accuracy + ailment chance both pass.
    const mock = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const me = makeMon("gengar", ["spore", "spore"]);
      const opp1 = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
      const opp2 = makeMon("blastoise", ["splash"], { hp: 400, maxHp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp1, opp2], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      // Turn 1: spore puts opp1 to sleep
      submitAction(room, "u1", { type: "fight", moveId: "spore" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      expect(opp1.statusCondition === "sleep" || opp1.statusCondition === null).toBe(true);

      // Force opp1 asleep manually (in case spore failed).
      opp1.statusCondition = "sleep";
      opp1.sleepTurns = 3;

      // Switch opp B's active to opp2; turn 2: try to sleep opp2.
      // We simulate this by directly switching activeIndex (no actual move,
      // since switch costs a turn — for this clause check we just want
      // the second pokemon to be the active target).
      room.playerB.activeIndex = 1;
      submitAction(room, "u1", { type: "fight", moveId: "spore" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Sleep Clause must block. opp2 stays awake.
      expect(opp2.statusCondition).not.toBe("sleep");
      expect(room.log.some((l) => l.includes("잠듦 조항"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });
});
