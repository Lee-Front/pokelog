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

// ── 1. Wish ──

describe("Wish (바라기)", () => {
  it("heals 1/2 maxHp two turns after use", () => {
    const room = readyRoom(
      [{
        hp: 80, maxHp: 200,
        moves: [{ id: "wish", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    // Turn 1: Use wish
    submitAction(room, "userA", { type: "fight", moveId: "wish" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("바라기"))).toBe(true);
    expect(room.playerA.wish).toBeDefined();
    // After turn 1: wish.turns decremented once to 1
    expect(room.playerA.wish?.turns).toBe(1);

    const hpBeforeHeal = room.playerA.party[0].hp;

    // Turn 2: wait — wish should trigger at end of turn 2
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Wish should have resolved (healAmount = floor(200/2) = 100)
    expect(room.log.some((l) => l.includes("바라기로 HP를 회복"))).toBe(true);
    expect(room.playerA.wish).toBeUndefined();
    // HP should be higher than before heal (taking B's tackle damage into account)
    expect(room.playerA.party[0].hp).toBeGreaterThan(hpBeforeHeal - 50);
  });
});

// ── 2. Recovery Moves ──

describe("Recovery moves", () => {
  it("recover heals 1/2 maxHp", () => {
    const room = readyRoom(
      [{
        hp: 50, maxHp: 200,
        moves: [{ id: "recover", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "recover" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("HP를 회복했다"))).toBe(true);
    // 50 + 100 (half of 200) = 150; minus minimal tackle damage
    expect(room.playerA.party[0].hp).toBeGreaterThan(100);
  });

  it("rest heals to full and inflicts sleep", () => {
    const room = readyRoom(
      [{
        hp: 10, maxHp: 200,
        moves: [{ id: "rest", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "rest" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("잠듦! HP가 완전히 회복"))).toBe(true);
    // HP should be maxHp minus any tackle damage from B
    expect(room.playerA.party[0].hp).toBeGreaterThan(150);
    expect(room.playerA.party[0].statusCondition).toBe("sleep");
  });

  it("moonlight heals 2/3 in sun", () => {
    const room = readyRoom(
      [{
        hp: 50, maxHp: 200,
        moves: [{ id: "moonlight", pp: 5, maxPp: 5 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );
    room.weather = "sun";
    room.weatherTurns = 5;

    submitAction(room, "userA", { type: "fight", moveId: "moonlight" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // floor(200 * 2/3) = 133
    // 50 + 133 = 183 (minus minimal tackle)
    expect(room.playerA.party[0].hp).toBeGreaterThan(150);
    expect(room.log.some((l) => l.includes("HP를 회복했다"))).toBe(true);
  });
});

// ── 3. Sleep Talk / Snore ──

describe("Sleep Talk / Snore", () => {
  it("sleep-talk uses a random other move while asleep", () => {
    const room = readyRoom(
      [{
        statusCondition: "sleep",
        sleepTurns: 3,
        moves: [
          { id: "sleep-talk", pp: 10, maxPp: 10 },
          { id: "tackle", pp: 35, maxPp: 35 },
        ],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    // Force random to pick index 0 (tackle is the only other move)
    vi.spyOn(Math, "random").mockReturnValue(0);

    const defHpBefore = room.playerB.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "sleep-talk" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Should see sleep-talk log
    expect(room.log.some((l) => l.includes("잠꼬대"))).toBe(true);
    // Attacker should still be asleep
    expect(room.playerA.party[0].statusCondition).toBe("sleep");
    // Tackle should have dealt damage via sleep-talk
    expect(room.playerB.party[0].hp).toBeLessThan(defHpBefore);
  });

  it("snore works while asleep", () => {
    const room = readyRoom(
      [{
        statusCondition: "sleep",
        sleepTurns: 3,
        moves: [
          { id: "snore", pp: 15, maxPp: 15 },
          { id: "tackle", pp: 35, maxPp: 35 },
        ],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const defHpBefore = room.playerB.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "snore" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("코골기"))).toBe(true);
    // Attacker should remain asleep
    expect(room.playerA.party[0].statusCondition).toBe("sleep");
    // Snore should deal damage
    expect(room.playerB.party[0].hp).toBeLessThan(defHpBefore);
  });
});

// ── 4. Belly Drum ──

describe("Belly Drum (배북)", () => {
  it("maximizes attack at cost of 1/2 maxHp", () => {
    const room = readyRoom(
      [{
        hp: 200, maxHp: 200,
        moves: [{ id: "belly-drum", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "belly-drum" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("배북"))).toBe(true);
    expect(room.playerA.statStages.attack).toBe(6);
    // HP reduced by half maxHp minus tackle damage from B
    expect(room.playerA.party[0].hp).toBeLessThanOrEqual(100);
  });

  it("fails when HP is 1/2 maxHp or less", () => {
    const room = readyRoom(
      [{
        hp: 100, maxHp: 200,
        moves: [{ id: "belly-drum", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "belly-drum" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("배북 실패"))).toBe(true);
    expect(room.playerA.statStages.attack).toBe(0);
  });
});

// ── 5. Focus Energy ──

describe("Focus Energy (초점맞추기)", () => {
  it("adds focus-energy volatile", () => {
    const room = readyRoom(
      [{
        moves: [{ id: "focus-energy", pp: 30, maxPp: 30 }, { id: "tackle", pp: 35, maxPp: 35 }],
        stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
      }],
      [{
        stats: { attack: 1, defense: 100, spAttack: 1, spDefense: 100, speed: 30 },
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "focus-energy" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("기력충전"))).toBe(true);
    expect(room.playerA.volatiles.some((v) => v.id === "focus-energy")).toBe(true);
  });
});

// ── 6. Transform ──

describe("Transform (변신)", () => {
  it("copies target species, stats, and moves with 5 PP", () => {
    const room = readyRoom(
      [{
        species: "ditto",
        moves: [{ id: "transform", pp: 10, maxPp: 10 }],
        stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
        abilityId: "imposter",
      }],
      [{
        species: "charizard",
        moves: [
          { id: "ember", pp: 25, maxPp: 25 },
          { id: "tackle", pp: 35, maxPp: 35 },
        ],
        stats: { attack: 200, defense: 150, spAttack: 250, spDefense: 120, speed: 180 },
        abilityId: "blaze",
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "transform" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.log.some((l) => l.includes("변신"))).toBe(true);

    const transformed = room.playerA.party[0];
    // Species copied
    expect(transformed.species).toBe("charizard");
    // Stats copied
    expect(transformed.stats.attack).toBe(200);
    expect(transformed.stats.spAttack).toBe(250);
    // Moves copied with 5 PP
    expect(transformed.moves.length).toBe(2);
    expect(transformed.moves[0].id).toBe("ember");
    expect(transformed.moves[0].pp).toBe(5);
    expect(transformed.moves[0].maxPp).toBe(5);
    // Ability copied
    expect(transformed.abilityId).toBe("blaze");
    // Pre-transform state saved
    expect(room.playerA.preTransformState).toBeDefined();
    expect(room.playerA.preTransformState?.species).toBe("ditto");
  });

  it("restores original stats/moves on switch out", () => {
    const room = readyRoom(
      [{
        species: "ditto",
        moves: [{ id: "transform", pp: 10, maxPp: 10 }],
        stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
        abilityId: "imposter",
      }],
      [{
        species: "charizard",
        moves: [{ id: "ember", pp: 25, maxPp: 25 }],
        stats: { attack: 200, defense: 150, spAttack: 250, spDefense: 120, speed: 180 },
        abilityId: "blaze",
      }],
    );

    submitAction(room, "userA", { type: "fight", moveId: "transform" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Confirm transformed
    expect(room.playerA.party[0].species).toBe("charizard");

    // Switch A out
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Original pokemon at index 0 should be restored
    const restored = room.playerA.party[0];
    expect(restored.species).toBe("ditto");
    expect(restored.stats.attack).toBe(50);
    expect(restored.moves[0].id).toBe("transform");
    expect(restored.abilityId).toBe("imposter");
    expect(room.playerA.preTransformState).toBeUndefined();
  });
});
