import type { OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getItemById } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { decrementItem, incrementItem } from "./inventory-utils.js";
import { isHoldableItem } from "./inventory-catalog.js";
import { getMegaStoneTargetSpecies } from "./battle-transformations.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";

export { GameRuleError as HeldItemError };

export interface HeldItemResult {
  item: string;
  itemName: string;
  pokemon: OwnedPokemon;
  previousHeldItem: string | null;
}

function getHeldItemName(itemId: string): string {
  return getItemById(itemId)?.name ?? itemId;
}

function getPartyPokemon(user: UserData, pokemonUid: string): OwnedPokemon {
  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found in party.", 404);
  }

  return pokemon;
}

export function equipHeldItem(user: UserData, pokemonUid: string, itemId: string): HeldItemResult {
  if (!user.inventory[itemId] || user.inventory[itemId] <= 0) {
    throw new GameRuleError("Item not found in inventory.");
  }
  if (!isHoldableItem(itemId)) {
    throw new GameRuleError("This item cannot be held.");
  }

  const pokemon = getPartyPokemon(user, pokemonUid);

  // 메가스톤은 맞는 종에만 착용 허용 — 잘못된 스톤은 애초에 들 수 없게 막는다.
  if (getItemById(itemId)?.category === "mega-stone") {
    const target = getMegaStoneTargetSpecies(itemId);
    if (target && target !== pokemon.species) {
      throw new GameRuleError(`이 메가스톤은 ${getDisplaySpeciesName(target)} 전용입니다.`);
    }
  }

  const previousHeldItem = pokemon.heldItem ?? null;

  if (previousHeldItem === itemId) {
    throw new GameRuleError("Pokemon is already holding that item.");
  }

  decrementItem(user.inventory, itemId);
  if (previousHeldItem) {
    incrementItem(user.inventory, previousHeldItem);
  }
  pokemon.heldItem = itemId;

  return {
    item: itemId,
    itemName: getHeldItemName(itemId),
    pokemon,
    previousHeldItem,
  };
}

export function unequipHeldItem(user: UserData, pokemonUid: string): { pokemon: OwnedPokemon; item: string; itemName: string } {
  const pokemon = getPartyPokemon(user, pokemonUid);
  const heldItem = pokemon.heldItem;
  if (!heldItem) {
    throw new GameRuleError("Pokemon is not holding an item.");
  }

  incrementItem(user.inventory, heldItem);
  pokemon.heldItem = null;

  return {
    pokemon,
    item: heldItem,
    itemName: getHeldItemName(heldItem),
  };
}
