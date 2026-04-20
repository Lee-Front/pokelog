import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
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

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. Magic Room ──

describe("Magic Room", () => {
  it("activates for 5 turns and disables item effects", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "magic-room", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        heldItem: "life-orb",
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "magic-room" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.magicRoom).toBe(4); // 5 - 1 end-of-turn tick
    expect(room.log.some((l) => l.includes("매직룸"))).toBe(true);
  });

  it("toggles off when used again", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "magic-room", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "magic-room" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.magicRoom).toBeGreaterThan(0);

    submitAction(room, "userA", { type: "fight", moveId: "magic-room" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.magicRoom).toBeUndefined();
    expect(room.log.some((l) => l.includes("매직룸이 해제"))).toBe(true);
  });
});

// ── 2. Wonder Room ──

describe("Wonder Room", () => {
  it("swaps defense and spDefense in damage calc", () => {
    // Glass cannon defender: low spDefense, high defense.
    // With wonder room, a special move should now hit defense (high) as spDefense.
    // But more testably: a physical move sees spDefense (low) instead of defense.
    const roomBaseline = readyRoom(
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 200, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        hp: 400, maxHp: 400,
        stats: { attack: 1, defense: 200, spAttack: 1, spDefense: 20, speed: 30 },
      }],
    );
    submitAction(roomBaseline, "userA", { type: "fight", moveId: "tackle" });
    submitAction(roomBaseline, "userB", { type: "fight", moveId: "tackle" });
    const damageBaseline = 400 - roomBaseline.playerB.party[0].hp;

    const roomWonder = readyRoom(
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 200, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        hp: 400, maxHp: 400,
        stats: { attack: 1, defense: 200, spAttack: 1, spDefense: 20, speed: 30 },
      }],
    );
    roomWonder.wonderRoom = 5;
    submitAction(roomWonder, "userA", { type: "fight", moveId: "tackle" });
    submitAction(roomWonder, "userB", { type: "fight", moveId: "tackle" });
    const damageWonder = 400 - roomWonder.playerB.party[0].hp;

    // Physical tackle against spDefense 20 (swapped) should be much higher than defense 200.
    expect(damageWonder).toBeGreaterThan(damageBaseline);
  });

  it("activates via move and ticks down", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "wonder-room", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "wonder-room" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.wonderRoom).toBe(4);
    expect(room.log.some((l) => l.includes("원더룸"))).toBe(true);
  });
});

// ── 3. Copycat ──

describe("Copycat", () => {
  it("copies the last move used by anyone", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "copycat", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        // Slower so B moves first (tackle)
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 10 },
      }],
      [{
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 100 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "copycat" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // B used tackle first; A then copycat's tackle
    expect(room.log.some((l) => l.includes("흉내내기"))).toBe(true);
  });

  it("fails if no previous move used in battle", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "copycat", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "copycat" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.log.some((l) => l.includes("흉내낼 기술이 없다"))).toBe(true);
  });
});

// ── 4. Pain Split ──

