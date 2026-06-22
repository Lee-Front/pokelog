import { describe, it, expect } from "vitest";
import {
  getHeldOffenseMultiplier,
  getHeldSpDefMultiplier,
  applyLifeOrbRecoil,
  tryFocusSurvive,
  applyHeldEndOfTurnHeal,
  maybeConsumePinchBerry,
  quickClawTriggers,
  type HeldItemHolder,
} from "../../src/game/held-item-battle.js";

function holder(over: Partial<HeldItemHolder> = {}): HeldItemHolder {
  return { heldItem: null, hp: 100, maxHp: 100, species: "test", ...over };
}

describe("held-item-battle", () => {
  describe("getHeldOffenseMultiplier", () => {
    it("no item → 1", () => {
      expect(getHeldOffenseMultiplier(holder(), "physical", true)).toBe(1);
    });
    it("life-orb → 1.3", () => {
      expect(getHeldOffenseMultiplier(holder({ heldItem: "life-orb" }), "special", false)).toBeCloseTo(1.3);
    });
    it("muscle-band only boosts physical", () => {
      expect(getHeldOffenseMultiplier(holder({ heldItem: "muscle-band" }), "physical", false)).toBeCloseTo(1.1);
      expect(getHeldOffenseMultiplier(holder({ heldItem: "muscle-band" }), "special", false)).toBe(1);
    });
    it("wise-glasses only boosts special", () => {
      expect(getHeldOffenseMultiplier(holder({ heldItem: "wise-glasses" }), "special", false)).toBeCloseTo(1.1);
      expect(getHeldOffenseMultiplier(holder({ heldItem: "wise-glasses" }), "physical", false)).toBe(1);
    });
    it("expert-belt only boosts super-effective", () => {
      expect(getHeldOffenseMultiplier(holder({ heldItem: "expert-belt" }), "physical", true)).toBeCloseTo(1.2);
      expect(getHeldOffenseMultiplier(holder({ heldItem: "expert-belt" }), "physical", false)).toBe(1);
    });
  });

  describe("getHeldSpDefMultiplier", () => {
    it("assault-vest boosts SpDef vs special only", () => {
      expect(getHeldSpDefMultiplier(holder({ heldItem: "assault-vest" }), "special")).toBe(1.5);
      expect(getHeldSpDefMultiplier(holder({ heldItem: "assault-vest" }), "physical")).toBe(1);
    });
    it("no item → 1", () => {
      expect(getHeldSpDefMultiplier(holder(), "special")).toBe(1);
    });
  });

  describe("applyLifeOrbRecoil", () => {
    it("holder loses maxHp/10 (min 1)", () => {
      const p = holder({ heldItem: "life-orb", hp: 100, maxHp: 100 });
      const log: string[] = [];
      applyLifeOrbRecoil(p, log);
      expect(p.hp).toBe(90);
      expect(log.length).toBe(1);
    });
    it("no-op without life-orb", () => {
      const p = holder({ hp: 100, maxHp: 100 });
      const log: string[] = [];
      applyLifeOrbRecoil(p, log);
      expect(p.hp).toBe(100);
      expect(log).toHaveLength(0);
    });
    it("no-op if fainted", () => {
      const p = holder({ heldItem: "life-orb", hp: 0, maxHp: 100 });
      applyLifeOrbRecoil(p, []);
      expect(p.hp).toBe(0);
    });
  });

  describe("tryFocusSurvive", () => {
    it("focus-sash from full HP survives KO with 1 HP and consumes", () => {
      const p = holder({ heldItem: "focus-sash", hp: 100, maxHp: 100 });
      const r = tryFocusSurvive(p, 250, true, () => 0);
      expect(r.kind).toBe("focus-sash");
      expect(r.finalDamage).toBe(99);
      expect(r.consumed).toBe(true);
    });
    it("focus-sash does NOT trigger when not at full HP", () => {
      const p = holder({ heldItem: "focus-sash", hp: 90, maxHp: 100 });
      const r = tryFocusSurvive(p, 250, false, () => 0);
      expect(r.kind).toBeNull();
      expect(r.finalDamage).toBe(250);
    });
    it("focus-band survives on 10% roll, not consumed", () => {
      const p = holder({ heldItem: "focus-band", hp: 50, maxHp: 100 });
      const hit = tryFocusSurvive(p, 60, false, () => 0.05);
      expect(hit.kind).toBe("focus-band");
      expect(hit.finalDamage).toBe(49);
      expect(hit.consumed).toBe(false);
      const miss = tryFocusSurvive(p, 60, false, () => 0.5);
      expect(miss.kind).toBeNull();
    });
    it("non-lethal damage passes through unchanged", () => {
      const p = holder({ heldItem: "focus-sash", hp: 100, maxHp: 100 });
      const r = tryFocusSurvive(p, 30, true, () => 0);
      expect(r.kind).toBeNull();
      expect(r.finalDamage).toBe(30);
    });
  });

  describe("applyHeldEndOfTurnHeal", () => {
    it("leftovers heals maxHp/16", () => {
      const p = holder({ heldItem: "leftovers", hp: 50, maxHp: 160 });
      applyHeldEndOfTurnHeal(p, []);
      expect(p.hp).toBe(60);
    });
    it("no-op at full HP", () => {
      const p = holder({ heldItem: "leftovers", hp: 100, maxHp: 100 });
      applyHeldEndOfTurnHeal(p, []);
      expect(p.hp).toBe(100);
    });
    it("caps at maxHp", () => {
      const p = holder({ heldItem: "leftovers", hp: 99, maxHp: 100 });
      applyHeldEndOfTurnHeal(p, []);
      expect(p.hp).toBe(100);
    });
  });

  describe("maybeConsumePinchBerry", () => {
    it("berry-juice heals 20 and consumes when at/below half", () => {
      const p = holder({ heldItem: "berry-juice", hp: 40, maxHp: 100 });
      const log: string[] = [];
      maybeConsumePinchBerry(p, log);
      expect(p.hp).toBe(60);
      expect(p.heldItem).toBeNull();
      expect(log.length).toBe(1);
    });
    it("no-op above half HP", () => {
      const p = holder({ heldItem: "berry-juice", hp: 80, maxHp: 100 });
      maybeConsumePinchBerry(p, []);
      expect(p.hp).toBe(80);
      expect(p.heldItem).toBe("berry-juice");
    });
    it("no-op if fainted", () => {
      const p = holder({ heldItem: "berry-juice", hp: 0, maxHp: 100 });
      maybeConsumePinchBerry(p, []);
      expect(p.hp).toBe(0);
      expect(p.heldItem).toBe("berry-juice");
    });
  });

  describe("quickClawTriggers", () => {
    it("triggers under 20%", () => {
      expect(quickClawTriggers(holder({ heldItem: "quick-claw" }), () => 0.1)).toBe(true);
      expect(quickClawTriggers(holder({ heldItem: "quick-claw" }), () => 0.5)).toBe(false);
    });
    it("no item → false", () => {
      expect(quickClawTriggers(holder(), () => 0)).toBe(false);
    });
  });
});
