import { describe, it, expect } from "vitest";
import { calculateElo } from "../../src/pvp/pvp-rating.js";

describe("calculateElo", () => {
  it("equal ratings: winner gains ~16, loser loses ~16", () => {
    const { winnerNew, loserNew } = calculateElo(1000, 1000);
    expect(winnerNew).toBe(1016);
    expect(loserNew).toBe(984);
  });

  it("higher rated winner gains less", () => {
    const { winnerNew, loserNew } = calculateElo(1200, 1000);
    expect(winnerNew).toBeLessThan(1200 + 16);
    expect(winnerNew).toBeGreaterThan(1200);
  });

  it("lower rated winner gains more (upset)", () => {
    const { winnerNew, loserNew } = calculateElo(1000, 1200);
    expect(winnerNew - 1000).toBeGreaterThan(16);
  });

  it("rating never goes below 0", () => {
    const { loserNew } = calculateElo(100, 0);
    expect(loserNew).toBeGreaterThanOrEqual(0);
  });
});
