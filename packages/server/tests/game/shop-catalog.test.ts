import { describe, it, expect } from "vitest";
import { buildDefaultShopItems } from "../../src/game/shop-catalog.js";

describe("shop-catalog", () => {
  const items = buildDefaultShopItems();

  it("retains legacy item ids with hand-tuned metadata", () => {
    expect(items.pokeball).toEqual({ name: "Poke Ball", price: 100, catchBonus: 0 });
    expect(items.greatball.catchBonus).toBe(0.2);
    expect(items.ultraball.catchBonus).toBe(0.35);
    expect(items.masterball.guaranteedCatch).toBe(true);
    expect(items.masterball.price).toBe(50000);
    expect(items.potion).toEqual({ name: "Potion", price: 100, healAmount: 20 });
    expect(items.superPotion.healAmount).toBe(60);
    expect(items.hyperPotion.healAmount).toBe(120);
  });

  it("includes status cure items", () => {
    for (const id of ["antidote", "burn-heal", "ice-heal", "awakening", "paralyze-heal", "full-heal", "full-restore"]) {
      expect(items[id], `${id} should be in shop`).toBeDefined();
    }
  });

  it("includes revive and pp recovery items", () => {
    expect(items.revive).toBeDefined();
    expect(items["max-revive"]).toBeDefined();
    expect(items.ether).toBeDefined();
    expect(items.elixir).toBeDefined();
    expect(items["max-elixir"]).toBeDefined();
  });

  it("includes apricorn balls with catchBonus", () => {
    for (const id of ["fast-ball", "friend-ball", "heavy-ball", "level-ball", "love-ball", "lure-ball", "moon-ball"]) {
      const entry = items[id];
      expect(entry, `${id} should be sold`).toBeDefined();
      expect(entry.price).toBeGreaterThan(0);
    }
  });

  it("includes TMs but skips HMs", () => {
    expect(items.tm01).toBeDefined();
    expect(items.tm22).toBeDefined();
    for (const hmId of ["hm01", "hm02", "hm03", "hm04", "hm05", "hm06", "hm07", "hm08"]) {
      expect(items[hmId], `${hmId} should not be sold`).toBeUndefined();
    }
  });

  it("excludes Battle Frontier signature held items (reserved for Tower rewards)", () => {
    for (const id of ["life-orb", "focus-sash", "leftovers", "eviolite", "assault-vest", "choice-band", "choice-specs", "choice-scarf"]) {
      expect(items[id], `${id} should not be in shop`).toBeUndefined();
    }
  });

  it("excludes encounter / breeding-only items (no field, no breeding system)", () => {
    for (const id of ["cleanse-tag", "luck-incense", "pure-incense", "destiny-knot"]) {
      expect(items[id], `${id} should not be in shop`).toBeUndefined();
    }
  });

  it("excludes promo balls and auto-level candies", () => {
    for (const id of ["premier-ball", "park-ball", "cherish-ball", "rare-candy", "dynamax-candy", "exp-candy-l"]) {
      expect(items[id], `${id} should not be in shop`).toBeUndefined();
    }
  });

  it("attaches vitamin metadata to stat vitamins only", () => {
    expect(items["hp-up"].vitaminStat).toBe("hp");
    expect(items.protein.vitaminStat).toBe("attack");
    expect(items.iron.vitaminStat).toBe("defense");
    expect(items.calcium.vitaminStat).toBe("spAttack");
    expect(items.zinc.vitaminStat).toBe("spDefense");
    expect(items.carbos.vitaminStat).toBe("speed");
    expect(items["pp-up"].ppBoost).toBe("increment");
    expect(items["pp-max"].ppBoost).toBe("max");
    expect(items["pp-max"].price).toBeGreaterThan(items["pp-up"].price);
  });

  it("includes berries at low cost", () => {
    expect(items["sitrus-berry"]).toBeDefined();
    expect(items["sitrus-berry"].price).toBeLessThanOrEqual(100);
    expect(items["lum-berry"]).toBeDefined();
    expect(items["occa-berry"]).toBeDefined();
    expect(items["liechi-berry"]).toBeDefined();
    expect(items["grepa-berry"]).toBeDefined();
  });

  it("includes evolution stones, ability changers, training items", () => {
    expect(items["fire-stone"]).toBeDefined();
    expect(items["water-stone"]).toBeDefined();
    expect(items["ability-capsule"]).toBeDefined();
    expect(items["ability-patch"]).toBeDefined();
    expect(items["soothe-bell"]).toBeDefined();
    expect(items["everstone"]).toBeDefined();
    expect(items["lucky-egg"]).toBeDefined();
    expect(items["amulet-coin"]).toBeDefined();
    expect(items["exp-share"]).toBeDefined();
  });
});
