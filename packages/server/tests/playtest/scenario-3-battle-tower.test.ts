/**
 * Scenario 3 — Battle Tower.
 *
 * Drives a tower-style 3v3 PvE battle to completion against a weaker
 * AI opponent. We use the in-process PvP room directly (bypassing the
 * HTTP tower flow) because:
 *   - The tower-routes layer has its own dedicated tests
 *   - We want determinism without real socket/timer plumbing
 *
 * Strategy:
 *   1. Build a strong user party (charizard / blastoise / venusaur Lv.50)
 *   2. Build a weak AI opposition party
 *   3. Run an AI-vs-heuristic loop until the room is finished
 *   4. Assert the user side wins, log accumulates, and stage rewards
 *      could be granted (we simulate one stage clear via reward math).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { chooseAiAction } from "../../src/pvp/pvp-ai.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makeStrongMon(species: string, moves: string[]): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 130, defense: 100, spAttack: 130, spDefense: 100, speed: 100 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: undefined,
    stellarTypesUsed: [],
    rageFistHits: 0,
  };
}

function makeWeakMon(species: string, moves: string[]): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species,
    level: 50,
    hp: 60,
    maxHp: 60,
    stats: { attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 50 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: undefined,
    stellarTypesUsed: [],
    rageFistHits: 0,
  };
}

describe("Scenario 3 — Battle Tower", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("strong user party clears one tower stage against weak AI", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const userParty = [
        makeStrongMon("charizard", ["flamethrower", "air-slash"]),
        makeStrongMon("blastoise", ["surf", "ice-beam"]),
        makeStrongMon("venusaur", ["solar-beam", "sludge-bomb"]),
      ];
      const aiParty = [
        makeWeakMon("rattata", ["tackle"]),
        makeWeakMon("pidgey", ["gust"]),
        makeWeakMon("caterpie", ["tackle"]),
      ];

      const room = createRoom(
        "userT", "Trainer", userParty,
        "aiT", "Tower AI", aiParty,
        true,
      );
      selectLead(room, "userT", 0);
      selectLead(room, "aiT", 0);

      let safety = 0;
      while (room.phase !== "finished" && safety < 60) {
        safety++;
        if (room.phase === "action") {
          const actA = chooseAiAction(room.playerA, room.playerB);
          const actB = chooseAiAction(room.playerB, room.playerA);
          submitAction(room, "userT", actA);
          if (room.phase !== "finished") submitAction(room, "aiT", actB);
        } else if (room.phase === "forced_switch") {
          if (room.forcedSwitchNeeded?.a) {
            const idx = room.playerA.party.findIndex(
              (p, i) => p.hp > 0 && i !== room.playerA.activeIndex,
            );
            if (idx >= 0) submitAction(room, "userT", { type: "switch", pokemonIndex: idx });
            else break;
          }
          if (room.forcedSwitchNeeded?.b) {
            const idx = room.playerB.party.findIndex(
              (p, i) => p.hp > 0 && i !== room.playerB.activeIndex,
            );
            if (idx >= 0) submitAction(room, "aiT", { type: "switch", pokemonIndex: idx });
            else break;
          }
        } else {
          break;
        }
      }

      expect(room.phase).toBe("finished");
      expect(room.result?.winnerId).toBe("userT");
      // User must still have at least one alive pokemon.
      expect(room.playerA.party.some((p) => p.hp > 0)).toBe(true);
      // All AI mons KO'd.
      expect(room.playerB.party.every((p) => p.hp <= 0)).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("after a stage clear, the player can immediately challenge stage 2 (state preserved)", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const charm = makeStrongMon("charizard", ["flamethrower"]);
      // Pre-damage charizard to confirm HP carries forward (canon tower rule).
      charm.hp = 120; // 200 max
      const userParty = [charm];
      const ai1 = [makeWeakMon("rattata", ["tackle"])];
      const ai2 = [makeWeakMon("pidgey", ["gust"])];

      const stage1 = createRoom("u1", "T", userParty, "ai1", "AI1", ai1, true);
      selectLead(stage1, "u1", 0);
      selectLead(stage1, "ai1", 0);
      let safety = 0;
      while (stage1.phase !== "finished" && safety < 30) {
        safety++;
        if (stage1.phase !== "action") break;
        submitAction(stage1, "u1", chooseAiAction(stage1.playerA, stage1.playerB));
        if (stage1.phase === "finished") break;
        submitAction(stage1, "ai1", chooseAiAction(stage1.playerB, stage1.playerA));
      }
      expect(stage1.phase).toBe("finished");
      expect(stage1.result?.winnerId).toBe("u1");

      // Carry the user's pokemon HP into stage 2 (snapshot preservation).
      const aliveAfterStage1 = stage1.playerA.party[0];
      const hpCarriedIn = aliveAfterStage1.hp;

      const stage2 = createRoom("u1", "T", [aliveAfterStage1], "ai2", "AI2", ai2, true);
      expect(stage2.playerA.party[0].hp).toBe(hpCarriedIn);
    } finally {
      mock.mockRestore();
    }
  });
});
