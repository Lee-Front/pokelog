import type { OwnedPokemon, ShopItem, UserData } from "../../../../shared/types.js";
import { getItems, getVariants } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon, getEvolutionItemUseTarget } from "./growth.js";
import { applyEvGain, emptyEvs, EV_STAT_MAX, EV_TOTAL_MAX, EV_STAT_KEYS, VITAMIN_STAT } from "./evs.js";
import { buildStatsForPokemon } from "./pokemon-stats.js";
import { decrementItem, healPokemon } from "./inventory-utils.js";
import { clearPendingEvolutionForPokemon } from "./pending-evolution.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";

export { GameRuleError as ItemUseError };

export interface ItemUseResult {
  kind: "healing" | "evolution" | "gmax-factor" | "vitamin";
  item: string;
  itemName: string;
  pokemon: OwnedPokemon;
  previousSpecies?: string;
}

function getItemDisplayName(item: string, shopItem?: ShopItem): string {
  if (shopItem?.name) {
    return shopItem.name;
  }

  return getItems().find((entry) => entry.id === item)?.name ?? item;
}

function getPokemonDisplayName(pokemon: OwnedPokemon): string {
  if (pokemon.nickname) {
    return pokemon.nickname;
  }

  return getDisplaySpeciesName(pokemon.species);
}

export function useInventoryItem(
  user: UserData,
  item: string,
  pokemonUid: string,
  shopItem?: ShopItem,
): ItemUseResult {
  if (!user.inventory[item] || user.inventory[item] <= 0) {
    throw new GameRuleError("Item not found in inventory.");
  }

  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found in party.", 404);
  }

  const itemName = getItemDisplayName(item, shopItem);

  if (shopItem?.healAmount) {
    if (pokemon.hp >= pokemon.maxHp) {
      throw new GameRuleError("Pokemon does not need healing.");
    }

    decrementItem(user.inventory, item);
    healPokemon(pokemon, shopItem.healAmount);

    return {
      kind: "healing",
      item,
      itemName,
      pokemon,
    };
  }

  // 맥스 수프 — 개체에 기가맥스 팩터를 영구 부여(개체별 1회). canGigantamax와 동일한
  // 방식으로 거다이 가능 종인지 판정한다(variantId 우선, 없으면 species).
  if (item === "max-soup") {
    const variantPrefix = pokemon.variantId ?? pokemon.species;
    const gmaxVariantId = `${variantPrefix}-gmax`;
    const canGmax = getVariants().some(
      (v) => v.id === gmaxVariantId && v.category === "gigantamax",
    );

    if (!canGmax) {
      throw new GameRuleError("이 포켓몬은 거다이맥스할 수 없습니다.");
    }

    if (pokemon.hasGigantamaxFactor) {
      throw new GameRuleError("이미 거다이맥스 가능합니다.");
    }

    pokemon.hasGigantamaxFactor = true;
    decrementItem(user.inventory, item);

    return {
      kind: "gmax-factor",
      item,
      itemName,
      pokemon,
    };
  }

  // 영양제(영양제) — 지정 노력치를 +10. 252/510 상한에 걸리면 거부한다. 적용 후
  // 스탯을 재계산하되 현재 HP는 보존(클램프)한다.
  const vitaminStat = VITAMIN_STAT[item];
  if (vitaminStat) {
    const currentEvs = pokemon.evs ?? emptyEvs();
    const currentTotal = EV_STAT_KEYS.reduce((sum, key) => sum + currentEvs[key], 0);
    if (currentEvs[vitaminStat] >= EV_STAT_MAX || currentTotal >= EV_TOTAL_MAX) {
      throw new GameRuleError("이미 노력치가 최대입니다.");
    }

    pokemon.evs = applyEvGain(currentEvs, { [vitaminStat]: 10 });
    const recomputed = buildStatsForPokemon(pokemon);
    pokemon.maxHp = recomputed.maxHp;
    pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
    pokemon.stats = recomputed.stats;
    decrementItem(user.inventory, item);

    return {
      kind: "vitamin",
      item,
      itemName,
      pokemon,
    };
  }

  const evolutionResult = getEvolutionItemUseTarget(pokemon.species, item);
  if (!evolutionResult) {
    throw new GameRuleError(`Cannot use ${itemName} on ${getPokemonDisplayName(pokemon)}.`);
  }

  const previousSpecies = pokemon.species;
  decrementItem(user.inventory, item);
  clearPendingEvolutionForPokemon(user, pokemon.uid);
  evolvePokemon(pokemon, evolutionResult.targetSpecies, evolutionResult.targetVariantId);

  if (!user.pokedex.includes(evolutionResult.targetSpecies)) {
    user.pokedex.push(evolutionResult.targetSpecies);
  }

  return {
    kind: "evolution",
    item,
    itemName,
    pokemon,
    previousSpecies,
  };
}
