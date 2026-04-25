import type { OwnedPokemon } from "../../../../shared/types.js";

// JS reserved keys that, if used as object keys with bracket assignment,
// can pollute Object.prototype or otherwise corrupt the inventory map.
// We refuse them up front so user-supplied item ids cannot be smuggled
// into inventory mutation paths (shop buy, admin grant, held-item swap).
const RESERVED_ITEM_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function ensureSafeItemKey(item: string): void {
  if (typeof item !== "string" || RESERVED_ITEM_KEYS.has(item)) {
    throw new Error(`invalid item key: ${String(item)}`);
  }
}

function readItemQty(inventory: Record<string, number>, item: string): number {
  return Object.prototype.hasOwnProperty.call(inventory, item)
    ? inventory[item]
    : 0;
}

export function decrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  ensureSafeItemKey(item);
  const current = readItemQty(inventory, item);
  const next = current - qty;
  if (next <= 0) {
    delete inventory[item];
  } else {
    inventory[item] = next;
  }
}

export function incrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  ensureSafeItemKey(item);
  const current = readItemQty(inventory, item);
  inventory[item] = current + qty;
}

export function healPokemon(pokemon: OwnedPokemon, amount?: number): void {
  if (amount !== undefined) {
    pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + amount);
  } else {
    pokemon.hp = pokemon.maxHp;
    for (const move of pokemon.moves) {
      move.pp = move.maxPp;
    }
    pokemon.statusCondition = null;
    pokemon.sleepTurns = undefined;
  }
}
