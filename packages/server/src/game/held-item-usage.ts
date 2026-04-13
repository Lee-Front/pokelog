import type { OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getItemById } from "./data-loader.js";
import { decrementItem, incrementItem } from "./inventory-utils.js";
import { isHoldableItem } from "./inventory-catalog.js";

export class HeldItemError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HeldItemError";
    this.status = status;
  }
}

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
    throw new HeldItemError("Pokemon not found in party.", 404);
  }

  return pokemon;
}

export function equipHeldItem(user: UserData, pokemonUid: string, itemId: string): HeldItemResult {
  if (!user.inventory[itemId] || user.inventory[itemId] <= 0) {
    throw new HeldItemError("Item not found in inventory.");
  }
  if (!isHoldableItem(itemId)) {
    throw new HeldItemError("This item cannot be held.");
  }

  const pokemon = getPartyPokemon(user, pokemonUid);
  const previousHeldItem = pokemon.heldItem ?? null;

  if (previousHeldItem === itemId) {
    throw new HeldItemError("Pokemon is already holding that item.");
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
    throw new HeldItemError("Pokemon is not holding an item.");
  }

  incrementItem(user.inventory, heldItem);
  pokemon.heldItem = null;

  return {
    pokemon,
    item: heldItem,
    itemName: getHeldItemName(heldItem),
  };
}
