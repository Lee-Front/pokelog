import { describe, it, expect } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    originalTypes: ["psychic"],
    teraType: "psychic",
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

function makeNecrozmaDuskMane(overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return makePokemon("necrozma-dusk", {
    heldItem: "ultra-necrozium-z",
    stats: { attack: 157, defense: 127, spAttack: 113, spDefense: 109, speed: 77 },
    originalTypes: ["psychic", "steel"],
    teraType: "psychic",
    ultraForm: {
      variantId: "necrozma-ultra",
      maxHp: 250,
      stats: { attack: 167, defense: 97, spAttack: 167, spDefense: 97, speed: 129 },
    },
    maxHp: 200,
    hp: 200,
    ...overrides,
  });
}

function readyUltraRoom(necroOverrides: Partial<PvpPokemon> = {}) {
  const necrozma = makeNecrozmaDuskMane(necroOverrides);
  const room = createRoom(
    "userA", "A", [necrozma, makePokemon("pikachu")],
    "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    false,
    { hasKeyStone: false, hasDynamaxBand: false },
    { hasKeyStone: false, hasDynamaxBand: false },
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

describe("Ultra Burst: activation", () => {
  it("Necrozma Dusk Mane + Ultra Necrozium Z triggers Ultra Burst (stats change, slot consumed)", () => {
    const room = readyUltraRoom();

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("necrozma-ultra");
    expect(room.playerA.transformationType).toBe("ultra-burst");
    expect(room.playerA.transformationUsed).toBe(true);

    const poke = room.playerA.party[0];
    // Stats should now be from ultraForm
    expect(poke.stats.attack).toBe(167);
    expect(poke.stats.spAttack).toBe(167);
    expect(poke.stats.speed).toBe(129);
    expect(poke.maxHp).toBe(250);
    // Log entry present
    expect(room.log.some((l) => l.includes("울트라버스트"))).toBe(true);
  });

  it("Necrozma Dawn Wings + Ultra Necrozium Z triggers Ultra Burst", () => {
    const dawn = makeNecrozmaDuskMane({
      species: "necrozma-dawn",
      uid: "necrozma-dawn-uid",
      stats: { attack: 113, defense: 109, spAttack: 157, spDefense: 127, speed: 77 },
      originalTypes: ["psychic", "ghost"],
    });
    const room = createRoom(
      "userA", "A", [dawn, makePokemon("pikachu")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.transformationType).toBe("ultra-burst");
    expect(room.playerA.battleForm).toBe("necrozma-ultra");
  });
});

describe("Ultra Burst: gating", () => {
  it("fails if ultraForm is missing (no Ultra Necrozium Z pre-compute)", () => {
    // Simulate no pre-computed ultraForm (i.e. missing held item at room creation)
    const room = readyUltraRoom({ ultraForm: null, heldItem: null });

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationType).toBeUndefined();
    expect(room.playerA.transformationUsed).not.toBe(true);
    expect(room.log.some((l) => l.includes("울트라버스트"))).toBe(false);
  });

  it("cannot Ultra Burst and Mega evolve in the same battle (shared transformation slot)", () => {
    const room = readyUltraRoom();
    // Simulate mega already used
    room.playerA.transformationUsed = true;
    room.playerA.transformationType = "mega";

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Ultra Burst should NOT activate
    expect(room.playerA.transformationType).toBe("mega");
    expect(room.playerA.battleForm).not.toBe("necrozma-ultra");
  });

  it("cannot Mega evolve after Ultra Burst in the same battle", () => {
    const room = readyUltraRoom();

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationType).toBe("ultra-burst");

    // Attempting mega after ultra burst should not override
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.transformationType).toBe("ultra-burst");
  });
});

describe("Ultra Burst: persistence", () => {
  it("Ultra form persists after activation (stats remain Ultra across turns)", () => {
    const room = readyUltraRoom();

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    const afterBurst = room.playerA.party[0].stats.speed;
    expect(afterBurst).toBe(129);

    // Next turn — stats should remain Ultra
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.party[0].stats.speed).toBe(129);
    expect(room.playerA.battleForm).toBe("necrozma-ultra");
    expect(room.playerA.transformationType).toBe("ultra-burst");
  });

  it("preserves HP ratio when transforming", () => {
    // Start with damaged HP to verify ratio preservation
    const room = readyUltraRoom({ hp: 100, maxHp: 200 });

    submitAction(room, "userA", { type: "fight", moveId: "tackle", ultraBurst: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    const poke = room.playerA.party[0];
    expect(poke.maxHp).toBe(250);
    // Ratio was 0.5; on 250 maxHp that's 125 (minus whatever damage was dealt this turn)
    // Use a loose check: HP should be somewhere around 125 (before/after turn damage)
    expect(poke.hp).toBeGreaterThan(50);
    expect(poke.hp).toBeLessThanOrEqual(125);
  });
});
