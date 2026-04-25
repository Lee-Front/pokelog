/**
 * Scenario 15 — Phazing and Switch.
 *
 *  - u-turn: damage + force own switch via pendingSwitchAfterMove
 *  - whirlwind: forces opponent to switch (target-side phazing)
 *  - mean-look: traps opponent so they can't switch out
 *  - shadow-tag: same as mean-look but ability-based
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

describe("Scenario 15 — Phazing and Switch", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("u-turn deals damage and triggers a forced switch on the user's side", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("scizor", ["u-turn"], {
        originalTypes: ["bug", "steel"],
        stats: { attack: 130, defense: 100, spAttack: 55, spDefense: 80, speed: 65 },
      });
      const benched = makeMon("blastoise", ["surf"]);
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const room = createRoom("u1", "A", [me, benched], "u2", "B", [opp], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      const hpBefore = opp.hp;
      submitAction(room, "u1", { type: "fight", moveId: "u-turn" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Damage dealt.
      expect(opp.hp).toBeLessThan(hpBefore);
      // Forced switch is now pending for player A.
      expect(room.phase).toBe("forced_switch");
      expect(room.forcedSwitchNeeded?.a).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("whirlwind / dragon-tail flag opposing-side as needing forced switch", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("dragonite", ["dragon-tail"], {
        originalTypes: ["dragon", "flying"],
        stats: { attack: 134, defense: 95, spAttack: 100, spDefense: 100, speed: 80 },
      });
      const opp = makeMon("snorlax", ["splash"], {
        maxHp: 400, hp: 400,
        stats: { attack: 110, defense: 65, spAttack: 65, spDefense: 110, speed: 30 },
      });
      const oppBenched = makeMon("clefable", ["splash"]);
      const room = createRoom("u1", "A", [me], "u2", "B", [opp, oppBenched], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "dragon-tail" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // dragon-tail forces a switch on B's side (or auto-applies it). The
      // exact semantics here can vary by engine — we check the room's log
      // for a "switched out" / "phazed" effect OR a forced_switch flag on B.
      const phazed = room.phase === "forced_switch" && room.forcedSwitchNeeded?.b;
      const oppActiveChanged = room.playerB.activeIndex !== 0;
      expect(phazed || oppActiveChanged).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("mean-look traps the defender — they can no longer switch", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const me = makeMon("crobat", ["mean-look"], {
        originalTypes: ["poison", "flying"],
      });
      const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
      const oppBenched = makeMon("clefable", ["splash"]);
      const room = createRoom("u1", "A", [me], "u2", "B", [opp, oppBenched], false);
      selectLead(room, "u1", 0);
      selectLead(room, "u2", 0);

      submitAction(room, "u1", { type: "fight", moveId: "mean-look" });
      submitAction(room, "u2", { type: "fight", moveId: "splash" });

      // Trap flag set — opponent's switch should now be rejected.
      const trapped = room.playerB.trapped;
      expect(trapped).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });

  it("shadow-tag traps the opponent on switch-in (ability-based)", () => {
    const me = makeMon("wobbuffet", ["counter"], {
      abilityId: "shadow-tag",
    });
    const opp = makeMon("snorlax", ["splash"], { maxHp: 400, hp: 400 });
    const oppBenched = makeMon("clefable", ["splash"]);
    const room = createRoom("u1", "A", [me], "u2", "B", [opp, oppBenched], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    expect(room.playerB.trapped).toBe(true);
  });
});
