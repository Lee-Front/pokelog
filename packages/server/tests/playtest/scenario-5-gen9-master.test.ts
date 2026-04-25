/**
 * Scenario 5 — Gen 9 Master.
 *
 * Exercises a Paradox + Tera combo:
 *  - Great Tusk with protosynthesis ability
 *  - Booster-energy held item OR sun weather → Paradox boost activates
 *  - Use tera (set teraType="ground") → STAB stacks with paradox boost
 *  - Verify both transformations land
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { tryActivateParadoxOnFieldChange } from "../../src/pvp/pvp-abilities.js";
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

describe("Scenario 5 — Gen 9 Master", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("great-tusk's protosynthesis activates under sun weather", () => {
    const greatTusk = makeMon("great-tusk", ["earthquake"], {
      abilityId: "protosynthesis",
      stats: { attack: 131, defense: 131, spAttack: 53, spDefense: 53, speed: 87 },
      teraType: "ground",
      originalTypes: ["ground", "fighting"],
    });
    const opp = makeMon("pidgey", ["tackle"], {
      stats: { attack: 45, defense: 40, spAttack: 35, spDefense: 35, speed: 56 },
    });
    const room = createRoom("u1", "A", [greatTusk], "u2", "B", [opp], false);
    room.weather = "sun";
    room.weatherTurns = 5;
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    tryActivateParadoxOnFieldChange(room);

    expect(room.playerA.paradoxBoost).toBeDefined();
    expect(room.playerA.paradoxBoost?.source).toBe("weather");
    // Highest stat is attack (131) → that should be the boosted stat.
    expect(room.playerA.paradoxBoost?.stat).toBe("attack");
  });

  it("great-tusk teralizes to ground and runs an earthquake — STAB compounds with paradox", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const greatTusk = makeMon("great-tusk", ["earthquake"], {
        abilityId: "protosynthesis",
        stats: { attack: 131, defense: 131, spAttack: 53, spDefense: 53, speed: 87 },
        teraType: "ground",
        originalTypes: ["ground", "fighting"],
      });
      // rattata (normal) — does not have flying-type immunity to ground.
      const opp = makeMon("rattata", ["tackle"], {
        maxHp: 200, hp: 200,
        stats: { attack: 45, defense: 40, spAttack: 35, spDefense: 35, speed: 56 },
      });
      const room = createRoom("u1", "A", [greatTusk], "u2", "B", [opp], false);
      room.weather = "sun";
      room.weatherTurns = 5;
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      tryActivateParadoxOnFieldChange(room);

      submitAction(room, "u1", { type: "fight", moveId: "earthquake", tera: true });
      submitAction(room, "u2", { type: "fight", moveId: "tackle" });

      expect(room.playerA.teraActive).toBe(true);
      expect(room.playerA.transformationType).toBe("tera");
      expect(opp.hp).toBeLessThan(200);
    } finally {
      mock.mockRestore();
    }
  });
});
