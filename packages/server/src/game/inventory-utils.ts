import type { OwnedPokemon } from "../../../../shared/types.js";

export function decrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) - qty;
  if (inventory[item] <= 0) delete inventory[item];
}

export function incrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) + qty;
}

export function healPokemon(pokemon: OwnedPokemon, amount?: number): void {
  if (amount !== undefined) {
    pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + amount);
  } else {
    pokemon.hp = pokemon.maxHp;
    for (const move of pokemon.moves) {
      move.pp = move.maxPp;
    }
  }
}
