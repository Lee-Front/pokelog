import { describe, it, expect } from "vitest";
import {
  getWeatherFromMove,
  getWeatherTypeModifier,
  getWeatherDamage,
  tickWeather,
} from "../../src/game/weather.js";

describe("weather", () => {
  describe("getWeatherFromMove", () => {
    it("sunny-day sets sun", () => {
      expect(getWeatherFromMove("sunny-day")).toBe("sun");
    });

    it("rain-dance sets rain", () => {
      expect(getWeatherFromMove("rain-dance")).toBe("rain");
    });

    it("hail sets hail", () => {
      expect(getWeatherFromMove("hail")).toBe("hail");
    });

    it("sandstorm sets sandstorm", () => {
      expect(getWeatherFromMove("sandstorm")).toBe("sandstorm");
    });

    it("returns null for non-weather moves", () => {
      expect(getWeatherFromMove("tackle")).toBeNull();
      expect(getWeatherFromMove("thunderbolt")).toBeNull();
      expect(getWeatherFromMove("flamethrower")).toBeNull();
    });
  });

  describe("getWeatherTypeModifier", () => {
    it("sun boosts fire to 1.5x", () => {
      expect(getWeatherTypeModifier("sun", "fire")).toBe(1.5);
    });

    it("sun weakens water to 0.5x", () => {
      expect(getWeatherTypeModifier("sun", "water")).toBe(0.5);
    });

    it("rain boosts water to 1.5x", () => {
      expect(getWeatherTypeModifier("rain", "water")).toBe(1.5);
    });

    it("rain weakens fire to 0.5x", () => {
      expect(getWeatherTypeModifier("rain", "fire")).toBe(0.5);
    });

    it("sun does not affect other types", () => {
      expect(getWeatherTypeModifier("sun", "grass")).toBe(1.0);
      expect(getWeatherTypeModifier("sun", "electric")).toBe(1.0);
    });

    it("rain does not affect other types", () => {
      expect(getWeatherTypeModifier("rain", "normal")).toBe(1.0);
    });

    it("hail has no type modifier", () => {
      expect(getWeatherTypeModifier("hail", "fire")).toBe(1.0);
      expect(getWeatherTypeModifier("hail", "ice")).toBe(1.0);
    });

    it("sandstorm has no type modifier", () => {
      expect(getWeatherTypeModifier("sandstorm", "rock")).toBe(1.0);
      expect(getWeatherTypeModifier("sandstorm", "ground")).toBe(1.0);
    });
  });

  describe("getWeatherDamage", () => {
    const maxHp = 160;

    it("hail damages non-ice types (1/16 maxHp)", () => {
      expect(getWeatherDamage("hail", ["fire"], maxHp)).toBe(10);
      expect(getWeatherDamage("hail", ["normal"], maxHp)).toBe(10);
    });

    it("hail does not damage ice types", () => {
      expect(getWeatherDamage("hail", ["ice"], maxHp)).toBe(0);
      expect(getWeatherDamage("hail", ["water", "ice"], maxHp)).toBe(0);
    });

    it("sandstorm damages non-rock/ground/steel types", () => {
      expect(getWeatherDamage("sandstorm", ["fire"], maxHp)).toBe(10);
      expect(getWeatherDamage("sandstorm", ["normal", "flying"], maxHp)).toBe(10);
    });

    it("sandstorm does not damage rock, ground, or steel types", () => {
      expect(getWeatherDamage("sandstorm", ["rock"], maxHp)).toBe(0);
      expect(getWeatherDamage("sandstorm", ["ground"], maxHp)).toBe(0);
      expect(getWeatherDamage("sandstorm", ["steel"], maxHp)).toBe(0);
      expect(getWeatherDamage("sandstorm", ["fire", "rock"], maxHp)).toBe(0);
    });

    it("sun does no chip damage", () => {
      expect(getWeatherDamage("sun", ["fire"], maxHp)).toBe(0);
      expect(getWeatherDamage("sun", ["grass"], maxHp)).toBe(0);
    });

    it("rain does no chip damage", () => {
      expect(getWeatherDamage("rain", ["water"], maxHp)).toBe(0);
      expect(getWeatherDamage("rain", ["fire"], maxHp)).toBe(0);
    });

    it("returns at least 1 damage for small maxHp", () => {
      expect(getWeatherDamage("hail", ["fire"], 10)).toBe(1);
    });
  });

  describe("tickWeather", () => {
    it("decrements turns", () => {
      const result = tickWeather("sun", 3);
      expect(result.weather).toBe("sun");
      expect(result.turns).toBe(2);
      expect(result.expired).toBe(false);
    });

    it("expires at 1 turn remaining", () => {
      const result = tickWeather("rain", 1);
      expect(result.weather).toBeUndefined();
      expect(result.turns).toBeUndefined();
      expect(result.expired).toBe(true);
    });

    it("returns no weather when called with undefined", () => {
      const result = tickWeather(undefined, undefined);
      expect(result.weather).toBeUndefined();
      expect(result.turns).toBeUndefined();
      expect(result.expired).toBe(false);
    });

    it("counts down from 5 to expiry over 5 ticks", () => {
      let weather: "sun" | undefined = "sun";
      let turns: number | undefined = 5;

      for (let i = 0; i < 4; i++) {
        const result = tickWeather(weather, turns);
        expect(result.expired).toBe(false);
        weather = result.weather as "sun";
        turns = result.turns;
      }

      const finalResult = tickWeather(weather, turns);
      expect(finalResult.expired).toBe(true);
      expect(finalResult.weather).toBeUndefined();
    });
  });
});
