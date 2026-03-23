import { describe, it, expect } from "vitest";
import {
  getExpForLevel,
  checkLevelUp,
  calculateStatsForLevel,
  checkEvolution,
} from "../../src/game/growth.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

describe("getExpForLevel", () => {
  it("level 1 = 1", () => {
    expect(getExpForLevel(1)).toBe(1);
  });

  it("level 10 = 1000", () => {
    expect(getExpForLevel(10)).toBe(1000);
  });

  it("level 100 = 1000000", () => {
    expect(getExpForLevel(100)).toBe(1000000);
  });
});

describe("checkLevelUp", () => {
  it("detects level up when exp is sufficient", () => {
    const pokemon: OwnedPokemon = {
      uid: "test-uid",
      species: "charmander",
      nickname: null,
      level: 5,
      exp: 216, // 6^3 = 216 → should level up to 6
      hp: 30,
      maxHp: 30,
      stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
      moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
      caughtAt: "2024-01-01T00:00:00Z",
    };

    const result = checkLevelUp(pokemon);
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(6);
  });

  it("does not level up when exp is insufficient", () => {
    const pokemon: OwnedPokemon = {
      uid: "test-uid",
      species: "charmander",
      nickname: null,
      level: 5,
      exp: 100, // 6^3 = 216, not enough
      hp: 30,
      maxHp: 30,
      stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
      moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
      caughtAt: "2024-01-01T00:00:00Z",
    };

    const result = checkLevelUp(pokemon);
    expect(result.leveled).toBe(false);
    expect(result.newLevel).toBe(5);
  });

  it("can level up multiple times at once", () => {
    const pokemon: OwnedPokemon = {
      uid: "test-uid",
      species: "charmander",
      nickname: null,
      level: 5,
      exp: 1000, // 10^3 = 1000 → should level up to 10
      hp: 30,
      maxHp: 30,
      stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
      moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
      caughtAt: "2024-01-01T00:00:00Z",
    };

    const result = checkLevelUp(pokemon);
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(10);
  });

  it("reports new moves learned at gained levels", () => {
    // charmander learns ember at level 5
    const pokemon: OwnedPokemon = {
      uid: "test-uid",
      species: "charmander",
      nickname: null,
      level: 4,
      exp: 125, // 5^3 = 125 → level up to 5
      hp: 30,
      maxHp: 30,
      stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
      moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
      caughtAt: "2024-01-01T00:00:00Z",
    };

    const result = checkLevelUp(pokemon);
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(5);
    expect(result.newMoves).toContain("ember");
  });
});

describe("calculateStatsForLevel", () => {
  it("calculates HP correctly", () => {
    // charmander: baseHp=39, level=10
    // HP = floor(((39 * 2 * 10) / 100) + 10 + 10) = floor(7.8 + 20) = floor(27.8) = 27
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.hp).toBe(27);
    expect(result.maxHp).toBe(27);
  });

  it("calculates attack stat correctly", () => {
    // charmander: baseAttack=52, level=10
    // attack = floor(((52 * 2 * 10) / 100) + 5) = floor(10.4 + 5) = floor(15.4) = 15
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.stats.attack).toBe(15);
  });

  it("calculates speed stat correctly", () => {
    // charmander: baseSpeed=65, level=10
    // speed = floor(((65 * 2 * 10) / 100) + 5) = floor(13 + 5) = 18
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.stats.speed).toBe(18);
  });
});

describe("checkEvolution", () => {
  it("returns evolution target when level is met (charmander at 16 → charmeleon)", () => {
    expect(checkEvolution("charmander", 16)).toBe("charmeleon");
  });

  it("returns null when level is not met (charmander at 15)", () => {
    expect(checkEvolution("charmander", 15)).toBeNull();
  });

  it("returns null for species with no evolution", () => {
    expect(checkEvolution("caterpie", 50)).toBeNull();
  });

  it("returns null for unknown species", () => {
    expect(checkEvolution("unknown_pokemon", 50)).toBeNull();
  });

  it("returns null for item-based evolution even at high level", () => {
    // pikachu evolves via thunder-stone, not level
    expect(checkEvolution("pikachu", 99)).toBeNull();
  });
});
