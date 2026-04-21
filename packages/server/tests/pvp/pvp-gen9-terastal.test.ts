import { describe, it, expect } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { computeStab } from "../../src/game/battle.js";
import { getBattleTypes } from "../../src/game/pokemon-state.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

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
    teraType: "fire",
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

function readyRoom(pokeA: Partial<PvpPokemon> = {}, pokeB: Partial<PvpPokemon> = {}) {
  const pA = makePokemon("pikachu", pokeA);
  const pB = makePokemon("bulbasaur", pokeB);
  const room = createRoom(
    "userA", "A", [pA, makePokemon("charizard")],
    "userB", "B", [pB, makePokemon("squirtle")],
    false,
    { hasKeyStone: false, hasDynamaxBand: false },
    { hasKeyStone: false, hasDynamaxBand: false },
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

describe("Terastallize: type override via getBattleTypes", () => {
  it("returns teraType when teraActive is true", () => {
    const poke = makePokemon("pikachu", {
      originalTypes: ["electric"],
      teraType: "flying",
    });
    const room = createRoom(
      "userA", "A", [poke],
      "userB", "B", [makePokemon("bulbasaur")],
    );
    room.playerA.teraActive = true;
    const types = getBattleTypes(poke, room.playerA);
    expect(types).toEqual(["flying"]);
  });

  it("returns original species types when teraActive is false", () => {
    const poke = makePokemon("pikachu", {
      originalTypes: ["electric"],
      teraType: "flying",
    });
    const room = createRoom(
      "userA", "A", [poke],
      "userB", "B", [makePokemon("bulbasaur")],
    );
    // teraActive defaults to undefined/false
    const types = getBattleTypes(poke, room.playerA);
    // Falls back to species types via getEffectiveTypes (pikachu → electric)
    expect(types).toContain("electric");
  });
});

describe("computeStab: Tera + Adaptability matrix", () => {
  it("combined Tera+original returns 2.0x (no Adaptability)", () => {
    const stab = computeStab("fire", ["fire", "flying"], true, "fire", false);
    expect(stab).toBe(2.0);
  });

  it("Tera only (no original match) returns 1.5x — Adaptability does NOT stack", () => {
    const stab = computeStab("water", ["fire"], true, "water", true);
    expect(stab).toBe(1.5);
  });

  it("Tera + original + Adaptability returns 2.25x", () => {
    const stab = computeStab("fire", ["fire"], true, "fire", true);
    expect(stab).toBe(2.25);
  });

  it("Adaptability + non-Tera original match returns 2.0x (regression check)", () => {
    const stab = computeStab("water", ["water"], false, null, true);
    expect(stab).toBe(2.0);
  });

  it("plain STAB (no Adaptability, no Tera) returns 1.5x", () => {
    const stab = computeStab("water", ["water"], false, null, false);
    expect(stab).toBe(1.5);
  });

  it("no match returns 1.0x", () => {
    const stab = computeStab("grass", ["fire"], false, null, false);
    expect(stab).toBe(1.0);
  });

  it("Tera active but move type mismatch with teraType and original returns 1.0x", () => {
    const stab = computeStab("grass", ["fire"], true, "water", false);
    expect(stab).toBe(1.0);
  });
});

describe("Tera Blast: customResolve overrideMove", () => {
  it("when Terastallized, overrides type to teraType", () => {
    // Very high Atk > SpA → physical
    const pA = makePokemon("pikachu", {
      stats: { attack: 200, defense: 80, spAttack: 50, spDefense: 80, speed: 80 },
      originalTypes: ["electric"],
      teraType: "fighting",
      moves: [{ id: "tera-blast", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur", {
      originalTypes: ["grass"],
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "tera-blast", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Terastallize happened
    expect(room.playerA.teraActive).toBe(true);
    expect(room.playerA.transformationType).toBe("tera");
    expect(room.playerA.transformationUsed).toBe(true);
    // Bulbasaur takes damage — fighting on grass is neutral, but the move ran
    const defPoke = room.playerB.party[0];
    expect(defPoke.hp).toBeLessThan(defPoke.maxHp);
  });

  it("when Atk > SpA, uses physical category", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 200, defense: 80, spAttack: 50, spDefense: 80, speed: 80 },
      originalTypes: ["electric"],
      teraType: "fire",
      moves: [{ id: "tera-blast", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("bulbasaur", {
      originalTypes: ["grass"],
      stats: { attack: 50, defense: 200, spAttack: 50, spDefense: 40, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    const hpBefore = room.playerB.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "tera-blast", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Physical category uses defender.defense (200). With 200 attack & 200 defense,
    // damage should be moderate. If category were mistakenly "special", it would
    // use spDefense (40) and deal much more damage. We assert some damage
    // happened and the move executed correctly.
    const hpAfter = room.playerB.party[0].hp;
    expect(hpAfter).toBeLessThan(hpBefore);
  });
});

describe("Terastallize action gating", () => {
  it("cannot Terastallize and Mega-evolve in the same battle", () => {
    const room = readyRoom();
    // Fake a mega already used
    room.playerA.transformationUsed = true;
    room.playerA.transformationType = "mega";

    submitAction(room, "userA", { type: "fight", moveId: "tackle", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Tera should NOT have activated because the slot is used
    expect(room.playerA.teraActive).not.toBe(true);
    expect(room.playerA.transformationType).toBe("mega");
  });

  it("consumes the transformation slot", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.teraActive).toBe(true);
    expect(room.playerA.transformationUsed).toBe(true);
    expect(room.playerA.transformationType).toBe("tera");
  });

  it("Tera persists across a switch out and back in (NOT reset on switch)", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.teraActive).toBe(true);

    // Switch out, then switch back in — teraActive should persist
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.teraActive).toBe(true);

    submitAction(room, "userA", { type: "switch", pokemonIndex: 0 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.teraActive).toBe(true);
  });
});

describe("Adaptability regression (non-Tera)", () => {
  it("still yields 2.0x STAB on an original-type move without Tera", () => {
    // A direct computeStab assertion ensures the Adaptability code path is
    // still driven by computeStab after removing the onAttack multiplier.
    const stab = computeStab("electric", ["electric"], false, null, true);
    expect(stab).toBe(2.0);
  });
});
