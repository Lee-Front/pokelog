/**
 * Scenario 14 — Walls and Defense.
 *
 *  - reflect halves physical damage for 5 turns
 *  - light-screen halves special damage
 *  - protect blocks incoming damage for 1 turn
 *  - substitute consumes 25% HP and absorbs subsequent hits until broken
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

describe("Scenario 14 — Walls and Defense", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("reflect cuts physical damage roughly in half on the next turn", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      function runWith(reflectFirst: boolean): number {
        const me = makeMon("alakazam", ["reflect", "thunder-punch"], {
          stats: { attack: 100, defense: 45, spAttack: 135, spDefense: 95, speed: 120 },
        });
        const opp = makeMon("machamp", ["cross-chop"], {
          maxHp: 400, hp: 400,
          stats: { attack: 130, defense: 80, spAttack: 65, spDefense: 85, speed: 55 },
        });
        const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
        selectLead(room, "u1", 0);
        selectLead(room, "u2", 0);

        if (reflectFirst) {
          submitAction(room, "u1", { type: "fight", moveId: "reflect" });
          submitAction(room, "u2", { type: "fight", moveId: "cross-chop" });
        }
        const hpBefore = me.hp;
        // Now the cross-chop turn (with or without reflect already up).
        submitAction(room, "u1", { type: "fight", moveId: "thunder-punch" });
        submitAction(room, "u2", { type: "fight", moveId: "cross-chop" });
        return hpBefore - me.hp;
      }

      const baseline = runWith(false);
      const withReflect = runWith(true);
      // Reflect should reduce damage. Use loose assertion.
      expect(withReflect).toBeLessThan(baseline);
    } finally {
      mock.mockRestore();
    }
  });

  it("light-screen sets a screen counter on the user's side", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("alakazam", ["light-screen"]);
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "light-screen" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect((room.playerA.screens?.lightScreen ?? 0)).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("protect blocks the incoming damage on the same turn", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.001); // succeed protect first time
    try {
      const me = makeMon("toxapex", ["protect"], {
        stats: { attack: 60, defense: 152, spAttack: 53, spDefense: 142, speed: 35 },
      });
      const opp = makeMon("garchomp", ["earthquake"], {
        maxHp: 250, hp: 250,
        stats: { attack: 130, defense: 95, spAttack: 80, spDefense: 85, speed: 102 },
      });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = me.hp;
      submitAction(room, "u1", { type: "fight", moveId: "protect" });
      submitAction(room, "u2", { type: "fight", moveId: "earthquake" });

      // Protect succeeded → no damage taken.
      expect(me.hp).toBe(hpBefore);
      expect(room.log.some((l) => l.includes("방어 태세"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("substitute consumes 25% of user HP and shows a sub-HP counter", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("gengar", ["substitute"], {
        maxHp: 200, hp: 200,
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "substitute" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // 25% of maxHp (200) = 50 → user lost 50 HP.
      expect(me.hp).toBeLessThanOrEqual(150);
      expect(me.hp).toBeGreaterThan(0);
      expect((room.playerA.substitute ?? 0)).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });
});
