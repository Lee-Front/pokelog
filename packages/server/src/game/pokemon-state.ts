import type { SpeciesData, VariantData, UserData, OwnedPokemon } from "../../../../shared/types.js";
import type { PvpPlayerState, PvpPokemon } from "../../../../shared/pvp-types.js";
import { getSpeciesByName, getVariantById } from "./data-loader.js";

export interface PokemonIdentity {
  baseSpecies: string;
  speciesData: SpeciesData | null;
  variantId: string | null;
  variant: VariantData | null;
}

export function resolveSpeciesOrVariant(species: string): PokemonIdentity {
  const speciesData = getSpeciesByName(species);
  if (speciesData) {
    return {
      baseSpecies: species,
      speciesData,
      variantId: null,
      variant: null,
    };
  }

  const variant = getVariantById(species) ?? null;
  const baseSpecies = variant?.baseSpecies ?? species;
  return {
    baseSpecies,
    speciesData: getSpeciesByName(baseSpecies) ?? null,
    variantId: variant?.id ?? null,
    variant,
  };
}

export function getEffectiveVariantId(
  variantId?: string | null,
  battleForm?: string | null,
): string | null {
  return battleForm ?? variantId ?? null;
}

export function getEffectiveVariant(
  variantId?: string | null,
  battleForm?: string | null,
): VariantData | null {
  const effectiveVariantId = getEffectiveVariantId(variantId, battleForm);
  if (!effectiveVariantId) {
    return null;
  }
  return getVariantById(effectiveVariantId) ?? null;
}

export function getEffectiveTypes(
  species: string,
  variantId?: string | null,
  battleForm?: string | null,
): string[] {
  const variant = getEffectiveVariant(variantId, battleForm);
  if (variant?.typing) {
    return variant.typing;
  }
  return getSpeciesByName(species)?.types ?? [];
}

/**
 * Resolve the effective battle types for a PvP pokemon.
 * When Terastallized, returns `[teraType]` (single-type override).
 * Otherwise falls back to getEffectiveTypes with the player's current battle form.
 */
export function getBattleTypes(poke: PvpPokemon, player: PvpPlayerState): string[] {
  if (player.teraActive && poke.teraType) {
    return [poke.teraType];
  }
  return getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
}

export function getDisplaySpeciesName(species: string): string {
  return getSpeciesByName(species)?.name ?? species;
}

export function findPokemonByUid(user: UserData, uid: string): OwnedPokemon | undefined {
  return user.pokemon.find((p) => p.uid === uid)
    ?? user.storage.find((p) => p.uid === uid);
}

export function getPartyPokemon(user: UserData): OwnedPokemon[] {
  return user.party
    .map((uid) => user.pokemon.find((p) => p.uid === uid))
    .filter((p): p is OwnedPokemon => p != null);
}
