import { describe, it, expect } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { chooseAiAction } from "../../src/pvp/pvp-ai.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePoke(species: string, moves: string[], abilityId?: string, heldItem?: string): PvpPokemon {
  return {
    uid: species + "-" + Math.random().toString(36).slice(2, 8),
    species, level: 50,
    hp: 150, maxHp: 150,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 90 },
    moves: moves.map((id) => ({ id, pp: 10, maxPp: 10 })),
    statusCondition: null,
    abilityId: abilityId ?? null,
    heldItem: heldItem ?? null,
  };
}

interface BattleResult {
  winnerId: string | null;
  turns: number;
  result: string;
  finalLog: string[];
}

function runBattle(partyA: PvpPokemon[], partyB: PvpPokemon[], maxTurns = 100): BattleResult {
  const room = createRoom("userA", "Alice", partyA, "userB", "Bob", partyB, true);
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);

  let safetyTurns = 0;
  while (room.phase !== "finished" && safetyTurns < maxTurns) {
    safetyTurns++;
    if (room.phase === "action") {
      const actionA = chooseAiAction(room.playerA, room.playerB);
      const actionB = chooseAiAction(room.playerB, room.playerA);
      submitAction(room, "userA", actionA);
      if (room.phase === "finished") break;
      submitAction(room, "userB", actionB);
    } else if (room.phase === "forced_switch") {
      const needA = room.forcedSwitchNeeded?.a;
      const needB = room.forcedSwitchNeeded?.b;
      let progressed = false;
      if (needA) {
        const idx = room.playerA.party.findIndex((p, i) => i !== room.playerA.activeIndex && p.hp > 0);
        if (idx >= 0) {
          submitAction(room, "userA", { type: "switch", pokemonIndex: idx });
          progressed = true;
        }
      }
      if (needB && room.phase === "forced_switch") {
        const idx = room.playerB.party.findIndex((p, i) => i !== room.playerB.activeIndex && p.hp > 0);
        if (idx >= 0) {
          submitAction(room, "userB", { type: "switch", pokemonIndex: idx });
          progressed = true;
        }
      }
      if (!progressed) break;
    } else {
      break;
    }
  }

  return {
    winnerId: room.result?.winnerId ?? null,
    turns: safetyTurns,
    result: room.result?.reason ?? "timeout",
    finalLog: room.log,
  };
}

