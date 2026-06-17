import crypto from "node:crypto";
import type {
  EvolutionBranch,
  OwnedPokemon,
  PendingEvolution,
  PendingEvolutionOption,
  UserData,
} from "../../../../shared/types.js";
import { getSpeciesByName, getVariantById } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import {
  buildLevelEvolutionContext,
  evolvePokemon,
  getEvolutionBranches,
  getMatchingEvolutionBranches,
} from "./growth.js";
import { findPokemonByUid, getPartyPokemon } from "./pokemon-state.js";

export { GameRuleError as PendingEvolutionError };

/**
 * Display name for an evolution target. When the branch points at a variant
 * form (e.g. Lycanroc Midnight), prefer the variant's name so the portal can
 * label the chosen form correctly; otherwise fall back to the species name.
 */
function resolveTargetName(targetSpecies: string, targetVariantId?: string | null): string {
  if (targetVariantId) {
    const variant = getVariantById(targetVariantId);
    if (variant) {
      return variant.name;
    }
  }
  return getSpeciesByName(targetSpecies)?.name ?? targetSpecies;
}

function buildOption(branch: EvolutionBranch): PendingEvolutionOption {
  return {
    branchId: branch.id,
    targetSpecies: branch.targetSpecies,
    ...(branch.targetVariantId ? { targetVariantId: branch.targetVariantId } : {}),
    targetName: resolveTargetName(branch.targetSpecies, branch.targetVariantId),
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

/**
 * Retroactively queue pending evolutions for Pokémon that are ALREADY eligible
 * but never re-level (so the level-up evolution path in growth.ts never fires
 * for them) — e.g. level-100 base forms caught under the old party-scaling.
 *
 * Uses the SAME matching logic as the level-up path, so only genuinely-eligible
 * evolutions are offered; item/trade evolutions won't match here (no usedItem/
 * trade context) and are correctly excluded. This only QUEUES pending choices —
 * it never auto-transforms — so the player confirms via /evolutions/resolve.
 *
 * Returns the number of newly queued pending evolutions.
 */
export function syncEligibleEvolutions(
  user: UserData,
  opts: { now?: Date; region?: string } = {},
): number {
  const party = getPartyPokemon(user);
  const handledUids = new Set((user.pendingEvolutions ?? []).map((p) => p.pokemonUid));

  let queued = 0;
  for (const mon of [...user.pokemon, ...user.storage]) {
    if (handledUids.has(mon.uid)) {
      continue;
    }

    const branches = getMatchingEvolutionBranches(mon.species, {
      level: mon.level,
      ...buildLevelEvolutionContext(mon, party, { now: opts.now, region: opts.region }),
    });

    if (branches.length >= 1) {
      queuePendingEvolution(user, mon, branches);
      handledUids.add(mon.uid);
      queued++;
    }
  }

  return queued;
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

  const pokemon = findPokemonByUid(user, pendingEvolution.pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found.", 404);
  }
  if (pokemon.species !== pendingEvolution.sourceSpecies) {
    throw new GameRuleError("Pokemon species no longer matches the pending evolution.");
  }

  // The stored option is a snapshot from when the pending was queued and may
  // predate later evolution-data changes (e.g. a branch gaining a
  // targetVariantId). Resolve the branch from the CURRENT evolution data by id
  // and treat that as authoritative, falling back to the snapshot only if the
  // branch no longer exists.
  const currentBranch = getEvolutionBranches(pendingEvolution.sourceSpecies)
    .find((branch) => branch.id === branchId);
  const targetSpecies = currentBranch?.targetSpecies ?? option.targetSpecies;
  const targetVariantId = currentBranch ? currentBranch.targetVariantId : option.targetVariantId;

  evolvePokemon(pokemon, targetSpecies, targetVariantId);
  if (!user.pokedex.includes(targetSpecies)) {
    user.pokedex.push(targetSpecies);
  }

  user.pendingEvolutions = pendingEvolutions.filter((entry) => entry.id !== pendingEvolutionId);

  return {
    pendingEvolution,
    pokemon,
    targetSpecies,
  };
}
