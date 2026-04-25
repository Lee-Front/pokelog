/**
 * Scenario 4 — Mega Trainer.
 *
 * Verifies the mega-evolution flow against a wild-style opponent:
 *  - Charizard with charizardite-y as held item, trainer has key-stone
 *  - During battle, submit `mega: true` action
 *  - Confirm transformation: battleForm → "charizard-mega-y", spAttack
 *    boosted vs. baseline, transformationUsed flag set
 *  - The boosted form then defeats a fragile defender
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
    stats: { attack: 84, defense: 78, spAttack: 109, spDefense: 85, speed: 100 },
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

describe("Scenario 4 — Mega Trainer", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("charizard mega-evolves to mega-y on first submission and gains spAttack", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const baseSpAttack = 109;
      const megaStats = { attack: 84, defense: 78, spAttack: 159, spDefense: 115, speed: 100 };
      const charizard = makeMon("charizard", ["flamethrower"], {
        heldItem: "charizardite-y",
        megaForm: { variantId: "charizard-mega-y", maxHp: 220, stats: megaStats },
      });
      const target = makeMon("rattata", ["tackle"], {
        maxHp: 80, hp: 80,
        stats: { attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 50 },
      });

      const room = createRoom(
        "trainer", "Mega", [charizard],
        "wild", "Wild", [target],
        false,
        { hasKeyStone: true, hasDynamaxBand: false },
        { hasKeyStone: false, hasDynamaxBand: false },
      );
      selectLead(room, "trainer", 0);
      selectLead(room, "wild", 0);

      submitAction(room, "trainer", { type: "fight", moveId: "flamethrower", mega: true });
      submitAction(room, "wild", { type: "fight", moveId: "tackle" });

      expect(room.playerA.battleForm).toBe("charizard-mega-y");
      expect(room.playerA.transformationType).toBe("mega");
      expect(room.playerA.transformationUsed).toBe(true);
      // Mega stats are applied — spAttack is no longer the baseline 109.
      expect(charizard.stats.spAttack).toBeGreaterThan(baseSpAttack);
      // The wild target took meaningful damage from STAB-boosted flamethrower.
      expect(target.hp).toBeLessThan(80);
    } finally {
      mock.mockRestore();
    }
  });

  it("mega charizard-y defeats a fragile wild target within a few turns", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const megaStats = { attack: 84, defense: 78, spAttack: 159, spDefense: 115, speed: 100 };
      const charizard = makeMon("charizard", ["flamethrower"], {
        heldItem: "charizardite-y",
        megaForm: { variantId: "charizard-mega-y", maxHp: 220, stats: megaStats },
      });
      const target = makeMon("caterpie", ["tackle"], {
        maxHp: 80, hp: 80,
        stats: { attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
      });

      const room = createRoom(
        "trainer2", "Mega", [charizard],
        "wild2", "Wild", [target],
        false,
        { hasKeyStone: true, hasDynamaxBand: false },
        { hasKeyStone: false, hasDynamaxBand: false },
      );
      selectLead(room, "trainer2", 0);
      selectLead(room, "wild2", 0);

      let safety = 0;
      let usedMega = false;
      while (room.phase !== "finished" && safety < 12) {
        safety++;
        if (room.phase !== "action") break;
        submitAction(room, "trainer2", {
          type: "fight",
          moveId: "flamethrower",
          mega: !usedMega,
        });
        usedMega = true;
        if (room.phase === "finished") break;
        submitAction(room, "wild2", { type: "fight", moveId: "tackle" });
      }

      expect(room.phase).toBe("finished");
      expect(room.result?.winnerId).toBe("trainer2");
    } finally {
      mock.mockRestore();
    }
  });
});
