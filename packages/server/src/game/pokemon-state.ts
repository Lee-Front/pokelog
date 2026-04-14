import type { SpeciesData, VariantData } from "../../../../shared/types.js";
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

export function getDisplaySpeciesName(species: string): string {
  return getSpeciesByName(species)?.name ?? species;
}
