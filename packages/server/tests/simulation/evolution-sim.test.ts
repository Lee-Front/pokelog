import { describe, it, expect } from "vitest";
import { getSpeciesByName } from "../../src/game/data-loader.js";
import { getEvolutionBranches, resolveEvolution, resolveTradeEvolution } from "../../src/game/growth.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

/**
 * Evolution simulation tests:
 * Compare actual game data against well-known Bulbapedia facts
 * for three representative Pokemon chains.
 *
 * API notes:
 * - createPokemon(species, level) uses positional args.
 * - resolveEvolution(species, context) returns the first matching EvolutionBranch
 *   for level-up / use-item triggers (trade is handled separately).
 * - resolveTradeEvolution(species, context) handles trade triggers.
 * - EvolutionCheckContext uses `usedItem` (item id) and `timeOfDay` ("day" | "night").
 */

function simulateLevelUp(
  pokemon: OwnedPokemon,
  targetLevel: number,
): { evolutions: Array<{ fromLv: number; to: string }>; finalSpecies: string } {
  const evolutions: Array<{ fromLv: number; to: string }> = [];
  while (pokemon.level < targetLevel) {
    pokemon.level += 1;
    const branch = resolveEvolution(pokemon.species, { level: pokemon.level });
    if (branch) {
      evolutions.push({ fromLv: pokemon.level, to: branch.targetSpecies });
      pokemon.species = branch.targetSpecies;
    }
  }
  return { evolutions, finalSpecies: pokemon.species };
}

describe("Evolution Simulation — 이상해씨 계열", () => {
  it("bulbasaur → ivysaur at Lv.16, → venusaur at Lv.32", () => {
    const poke = createPokemon("bulbasaur", 5);

    const result = simulateLevelUp(poke, 40);

    expect(result.evolutions.length).toBe(2);
    expect(result.evolutions[0]).toEqual({ fromLv: 16, to: "ivysaur" });
    expect(result.evolutions[1]).toEqual({ fromLv: 32, to: "venusaur" });
    expect(result.finalSpecies).toBe("venusaur");
  });

  it("venusaur Lv.1 learnset includes petal-dance and vine-whip", () => {
    const sp = getSpeciesByName("venusaur");
    expect(sp).toBeDefined();
    const lv1Moves = sp!.learnset.levelUp["1"];
    expect(lv1Moves).toContain("petal-dance");
    expect(lv1Moves).toContain("vine-whip");
  });

  it("bulbasaur TM list includes expected moves (Gen 8-9)", () => {
    const sp = getSpeciesByName("bulbasaur");
    // Note: solar-beam is NOT in bulbasaur's TM list in this dataset
    // (it was previously TM22 in classic gens but removed / replaced with other moves).
    expect(sp?.learnset.tm).toContain("sludge-bomb");
    expect(sp?.learnset.tm).toContain("tera-blast"); // Gen 9
    expect(sp?.learnset.tm).toContain("grass-knot");
    expect(sp?.learnset.tm).toContain("energy-ball");
  });
});

describe("Evolution Simulation — 이브이 계열", () => {
  it("eevee evolves into vaporeon via water-stone", () => {
    const poke = createPokemon("eevee", 10);

    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      usedItem: "water-stone",
    });

    expect(branch).not.toBeNull();
    expect(branch!.targetSpecies).toBe("vaporeon");
  });

  it("eevee evolves into jolteon via thunder-stone", () => {
    const poke = createPokemon("eevee", 10);
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      usedItem: "thunder-stone",
    });
    expect(branch?.targetSpecies).toBe("jolteon");
  });

  it("eevee evolves into flareon via fire-stone", () => {
    const poke = createPokemon("eevee", 10);
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      usedItem: "fire-stone",
    });
    expect(branch?.targetSpecies).toBe("flareon");
  });

  it("eevee evolves into leafeon via leaf-stone", () => {
    const poke = createPokemon("eevee", 10);
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      usedItem: "leaf-stone",
    });
    expect(branch?.targetSpecies).toBe("leafeon");
  });

  it("eevee evolves into glaceon via ice-stone", () => {
    const poke = createPokemon("eevee", 10);
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      usedItem: "ice-stone",
    });
    expect(branch?.targetSpecies).toBe("glaceon");
  });

  it("eevee evolves into espeon with high friendship during day", () => {
    const poke = createPokemon("eevee", 20);
    poke.friendship = 220;
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      friendship: poke.friendship,
      timeOfDay: "day",
    });
    expect(branch?.targetSpecies).toBe("espeon");
  });

  it("eevee evolves into umbreon with high friendship during night", () => {
    const poke = createPokemon("eevee", 20);
    poke.friendship = 220;
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      friendship: poke.friendship,
      timeOfDay: "night",
    });
    expect(branch?.targetSpecies).toBe("umbreon");
  });

  it("eevee does NOT evolve at low friendship regardless of time", () => {
    const poke = createPokemon("eevee", 20);
    poke.friendship = 50;
    const day = resolveEvolution(poke.species, {
      level: poke.level,
      friendship: poke.friendship,
      timeOfDay: "day",
    });
    const night = resolveEvolution(poke.species, {
      level: poke.level,
      friendship: poke.friendship,
      timeOfDay: "night",
    });
    expect(day).toBeNull();
    expect(night).toBeNull();
  });

  it("eevee evolves into sylveon with fairy-type move and high friendship", () => {
    const poke = createPokemon("eevee", 20);
    poke.friendship = 220;
    // Known fairy move (e.g. fairy-wind) — uses sylveon branch 2 (no affection requirement).
    const branch = resolveEvolution(poke.species, {
      level: poke.level,
      friendship: poke.friendship,
      knownMoveTypes: ["fairy"],
      // Neither day nor night set, so espeon/umbreon branches fail the time condition,
      // leaving sylveon as the match.
    });
    expect(branch?.targetSpecies).toBe("sylveon");
  });

  it("all 8 eevee evolutions exist in species data", () => {
    const evos = ["vaporeon", "jolteon", "flareon", "espeon", "umbreon", "leafeon", "glaceon", "sylveon"];
    for (const evo of evos) {
      const sp = getSpeciesByName(evo);
      expect(sp, `${evo} should exist`).toBeDefined();
      expect(sp?.baseStats).toBeDefined();
    }
  });
});

