import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

// ── Helpers ──

function makePokemon(species: string, overrides?: Partial<PvpPokemon>): PvpPokemon {
  return {
    uid: species + "-uid",
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 50 },
    moves: [
      { id: "tackle", pp: 35, maxPp: 35 },
      { id: "ember", pp: 25, maxPp: 25 },
    ],
    statusCondition: null,
    ...overrides,
  };
}

function readyRoom(partyAOverrides?: Partial<PvpPokemon>[], partyBOverrides?: Partial<PvpPokemon>[]) {
  const defaultPartyA = [makePokemon("pikachu"), makePokemon("charizard"), makePokemon("eevee")];
  const defaultPartyB = [makePokemon("bulbasaur"), makePokemon("squirtle"), makePokemon("jigglypuff")];
  if (partyAOverrides) {
    for (let i = 0; i < partyAOverrides.length && i < defaultPartyA.length; i++) {
      Object.assign(defaultPartyA[i], partyAOverrides[i]);
    }
  }
  if (partyBOverrides) {
    for (let i = 0; i < partyBOverrides.length && i < defaultPartyB.length; i++) {
      Object.assign(defaultPartyB[i], partyBOverrides[i]);
    }
  }
  const room = createRoom("userA", "A", defaultPartyA, "userB", "B", defaultPartyB);
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

// ── 1. Substitute ──

describe("Substitute (대타출동)", () => {
  it("creates a substitute that absorbs damage", () => {
    const room = readyRoom(
      [{ moves: [{ id: "substitute", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
    );
    // Player A uses substitute
    submitAction(room, "userA", { type: "fight", moveId: "substitute" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Substitute should have been created
    // HP cost: floor(200/4) = 50
    expect(room.playerA.party[0].hp).toBeLessThan(200);
    // Check that substitute was set (may have taken damage this turn too)
    expect(room.log.some(l => l.includes("대타출동"))).toBe(true);
  });

  it("substitute breaks when HP is depleted by damage", () => {
    const room = readyRoom(
      [{ moves: [{ id: "substitute", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
      // Give B very high attack to break substitute
      [{ stats: { attack: 300, defense: 100, spAttack: 100, spDefense: 100, speed: 30 } }],
    );
    // A uses substitute (costs 50 HP, creates sub with 50 HP)
    // B uses tackle with high attack - should break substitute
    submitAction(room, "userA", { type: "fight", moveId: "substitute" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Check substitute was created and then broken (B is slower so attacks after sub)
    const hasSubCreated = room.log.some(l => l.includes("대타출동"));
    expect(hasSubCreated).toBe(true);
    // Either substitute took the hit or was broken
    const subBlocked = room.log.some(l => l.includes("대타 인형"));
    expect(subBlocked).toBe(true);
    // The pokemon's actual HP should not have decreased beyond the substitute cost
    // because the substitute took the hit
    expect(room.playerA.party[0].hp).toBe(150); // 200 - 50 (sub cost)
  });

  it("substitute resets on switch", () => {
    const room = readyRoom(
      [{ moves: [{ id: "substitute", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
      // Make B slower so A's sub goes first
      [{ stats: { attack: 50, defense: 100, spAttack: 100, spDefense: 100, speed: 30 } }],
    );
    // Create substitute
    submitAction(room, "userA", { type: "fight", moveId: "substitute" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Switch out
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.substitute).toBeUndefined();
  });
});

// ── 2. Two-Turn Moves ──

describe("Two-Turn Moves (2턴 기술)", () => {
  it("fly charges on turn 1 then executes on turn 2", () => {
    const room = readyRoom(
      [{ moves: [{ id: "fly", pp: 15, maxPp: 15 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
      [{ stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 } }],
    );
    const defHpBefore = room.playerB.party[0].hp;

    // Turn 1: A uses fly (charge phase)
    submitAction(room, "userA", { type: "fight", moveId: "fly" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Should be charging
    expect(room.log.some(l => l.includes("준비 중"))).toBe(true);
    // Defender's tackle should miss (semi-invulnerable)
    // Player A should have chargingMove set for auto-submit next turn
    // (chargingMove is consumed at start of resolution)

    // B's HP shouldn't have changed from fly (not yet executed)
    // But B's tackle may have missed due to semi-invulnerable

    const turn1DefHp = room.playerB.party[0].hp;
    expect(turn1DefHp).toBe(defHpBefore); // Fly hasn't dealt damage yet

    // Turn 2: A auto-continues fly, B tackles
    submitAction(room, "userA", { type: "fight", moveId: "fly" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Now fly should have dealt damage
    expect(room.playerB.party[0].hp).toBeLessThan(defHpBefore);
  });

  it("semi-invulnerable dodge: opponent's move misses during charge", () => {
    const room = readyRoom(
      // A faster so charges first
      [{ stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
         moves: [{ id: "dig", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
      [{ stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 } }],
    );
    const hpBefore = room.playerA.party[0].hp;

    // Turn 1: A uses dig (charge, semi-invulnerable), B uses tackle
    submitAction(room, "userA", { type: "fight", moveId: "dig" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // A should not have taken damage from B's tackle (semi-invulnerable)
    // Note: A loses no HP from dig's charge
    expect(room.playerA.party[0].hp).toBe(hpBefore);
    // B's tackle should have missed
    const missLog = room.log.filter(l => l.includes("빗나갔다"));
    expect(missLog.length).toBeGreaterThan(0);
  });

  it("solar-beam executes immediately in sun weather", () => {
    const room = readyRoom(
      [{ moves: [{ id: "solar-beam", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
    );
    room.weather = "sun";

    submitAction(room, "userA", { type: "fight", moveId: "solar-beam" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Should NOT see "준비 중" - should execute immediately
    expect(room.log.some(l => l.includes("준비 중"))).toBe(false);
    // Should have dealt damage
    expect(room.playerB.party[0].hp).toBeLessThan(200);
  });
});

// ── 3. Phazing ──

describe("Phazing (Whirlwind, Roar)", () => {
  it("whirlwind forces a random switch", () => {
    const room = readyRoom(
      [{ moves: [{ id: "whirlwind", pp: 20, maxPp: 20 }, { id: "tackle", pp: 35, maxPp: 35 }] }],
    );
    const originalActive = room.playerB.activeIndex;

    // Seed Math.random to ensure phazing picks something
    submitAction(room, "userA", { type: "fight", moveId: "whirlwind" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Defender should have been switched out
    const phazedLog = room.log.some(l => l.includes("끌려나갔다"));
    expect(phazedLog).toBe(true);
    expect(room.playerB.activeIndex).not.toBe(originalActive);
  });
});

// ── 4. Destiny Bond ──

describe("Destiny Bond (운명의끈)", () => {
  it("KOs attacker when user with destiny-bond faints", () => {
    const room = readyRoom(
      // A has very low HP and uses destiny bond
      [{
        hp: 1, maxHp: 200,
        moves: [{ id: "destiny-bond", pp: 5, maxPp: 5 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 }, // faster
      }],
      [{ stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 } }],
    );

    // A uses destiny-bond (faster, goes first), B tackles and KOs A
    submitAction(room, "userA", { type: "fight", moveId: "destiny-bond" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // A should have fainted from B's tackle
    expect(room.playerA.party[0].hp).toBe(0);
    // B should also have fainted due to destiny bond
    expect(room.playerB.party[0].hp).toBe(0);
    expect(room.log.some(l => l.includes("운명의끈"))).toBe(true);
  });
});

// ── 5. Counter / Mirror Coat ──

describe("Counter / Mirror Coat", () => {
  it("counter returns 2x physical damage", () => {
    const room = readyRoom(
      // A is slower (counter has -5 priority anyway) and uses counter
      [{
        moves: [{ id: "counter", pp: 20, maxPp: 20 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
      // B uses tackle (physical)
      [{
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
    );
    const defHpBefore = room.playerB.party[0].hp;

    submitAction(room, "userA", { type: "fight", moveId: "counter" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Counter should have been logged
    const counterLog = room.log.some(l => l.includes("카운터"));
    expect(counterLog).toBe(true);
    // B should have taken more damage than it dealt
    const aDamage = 200 - room.playerA.party[0].hp; // damage A took from tackle
    const bDamage = defHpBefore - room.playerB.party[0].hp; // damage B took from counter
    // Counter does 2x the physical damage received
    expect(bDamage).toBe(aDamage * 2);
  });

  it("mirror coat returns 2x special damage", () => {
    const room = readyRoom(
      // A uses mirror coat (slower)
      [{
        moves: [{ id: "mirror-coat", pp: 20, maxPp: 20 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
      // B uses a special move - ember is special
      [{
        moves: [{ id: "ember", pp: 25, maxPp: 25 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
    );
    const defHpBefore = room.playerB.party[0].hp;

    submitAction(room, "userA", { type: "fight", moveId: "mirror-coat" });
    submitAction(room, "userB", { type: "fight", moveId: "ember" });

    const mirrorLog = room.log.some(l => l.includes("미러코트"));
    expect(mirrorLog).toBe(true);
    const aDamage = 200 - room.playerA.party[0].hp;
    const bDamage = defHpBefore - room.playerB.party[0].hp;
    expect(bDamage).toBe(aDamage * 2);
  });
});

// ── 6. Disable / Encore / Taunt / Torment ──

describe("Taunt (도발)", () => {
  it("taunt blocks status moves", () => {
    const room = readyRoom(
      // A uses taunt (faster)
      [{
        moves: [{ id: "taunt", pp: 20, maxPp: 20 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      // B has a status move (toxic is status category)
      [{
        moves: [{ id: "toxic", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: A taunts B, B tries to use toxic (blocked by taunt)
    submitAction(room, "userA", { type: "fight", moveId: "taunt" });
    submitAction(room, "userB", { type: "fight", moveId: "toxic" });

    // Should see taunt applied and toxic blocked
    expect(room.log.some(l => l.includes("도발 당했다"))).toBe(true);
    expect(room.log.some(l => l.includes("도발 때문에"))).toBe(true);
    // B should NOT be poisoned (toxic was blocked)
    expect(room.playerA.party[0].statusCondition).toBeNull();
  });
});

describe("Encore (앵콜)", () => {
  it("encore forces repeated move", () => {
    const room = readyRoom(
      // A faster, uses tackle first turn then encore
      [{
        moves: [{ id: "encore", pp: 5, maxPp: 5 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }, { id: "ember", pp: 25, maxPp: 25 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: B uses tackle (sets lastMoveUsed), A uses tackle
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerB.lastMoveUsed).toBe("tackle");

    // Turn 2: A uses encore on B
    submitAction(room, "userA", { type: "fight", moveId: "encore" });
    submitAction(room, "userB", { type: "fight", moveId: "ember" }); // tries ember

    // Encore should have forced B to use tackle instead of ember
    expect(room.log.some(l => l.includes("앵콜"))).toBe(true);
    expect(room.playerB.encoreMoveId).toBe("tackle");
  });
});

describe("Disable (사슬묶기)", () => {
  it("disable prevents using the disabled move", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "disable", pp: 20, maxPp: 20 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }, { id: "ember", pp: 25, maxPp: 25 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: Both tackle (so B has lastMoveUsed = tackle)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Turn 2: A uses disable on B
    submitAction(room, "userA", { type: "fight", moveId: "disable" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("사슬묶기"))).toBe(true);
    expect(room.playerB.disabledMoveId).toBe("tackle");

    // Turn 3: B tries to use disabled tackle
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("사용할 수 없다"))).toBe(true);
  });
});

describe("Torment (트집)", () => {
  it("torment prevents using the same move twice in a row", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "torment", pp: 15, maxPp: 15 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }, { id: "ember", pp: 25, maxPp: 25 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: A torments B, B uses tackle
    submitAction(room, "userA", { type: "fight", moveId: "torment" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("트집"))).toBe(true);

    // Turn 2: B tries tackle again (same move)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("트집 때문에 같은 기술을 쓸 수 없다"))).toBe(true);
  });
});
