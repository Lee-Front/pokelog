import type { OwnedPokemon, ShopItem, UserData, VitaminStatKey } from "../../../../shared/types.js";
import { getItems } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon, getEvolutionItemUseTarget } from "./growth.js";
import { decrementItem, healPokemon } from "./inventory-utils.js";
import { clearPendingEvolutionForPokemon } from "./pending-evolution.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";

export { GameRuleError as ItemUseError };

export interface ItemUseResult {
  kind: "healing" | "evolution" | "vitamin" | "pp-boost";
  item: string;
  itemName: string;
  pokemon: OwnedPokemon;
  previousSpecies?: string;
  vitaminStat?: VitaminStatKey;
  newVitaminCount?: number;
  moveId?: string;
  newMaxPp?: number;
}

export const VITAMIN_MAX_APPLICATIONS = 10;
const VITAMIN_STAT_INCREMENT = 2; // +2 per application. 10 uses = +20 — roughly canonical (~+25 at lv100 from 100 EV).
const HP_UP_INCREMENT = 3; // HP scales more per EV so give a slightly bigger step.
const PP_UP_MAX_INCREMENTS = 3;

function ensureAppliedVitamins(pokemon: OwnedPokemon): NonNullable<OwnedPokemon["appliedVitamins"]> {
  if (!pokemon.appliedVitamins) {
    pokemon.appliedVitamins = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
  }
  return pokemon.appliedVitamins;
}

function applyVitamin(pokemon: OwnedPokemon, stat: VitaminStatKey): number {
  const applied = ensureAppliedVitamins(pokemon);
  if (applied[stat] >= VITAMIN_MAX_APPLICATIONS) {
    throw new GameRuleError(`${stat} 영양제는 더 이상 효과가 없습니다.`);
  }

  applied[stat] += 1;
  if (stat === "hp") {
    pokemon.maxHp += HP_UP_INCREMENT;
    pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + HP_UP_INCREMENT);
  } else {
    pokemon.stats[stat] += VITAMIN_STAT_INCREMENT;
  }

  return applied[stat];
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

/**
 * Canon PP Up: each use adds 20% of the move's base PP, capped at 3
 * applications per move (= +60% baseline PP). PP Max jumps straight to the
 * cap. We derive the baseline PP from (current maxPp − prior bumps) and
 * track applications on move.ppUpsUsed.
 */
function applyPpBoost(
  pokemon: OwnedPokemon,
  kind: NonNullable<ShopItem["ppBoost"]>,
  moveId: string,
): { moveId: string; newMaxPp: number } {
  const move = pokemon.moves.find((entry) => entry.id === moveId);
  if (!move) {
    throw new GameRuleError("해당 포켓몬은 그 기술을 배우지 않았습니다.");
  }

  const used = move.ppUpsUsed ?? 0;
  if (used >= PP_UP_MAX_INCREMENTS) {
    throw new GameRuleError("이 기술의 PP는 이미 최대입니다.");
  }

  // Reconstruct baseline PP before any PP Up applications.
  const baselinePp = Math.floor((move.maxPp * 5) / (5 + used));
  const increment = Math.max(1, Math.floor(baselinePp / 5));

  const add = kind === "max" ? (PP_UP_MAX_INCREMENTS - used) : 1;
  move.maxPp += increment * add;
  move.pp = Math.min(move.maxPp, move.pp + increment * add);
  move.ppUpsUsed = used + add;
  return { moveId, newMaxPp: move.maxPp };
}

export interface UseInventoryItemOptions {
  /** Required when using pp-up / pp-max. */
  moveId?: string;
}

export function useInventoryItem(
  user: UserData,
  item: string,
  pokemonUid: string,
  shopItem?: ShopItem,
  options: UseInventoryItemOptions = {},
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

  if (shopItem?.vitaminStat) {
    const newCount = applyVitamin(pokemon, shopItem.vitaminStat);
    decrementItem(user.inventory, item);
    return {
      kind: "vitamin",
      item,
      itemName,
      pokemon,
      vitaminStat: shopItem.vitaminStat,
      newVitaminCount: newCount,
    };
  }

  if (shopItem?.ppBoost) {
    if (!options.moveId) {
      throw new GameRuleError("PP 강화 대상 기술을 선택해야 합니다.");
    }
    const result = applyPpBoost(pokemon, shopItem.ppBoost, options.moveId);
    decrementItem(user.inventory, item);
    return {
      kind: "pp-boost",
      item,
      itemName,
      pokemon,
      moveId: result.moveId,
      newMaxPp: result.newMaxPp,
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
