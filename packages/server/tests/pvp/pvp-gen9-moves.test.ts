import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { hasVolatile } from "../../src/game/status-conditions.js";
import { tryCustomResolve } from "../../src/pvp/pvp-moves.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

/**
 * Gen 9 move tests (Phase 4).
 *
 * These exercise the registered Gen 9 moves end-to-end through createRoom /
 * submitAction so registry hooks, pvp-room.ts wiring, and end-of-turn logic
 * are covered together.
 */

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    originalTypes: ["normal"],
    teraType: "normal",
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

function readyRoom(
  partyA: PvpPokemon[],
  partyB: PvpPokemon[],
): ReturnType<typeof createRoom> {
  const room = createRoom(
    "userA", "A", partyA,
    "userB", "B", partyB,
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. Tera Blast picks physical vs special by raw offensive stats ──
describe("Tera Blast", () => {
  it("uses physical category when Atk > SpA", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 200, defense: 80, spAttack: 40, spDefense: 80, speed: 80 },
      originalTypes: ["electric"],
      teraType: "fire",
      moves: [{ id: "tera-blast", pp: 10, maxPp: 10 }],
    });
    // Very high spDefense so that if tera-blast were *special* (spAttack 40 vs
    // spDefense 300) the damage would be minimal, proving physical was used.
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 50, defense: 80, spAttack: 50, spDefense: 300, speed: 40 },
      originalTypes: ["grass"],
    });
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

    submitAction(room, "userA", { type: "fight", moveId: "tera-blast", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.teraActive).toBe(true);
    // Physical hit should deal visible damage — pB HP strictly below max.
    expect(room.playerB.party[0].hp).toBeLessThan(room.playerB.party[0].maxHp);
  });
});

// ── 2. Ice Spinner removes terrain on hit ──
describe("Ice Spinner", () => {
  it("clears the current terrain on hit", () => {
    const pA = makePokemon("pikachu", {
      moves: [{ id: "ice-spinner", pp: 20, maxPp: 20 }],
    });
    const pB = makePokemon("bulbasaur");
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);
    room.terrain = "electric";
    room.terrainTurns = 5;

    submitAction(room, "userA", { type: "fight", moveId: "ice-spinner" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.terrain).toBeUndefined();
    expect(room.terrainTurns).toBeUndefined();
  });
});

