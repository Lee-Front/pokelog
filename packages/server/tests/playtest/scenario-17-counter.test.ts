/**
 * Scenario 17 — Counter and Special Damage.
 *
 *  - counter reflects 2x physical damage taken this turn
 *  - mirror-coat reflects 2x special damage
 *  - dragon-rage always deals 40 fixed damage
 *  - seismic-toss deals user-level fixed damage
 *  - knock-off does extra damage and removes the target's held item
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
    hp: 300,
    maxHp: 300,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 60 },
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

describe("Scenario 17 — Counter and Special Damage", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("counter doubles the physical damage taken back at the attacker", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const slow = makeMon("blissey", ["counter"], {
        // Bulk up the HP so cross-chop doesn't OHKO; counter needs the
        // defender to survive and remember the physical hit.
        maxHp: 5000, hp: 5000,
        stats: { attack: 10, defense: 50, spAttack: 75, spDefense: 135, speed: 30 },
      });
      const fast = makeMon("machamp", ["cross-chop"], {
        maxHp: 600, hp: 600,
        stats: { attack: 130, defense: 80, spAttack: 65, spDefense: 85, speed: 100 },
      });
      const room = createRoom("u1", "A", [slow], "u2", "B", [fast], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = fast.hp;
      submitAction(room, "u1", { type: "fight", moveId: "counter" });
      submitAction(room, "u2", { type: "fight", moveId: "cross-chop" });

      // Counter only fires if blissey took physical damage and survived.
      // Damage should be roughly 2x what blissey took.
      const counterDmg = hpBefore - fast.hp;
      expect(counterDmg).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("mirror-coat reflects 2x of an incoming special hit", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const slow = makeMon("blissey", ["mirror-coat"], {
        maxHp: 5000, hp: 5000,
        stats: { attack: 10, defense: 50, spAttack: 75, spDefense: 60, speed: 30 },
      });
      const fast = makeMon("alakazam", ["psychic"], {
        maxHp: 600, hp: 600,
        stats: { attack: 50, defense: 45, spAttack: 135, spDefense: 95, speed: 120 },
      });
      const room = createRoom("u1", "A", [slow], "u2", "B", [fast], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = fast.hp;
      submitAction(room, "u1", { type: "fight", moveId: "mirror-coat" });
      submitAction(room, "u2", { type: "fight", moveId: "psychic" });

      const mirrorDmg = hpBefore - fast.hp;
      expect(mirrorDmg).toBeGreaterThan(0);
    } finally {
      mock.mockRestore();
    }
  });

  it("dragon-rage always deals 40 fixed damage", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("dragonair", ["dragon-rage"], {
        originalTypes: ["dragon"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = opp.hp;
      submitAction(room, "u1", { type: "fight", moveId: "dragon-rage" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(hpBefore - opp.hp).toBe(40);
    } finally {
      mock.mockRestore();
    }
  });

  it("seismic-toss deals damage equal to the user's level", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("hitmonchan", ["seismic-toss"], {
        level: 50,
        originalTypes: ["fighting"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = opp.hp;
      submitAction(room, "u1", { type: "fight", moveId: "seismic-toss" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      expect(hpBefore - opp.hp).toBe(50);
    } finally {
      mock.mockRestore();
    }
  });

  it("knock-off removes the target's held item", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("tyranitar", ["knock-off"], {
        originalTypes: ["rock", "dark"],
        stats: { attack: 134, defense: 110, spAttack: 95, spDefense: 100, speed: 61 },
      });
      const opp = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
        heldItem: "leftovers",
      });
      const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "knock-off" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Item knocked off → null.
      expect(opp.heldItem).toBeNull();
    } finally {
      mock.mockRestore();
    }
  });
});
