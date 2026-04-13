import type { OwnedPokemon, ShopItem, UserData } from "../../../../shared/types.js";
import { getItems, getSpeciesByName } from "./data-loader.js";
import { evolvePokemon, getEvolutionItemUseTarget } from "./growth.js";
import { decrementItem, healPokemon } from "./inventory-utils.js";
import { clearPendingEvolutionForPokemon } from "./pending-evolution.js";

export class ItemUseError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ItemUseError";
    this.status = status;
  }
}

export interface ItemUseResult {
  kind: "healing" | "evolution";
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

  return getSpeciesByName(pokemon.species)?.name ?? pokemon.species;
}

export function useInventoryItem(
  user: UserData,
  item: string,
  pokemonUid: string,
  shopItem?: ShopItem,
): ItemUseResult {
  if (!user.inventory[item] || user.inventory[item] <= 0) {
    throw new ItemUseError("Item not found in inventory.");
  }

  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid);
  if (!pokemon) {
    throw new ItemUseError("Pokemon not found in party.", 404);
  }

  const itemName = getItemDisplayName(item, shopItem);

  if (shopItem?.healAmount) {
    if (pokemon.hp >= pokemon.maxHp) {
      throw new ItemUseError("Pokemon does not need healing.");
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

  const evolutionTarget = getEvolutionItemUseTarget(pokemon.species, item);
  if (!evolutionTarget) {
    throw new ItemUseError(`Cannot use ${itemName} on ${getPokemonDisplayName(pokemon)}.`);
  }

  const previousSpecies = pokemon.species;
  decrementItem(user.inventory, item);
  clearPendingEvolutionForPokemon(user, pokemon.uid);
  evolvePokemon(pokemon, evolutionTarget);

  if (!user.pokedex.includes(evolutionTarget)) {
    user.pokedex.push(evolutionTarget);
  }

  return {
    kind: "evolution",
    item,
    itemName,
    pokemon,
    previousSpecies,
  };
}
