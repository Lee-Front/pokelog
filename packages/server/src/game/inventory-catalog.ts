import type { ShopItem } from "../../../../shared/types.js";
import { getEvolutions, getItemById } from "./data-loader.js";

export type InventoryCatalogKind = "ball" | "healing" | "evolution" | "held" | "other";

export interface InventoryCatalogEntry {
  name: string;
  kind: InventoryCatalogKind;
  description: string;
  canUseDirectly: boolean;
  canHold: boolean;
}

function getHeldEvolutionItemIds(): Set<string> {
  const itemIds = new Set<string>();

  for (const evolution of Object.values(getEvolutions())) {
    for (const branch of evolution.branches) {
      for (const condition of branch.conditions) {
        if (condition.type === "held-item") {
          itemIds.add(condition.item);
        }
      }
    }
  }

  return itemIds;
}

// Transformation/plot-advancement items that a Pokemon can hold even though
// PokeAPI places them in non-held-item categories.
const HOLDABLE_TRANSFORMATION_ITEMS = new Set<string>([
  "red-orb",
  "blue-orb",
  "rusted-sword",
  "rusted-shield",
]);

export function isHoldableItem(itemId: string): boolean {
  if (HOLDABLE_TRANSFORMATION_ITEMS.has(itemId)) {
    return true;
  }

  const item = getItemById(itemId);
  if (
    item?.category === "held-items"
    || item?.category === "mega-stone"
    || item?.category === "mega-stones"
  ) {
    return true;
  }

  return getHeldEvolutionItemIds().has(itemId);
}

export function buildInventoryCatalogEntry(itemId: string, shopItem?: ShopItem): InventoryCatalogEntry {
  const item = getItemById(itemId);
  const canHold = isHoldableItem(itemId);

  if (shopItem?.guaranteedCatch || shopItem?.catchBonus != null) {
    return {
      name: shopItem.name,
      kind: "ball",
      description: item?.shortEffect || "Capture item.",
      canUseDirectly: false,
      canHold,
    };
  }

  if (shopItem?.healAmount != null) {
    return {
      name: shopItem.name,
      kind: "healing",
      description: item?.shortEffect || `Restore ${shopItem.healAmount} HP.`,
      canUseDirectly: true,
      canHold,
    };
  }

  if (canHold) {
    return {
      name: item?.name ?? shopItem?.name ?? itemId,
      kind: "held",
      description: item?.shortEffect || "Hold item.",
      canUseDirectly: false,
      canHold: true,
    };
  }

  if (item?.category === "evolution") {
    return {
      name: item.name,
      kind: "evolution",
      description: item.shortEffect || "Evolution item.",
      canUseDirectly: true,
      canHold: false,
    };
  }

  if (item?.category === "healing") {
    return {
      name: item.name,
      kind: "healing",
      description: item.shortEffect || "Healing item.",
      canUseDirectly: true,
      canHold,
    };
  }

  return {
    name: item?.name ?? shopItem?.name ?? itemId,
    kind: "other",
    description: item?.shortEffect || "",
    canUseDirectly: false,
    canHold,
  };
}
