import { describe, it, expect } from "vitest";
import {
  getTerrainFromMove,
  getTerrainTypeModifier,
  getTerrainHeal,
  terrainBlocksStatus,
  isGrounded,
  tickTerrain,
} from "../../src/game/terrain.js";

describe("terrain", () => {
  describe("getTerrainFromMove", () => {
    it("electric-terrain sets electric", () => {
      expect(getTerrainFromMove("electric-terrain")).toBe("electric");
    });

    it("grassy-terrain sets grassy", () => {
      expect(getTerrainFromMove("grassy-terrain")).toBe("grassy");
    });

    it("misty-terrain sets misty", () => {
      expect(getTerrainFromMove("misty-terrain")).toBe("misty");
    });

    it("psychic-terrain sets psychic", () => {
      expect(getTerrainFromMove("psychic-terrain")).toBe("psychic");
    });

    it("returns null for non-terrain moves", () => {
      expect(getTerrainFromMove("tackle")).toBeNull();
      expect(getTerrainFromMove("sunny-day")).toBeNull();
    });
  });

  describe("isGrounded", () => {
    it("non-flying types are grounded", () => {
      expect(isGrounded(["electric"])).toBe(true);
      expect(isGrounded(["grass", "poison"])).toBe(true);
    });

    it("flying types are not grounded", () => {
      expect(isGrounded(["flying"])).toBe(false);
      expect(isGrounded(["normal", "flying"])).toBe(false);
    });
  });

  describe("getTerrainTypeModifier", () => {
    it("electric boosts electric moves to 1.3x when attacker grounded", () => {
      expect(getTerrainTypeModifier("electric", "electric", true, true)).toBe(1.3);
    });

    it("electric does not boost when attacker not grounded", () => {
      expect(getTerrainTypeModifier("electric", "electric", false, true)).toBe(1.0);
    });

    it("grassy boosts grass moves to 1.3x when attacker grounded", () => {
      expect(getTerrainTypeModifier("grassy", "grass", true, true)).toBe(1.3);
      expect(getTerrainTypeModifier("grassy", "grass", false, true)).toBe(1.0);
    });

    it("psychic boosts psychic moves to 1.3x when attacker grounded", () => {
      expect(getTerrainTypeModifier("psychic", "psychic", true, true)).toBe(1.3);
      expect(getTerrainTypeModifier("psychic", "psychic", false, true)).toBe(1.0);
    });

    it("misty halves dragon moves to 0.5x when target grounded", () => {
      expect(getTerrainTypeModifier("misty", "dragon", true, true)).toBe(0.5);
      expect(getTerrainTypeModifier("misty", "dragon", true, false)).toBe(1.0);
    });

    it("does not affect unrelated move types", () => {
      expect(getTerrainTypeModifier("electric", "water", true, true)).toBe(1.0);
      expect(getTerrainTypeModifier("grassy", "fire", true, true)).toBe(1.0);
      expect(getTerrainTypeModifier("psychic", "normal", true, true)).toBe(1.0);
      expect(getTerrainTypeModifier("misty", "fire", true, true)).toBe(1.0);
    });
  });

  describe("getTerrainHeal", () => {
    const maxHp = 160;

    it("grassy heals grounded pokemon 1/16 maxHp", () => {
      expect(getTerrainHeal("grassy", ["grass"], maxHp)).toBe(10);
    });

    it("grassy does not heal non-grounded (flying) pokemon", () => {
      expect(getTerrainHeal("grassy", ["flying"], maxHp)).toBe(0);
    });

    it("non-grassy terrains do not heal", () => {
      expect(getTerrainHeal("electric", ["grass"], maxHp)).toBe(0);
      expect(getTerrainHeal("misty", ["grass"], maxHp)).toBe(0);
      expect(getTerrainHeal("psychic", ["grass"], maxHp)).toBe(0);
    });

    it("returns at least 1 heal for small maxHp", () => {
      expect(getTerrainHeal("grassy", ["grass"], 10)).toBe(1);
    });
  });

  describe("terrainBlocksStatus", () => {
    it("electric blocks sleep on grounded target only", () => {
      expect(terrainBlocksStatus("electric", "sleep", true)).toBe(true);
      expect(terrainBlocksStatus("electric", "sleep", false)).toBe(false);
      expect(terrainBlocksStatus("electric", "burn", true)).toBe(false);
    });

    it("misty blocks all primary statuses on grounded target", () => {
      expect(terrainBlocksStatus("misty", "poison", true)).toBe(true);
      expect(terrainBlocksStatus("misty", "burn", true)).toBe(true);
      expect(terrainBlocksStatus("misty", "paralysis", true)).toBe(true);
      expect(terrainBlocksStatus("misty", "sleep", true)).toBe(true);
      expect(terrainBlocksStatus("misty", "freeze", true)).toBe(true);
    });

    it("misty does not block on non-grounded target", () => {
      expect(terrainBlocksStatus("misty", "poison", false)).toBe(false);
    });

    it("grassy and psychic do not block status", () => {
      expect(terrainBlocksStatus("grassy", "sleep", true)).toBe(false);
      expect(terrainBlocksStatus("psychic", "sleep", true)).toBe(false);
    });

    it("undefined terrain blocks nothing", () => {
      expect(terrainBlocksStatus(undefined, "sleep", true)).toBe(false);
    });
  });

  describe("tickTerrain", () => {
    it("decrements turns", () => {
      const result = tickTerrain("electric", 3);
      expect(result.terrain).toBe("electric");
      expect(result.turns).toBe(2);
      expect(result.expired).toBe(false);
    });

    it("expires at 1 turn remaining", () => {
      const result = tickTerrain("grassy", 1);
      expect(result.terrain).toBeUndefined();
      expect(result.turns).toBeUndefined();
      expect(result.expired).toBe(true);
    });

    it("returns no terrain when called with undefined", () => {
      const result = tickTerrain(undefined, undefined);
      expect(result.terrain).toBeUndefined();
      expect(result.turns).toBeUndefined();
      expect(result.expired).toBe(false);
    });

    it("counts down from 5 to expiry over 5 ticks", () => {
      let terrain: "electric" | undefined = "electric";
      let turns: number | undefined = 5;

      for (let i = 0; i < 4; i++) {
        const result = tickTerrain(terrain, turns);
        expect(result.expired).toBe(false);
        terrain = result.terrain as "electric";
        turns = result.turns;
      }

      const finalResult = tickTerrain(terrain, turns);
      expect(finalResult.expired).toBe(true);
      expect(finalResult.terrain).toBeUndefined();
    });
  });
});
