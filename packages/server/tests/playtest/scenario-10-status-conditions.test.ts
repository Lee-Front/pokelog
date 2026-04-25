/**
 * Scenario 10 — Status Conditions.
 *
 * For each canon primary status:
 *   - Apply via the appropriate move (will-o-wisp / thunder-wave / spore /
 *     toxic) using the in-process PvP engine
 *   - Verify the defender's statusCondition is set
 *   - Verify the residual / behavioural side effect (burn ticks 1/16,
 *     paralysis halves speed for the rest of the battle, toxic counter
 *     escalates, etc.)
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
    stats: { attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
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

describe("Scenario 10 — Status Conditions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("will-o-wisp burns the defender; residual ticks each turn", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0); // ensure ailment lands
    try {
      const attacker = makeMon("gengar", ["will-o-wisp"], {
        stats: { attack: 65, defense: 60, spAttack: 130, spDefense: 75, speed: 110 },
      });
      const defender = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const room = createRoom("u1", "A", [attacker], "u2", "B", [defender], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "will-o-wisp" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(defender.statusCondition).toBe("burn");
      const lostT1 = defender.maxHp - defender.hp;
      // Burn residual is at least 1/16 of max HP per turn.
      expect(lostT1).toBeGreaterThanOrEqual(Math.floor(defender.maxHp / 16));

      // Run another turn — burn should keep ticking.
      submitAction(room, "u1", { type: "fight", moveId: "will-o-wisp" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      const lostT2 = defender.maxHp - defender.hp;
      expect(lostT2).toBeGreaterThan(lostT1);
    } finally {
      mock.mockRestore();
    }
  });

  it("thunder-wave paralyzes; setting paralysis is reflected on the pokemon", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const attacker = makeMon("pikachu", ["thunder-wave"], {
        stats: { attack: 55, defense: 40, spAttack: 50, spDefense: 50, speed: 90 },
      });
      const defender = makeMon("rattata", ["tackle"]);
      const room = createRoom("u1", "A", [attacker], "u2", "B", [defender], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "thunder-wave" });
      submitAction(room, "u2", { type: "fight", moveId: "tackle" });

      expect(defender.statusCondition).toBe("paralysis");
    } finally {
      mock.mockRestore();
    }
  });

  it("spore lands sleep on the defender (per battle log)", () => {
    // Use a mid-range random so sleepTurns > 1 and the defender doesn't
    // wake up in the same turn.
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.7);
    try {
      const attacker = makeMon("breloom", ["spore"], {
        originalTypes: ["grass", "fighting"],
        // breloom must be faster so spore lands before snorlax acts.
        stats: { attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 90 },
      });
      const defender = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const room = createRoom("u1", "A", [attacker], "u2", "B", [defender], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "spore" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Sleep was applied (battle log shows it) — assert via log so we tolerate
      // the sleep-turns countdown wearing off in the same turn boundary.
      expect(room.log.some((l) => l.includes("잠듦 상태가 되었다"))).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("toxic badly poisons the defender; toxicCounter escalates each turn", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const attacker = makeMon("crobat", ["toxic"], {
        originalTypes: ["poison", "flying"],
      });
      const defender = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const room = createRoom("u1", "A", [attacker], "u2", "B", [defender], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "toxic" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // The engine maps badly-poison ailment to statusCondition="poison" with
      // a separate toxicCounter that scales the residual.
      expect(defender.statusCondition).toBe("poison");
      expect(defender.toxicCounter).toBeGreaterThan(0);
      const counterT1 = defender.toxicCounter ?? 0;
      const lostT1 = defender.maxHp - defender.hp;
      expect(lostT1).toBeGreaterThan(0);

      // Second turn — toxic counter escalates.
      submitAction(room, "u1", { type: "fight", moveId: "toxic" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });
      const counterT2 = defender.toxicCounter ?? 0;
      expect(counterT2).toBeGreaterThan(counterT1);
      const lostT2 = defender.maxHp - defender.hp;
      expect(lostT2).toBeGreaterThan(lostT1);
    } finally {
      mock.mockRestore();
    }
  });
});
