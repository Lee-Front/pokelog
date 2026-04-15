import { describe, it, expect, vi, beforeEach } from "vitest";
import { isHoldableItem, buildInventoryCatalogEntry } from "../../src/game/inventory-catalog.js";
import * as dataLoader from "../../src/game/data-loader.js";
import type { ItemData, EvolutionData } from "../../../../shared/types.js";

function stubItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: "potion",
    name: "Potion",
    category: "healing",
    cost: 200,
    shortEffect: "Restores 20 HP.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: no evolutions with held-item conditions
  vi.spyOn(dataLoader, "getEvolutions").mockReturnValue({});
});

describe("isHoldableItem", () => {
  it("returns true for held-items category", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "leftovers", category: "held-items", name: "Leftovers" }),
    );
    expect(isHoldableItem("leftovers")).toBe(true);
  });

  it("returns true for mega-stone category", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "venusaurite", category: "mega-stone", name: "Venusaurite" }),
    );
    expect(isHoldableItem("venusaurite")).toBe(true);
  });

  it("returns true for an evolution held-item", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "metal-coat", category: "evolution", name: "Metal Coat" }),
    );
    const evolutions: Record<string, EvolutionData> = {
      scyther: {
        branches: [{
          id: "scyther-scizor",
          targetSpecies: "scizor",
          trigger: "trade",
          conditions: [{ type: "held-item", item: "metal-coat" }],
        }],
      },
    };
    vi.spyOn(dataLoader, "getEvolutions").mockReturnValue(evolutions);

    expect(isHoldableItem("metal-coat")).toBe(true);
  });

  it("returns false for a non-holdable item (healing)", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "potion", category: "healing", name: "Potion" }),
    );
    expect(isHoldableItem("potion")).toBe(false);
  });

  it("returns false when item is unknown", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(undefined);
    expect(isHoldableItem("unknown-item")).toBe(false);
  });
});

describe("buildInventoryCatalogEntry", () => {
  it("returns ball kind when shopItem has guaranteedCatch", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "master-ball", name: "Master Ball", category: "ball", shortEffect: "Never fails." }),
    );
    const entry = buildInventoryCatalogEntry("master-ball", {
      name: "Master Ball",
      price: 999,
      guaranteedCatch: true,
    });
    expect(entry.kind).toBe("ball");
    expect(entry.name).toBe("Master Ball");
    expect(entry.canUseDirectly).toBe(false);
  });

  it("returns ball kind when shopItem has catchBonus", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "great-ball", name: "Great Ball", category: "ball", shortEffect: "Better catch rate." }),
    );
    const entry = buildInventoryCatalogEntry("great-ball", {
      name: "Great Ball",
      price: 600,
      catchBonus: 1.5,
    });
    expect(entry.kind).toBe("ball");
    expect(entry.description).toBe("Better catch rate.");
  });

  it("returns healing kind when shopItem has healAmount", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "potion", name: "Potion", category: "healing", shortEffect: "Restores 20 HP." }),
    );
    const entry = buildInventoryCatalogEntry("potion", {
      name: "Potion",
      price: 200,
      healAmount: 20,
    });
    expect(entry.kind).toBe("healing");
    expect(entry.canUseDirectly).toBe(true);
  });

  it("returns held kind when item is holdable (no shopItem ball/heal)", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "leftovers", name: "Leftovers", category: "held-items", shortEffect: "Restores HP each turn." }),
    );
    const entry = buildInventoryCatalogEntry("leftovers");
    expect(entry.kind).toBe("held");
    expect(entry.canHold).toBe(true);
    expect(entry.canUseDirectly).toBe(false);
  });

  it("returns evolution kind for evolution category items", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "fire-stone", name: "Fire Stone", category: "evolution", shortEffect: "Evolves certain Pokemon." }),
    );
    const entry = buildInventoryCatalogEntry("fire-stone");
    expect(entry.kind).toBe("evolution");
    expect(entry.canUseDirectly).toBe(true);
    expect(entry.canHold).toBe(false);
  });

  it("returns healing kind for healing category items without shopItem", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "full-restore", name: "Full Restore", category: "healing", shortEffect: "Fully restores HP." }),
    );
    const entry = buildInventoryCatalogEntry("full-restore");
    expect(entry.kind).toBe("healing");
    expect(entry.canUseDirectly).toBe(true);
  });

  it("falls back to other kind for unknown items", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(undefined);
    const entry = buildInventoryCatalogEntry("mystery-item");
    expect(entry.kind).toBe("other");
    expect(entry.name).toBe("mystery-item");
    expect(entry.canUseDirectly).toBe(false);
    expect(entry.canHold).toBe(false);
  });

  it("uses shopItem name as fallback in other kind when no item data", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(undefined);
    const entry = buildInventoryCatalogEntry("custom-item", {
      name: "Custom Item",
      price: 100,
    });
    expect(entry.kind).toBe("other");
    expect(entry.name).toBe("Custom Item");
  });

  it("uses item shortEffect as description for ball kind", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "poke-ball", shortEffect: "A basic Poke Ball.", category: "ball" }),
    );
    const entry = buildInventoryCatalogEntry("poke-ball", {
      name: "Poke Ball",
      price: 200,
      catchBonus: 1.0,
    });
    expect(entry.description).toBe("A basic Poke Ball.");
  });

  it("falls back to default description when item has no shortEffect for ball", () => {
    vi.spyOn(dataLoader, "getItemById").mockReturnValue(
      stubItem({ id: "poke-ball", shortEffect: "", category: "ball" }),
    );
    const entry = buildInventoryCatalogEntry("poke-ball", {
      name: "Poke Ball",
      price: 200,
      guaranteedCatch: true,
    });
    expect(entry.description).toBe("Capture item.");
  });
});