describe("Pain Split", () => {
  it("averages HP between attacker and defender", () => {
    const room = readyRoom(
      [{
        hp: 50, maxHp: 200,
        moves: [{ id: "pain-split", pp: 10, maxPp: 10 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        hp: 200, maxHp: 200,
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "pain-split" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    // Average of 50 + 200 = 125
    expect(room.playerA.party[0].hp).toBe(125);
    expect(room.playerB.party[0].hp).toBe(125);
    expect(room.log.some((l) => l.includes("아픔나누기"))).toBe(true);
  });
});

// ── 5. Endeavor ──

describe("Endeavor", () => {
  it("brings defender's HP down to attacker's HP", () => {
    const room = readyRoom(
      [{
        hp: 30, maxHp: 200,
        moves: [{ id: "endeavor", pp: 5, maxPp: 5 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        hp: 180, maxHp: 200,
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "endeavor" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerB.party[0].hp).toBe(30);
    expect(room.log.some((l) => l.includes("힘껏펀치"))).toBe(true);
  });

  it("fails when defender has less or equal HP", () => {
    const room = readyRoom(
      [{
        hp: 200, maxHp: 200,
        moves: [{ id: "endeavor", pp: 5, maxPp: 5 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        hp: 50, maxHp: 200,
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "endeavor" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerB.party[0].hp).toBe(50);
    expect(room.log.some((l) => l.includes("힘껏펀치 실패"))).toBe(true);
  });
});

// ── 6. Attract ──

describe("Attract", () => {
  it("adds infatuation volatile to defender", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "attract", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "attract" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerB.volatiles.some((v) => v.id === "infatuation")).toBe(true);
    expect(room.log.some((l) => l.includes("헤롱헤롱"))).toBe(true);
  });

  it("is blocked by Oblivious ability", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "attract", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        abilityId: "oblivious",
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "attract" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerB.volatiles.some((v) => v.id === "infatuation")).toBe(false);
  });
});

// ── 7. Heal Block ──

describe("Heal Block", () => {
  it("prevents recovery moves from healing", () => {
    const room = readyRoom(
      [{
        hp: 50, maxHp: 200,
        moves: [{ id: "recover", pp: 10, maxPp: 10 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
        // slower than B
      }],
      [{
        moves: [{ id: "heal-block", pp: 15, maxPp: 15 }, { id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 200 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "recover" });
    submitAction(room, "userB", { type: "fight", moveId: "heal-block" });

    // B heal-blocks A, then A tries to recover but is blocked.
    expect(room.playerA.party[0].hp).toBe(50);
    expect(room.log.some((l) => l.includes("회복봉인으로 회복할 수 없다"))).toBe(true);
  });
});

// ── 8. Ingrain ──

describe("Ingrain", () => {
  it("prevents switching after use", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "ingrain", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "ingrain" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerA.volatiles.some((v) => v.id === "ingrain")).toBe(true);

    // Try to switch — should be rejected
    const switched = submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    expect(switched).toBe(false);
  });
});

// ── 9. Suction Cups (phazing immunity) ──

describe("Suction Cups", () => {
  it("prevents phazing moves (Roar) from switching out the defender", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "roar", pp: 20, maxPp: 20 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        abilityId: "suction-cups",
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "roar" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    // Defender should NOT have switched — still index 0 (bulbasaur)
    expect(room.playerB.activeIndex).toBe(0);
    expect(room.log.some((l) => l.includes("흡반"))).toBe(true);
  });
});

// ── 10. Iron Ball Grounding ──

describe("Iron Ball", () => {
  it("grounds a flying-type pokemon so Spikes damage applies on switch-in", () => {
    // Party B has spikes set, party B's switched-in flying pokemon with iron ball should take damage.
    const room = readyRoom(
      [{ moves: [{ id: "splash", pp: 40, maxPp: 40 }] }],
      [
        { moves: [{ id: "splash", pp: 40, maxPp: 40 }] },
        // Pidgey-like flying with iron ball (at index 1)
        makePokemon("pidgey", {
          heldItem: "iron-ball",
          hp: 200, maxHp: 200,
        }),
      ],
    );

    // Seed spikes on player B side so switching in will trigger damage.
    room.playerB.hazards = { spikes: 1 };

    // Force a switch: set index 0's HP to 0 and trigger a forced switch.
    // Simpler: have userB switch to index 1 directly (which goes through applySwitch).
    submitAction(room, "userA", { type: "fight", moveId: "splash" });
    submitAction(room, "userB", { type: "switch", pokemonIndex: 1 });

    // Pidgey has iron-ball so grounded — should take spike damage.
    expect(room.playerB.party[1].hp).toBeLessThan(200);
  });
});

// ── Bonus: Embargo ──

describe("Embargo", () => {
  it("adds embargo volatile to defender", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "embargo", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      }],
      [{
        heldItem: "leftovers",
        moves: [{ id: "splash", pp: 40, maxPp: 40 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "embargo" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    expect(room.playerB.volatiles.some((v) => v.id === "embargo")).toBe(true);
    expect(room.log.some((l) => l.includes("아이템금지"))).toBe(true);
  });
});
