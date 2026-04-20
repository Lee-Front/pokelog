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

// ── 1. Scrappy (Normal/Fighting bypass ghost immunity) ──

describe("Scrappy (배짱)", () => {
  it("allows normal-type moves to hit ghost-type defenders", () => {
    // Make A faster with scrappy + tackle, B is gengar (ghost/poison)
    const room = readyRoom(
      [{
        abilityId: "scrappy",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        species: "gengar",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );
    const defHpBefore = room.playerB.party[0].hp;

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Without scrappy, tackle does 0 damage to ghost. With scrappy, it should hit.
    expect(room.playerB.party[0].hp).toBeLessThan(defHpBefore);
  });

  it("without scrappy, normal moves deal no damage to ghost types", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        species: "gengar",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
    );
    const defHpBefore = room.playerB.party[0].hp;

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Tackle (normal) vs gengar (ghost/poison) — ghost immunity makes damage 0
    expect(room.playerB.party[0].hp).toBe(defHpBefore);
  });
});

// ── 2. Foresight / Odor Sleuth ──

describe("Foresight (신통력)", () => {
  it("removes ghost immunity from target, letting normal moves hit", () => {
    const room = readyRoom(
      [{
        moves: [
          { id: "foresight", pp: 40, maxPp: 40 },
          { id: "tackle", pp: 35, maxPp: 35 },
        ],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        species: "gengar",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: A uses foresight on B
    submitAction(room, "userA", { type: "fight", moveId: "foresight" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("타입 내성이 사라졌다"))).toBe(true);
    const hpAfterForesight = room.playerB.party[0].hp;

    // Turn 2: A tackles B (should now hit)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerB.party[0].hp).toBeLessThan(hpAfterForesight);
  });
});

// ── 3. Attract (gender check) ──

describe("Attract (헤롱헤롱)", () => {
  it("fails when both pokemon are the same gender", () => {
    const room = readyRoom(
      [{
        gender: "male",
        moves: [{ id: "attract", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        gender: "male",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "attract" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("헤롱헤롱 실패"))).toBe(true);
    expect(room.playerB.volatiles.some(v => v.id === "infatuation")).toBe(false);
  });

  it("fails when either pokemon is genderless", () => {
    const room = readyRoom(
      [{
        gender: "male",
        moves: [{ id: "attract", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        gender: "genderless",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "attract" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("헤롱헤롱 실패"))).toBe(true);
    expect(room.playerB.volatiles.some(v => v.id === "infatuation")).toBe(false);
  });

  it("succeeds when opposite genders", () => {
    const room = readyRoom(
      [{
        gender: "male",
        moves: [{ id: "attract", pp: 15, maxPp: 15 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        gender: "female",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "attract" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("헤롱헤롱!"))).toBe(true);
    expect(room.playerB.volatiles.some(v => v.id === "infatuation")).toBe(true);
  });
});

// ── 4. Roost ──

describe("Roost (날개쉬기)", () => {
  it("removes flying type for the turn, letting ground moves hit", () => {
    // B is charizard (fire/flying) that uses roost. A uses earthquake.
    // With Roost, flying is removed for the turn so earthquake hits normally.
    const room = readyRoom(
      [{
        // A faster, uses earthquake
        moves: [{ id: "earthquake", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
      [{
        // B slower, uses roost first (roost has priority 0, but B damaged somehow)
        species: "charizard",
        hp: 100,
        moves: [{ id: "roost", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
    );

    // B goes first (faster) and uses roost (removes flying for turn).
    // Then A uses earthquake — should hit charizard normally (no flying immunity, though charizard isn't levitate).
    // Actually charizard fire/flying is 0x to ground. With roost, ground hits 2x (via fire).
    submitAction(room, "userA", { type: "fight", moveId: "earthquake" });
    submitAction(room, "userB", { type: "fight", moveId: "roost" });

    // B should have roosted
    const roostedLog = room.log.some(l => l.includes("HP를 회복했다"));
    expect(roostedLog).toBe(true);
    // earthquake should have hit
    expect(room.playerB.party[0].hp).toBeLessThan(150); // less than 100+50 heal (150)
  });

  it("roostedThisTurn is reset after the turn", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
      [{
        species: "charizard",
        hp: 100,
        moves: [{ id: "roost", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "roost" });

    // After turn ends, roostedThisTurn should be cleared
    expect(room.playerB.roostedThisTurn).toBeFalsy();
  });
});

// ── 5. Knock Off ──

describe("Knock Off (탁쳐서떨구기)", () => {
  it("removes defender's held item after dealing damage", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "knock-off", pp: 20, maxPp: 20 }],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        heldItem: "leftovers",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "knock-off" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("떨어뜨렸다"))).toBe(true);
    expect(room.playerB.party[0].heldItem).toBeNull();
  });

  it("does not remove item if defender has none", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "knock-off", pp: 20, maxPp: 20 }],
        stats: { attack: 150, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "knock-off" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("떨어뜨렸다"))).toBe(false);
  });
});

// ── 6. Trick / Switcheroo ──

describe("Trick / Switcheroo (트릭 / 바꿔치기)", () => {
  it("swaps held items between attacker and defender", () => {
    const room = readyRoom(
      [{
        heldItem: "choice-band",
        moves: [{ id: "trick", pp: 10, maxPp: 10 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        heldItem: "leftovers",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "trick" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.party[0].heldItem).toBe("leftovers");
    expect(room.playerB.party[0].heldItem).toBe("choice-band");
    expect(room.log.some(l => l.includes("도구가 바뀌었다"))).toBe(true);
  });

  it("swaps even when one side has no item", () => {
    const room = readyRoom(
      [{
        heldItem: null,
        moves: [{ id: "switcheroo", pp: 10, maxPp: 10 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        heldItem: "leftovers",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "switcheroo" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.party[0].heldItem).toBe("leftovers");
    expect(room.playerB.party[0].heldItem).toBeNull();
  });
});

// ── 7. Magic Coat / Magic Bounce ──

describe("Magic Coat / Magic Bounce (매직코트 / 매직미러)", () => {
  it("magic-bounce ability reflects status moves", () => {
    const room = readyRoom(
      [{
        // A uses toxic (status move)
        moves: [{ id: "toxic", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        abilityId: "magic-bounce",
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Magic bounce should reflect. Defender (B) should NOT be poisoned.
    expect(room.log.some(l => l.includes("매직미러"))).toBe(true);
    expect(room.playerB.party[0].statusCondition).toBeNull();
  });

  it("magic-coat move blocks status moves for that turn", () => {
    const room = readyRoom(
      [{
        // A uses toxic, slower
        moves: [{ id: "toxic", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 30 },
      }],
      [{
        // B uses magic-coat (priority +4, goes first), then A's toxic is reflected
        moves: [{ id: "magic-coat", pp: 15, maxPp: 15 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 50 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "magic-coat" });

    // B should have used magic-coat, A's toxic should be reflected
    expect(room.log.some(l => l.includes("매직코트"))).toBe(true);
    // B should not be poisoned
    expect(room.playerB.party[0].statusCondition).toBeNull();
  });
});

// ── 8. Curse ──

describe("Curse (저주)", () => {
  it("ghost-type user loses 50% HP and curses defender", () => {
    const room = readyRoom(
      [{
        species: "gengar",  // ghost
        moves: [{ id: "curse", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );
    const atkHpBefore = room.playerA.party[0].hp;

    submitAction(room, "userA", { type: "fight", moveId: "curse" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // A should have lost ~50% HP (or more with end-of-turn curse damage to defender)
    expect(room.playerA.party[0].hp).toBeLessThanOrEqual(atkHpBefore - Math.floor(200 / 2) + 10);
    // B should be cursed
    expect(room.playerB.volatiles.some(v => v.id === "curse")).toBe(true);
    // B should have taken curse damage at end of turn (1/4 maxHp = 50)
    expect(room.playerB.party[0].hp).toBeLessThan(200);
  });

  it("non-ghost user gets +1 atk, +1 def, -1 speed", () => {
    const room = readyRoom(
      [{
        // pikachu is electric, not ghost
        moves: [{ id: "curse", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 120 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "curse" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.statStages.attack).toBe(1);
    expect(room.playerA.statStages.defense).toBe(1);
    expect(room.playerA.statStages.speed).toBe(-1);
    // No curse volatile applied (only ghost version applies it)
    expect(room.playerB.volatiles.some(v => v.id === "curse")).toBe(false);
  });
});

// ── 9. Fake Out ──

describe("Fake Out (속이다)", () => {
  it("works on the first turn after switch-in", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "fake-out", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 50 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );
    // Lead pokemon just switched in; fake-out should work turn 1
    submitAction(room, "userA", { type: "fight", moveId: "fake-out" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Fake out should NOT fail on turn 1
    expect(room.log.some(l => l.includes("속이기 실패"))).toBe(false);
    // B should have been hit
    expect(room.playerB.party[0].hp).toBeLessThan(200);
  });

  it("fails on subsequent turns", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "fake-out", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: fake-out works
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Turn 2: fake-out should fail (not first turn)
    submitAction(room, "userA", { type: "fight", moveId: "fake-out" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some(l => l.includes("속이기 실패"))).toBe(true);
  });

  it("works again after switching out and back in", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "fake-out", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 30, defense: 100, spAttack: 30, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: normal attack (uses up "just switched in")
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Turn 2: A switches to index 1 (charizard)
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Turn 3: A switches back to index 0 (pikachu with fake-out)
    submitAction(room, "userA", { type: "switch", pokemonIndex: 0 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Turn 4: fake-out should work since pokemon just came back
    const logLenBefore = room.log.length;
    submitAction(room, "userA", { type: "fight", moveId: "fake-out" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    const newLogs = room.log.slice(logLenBefore);
    const failLog = newLogs.some(l => l.includes("속이기 실패"));
    expect(failLog).toBe(false);
  });
});
