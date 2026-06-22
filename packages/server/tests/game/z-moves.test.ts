import { describe, it, expect } from "vitest";
import { getZPower } from "../../src/game/z-moves.js";

describe("getZPower — 본가 Z파워 환산표", () => {
  it("≤55 → 100", () => {
    expect(getZPower(0)).toBe(100);
    expect(getZPower(40)).toBe(100);
    expect(getZPower(55)).toBe(100);
  });

  it("60–65 → 120", () => {
    expect(getZPower(60)).toBe(120);
    expect(getZPower(65)).toBe(120);
  });

  it("70–75 → 140", () => {
    expect(getZPower(70)).toBe(140);
    expect(getZPower(75)).toBe(140);
  });

  it("80–85 → 160", () => {
    expect(getZPower(80)).toBe(160);
    expect(getZPower(85)).toBe(160);
  });

  it("90–95 → 175", () => {
    expect(getZPower(90)).toBe(175);
    expect(getZPower(95)).toBe(175);
  });

  it("100 → 180", () => {
    expect(getZPower(100)).toBe(180);
  });

  it("110 → 185", () => {
    expect(getZPower(110)).toBe(185);
  });

  it("120–125 → 190", () => {
    expect(getZPower(120)).toBe(190);
    expect(getZPower(125)).toBe(190);
  });

  it("130 → 195", () => {
    expect(getZPower(130)).toBe(195);
  });

  it("≥140 → 200", () => {
    expect(getZPower(140)).toBe(200);
    expect(getZPower(150)).toBe(200);
    expect(getZPower(250)).toBe(200);
  });

  it("경계값 단조 증가(위력↑ → Z파워 비감소)", () => {
    let prev = 0;
    for (let p = 0; p <= 200; p += 5) {
      const z = getZPower(p);
      expect(z).toBeGreaterThanOrEqual(prev);
      prev = z;
    }
  });
});
