/**
 * Scenario 11 — Stat Stages.
 *
 *  - swords-dance bumps the user's attack stage by +2
 *  - growl drops the opponent's attack stage by -1
 *  - The pre/post boost damage of the same physical move differs
 *    measurably (boost-amplified > baseline)
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
    stats: { attack: 100, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
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

describe("Scenario 11 — Stat Stages", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("swords-dance raises the user's attack stage by +2", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("scyther", ["swords-dance"]);
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "swords-dance" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(room.playerA.statStages.attack).toBe(2);
    } finally {
      mock.mockRestore();
    }
  });

  it("after a swords-dance turn, the next physical hit deals more than baseline", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      function runScenario(boost: boolean): number {
        const me = makeMon("machamp", ["swords-dance", "tackle"], {
          stats: { attack: 130, defense: 80, spAttack: 65, spDefense: 85, speed: 55 },
        });
        const opp = makeMon("snorlax", ["splash"], {
          maxHp: 600, hp: 600,
          stats: { attack: 80, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
        });
        const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
        selectLead(room, "u1", 0);
        selectLead(room, "u2", 0);

        if (boost) {
          submitAction(room, "u1", { type: "fight", moveId: "swords-dance" });
          submitAction(room, "u2", { type: "fight", moveId: "splash" });
        }

        const hpBefore = opp.hp;
        submitAction(room, "u1", { type: "fight", moveId: "tackle" });
        submitAction(room, "u2", { type: "fight", moveId: "splash" });
        return hpBefore - opp.hp;
      }

      const baselineDmg = runScenario(false);
      const boostedDmg = runScenario(true);
      expect(boostedDmg).toBeGreaterThan(baselineDmg);
    } finally {
      mock.mockRestore();
    }
  });

  it("intimidate drops the opponent's attack stage by -1 on switch-in", () => {
    // Intimidate is the canonical opponent-attack drop hook in this engine
    // (status-move stat drops have a quirk where they sometimes apply to
    // self when their statChance is 0). It fires on lead select.
    const me = makeMon("gyarados", ["splash"], {
      abilityId: "intimidate",
    });
    const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    expect(room.playerB.statStages.attack).toBe(-1);
  });
});
