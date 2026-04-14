import crypto from "node:crypto";
import type {
  EvolutionBranch,
  OwnedPokemon,
  PendingEvolution,
  PendingEvolutionOption,
  UserData,
} from "../../../../shared/types.js";
import { getSpeciesByName } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon } from "./growth.js";

export { GameRuleError as PendingEvolutionError };

function getPokemonByUid(user: UserData, pokemonUid: string): OwnedPokemon | undefined {
  return user.pokemon.find((pokemon) => pokemon.uid === pokemonUid)
    ?? user.storage.find((pokemon) => pokemon.uid === pokemonUid);
}

function buildOption(branch: EvolutionBranch): PendingEvolutionOption {
  const target = getSpeciesByName(branch.targetSpecies);
  return {
    branchId: branch.id,
    targetSpecies: branch.targetSpecies,
    ...(branch.targetVariantId ? { targetVariantId: branch.targetVariantId } : {}),
    targetName: target?.name ?? branch.targetSpecies,
  };
}

export function queuePendingEvolution(
  user: UserData,
  pokemon: OwnedPokemon,
  branches: EvolutionBranch[],
): PendingEvolution {
  const source = getSpeciesByName(pokemon.species);
  const pending: PendingEvolution = {
    id: crypto.randomUUID(),
    pokemonUid: pokemon.uid,
    sourceSpecies: pokemon.species,
    sourceName: source?.name ?? pokemon.species,
    trigger: branches[0]?.trigger ?? "other",
    options: branches.map(buildOption),
    createdAt: new Date().toISOString(),
  };

  const pendingEvolutions = user.pendingEvolutions ?? [];
  user.pendingEvolutions = pendingEvolutions.filter((entry) => entry.pokemonUid !== pokemon.uid);
  user.pendingEvolutions.push(pending);
  return pending;
}

export function clearPendingEvolutionForPokemon(user: UserData, pokemonUid: string): void {
  user.pendingEvolutions = (user.pendingEvolutions ?? []).filter((entry) => entry.pokemonUid !== pokemonUid);
}

export function resolvePendingEvolutionChoice(
  user: UserData,
  pendingEvolutionId: string,
  branchId: string,
): { pendingEvolution: PendingEvolution; pokemon: OwnedPokemon; targetSpecies: string } {
  const pendingEvolutions = user.pendingEvolutions ?? [];
  const pendingEvolution = pendingEvolutions.find((entry) => entry.id === pendingEvolutionId);
  if (!pendingEvolution) {
    throw new GameRuleError("Pending evolution not found.", 404);
  }

  const option = pendingEvolution.options.find((entry) => entry.branchId === branchId);
  if (!option) {
    throw new GameRuleError("Evolution option not found.", 404);
  }

  const pokemon = getPokemonByUid(user, pendingEvolution.pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found.", 404);
  }
  if (pokemon.species !== pendingEvolution.sourceSpecies) {
    throw new GameRuleError("Pokemon species no longer matches the pending evolution.");
  }

  evolvePokemon(pokemon, option.targetSpecies, option.targetVariantId);
  if (!user.pokedex.includes(option.targetSpecies)) {
    user.pokedex.push(option.targetSpecies);
  }

  user.pendingEvolutions = pendingEvolutions.filter((entry) => entry.id !== pendingEvolutionId);

  return {
    pendingEvolution,
    pokemon,
    targetSpecies: option.targetSpecies,
  };
}
