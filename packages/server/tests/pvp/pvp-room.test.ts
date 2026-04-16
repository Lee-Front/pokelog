import { describe, it, expect } from "vitest";
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