describe("AI vs AI battle simulation", () => {
  it("simple battle finishes without errors", () => {
    const partyA = [makePoke("pikachu", ["tackle", "thunderbolt"]), makePoke("charizard", ["flamethrower", "tackle"])];
    const partyB = [makePoke("bulbasaur", ["vine-whip", "tackle"]), makePoke("squirtle", ["water-gun", "tackle"])];
    const result = runBattle(partyA, partyB);
    expect(["ko", "timeout"]).toContain(result.result);
    expect(result.turns).toBeLessThan(100);
  });

  it("battle with abilities and items finishes", () => {
    const partyA = [
      makePoke("gyarados", ["waterfall", "earthquake"], "intimidate", "choice-band"),
      makePoke("alakazam", ["psychic", "focus-blast"], "magic-guard", "life-orb"),
    ];
    const partyB = [
      makePoke("snorlax", ["body-slam", "rest"], "thick-fat", "leftovers"),
      makePoke("gengar", ["hex", "shadow-ball"], "levitate", "choice-specs"),
    ];
    const result = runBattle(partyA, partyB);
    expect(result.turns).toBeLessThan(100);
  });

  it("battle with terrain and screens finishes", () => {
    const partyA = [
      makePoke("tapu-koko", ["electric-terrain", "thunderbolt"], "electric-surge"),
      makePoke("garchomp", ["earthquake", "reflect"]),
    ];
    const partyB = [
      makePoke("metagross", ["light-screen", "meteor-mash"]),
      makePoke("tapu-fini", ["misty-terrain", "moonblast"], "misty-surge"),
    ];
    const result = runBattle(partyA, partyB);
    expect(result.turns).toBeLessThan(100);
  });

  it("battle with status moves finishes", () => {
    const partyA = [
      makePoke("gliscor", ["toxic", "earthquake"], "poison-heal", "toxic-orb"),
      makePoke("chansey", ["soft-boiled", "seismic-toss"], "natural-cure", "leftovers"),
    ];
    const partyB = [
      makePoke("ferrothorn", ["spikes", "stealth-rock"], "iron-barbs"),
      makePoke("gliscor-2", ["substitute", "protect"]),
    ];
    const result = runBattle(partyA, partyB);
    expect(result.turns).toBeLessThan(100);
  });

  it("no infinite loop with switching-prevention", () => {
    const partyA = [makePoke("wobbuffet", ["counter", "mirror-coat"], "shadow-tag")];
    const partyB = [makePoke("gengar", ["shadow-ball", "thunderbolt"], "levitate")];
    const result = runBattle(partyA, partyB);
    expect(result.turns).toBeLessThan(100);
  });

  it("battle with transformations finishes", () => {
    const party = [makePoke("charizard", ["flamethrower", "dragon-pulse"], "blaze", "charizardite-y")];
    const partyA = party.map(p => ({ ...p, uid: p.uid + "-a" }));
    const partyB = party.map(p => ({ ...p, uid: p.uid + "-b" }));
    // Note: mega form must be pre-computed. This test checks the engine doesn't crash.
    const result = runBattle(partyA, partyB, 50);
    expect(result.turns).toBeLessThan(50);
  });

  it("runs 20 random matchups without errors", () => {
    const species = ["pikachu", "charizard", "gengar", "alakazam", "snorlax", "gyarados"];
    const moves = ["tackle", "ember", "thunder-shock", "water-gun", "vine-whip", "psychic", "shadow-ball", "ice-beam"];
    const abilities = ["intimidate", "levitate", "blaze", "multiscale", "regenerator"];
    const items: (string | null)[] = ["leftovers", "life-orb", "choice-band", "focus-sash", null];

    for (let i = 0; i < 20; i++) {
      const randPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
      const partyA = [
        makePoke(randPick(species), [randPick(moves), randPick(moves)], randPick(abilities), randPick(items) ?? undefined),
        makePoke(randPick(species) + "-2a", [randPick(moves), randPick(moves)], randPick(abilities), randPick(items) ?? undefined),
      ];
      const partyB = [
        makePoke(randPick(species) + "-b", [randPick(moves), randPick(moves)], randPick(abilities), randPick(items) ?? undefined),
        makePoke(randPick(species) + "-2b", [randPick(moves), randPick(moves)], randPick(abilities), randPick(items) ?? undefined),
      ];
      const result = runBattle(partyA, partyB, 100);
      expect(result.turns).toBeLessThan(100);
      expect(result.finalLog).toBeDefined();
    }
  });
});

describe("edge case scenarios", () => {
  it("double KO at end of turn doesn't crash", () => {
    const partyA = [makePoke("pikachu", ["explosion"])];
    const partyB = [makePoke("bulbasaur", ["explosion"])];
    const result = runBattle(partyA, partyB, 10);
    expect(result.turns).toBeLessThan(10);
  });

  it("switch-prevention + forced KO works correctly", () => {
    const partyA = [
      makePoke("wobbuffet", ["counter"], "shadow-tag"),
      makePoke("alakazam", ["psychic"]),
    ];
    const partyB = [
      makePoke("gengar", ["shadow-ball", "hex"], "levitate"),
      makePoke("pikachu", ["thunderbolt"]),
    ];
    const result = runBattle(partyA, partyB, 50);
    expect(result.turns).toBeLessThan(50);
  });

  it("all pokemon fainted triggers finish", () => {
    const partyA = [makePoke("pikachu", ["tackle"], undefined, "focus-sash")];
    const partyB = [makePoke("garchomp", ["earthquake"])];
    const result = runBattle(partyA, partyB, 30);
    expect(result.turns).toBeLessThan(30);
    expect(["ko", "timeout"]).toContain(result.result);
  });

  it("party of 6 battle works", () => {
    // NOTE: Species Clause might filter duplicates - use unique species
    const uniqueA = ["pikachu", "charizard", "gengar", "alakazam", "snorlax", "gyarados"].map(s => makePoke(s, ["tackle"]));
    const uniqueB = ["bulbasaur", "squirtle", "rattata", "eevee", "jolteon", "flareon"].map(s => makePoke(s, ["tackle"]));
    const result = runBattle(uniqueA, uniqueB, 100);
    expect(result.turns).toBeLessThan(100);
  });
});