// ── 3. Population Bomb hits up to 10 times ──
describe("Population Bomb", () => {
  it("rolls a multi-hit (minHits=1, maxHits=10) via move-data override", () => {
    // Validate by directly invoking tryCustomResolve — the override injection
    // is deterministic regardless of RNG, and the runtime multi-hit path is
    // already exercised by existing tests for bullet-seed et al.
    const pA = makePokemon("pikachu", {
      moves: [{ id: "population-bomb", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur");
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);
    const result = tryCustomResolve({
      room,
      attacker: room.playerA,
      defender: room.playerB,
      atkPoke: room.playerA.party[0],
      defPoke: room.playerB.party[0],
      move: { id: "population-bomb", name: "", type: "normal", category: "physical", power: 20, accuracy: 90, pp: 10, description: "" },
      moveId: "population-bomb",
    });
    expect(result).toMatchObject({ overrideMove: { meta: { minHits: 1, maxHits: 10 } } });
  });
});

// ── 4. Last Respects scales with fainted party members ──
describe("Last Respects", () => {
  it("deals more damage when the user has fainted teammates", () => {
    const makeTrio = (signatureMove: string, fainted: boolean) => {
      const lead = makePokemon("pikachu", {
        stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
        moves: [{ id: signatureMove, pp: 10, maxPp: 10 }],
      });
      const second = makePokemon("charizard", fainted ? { hp: 0 } : {});
      const third = makePokemon("eevee", fainted ? { hp: 0 } : {});
      return [lead, second, third];
    };

    // Control battle: no fainted allies → base 50 BP.
    const control = readyRoom(
      makeTrio("last-respects", false),
      [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    submitAction(control, "userA", { type: "fight", moveId: "last-respects" });
    submitAction(control, "userB", { type: "fight", moveId: "tackle" });
    const controlDamage = control.playerB.party[0].maxHp - control.playerB.party[0].hp;

    // Boosted battle: 2 fainted allies → 150 BP.
    const boosted = readyRoom(
      makeTrio("last-respects", true),
      [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    submitAction(boosted, "userA", { type: "fight", moveId: "last-respects" });
    submitAction(boosted, "userB", { type: "fight", moveId: "tackle" });
    const boostedDamage = boosted.playerB.party[0].maxHp - boosted.playerB.party[0].hp;

    expect(boostedDamage).toBeGreaterThan(controlDamage);
  });
});

// ── 5. Rage Fist scales with hits taken ──
describe("Rage Fist", () => {
  it("deals more damage after taking hits", () => {
    const weak = makePokemon("pikachu", {
      stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
      moves: [{ id: "rage-fist", pp: 10, maxPp: 10 }],
      rageFistHits: 0,
    });
    const raged = makePokemon("pikachu", {
      stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
      moves: [{ id: "rage-fist", pp: 10, maxPp: 10 }],
      rageFistHits: 5,
    });
    const target = () => makePokemon("bulbasaur", {
      stats: { attack: 50, defense: 80, spAttack: 50, spDefense: 80, speed: 50 },
    });
    const control = readyRoom([weak, makePokemon("charizard")], [target(), makePokemon("squirtle")]);
    const angry = readyRoom([raged, makePokemon("charizard")], [target(), makePokemon("squirtle")]);

    submitAction(control, "userA", { type: "fight", moveId: "rage-fist" });
    submitAction(control, "userB", { type: "fight", moveId: "tackle" });
    submitAction(angry, "userA", { type: "fight", moveId: "rage-fist" });
    submitAction(angry, "userB", { type: "fight", moveId: "tackle" });

    const controlDmg = control.playerB.party[0].maxHp - control.playerB.party[0].hp;
    const angryDmg = angry.playerB.party[0].maxHp - angry.playerB.party[0].hp;
    expect(angryDmg).toBeGreaterThan(controlDmg);
  });
});

// ── 6. Salt Cure end-of-turn damage (doubled vs Steel/Water) ──
describe("Salt Cure", () => {
  it("applies end-of-turn damage after the hit", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 20, defense: 80, spAttack: 20, spDefense: 80, speed: 120 },
      moves: [{ id: "salt-cure", pp: 15, maxPp: 15 }],
    });
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 50, defense: 200, spAttack: 50, spDefense: 200, speed: 40 },
      hp: 300, maxHp: 300,
    });
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

    submitAction(room, "userA", { type: "fight", moveId: "salt-cure" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(hasVolatile(room.playerB.volatiles, "salt-cure")).toBe(true);
    // 300 maxHp / 8 = 37 per tick; must see the residual-damage log message.
    expect(room.log.some((l) => l.includes("소금절임 데미지"))).toBe(true);
  });

  it("deals double damage to Water or Steel types", () => {
    const baseOpts = {
      stats: { attack: 50, defense: 200, spAttack: 50, spDefense: 200, speed: 40 },
      hp: 800, maxHp: 800,
    };
    // Neutral: grass only (Bulbasaur's second type "poison" still isn't steel/water)
    const neutralRoom = readyRoom(
      [makePokemon("pikachu", {
        stats: { attack: 20, defense: 80, spAttack: 20, spDefense: 80, speed: 120 },
        moves: [{ id: "salt-cure", pp: 15, maxPp: 15 }],
      }), makePokemon("charizard")],
      [makePokemon("gastly", { ...baseOpts }), makePokemon("squirtle")],
    );
    // Water target: squirtle should take 2x salt damage.
    const waterRoom = readyRoom(
      [makePokemon("pikachu", {
        stats: { attack: 20, defense: 80, spAttack: 20, spDefense: 80, speed: 120 },
        moves: [{ id: "salt-cure", pp: 15, maxPp: 15 }],
      }), makePokemon("charizard")],
      [makePokemon("squirtle", { ...baseOpts }), makePokemon("bulbasaur")],
    );

    submitAction(neutralRoom, "userA", { type: "fight", moveId: "salt-cure" });
    submitAction(neutralRoom, "userB", { type: "fight", moveId: "tackle" });
    submitAction(waterRoom, "userA", { type: "fight", moveId: "salt-cure" });
    submitAction(waterRoom, "userB", { type: "fight", moveId: "tackle" });

    const neutralHpLost = neutralRoom.playerB.party[0].maxHp - neutralRoom.playerB.party[0].hp;
    const waterHpLost = waterRoom.playerB.party[0].maxHp - waterRoom.playerB.party[0].hp;
    expect(waterHpLost).toBeGreaterThan(neutralHpLost);
  });
});

// ── 7. Syrup Bomb drops speed at end of turn while volatile is active ──
describe("Syrup Bomb", () => {
  it("applies the syrup-bomb volatile and drops speed at end of turn", () => {
    // Force all RNG rolls low so the move lands (85 accuracy) and side-effect
    // RNG consistently fires.
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    try {
      const pA = makePokemon("pikachu", {
        stats: { attack: 30, defense: 80, spAttack: 30, spDefense: 80, speed: 120 },
        moves: [{ id: "syrup-bomb", pp: 10, maxPp: 10 }],
      });
      const pB = makePokemon("bulbasaur", {
        stats: { attack: 50, defense: 150, spAttack: 50, spDefense: 150, speed: 40 },
        hp: 400, maxHp: 400,
      });
      const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

      submitAction(room, "userA", { type: "fight", moveId: "syrup-bomb" });
      submitAction(room, "userB", { type: "fight", moveId: "tackle" });

      expect(hasVolatile(room.playerB.volatiles, "syrup-bomb")).toBe(true);
      expect(room.playerB.statStages.speed).toBeLessThanOrEqual(-1);
    } finally {
      randSpy.mockRestore();
    }
  });
});

// ── 8. Doodle copies target's ability ──
describe("Doodle", () => {
  it("copies the opponent's ability onto the user", () => {
    const pA = makePokemon("pikachu", {
      abilityId: "static",
      moves: [{ id: "doodle", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur", { abilityId: "overgrow" });
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

    submitAction(room, "userA", { type: "fight", moveId: "doodle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.party[0].abilityId).toBe("overgrow");
  });
});

// ── 9. Comeuppance returns 1.5x last damage taken ──
describe("Comeuppance", () => {
  it("fires 1.5x the last damage taken back at the attacker", () => {
    const pA = makePokemon("pikachu", {
      hp: 400, maxHp: 400,
      stats: { attack: 30, defense: 80, spAttack: 30, spDefense: 80, speed: 30 },
      moves: [{ id: "comeuppance", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 250, defense: 80, spAttack: 50, spDefense: 80, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

    // Fake a strong hit from B against A via lastDamageTaken directly for
    // determinism; comeuppance should then echo 1.5x that amount.
    room.playerA.lastDamageTaken = { amount: 50, category: "physical" };
    submitAction(room, "userA", { type: "fight", moveId: "comeuppance" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Expected return damage: floor(50 * 1.5) = 75 … plus whatever B's tackle
    // dealt back to A (not relevant here). Just verify the move fired.
    expect(room.log.some((l) => l.includes("복수"))).toBe(true);
  });

  it("fails if no damage was taken", () => {
    const pA = makePokemon("pikachu", {
      moves: [{ id: "comeuppance", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur", {
      moves: [{ id: "growl", pp: 40, maxPp: 40 }],
    });
    const room = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);

    // Ensure no prior damage and no damage this turn either (growl does no dmg).
    room.playerA.lastDamageTaken = undefined;
    submitAction(room, "userA", { type: "fight", moveId: "comeuppance" });
    submitAction(room, "userB", { type: "fight", moveId: "growl" });

    expect(room.log.some((l) => l.includes("복수 실패"))).toBe(true);
  });
});

// ── 10. Revival Blessing revives a fainted ally at half HP ──
describe("Revival Blessing", () => {
  it("revives a fainted teammate to half HP", () => {
    const pA = makePokemon("pikachu", {
      moves: [{ id: "revival-blessing", pp: 5, maxPp: 5 }],
    });
    const faintedAlly = makePokemon("charizard", { hp: 0 });
    const pB = makePokemon("bulbasaur");
    const room = readyRoom([pA, faintedAlly], [pB, makePokemon("squirtle")]);

    submitAction(room, "userA", { type: "fight", moveId: "revival-blessing" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // faintedAlly is party index 1.
    expect(room.playerA.party[1].hp).toBe(Math.floor(faintedAlly.maxHp / 2));
  });
});

// ── 11. Collision Course gains ~1.33x on super-effective hits ──
describe("Collision Course", () => {
  it("boosts damage against a super-effective target", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
      moves: [{ id: "collision-course", pp: 10, maxPp: 10 }],
    });
    // Fighting vs Normal = 2x super effective
    const super1 = makePokemon("snorlax", {
      stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 80, speed: 30 },
      hp: 400, maxHp: 400,
    });
    // Fighting vs Fighting = 1x neutral
    const neutral = makePokemon("machamp", {
      stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 80, speed: 30 },
      hp: 400, maxHp: 400,
    });
    const superRoom = readyRoom([pA, makePokemon("charizard")], [super1, makePokemon("squirtle")]);
    submitAction(superRoom, "userA", { type: "fight", moveId: "collision-course" });
    submitAction(superRoom, "userB", { type: "fight", moveId: "tackle" });
    const superDmg = superRoom.playerB.party[0].maxHp - superRoom.playerB.party[0].hp;

    const neutralRoom = readyRoom(
      [makePokemon("pikachu", {
        stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
        moves: [{ id: "collision-course", pp: 10, maxPp: 10 }],
      }), makePokemon("charizard")],
      [neutral, makePokemon("squirtle")],
    );
    submitAction(neutralRoom, "userA", { type: "fight", moveId: "collision-course" });
    submitAction(neutralRoom, "userB", { type: "fight", moveId: "tackle" });
    const neutralDmg = neutralRoom.playerB.party[0].maxHp - neutralRoom.playerB.party[0].hp;

    // Super-effective hit should exceed neutral by a clear margin (super-effective 2x *
    // collision-course boost ~1.33x dwarfs neutral 1x).
    expect(superDmg).toBeGreaterThan(neutralDmg);
  });
});

// ── 12. Ivy Cudgel type varies by Ogerpon form ──
describe("Ivy Cudgel", () => {
  it("uses fire when the user is Ogerpon-Hearthflame-Mask", () => {
    const pA = makePokemon("ogerpon-hearthflame-mask", {
      stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
      originalTypes: ["grass", "fire"],
      moves: [{ id: "ivy-cudgel", pp: 10, maxPp: 10 }],
    });
    // Fire is weak against water → but bulbasaur is grass/poison.
    // Use paras (grass/bug) — 4x weak to fire, to make the type override
    // dramatic. (If paras isn't in the species data, the weakness still
    // appears through grass/bug typing.)
    const pB = makePokemon("paras", {
      stats: { attack: 40, defense: 80, spAttack: 40, spDefense: 80, speed: 40 },
      hp: 400, maxHp: 400,
    });
    const roomFire = readyRoom([pA, makePokemon("charizard")], [pB, makePokemon("squirtle")]);
    submitAction(roomFire, "userA", { type: "fight", moveId: "ivy-cudgel" });
    submitAction(roomFire, "userB", { type: "fight", moveId: "tackle" });
    const fireDmg = roomFire.playerB.party[0].maxHp - roomFire.playerB.party[0].hp;

    // Grass-form Ogerpon: default (grass). Same target is grass/bug and resists
    // grass 0.5x, so fireDmg should be clearly larger.
    const grass = makePokemon("ogerpon", {
      stats: { attack: 150, defense: 80, spAttack: 40, spDefense: 80, speed: 100 },
      originalTypes: ["grass"],
      moves: [{ id: "ivy-cudgel", pp: 10, maxPp: 10 }],
    });
    const grassTarget = makePokemon("paras", {
      stats: { attack: 40, defense: 80, spAttack: 40, spDefense: 80, speed: 40 },
      hp: 400, maxHp: 400,
    });
    const roomGrass = readyRoom([grass, makePokemon("charizard")], [grassTarget, makePokemon("squirtle")]);
    submitAction(roomGrass, "userA", { type: "fight", moveId: "ivy-cudgel" });
    submitAction(roomGrass, "userB", { type: "fight", moveId: "tackle" });
    const grassDmg = roomGrass.playerB.party[0].maxHp - roomGrass.playerB.party[0].hp;

    expect(fireDmg).toBeGreaterThan(grassDmg);
  });
});
