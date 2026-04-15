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
});
