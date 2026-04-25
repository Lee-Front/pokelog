import { describe, it, expect } from "vitest";
import { getBpShopEntries, findBpShopEntry } from "../../src/game/bp-shop-catalog.js";

describe("bp-shop-catalog", () => {
  const entries = getBpShopEntries();

  it("includes the BP-tier core held items reserved out of the regular shop", () => {
    for (const id of ["life-orb", "focus-sash", "leftovers", "eviolite", "assault-vest"]) {
      const entry = findBpShopEntry(id);
      expect(entry, `${id} should be in BP shop`).toBeDefined();
      expect(entry!.bp).toBeGreaterThan(0);
      expect(entry!.category).toBe("core-held");
    }
  });

  it("includes choice items at the same tier", () => {
    const band = findBpShopEntry("choice-band");
    const specs = findBpShopEntry("choice-specs");
    const scarf = findBpShopEntry("choice-scarf");
    expect(band?.bp).toBe(specs?.bp);
    expect(band?.bp).toBe(scarf?.bp);
    expect(band?.category).toBe("choice");
  });

  it("prices ability-patch above ability-capsule", () => {
    const cap = findBpShopEntry("ability-capsule");
    const patch = findBpShopEntry("ability-patch");
    expect(cap).toBeDefined();
    expect(patch).toBeDefined();
    expect(patch!.bp).toBeGreaterThan(cap!.bp);
  });

  it("returns Korean names from items.json when available", () => {
    const leftovers = findBpShopEntry("leftovers");
    expect(leftovers).toBeDefined();
    expect(typeof leftovers!.name).toBe("string");
    expect(leftovers!.name.length).toBeGreaterThan(0);
  });

  it("does not expose any item with bp=0", () => {
    for (const entry of entries) {
      expect(entry.bp).toBeGreaterThan(0);
    }
  });

  it("contains nature mints and effort-training power items", () => {
    expect(findBpShopEntry("adamant-mint")).toBeDefined();
    expect(findBpShopEntry("jolly-mint")).toBeDefined();
    expect(findBpShopEntry("macho-brace")).toBeDefined();
    expect(findBpShopEntry("power-anklet")).toBeDefined();
  });
});
