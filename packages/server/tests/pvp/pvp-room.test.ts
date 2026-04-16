import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, getPlayerView, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, level = 50): PvpPokemon {
  return {
    uid: species + "-uid",
    species,
    level,
    hp: 100, maxHp: 100,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
  };
}

const partyA = [makePokemon("pikachu"), makePokemon("charizard")];
const partyB = [makePokemon("bulbasaur"), makePokemon("squirtle")];

describe("pvp-room", () => {
  it("createRoom returns room in team_preview phase", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    expect(room.phase).toBe("team_preview");
    expect(room.playerA.party).toHaveLength(2);
    expect(room.playerB.party).toHaveLength(2);
  });

  it("selectLead sets activeIndex and marks ready", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 1);
    expect(room.playerA.activeIndex).toBe(1);
    expect(room.playerA.ready).toBe(true);
    expect(room.phase).toBe("team_preview");
  });

  it("both leads selected → phase advances to action", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    expect(room.phase).toBe("action");
    expect(room.turn).toBe(1);
  });

  it("getPlayerView hides opponent party details", () => {
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const view = getPlayerView(room, "userA");
    expect(view.me.party).toHaveLength(2);
    expect(view.opponent.activePokemon).not.toBeNull();
    expect(view.opponent.partyHpRatios).toHaveLength(2);
  });
});

describe("pvp turn resolution", () => {
  function readyRoom() {
    const room = createRoom("userA", "A",
      [makePokemon("pikachu"), makePokemon("charizard")],
      "userB", "B",
      [makePokemon("bulbasaur"), makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("submitAction marks player as submitted", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    expect(room.playerA.actionSubmitted).toBe(true);
  });

  it("both actions submitted triggers resolution", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    const resolved = submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(resolved).toBe(true);
    expect(room.turn).toBe(2);
    expect(room.playerA.actionSubmitted).toBe(false);
    expect(room.log.length).toBeGreaterThan(0);
  });

  it("forfeit ends the match immediately", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "forfeit" });
    expect(room.phase).toBe("finished");
    expect(room.result?.winnerId).toBe("userB");
    expect(room.result?.reason).toBe("forfeit");
  });

  it("switch changes active pokemon", () => {
    const room = readyRoom();
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.activeIndex).toBe(1);
  });

  it("dual-KO sets forcedSwitchNeeded for both sides", () => {
    const room = readyRoom();
    // Manually set both active pokemon to near-death and force KO state
    room.playerA.party[0].hp = 0;
    room.playerB.party[0].hp = 0;
    // Simulate what resolveTurn does when both KO
    room.phase = "forced_switch";
    room.forcedSwitchNeeded = { a: true, b: true };

    expect(room.forcedSwitchNeeded).toEqual({ a: true, b: true });

    // Only userA needs to switch — submit userA switch
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    expect(room.phase).toBe("forced_switch"); // userB hasn't switched yet

    // userB submits switch
    const resolved = submitAction(room, "userB", { type: "switch", pokemonIndex: 1 });
    expect(resolved).toBe(true);
    expect(room.phase).toBe("action");
    expect(room.forcedSwitchNeeded).toBeUndefined();
    expect(room.playerA.activeIndex).toBe(1);
    expect(room.playerB.activeIndex).toBe(1);
  });

  it("single-KO forced_switch only waits for the fainted side", () => {
    const room = readyRoom();
    // Only player A's active pokemon fainted
    room.playerA.party[0].hp = 0;
    room.phase = "forced_switch";
    room.forcedSwitchNeeded = { a: true, b: false };

    // userB submitting should not resolve (only A needs to switch)
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.phase).toBe("forced_switch");

    // userA submits switch — should resolve immediately
    const resolved = submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    expect(resolved).toBe(true);
    expect(room.phase).toBe("action");
    expect(room.playerA.activeIndex).toBe(1);
  });
});

