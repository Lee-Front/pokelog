import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateCaptureChance, attemptCapture, getCatchRate } from "../../src/game/capture.js";

describe("calculateCaptureChance", () => {
  it("pokeball(1.0) + HP 100% + catchRate 0.3 = 0.3", () => {
    // chance = min(1.0, 1.0 * (1 - 100/100) * 0.5 + 0.3) = min(1.0, 0 + 0.3) = 0.3
    const chance = calculateCaptureChance(1.0, 100, 100, 0.3);
    expect(chance).toBeCloseTo(0.3);
  });

  it("hyperball(2.0) + HP 10% + catchRate 0.3 = 1.0 (clamped)", () => {
    // chance = min(1.0, 2.0 * (1 - 10/100) * 0.5 + 0.3) = min(1.0, 2.0 * 0.9 * 0.5 + 0.3) = min(1.0, 0.9 + 0.3) = 1.0
    const chance = calculateCaptureChance(2.0, 10, 100, 0.3);
    expect(chance).toBeCloseTo(1.0);
  });

  it("pokeball(1.0) + HP 30% + catchRate 0.3 = 0.65", () => {
    // chance = min(1.0, 1.0 * (1 - 30/100) * 0.5 + 0.3) = min(1.0, 0.7 * 0.5 + 0.3) = min(1.0, 0.35 + 0.3) = 0.65
    const chance = calculateCaptureChance(1.0, 30, 100, 0.3);
    expect(chance).toBeCloseTo(0.65);
  });

  it("result never exceeds 1.0", () => {
    const chance = calculateCaptureChance(3.0, 5, 100, 0.8);
    expect(chance).toBeLessThanOrEqual(1.0);
  });
});

describe("attemptCapture", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("captures when random < chance", () => {
    randomSpy.mockReturnValueOnce(0.1);
    expect(attemptCapture(1.0, 30, 100, 0.3)).toBe(true);
  });

  it("fails when random >= chance", () => {
    randomSpy.mockReturnValueOnce(0.99);
    expect(attemptCapture(1.0, 100, 100, 0.3)).toBe(false);
  });
});

describe("getCatchRate", () => {
  it("returns catch rate for known species", () => {
    const rate = getCatchRate("bulbasaur");
    expect(rate).toBe(0.12);
  });

  it("returns default 0.1 for unknown species", () => {
    const rate = getCatchRate("unknown_pokemon");
    expect(rate).toBe(0.1);
  });
});
