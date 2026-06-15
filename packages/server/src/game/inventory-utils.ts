import type { OwnedPokemon, PvpCombatant, ShopItem } from "../../../../shared/types.js";

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
    pokemon.statusCondition = null;
    pokemon.sleepTurns = undefined;
  }
}

/**
 * 전투에서 사용 가능한 아이템인지 판정 — PvE handleItem과 동일 기준(회복량 보유).
 * config.shop.items의 ShopItem을 받아 healAmount가 양수면 true.
 */
export function isBattleUsableItem(item: ShopItem | undefined): item is ShopItem & { healAmount: number } {
  return !!item && typeof item.healAmount === "number" && item.healAmount > 0;
}

/** 전투 회복 아이템을 PvpCombatant 스냅샷에 적용(HP 회복). 실제 회복량을 반환. */
export function applyHealToCombatant(target: PvpCombatant, amount: number): number {
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  return target.hp - before;
}
