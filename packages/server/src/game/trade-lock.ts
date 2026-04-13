import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

export class TradeLockError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TradeLockError";
    this.status = status;
  }
}

function getOwnedPokemon(user: UserData, pokemonUid: string): OwnedPokemon {
  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid)
    ?? user.storage.find((entry) => entry.uid === pokemonUid);

  if (!pokemon) {
    throw new TradeLockError("Pokemon not found.", 404);
  }

  return pokemon;
}

export function setTradeLock(
  user: UserData,
  pokemonUid: string,
  locked: boolean,
): { pokemon: OwnedPokemon; tradeLocked: boolean } {
  const pokemon = getOwnedPokemon(user, pokemonUid);
  pokemon.tradeLocked = locked;
  return {
    pokemon,
    tradeLocked: locked,
  };
}