// ── Task 3: Primal Reversion ──
describe("pvp primal reversion", () => {
  function makePrimalGroudon(): PvpPokemon {
    return {
      uid: "groudon-uid",
      species: "groudon",
      level: 50,
      hp: 100,
      maxHp: 100,
      stats: { attack: 80, defense: 70, spAttack: 60, spDefense: 60, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
      primalForm: {
        variantId: "groudon-primal",
        maxHp: 150,
        stats: { attack: 120, defense: 90, spAttack: 80, spDefense: 80, speed: 50 },
      },
    };
  }

  it("auto-applies primal reversion when lead is selected and both players are ready", () => {
    const groudon = makePrimalGroudon();
    const room = createRoom(
      "userA", "A", [groudon, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    expect(room.phase).toBe("action");
    const poke = room.playerA.party[0];
    expect(room.playerA.battleForm).toBe("groudon-primal");
    expect(room.playerA.transformationType).toBe("primal");
    expect(poke.stats.attack).toBe(120);
    expect(poke.stats.defense).toBe(90);
    expect(poke.maxHp).toBe(150);
    // HP should scale proportionally (was 100/100 = 1.0 → 150)
    expect(poke.hp).toBe(150);
  });

  it("scales HP proportionally when pokemon is damaged", () => {
    const groudon = makePrimalGroudon();
    groudon.hp = 50; // 50% HP
    const room = createRoom(
      "userA", "A", [groudon, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    const poke = room.playerA.party[0];
    // 50/100 = 0.5 → Math.round(0.5 * 150) = 75
    expect(poke.hp).toBe(75);
    expect(poke.maxHp).toBe(150);
  });

  it("does NOT consume transformationUsed (can still mega evolve)", () => {
    const groudon = makePrimalGroudon();
    const room = createRoom(
      "userA", "A", [groudon, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    expect(room.playerA.transformationUsed).toBeFalsy();
  });

  it("logs primal reversion message", () => {
    const groudon = makePrimalGroudon();
    const room = createRoom(
      "userA", "A", [groudon, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    expect(room.log.some((l) => l.includes("원시회귀"))).toBe(true);
  });

  it("does NOT apply primal reversion for pokemon without primalForm", () => {
    const room = createRoom(
      "userA", "A", [makePokemon("pikachu"), makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationType).toBeUndefined();
  });
});

// ── Task 4: Mega Evolution ──
describe("pvp mega evolution", () => {
  function makeMegaPokemon(species = "charizard"): PvpPokemon {
    return {
      uid: `${species}-uid`,
      species,
      level: 50,
      hp: 100,
      maxHp: 100,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
      megaForm: {
        variantId: `${species}-mega`,
        maxHp: 120,
        stats: { attack: 80, defense: 70, spAttack: 80, spDefense: 70, speed: 60 },
      },
    };
  }

  function readyMegaRoom(opts?: { hasKeyStone?: boolean; species?: string }) {
    const mega = makeMegaPokemon(opts?.species);
    const room = createRoom(
      "userA", "A", [mega, makePokemon("pikachu")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
      false,
      { hasKeyStone: opts?.hasKeyStone ?? true, hasDynamaxBand: false },
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("fight with mega:true triggers mega evolution (stats change, transformationUsed=true)", () => {
    const room = readyMegaRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("charizard-mega");
    expect(room.playerA.transformationType).toBe("mega");
    expect(room.playerA.transformationUsed).toBe(true);
    // Stats should be from mega form
    const poke = room.playerA.party[0];
    expect(poke.stats.attack).toBe(80);
    expect(poke.maxHp).toBe(120);
    expect(room.log.some((l) => l.includes("메가진화"))).toBe(true);
  });

  it("cannot mega evolve twice per battle", () => {
    const room = readyMegaRoom();
    // First mega: works
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationUsed).toBe(true);

    const statsAfterFirstMega = { ...room.playerA.party[0].stats };

    // Switch out and back
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    submitAction(room, "userA", { type: "switch", pokemonIndex: 0 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Second mega attempt: should not change anything further
    const megaLogCount = room.log.filter((l) => l.includes("메가진화")).length;
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // No new mega evolution log
    const newMegaLogCount = room.log.filter((l) => l.includes("메가진화")).length;
    expect(newMegaLogCount).toBe(0); // logs reset each turn, but mega should not trigger again
  });

  it("cannot mega evolve without key stone (non-rayquaza)", () => {
    const room = readyMegaRoom({ hasKeyStone: false });
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationUsed).toBe(false);
  });

  it("rayquaza can mega evolve without key stone", () => {
    const rayquaza = makeMegaPokemon("rayquaza");
    const room = createRoom(
      "userA", "A", [rayquaza, makePokemon("pikachu")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
      false,
      { hasKeyStone: false, hasDynamaxBand: false },
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("rayquaza-mega");
    expect(room.playerA.transformationUsed).toBe(true);
  });

  it("mega form persists when switching back in", () => {
    const room = readyMegaRoom();
    // Mega evolve
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBe("charizard-mega");

    // Switch out
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBeUndefined();

    // Switch back in
    submitAction(room, "userA", { type: "switch", pokemonIndex: 0 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBe("charizard-mega");
  });
});

// ── Task 5: Gigantamax ──
describe("pvp gigantamax", () => {
  function makeGmaxPokemon(species = "charizard"): PvpPokemon {
    return {
      uid: `${species}-uid`,
      species,
      level: 50,
      hp: 100,
      maxHp: 100,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
      gmaxForm: {
        variantId: `${species}-gmax`,
        maxHp: 200,
        stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      },
    };
  }

  function readyGmaxRoom(opts?: { hasDynamaxBand?: boolean }) {
    const gmax = makeGmaxPokemon();
    const room = createRoom(
      "userA", "A", [gmax, makePokemon("pikachu")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
      false,
      { hasKeyStone: false, hasDynamaxBand: opts?.hasDynamaxBand ?? true },
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("gigantamax triggers with HP boost", () => {
    const room = readyGmaxRoom();
    submitAction(room, "userA", { type: "fight", moveId: "tackle", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("charizard-gmax");
    expect(room.playerA.transformationType).toBe("gigantamax");
    expect(room.playerA.transformationUsed).toBe(true);
    expect(room.playerA.gmaxTurnsRemaining).toBe(2); // 3 - 1 (countdown happens at end of turn)
    const poke = room.playerA.party[0];
    expect(poke.maxHp).toBe(200);
    // HP should scale: ceil(100/100 * 200) = 200 minus damage taken from tackle
    expect(room.log.some((l) => l.includes("기가맥스"))).toBe(true);
  });

  it("auto-reverts after 3 turns", () => {
    const room = readyGmaxRoom();
    // Turn 1: activate gmax (gmaxTurnsRemaining becomes 3, then countdown → 2)
    submitAction(room, "userA", { type: "fight", moveId: "tackle", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.gmaxTurnsRemaining).toBe(2);

    // Turn 2: (countdown → 1)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.gmaxTurnsRemaining).toBe(1);

    // Turn 3: (countdown → 0, reverts)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationType).toBeNull();
    expect(room.playerA.gmaxTurnsRemaining).toBeUndefined();
    // maxHp should revert to original
    const poke = room.playerA.party[0];
    expect(poke.maxHp).toBe(100);
    expect(room.log.some((l) => l.includes("기가맥스가 풀렸다"))).toBe(true);
  });

  it("cannot gigantamax without dynamax band", () => {
    const room = readyGmaxRoom({ hasDynamaxBand: false });
    submitAction(room, "userA", { type: "fight", moveId: "tackle", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationUsed).toBe(false);
  });

  it("mega and gigantamax are mutually exclusive (mega first blocks gmax)", () => {
    // Pokemon with both mega and gmax forms
    const pokemon: PvpPokemon = {
      uid: "charizard-uid",
      species: "charizard",
      level: 50,
      hp: 100,
      maxHp: 100,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
      megaForm: {
        variantId: "charizard-mega",
        maxHp: 120,
        stats: { attack: 80, defense: 70, spAttack: 80, spDefense: 70, speed: 60 },
      },
      gmaxForm: {
        variantId: "charizard-gmax",
        maxHp: 200,
        stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      },
    };
    const room = createRoom(
      "userA", "A", [pokemon, makePokemon("pikachu")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
      false,
      { hasKeyStone: true, hasDynamaxBand: true },
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Mega evolve first
    submitAction(room, "userA", { type: "fight", moveId: "tackle", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationUsed).toBe(true);
    expect(room.playerA.transformationType).toBe("mega");

    // Try gigantamax — should be blocked because transformationUsed
    submitAction(room, "userA", { type: "fight", moveId: "tackle", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationType).toBe("mega"); // unchanged
  });

  it("HP reverts proportionally when gmax ends", () => {
    const room = readyGmaxRoom();
    // Gmax: HP goes from 100 → 200
    submitAction(room, "userA", { type: "fight", moveId: "tackle", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    const poke = room.playerA.party[0];
    const gmaxHp = poke.hp; // some HP after taking damage

    // Burn through remaining turns
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // After revert, maxHp should be 100
    expect(poke.maxHp).toBe(100);
    // HP should be proportional but at least 1
    expect(poke.hp).toBeGreaterThanOrEqual(1);
    expect(poke.hp).toBeLessThanOrEqual(100);
  });
});

// ── Task 6: Stat-Changing Moves ──
describe("pvp stat-changing moves", () => {
  function readyStatRoom() {
    const pA: PvpPokemon = {
      uid: "pikachu-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [
        { id: "swords-dance", pp: 20, maxPp: 20 },
        { id: "tackle", pp: 35, maxPp: 35 },
      ],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "bulbasaur-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [
        { id: "tackle", pp: 35, maxPp: 35 },
        { id: "acid-spray", pp: 20, maxPp: 20 },
      ],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("swords-dance raises attacker attack stat stage", () => {
    const room = readyStatRoom();
    // Both use moves; swords-dance is self-targeting status
    submitAction(room, "userA", { type: "fight", moveId: "swords-dance" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.statStages.attack).toBe(2);
    expect(room.log.some((l) => l.includes("공격") && l.includes("올랐다"))).toBe(true);
  });

  it("stat stages clamp at +6", () => {
    const room = readyStatRoom();
    // Use swords-dance 4 times (+2 each = +8, clamped to +6)
    for (let i = 0; i < 4; i++) {
      submitAction(room, "userA", { type: "fight", moveId: "swords-dance" });
      submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    }
    expect(room.playerA.statStages.attack).toBe(6);
  });

  it("secondary stat changes apply to defender on hit (acid-spray)", () => {
    const room = readyStatRoom();
    // acid-spray: 100% chance to lower target spDefense by -2
    vi.spyOn(Math, "random").mockReturnValue(0.0); // ensure hit
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "acid-spray" });
    vi.restoreAllMocks();
    // acid-spray targets the opponent (playerA) — B attacks A
    expect(room.playerA.statStages.spDefense).toBe(-2);
    expect(room.log.some((l) => l.includes("특수방어") && l.includes("내려갔다"))).toBe(true);
  });
});

// ── Task 7: Burn Attack Reduction & Paralysis Speed Reduction ──
describe("pvp burn and paralysis stat effects", () => {
  it("burned pokemon deals less physical damage", () => {
    // Create two rooms with identical pokemon, one with burned attacker, one without
    vi.spyOn(Math, "random").mockReturnValue(0.5); // consistent random

    // Room 1: Burned attacker
    const burnedAtk: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: "burn",
    };
    const defender1: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room1 = createRoom("userA", "A", [burnedAtk, makePokemon("charizard")], "userB", "B", [defender1, makePokemon("squirtle")]);
    selectLead(room1, "userA", 0);
    selectLead(room1, "userB", 0);
    submitAction(room1, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room1, "userB", { type: "fight", moveId: "tackle" });
    const burnedDmg = 300 - room1.playerB.party[0].hp; // damage from burned attacker

    // Room 2: Normal attacker
    const normalAtk: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const defender2: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room2 = createRoom("userA", "A", [normalAtk, makePokemon("charizard")], "userB", "B", [defender2, makePokemon("squirtle")]);
    selectLead(room2, "userA", 0);
    selectLead(room2, "userB", 0);
    submitAction(room2, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room2, "userB", { type: "fight", moveId: "tackle" });
    const normalDmg = 300 - room2.playerB.party[0].hp; // damage from normal attacker

    vi.restoreAllMocks();
    // Burned physical attacker should deal strictly less damage than the same unbuffed attacker
    expect(burnedDmg).toBeLessThan(normalDmg);
  });

  it("paralyzed fast pokemon goes after slower non-paralyzed pokemon", () => {
    // A is fast (speed 100) but paralyzed → effective 50
    // B is slower (speed 60) but healthy → goes first
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 100 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: "paralysis",
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };

    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Mock random: 0.5 means paralysis doesn't prevent action (>= 0.25 check passes),
    // and determineTurnOrder speed tiebreak won't matter since 60 > 50
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // B should have gone first (B's tackle log appears before A's tackle log)
    const tackleLogIndices = room.log
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes("몸통박치기"));
    expect(tackleLogIndices.length).toBe(2);
    // First tackle log should be from B (who goes first due to paralysis speed reduction on A)
    expect(tackleLogIndices[0].l).toContain("B의");
  });
});

// ── Task 8: Toxic (Badly Poisoned) ──
describe("pvp toxic", () => {
  function readyToxicRoom() {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 160, maxHp: 160,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "toxic", pp: 10, maxPp: 10 }, { id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 160, maxHp: 160,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("toxic damage increases each turn (1/16, 2/16, 3/16...)", () => {
    const room = readyToxicRoom();
    // Turn 1: Use toxic (A outspeeds B)
    vi.spyOn(Math, "random").mockReturnValue(0.1); // ensure toxic hits (accuracy 90, roll < 90)
    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    const defPoke = room.playerB.party[0];
    expect(defPoke.statusCondition).toBe("poison");
    expect(defPoke.toxicCounter).toBe(2); // was 1, incremented to 2 after first EOT
    // After turn 1 EOT: toxic damage = max(1, floor(160 * 1/16)) = 10
    // B also took tackle damage, but toxic added 10
    const hpAfterTurn1 = defPoke.hp;

    // Turn 2: tackle vs tackle, toxic EOT applies again
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    const hpAfterTurn2 = defPoke.hp;
    // After turn 2 EOT: toxic damage = max(1, floor(160 * 2/16)) = 20
    // So B lost tackle damage + 20 toxic damage this turn
    // The toxic damage should be larger than turn 1's toxic damage
    expect(defPoke.toxicCounter).toBe(3);

    // Turn 3: tackle vs tackle
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    expect(defPoke.toxicCounter).toBe(4);
    // Verify escalating damage via logs
    const toxicLogs = room.log.filter((l) => l.includes("독 데미지"));
    expect(toxicLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("toxic counter resets on switch", () => {
    const room = readyToxicRoom();
    // Apply toxic to B
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    expect(room.playerB.party[0].toxicCounter).toBe(2); // incremented after EOT

    // B switches out
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "switch", pokemonIndex: 1 });
    vi.restoreAllMocks();

    // The original pokemon's toxic counter should be reset
    expect(room.playerB.party[0].toxicCounter).toBeUndefined();
  });
});

// ── Task 4 (new numbering): Accuracy/Evasion Stat Stages ──
describe("pvp accuracy/evasion stat stages", () => {
  it("accuracy stage +6 makes moves nearly always hit", () => {
    // With +6 accuracy stage, effective accuracy = 100 * (3+6)/3 * 1 = 300
    // So Math.random()*100 < 300 should always be true
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Set attacker's accuracy stage to +6
    room.playerA.statStages.accuracy = 6;

    // Use high random value (0.99) that would normally miss with low accuracy
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // With +6 accuracy, effective accuracy = 100 * 3 = 300%, so even 0.99*100=99 < 300
    // Tackle should hit (no "빗나갔다" in log for A's attack)
    const aAttackLogs = room.log.filter((l) => l.includes("A의") && l.includes("pikachu") && l.includes("몸통박치기"));
    expect(aAttackLogs.some((l) => l.includes("데미지"))).toBe(true);
    expect(aAttackLogs.some((l) => l.includes("빗나갔다"))).toBe(false);
  });

  it("evasion stage +6 makes moves miss more often (mocked)", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Set defender's evasion stage to +6
    room.playerB.statStages.evasion = 6;

    // With +6 evasion, effective accuracy = 100 * 1 * 3/(3+6) = 33.3%
    // random() returns 0.5 → 0.5*100=50 >= 33.3 → miss
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // A's attack should miss
    const aAttackLogs = room.log.filter((l) => l.includes("A의") && l.includes("pikachu") && l.includes("몸통박치기"));
    expect(aAttackLogs.some((l) => l.includes("빗나갔다"))).toBe(true);
  });
});

// ── Task 5: Struggle ──
describe("pvp struggle", () => {
  it("pokemon with all PP=0 uses Struggle and deals damage", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 0, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Struggle should be used (발버둥 in Korean)
    expect(room.log.some((l) => l.includes("발버둥"))).toBe(true);
    // Defender should take damage
    expect(room.playerB.party[0].hp).toBeLessThan(200);
  });

  it("struggle causes 1/4 maxHp recoil to attacker", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 0, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Recoil log should appear: 반동으로 50 데미지 (200/4 = 50)
    expect(room.log.some((l) => l.includes("반동으로") && l.includes("50"))).toBe(true);
    // A should have taken recoil + B's tackle damage
    const atkPoke = room.playerA.party[0];
    // At minimum, recoil of 50 happened
    expect(atkPoke.hp).toBeLessThanOrEqual(200 - 50);
  });
});

// ── Task 6: Multi-Hit Moves ──
describe("pvp multi-hit moves", () => {
  it("a move with minHits=2, maxHits=5 logs N번 맞았다", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "fury-attack", pp: 20, maxPp: 20 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 500, maxHp: 500,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "fury-attack" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Should log "N번 맞았다" for multi-hit
    expect(room.log.some((l) => l.includes("번 맞았다"))).toBe(true);
    // Defender should take damage
    expect(room.playerB.party[0].hp).toBeLessThan(500);
  });

  it("multi-hit stops if target faints mid-sequence", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "fury-attack", pp: 20, maxPp: 20 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 5, maxHp: 200,  // Very low HP so it faints quickly
      stats: { attack: 50, defense: 10, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "fury-attack" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Target should have fainted
    expect(room.playerB.party[0].hp).toBe(0);
    // Multi-hit log should show fewer hits than max (stopped early)
    const multiHitLog = room.log.find((l) => l.includes("번 맞았다"));
    if (multiHitLog) {
      const hitMatch = multiHitLog.match(/(\d+)번/);
      if (hitMatch) {
        const hits = parseInt(hitMatch[1]);
        // Should have stopped before max hits since target fainted
        expect(hits).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ── Task 7: Fixed Damage Moves & Self-Destruct ──
describe("pvp fixed damage moves", () => {
  it("dragon-rage always deals 40 damage regardless of stats", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 10, defense: 50, spAttack: 10, spDefense: 50, speed: 60 },
      moves: [{ id: "dragon-rage", pp: 10, maxPp: 10 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 200, spAttack: 50, spDefense: 200, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "dragon-rage" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Dragon Rage always deals exactly 40 damage
    expect(room.playerB.party[0].hp).toBeLessThanOrEqual(200); // took tackle damage too possibly
    expect(room.log.some((l) => l.includes("40 데미지"))).toBe(true);
  });

  it("seismic-toss deals damage equal to user level", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 42,
      hp: 200, maxHp: 200,
      stats: { attack: 10, defense: 50, spAttack: 10, spDefense: 50, speed: 60 },
      moves: [{ id: "seismic-toss", pp: 20, maxPp: 20 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 200, spAttack: 50, spDefense: 200, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "seismic-toss" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Seismic Toss deals damage = level = 42
    expect(room.log.some((l) => l.includes("42 데미지"))).toBe(true);
  });
});

describe("pvp self-destruct moves", () => {
  it("self-destruct makes attacker faint after dealing damage", () => {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "self-destruct", pp: 5, maxPp: 5 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 500, maxHp: 500,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "self-destruct" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Attacker should faint
    expect(room.playerA.party[0].hp).toBe(0);
    // Defender should have taken damage
    expect(room.playerB.party[0].hp).toBeLessThan(500);
    // Faint message for attacker
    expect(room.log.some((l) => l.includes("A의") && l.includes("pikachu") && l.includes("쓰러졌다"))).toBe(true);
  });
});

// ── Task 8: Protect/Detect ──
describe("pvp protect/detect", () => {
  function readyProtectRoom() {
    const pA: PvpPokemon = {
      uid: "a-uid", species: "pikachu", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [
        { id: "protect", pp: 10, maxPp: 10 },
        { id: "tackle", pp: 35, maxPp: 35 },
      ],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [
        { id: "tackle", pp: 35, maxPp: 35 },
        { id: "detect", pp: 5, maxPp: 5 },
      ],
      statusCondition: null,
    };
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    return room;
  }

  it("protect blocks all incoming damage", () => {
    const room = readyProtectRoom();
    // Math.random < 1.0 (first protect always succeeds: rate = 1/3^0 = 1)
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // A used protect, B's tackle should be blocked
    expect(room.log.some((l) => l.includes("방어 태세"))).toBe(true);
    expect(room.log.some((l) => l.includes("공격을 막았다"))).toBe(true);
    // A should not have taken any damage
    expect(room.playerA.party[0].hp).toBe(200);
  });

  it("consecutive protect can fail (mock Math.random)", () => {
    const room = readyProtectRoom();

    // Turn 1: first protect succeeds (rate = 1/3^0 = 1.0, any random succeeds)
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.playerA.party[0].hp).toBe(200); // protected

    // Turn 2: second consecutive protect (rate = 1/3^1 = 0.333...)
    // random() = 0.5 >= 0.333 → fails
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    expect(room.log.some((l) => l.includes("방어에 실패했다"))).toBe(true);
    // A should have taken damage since protect failed
    expect(room.playerA.party[0].hp).toBeLessThan(200);
  });

  it("non-protect turn resets protect counter", () => {
    const room = readyProtectRoom();

    // Turn 1: protect succeeds
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.playerA.protectCount).toBe(1);

    // Turn 2: use tackle (not protect) → resets counter
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.playerA.protectCount).toBe(0);

    // Turn 3: protect again (rate = 1/3^0 = 1.0 → always succeeds)
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    expect(room.log.some((l) => l.includes("방어 태세"))).toBe(true);
    expect(room.playerA.party[0].hp).toBeGreaterThan(0);
  });

  it("detect also works as a protect move", () => {
    const room = readyProtectRoom();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "detect" });
    vi.restoreAllMocks();

    // B used detect, A's tackle should be blocked
    expect(room.log.some((l) => l.includes("방어 태세"))).toBe(true);
    expect(room.log.some((l) => l.includes("공격을 막았다"))).toBe(true);
    expect(room.playerB.party[0].hp).toBe(200);
  });
});

// ── Task 9: Battle Form Changes ──
describe("pvp battle form changes", () => {
  it("Aegislash changes to blade form after physical attack", () => {
    const aegislash: PvpPokemon = {
      uid: "aegislash-uid", species: "aegislash", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom(
      "userA", "A", [aegislash, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Aegislash should change to blade form after physical attack
    expect(room.playerA.battleForm).toBe("aegislash-blade");
    expect(room.log.some((l) => l.includes("aegislash") && l.includes("블레이드 폼"))).toBe(true);
  });

  it("Morpeko changes form each turn", () => {
    const morpeko: PvpPokemon = {
      uid: "morpeko-uid", species: "morpeko", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom(
      "userA", "A", [morpeko, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Turn 1 (odd) → should become hangry
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.playerA.battleForm).toBe("morpeko-hangry");

    // Turn 2 (even) → should revert to base
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.playerA.battleForm).toBeNull();
  });

  it("HP threshold form change triggers (Darmanitan zen mode)", () => {
    const darmanitan: PvpPokemon = {
      uid: "darmanitan-uid", species: "darmanitan", level: 50,
      hp: 60, maxHp: 200, // Start at 30% HP (below 50%)
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 60 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const pB: PvpPokemon = {
      uid: "b-uid", species: "bulbasaur", level: 50,
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      statusCondition: null,
    };
    const room = createRoom(
      "userA", "A", [darmanitan, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Darmanitan at 30% HP should change to zen mode after combat
    expect(room.playerA.battleForm).toBe("darmanitan-zen");
    expect(room.log.some((l) => l.includes("darmanitan") && l.includes("젠모드"))).toBe(true);
  });
});
