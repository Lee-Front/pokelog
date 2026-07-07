import type { OwnedPokemon, PvpCombatant, ServerConfig, ShopItem } from "../../../../shared/types.js";

export function decrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) - qty;
  if (inventory[item] <= 0) delete inventory[item];
}

export function incrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) + qty;
}

/**
 * 아이템 메타(ShopItem)를 두 상점 카탈로그에서 해석한다. 포인트 상점(shop.items)을 먼저 보고,
 * 없으면 게임머니 상점(battleShop.items)으로 폴백한다. 볼·회복약·진화/메가 아이템이 battleShop으로
 * 이동했으므로, 인벤토리 아이템 조회는 반드시 두 카탈로그를 모두 봐야 한다(한쪽만 보면 죽은 키가 된다).
 */
export function resolveShopItem(config: ServerConfig, itemId: string): ShopItem | undefined {
  return config.shop.items[itemId] ?? config.battleShop.items[itemId];
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
 * 상태이상 치료 아이템(ShopItem.curesStatus) 적용 — 대상 개체의 statusCondition을 검사해
 * 치료 가능하면 비우고 true, 대상 상태가 아니면(또는 무상태) false를 반환한다(호출부가 에러 처리).
 * curesStatus="all"은 어떤 상태이상이든 회복(만능치료제), 특정 값이면 그 상태일 때만 회복한다.
 * 전투/비전투 공용 — 둘 다 OwnedPokemon의 statusCondition/sleepTurns를 본다.
 */
export function applyStatusCure(pokemon: OwnedPokemon, curesStatus: string): boolean {
  const status = pokemon.statusCondition ?? null;
  if (!status) return false;
  if (curesStatus !== "all" && status !== curesStatus) return false;
  pokemon.statusCondition = null;
  pokemon.sleepTurns = undefined;
  return true;
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
