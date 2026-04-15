import { describe, it, expect } from "vitest";
import { resolvePokemonGender, seededGenderRoll } from "../../src/game/pokemon-gender.js";

describe("resolvePokemonGender", () => {
  it("returns genderless when genderRate is undefined", () => {
    expect(resolvePokemonGender(undefined, 0.5)).toBe("genderless");
  });

  it("returns genderless when genderRate is negative", () => {
    expect(resolvePokemonGender(-1, 0.5)).toBe("genderless");
  });

  it("returns male when genderRate is 0 (always male)", () => {
    expect(resolvePokemonGender(0, 0.0)).toBe("male");
    expect(resolvePokemonGender(0, 0.5)).toBe("male");
    expect(resolvePokemonGender(0, 1.0)).toBe("male");
  });

  it("returns female when genderRate is >= 8 (always female)", () => {
    expect(resolvePokemonGender(8, 0.0)).toBe("female");
    expect(resolvePokemonGender(8, 1.0)).toBe("female");
    expect(resolvePokemonGender(10, 0.5)).toBe("female");
  });

  it("returns female when randomValue is below the female threshold", () => {
    // genderRate 4 => threshold = 4/8 = 0.5
    expect(resolvePokemonGender(4, 0.3)).toBe("female");
    expect(resolvePokemonGender(4, 0.49)).toBe("female");
  });

  it("returns male when randomValue is at or above the female threshold", () => {
    // genderRate 4 => threshold = 4/8 = 0.5
    expect(resolvePokemonGender(4, 0.5)).toBe("male");
    expect(resolvePokemonGender(4, 0.9)).toBe("male");
  });

  it("handles genderRate 1 (mostly male)", () => {
    // threshold = 1/8 = 0.125
    expect(resolvePokemonGender(1, 0.1)).toBe("female");
    expect(resolvePokemonGender(1, 0.2)).toBe("male");
  });

  it("handles genderRate 7 (mostly female)", () => {
    // threshold = 7/8 = 0.875
    expect(resolvePokemonGender(7, 0.8)).toBe("female");
    expect(resolvePokemonGender(7, 0.9)).toBe("male");
  });
});

describe("seededGenderRoll", () => {
  it("returns a number between 0 and 1", () => {
    const result = seededGenderRoll("test-seed");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("is deterministic for the same seed", () => {
    const a = seededGenderRoll("same-seed");
    const b = seededGenderRoll("same-seed");
    expect(a).toBe(b);
  });

  it("produces different values for different seeds", () => {
    const a = seededGenderRoll("seed-alpha");
    const b = seededGenderRoll("seed-beta");
    expect(a).not.toBe(b);
  });
});
