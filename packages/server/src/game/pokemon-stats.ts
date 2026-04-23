import type {
  IndividualValues,
  OwnedPokemon,
  PokemonStats,
  SpeciesData,
} from "../../../../shared/types.js";
import { getSpeciesByName, getNatureById } from "./data-loader.js";
import { getEffectiveVariant } from "./pokemon-state.js";

export function applyNatureModifier(stats: PokemonStats, nature?: string): void {
  if (!nature) return;
  const natureData = getNatureById(nature);
  if (!natureData) return;
  if (natureData.increasedStat && natureData.increasedStat in stats) {
    stats[natureData.increasedStat] = Math.floor(stats[natureData.increasedStat] * 1.1);
  }
  if (natureData.decreasedStat && natureData.decreasedStat in stats) {
    stats[natureData.decreasedStat] = Math.floor(stats[natureData.decreasedStat] * 0.9);
  }
}

export function buildStats(
  species: SpeciesData,
  level: number,
  nature?: string,
  variantId?: string | null,
  ivs?: IndividualValues,
): { maxHp: number; stats: PokemonStats } {
  const baseStats = { ...species.baseStats };
  const variant = getEffectiveVariant(variantId);
  if (variant?.baseStatsOverride) {
    Object.assign(baseStats, variant.baseStatsOverride);
  }

  // IV defaults to 0 for legacy pokemon (preserves existing stats).
  // New pokemon are assigned random IVs at creation time (see pokemon-factory).
  const ivHp = ivs?.hp ?? 0;
  const ivAtk = ivs?.attack ?? 0;
  const ivDef = ivs?.defense ?? 0;
  const ivSpa = ivs?.spAttack ?? 0;
  const ivSpd = ivs?.spDefense ?? 0;
  const ivSpe = ivs?.speed ?? 0;

  const maxHp = Math.floor(((baseStats.hp * 2 + ivHp) * level) / 100) + level + 10;
  const stats: PokemonStats = {
    attack: Math.floor(((baseStats.attack * 2 + ivAtk) * level) / 100) + 5,
    defense: Math.floor(((baseStats.defense * 2 + ivDef) * level) / 100) + 5,
    speed: Math.floor(((baseStats.speed * 2 + ivSpe) * level) / 100) + 5,
    spAttack: Math.floor(((baseStats.spAttack * 2 + ivSpa) * level) / 100) + 5,
    spDefense: Math.floor(((baseStats.spDefense * 2 + ivSpd) * level) / 100) + 5,
  };
  applyNatureModifier(stats, nature);
  return { maxHp, stats };
}

export function calculateStatsForLevel(
  species: string,
  level: number,
  nature?: string,
  variantId?: string | null,
  ivs?: IndividualValues,
): { hp: number; maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId, ivs);
  return { hp: maxHp, maxHp, stats };
}

export function buildStatsForPokemon(
  pokemon: Pick<OwnedPokemon, "species" | "level" | "nature" | "variantId" | "ivs">,
  battleForm?: string | null,
): { maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(pokemon.species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${pokemon.species}`);
  }
  return buildStats(
    speciesData,
    pokemon.level,
    pokemon.nature,
    battleForm ?? pokemon.variantId ?? null,
    pokemon.ivs,
  );
}
