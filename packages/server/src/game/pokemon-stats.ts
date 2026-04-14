import type { OwnedPokemon, PokemonStats, SpeciesData } from "../../../../shared/types.js";
import { getSpeciesByName, getNatureById } from "./data-loader.js";
import { getEffectiveVariant } from "./pokemon-state.js";

function calcHp(baseHp: number, level: number): number {
  return Math.floor(((baseHp * 2 * level) / 100) + level + 10);
}

function calcStat(baseStat: number, level: number): number {
  return Math.floor(((baseStat * 2 * level) / 100) + 5);
}

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
): { maxHp: number; stats: PokemonStats } {
  const baseStats = { ...species.baseStats };
  const variant = getEffectiveVariant(variantId);
  if (variant?.baseStatsOverride) {
    Object.assign(baseStats, variant.baseStatsOverride);
  }

  const maxHp = calcHp(baseStats.hp, level);
  const stats: PokemonStats = {
    attack: calcStat(baseStats.attack, level),
    defense: calcStat(baseStats.defense, level),
    speed: calcStat(baseStats.speed, level),
    spAttack: calcStat(baseStats.spAttack, level),
    spDefense: calcStat(baseStats.spDefense, level),
  };
  applyNatureModifier(stats, nature);
  return { maxHp, stats };
}

export function calculateStatsForLevel(
  species: string,
  level: number,
  nature?: string,
  variantId?: string | null,
): { hp: number; maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId);
  return { hp: maxHp, maxHp, stats };
}

export function buildStatsForPokemon(
  pokemon: Pick<OwnedPokemon, "species" | "level" | "nature" | "variantId">,
  battleForm?: string | null,
): { maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(pokemon.species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${pokemon.species}`);
  }
  return buildStats(speciesData, pokemon.level, pokemon.nature, battleForm ?? pokemon.variantId ?? null);
}