describe("Evolution Simulation — 팬텀 계열", () => {
  it("gastly evolves to haunter at Lv.25", () => {
    const poke = createPokemon("gastly", 10);

    const result = simulateLevelUp(poke, 30);

    expect(result.evolutions.length).toBe(1);
    expect(result.evolutions[0]).toEqual({ fromLv: 25, to: "haunter" });
    expect(result.finalSpecies).toBe("haunter");
  });

  it("haunter → gengar requires trade (not level-up)", () => {
    const poke = createPokemon("haunter", 30);

    const levelResult = simulateLevelUp(poke, 100);
    expect(levelResult.finalSpecies).toBe("haunter"); // no level-up evolution

    // Trade evolution path
    const tradeBranch = resolveTradeEvolution(poke.species);
    expect(tradeBranch?.targetSpecies).toBe("gengar");
  });

  it("gengar's levelUp moveset includes signature moves", () => {
    const sp = getSpeciesByName("gengar");
    expect(sp).toBeDefined();
    const allLevelUpMoves = Object.values(sp!.learnset.levelUp).flat();
    expect(allLevelUpMoves).toContain("shadow-ball");
    expect(allLevelUpMoves).toContain("hex");
    expect(allLevelUpMoves).toContain("hypnosis");
  });
});

describe("Evolution Simulation — 요약", () => {
  it("모든 포켓몬이 진화 데이터를 보유", () => {
    const bulbasaur = getEvolutionBranches("bulbasaur");
    const eevee = getEvolutionBranches("eevee");
    const gastly = getEvolutionBranches("gastly");
    expect(bulbasaur.length).toBeGreaterThan(0);
    // 8+ branches (some evolutions have multiple branches for different regions/stones).
    expect(eevee.length).toBeGreaterThanOrEqual(8);
    expect(gastly.length).toBe(1);
  });
});

describe("Evolution Simulation — Gen 9 스프리가티토 계열", () => {
  it("sprigatito → floragato at Lv.16 → meowscarada at Lv.36", () => {
    const poke = createPokemon("sprigatito", 5);
    const result = simulateLevelUp(poke, 40);

    expect(result.evolutions.length).toBe(2);
    expect(result.evolutions[0]).toEqual({ fromLv: 16, to: "floragato" });
    expect(result.evolutions[1]).toEqual({ fromLv: 36, to: "meowscarada" });
    expect(result.finalSpecies).toBe("meowscarada");
  });

  it("meowscarada species exists in data", () => {
    const sp = getSpeciesByName("meowscarada");
    expect(sp).toBeDefined();
    expect(sp?.types).toContain("grass");
    expect(sp?.types).toContain("dark");
  });
});

describe("Evolution Simulation — Gen 9 푸에코코 계열", () => {
  it("fuecoco → crocalor at Lv.16 → skeledirge at Lv.36", () => {
    const poke = createPokemon("fuecoco", 5);
    const result = simulateLevelUp(poke, 40);

    expect(result.evolutions.length).toBe(2);
    expect(result.evolutions[0]).toEqual({ fromLv: 16, to: "crocalor" });
    expect(result.evolutions[1]).toEqual({ fromLv: 36, to: "skeledirge" });
    expect(result.finalSpecies).toBe("skeledirge");
  });

  it("skeledirge species exists in data", () => {
    const sp = getSpeciesByName("skeledirge");
    expect(sp).toBeDefined();
    expect(sp?.types).toContain("fire");
    expect(sp?.types).toContain("ghost");
  });
});

describe("Evolution Simulation — Gen 9 쿠아쿠아바 계열", () => {
  it("quaxly → quaxwell at Lv.16 → quaquaval at Lv.36", () => {
    const poke = createPokemon("quaxly", 5);
    const result = simulateLevelUp(poke, 40);

    expect(result.evolutions.length).toBe(2);
    expect(result.evolutions[0]).toEqual({ fromLv: 16, to: "quaxwell" });
    expect(result.evolutions[1]).toEqual({ fromLv: 36, to: "quaquaval" });
    expect(result.finalSpecies).toBe("quaquaval");
  });

  it("quaquaval species exists in data", () => {
    const sp = getSpeciesByName("quaquaval");
    expect(sp).toBeDefined();
    expect(sp?.types).toContain("water");
    expect(sp?.types).toContain("fighting");
  });
});
