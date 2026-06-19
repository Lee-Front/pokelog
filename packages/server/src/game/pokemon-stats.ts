import type { OwnedPokemon, PokemonStats, PokemonIVs, SpeciesData } from "../../../../shared/types.js";
import { getSpeciesByName, getNatureById } from "./data-loader.js";
import { getEffectiveVariant } from "./pokemon-state.js";

// 본가식 — 개체값(IV, 0~31)을 종족값에 더해 반영한다. EV는 미구현(0). IV=0이면 종전과 동일.
function calcHp(baseHp: number, level: number, iv = 0): number {
  return Math.floor(((2 * baseHp + iv) * level) / 100) + level + 10;
}

function calcStat(baseStat: number, level: number, iv = 0): number {
  return Math.floor(((2 * baseStat + iv) * level) / 100) + 5;
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
  ivs?: PokemonIVs,
): { maxHp: number; stats: PokemonStats } {
  const baseStats = { ...species.baseStats };
  const variant = getEffectiveVariant(variantId);
  if (variant?.baseStatsOverride) {
    Object.assign(baseStats, variant.baseStatsOverride);
  }

  const maxHp = calcHp(baseStats.hp, level, ivs?.hp ?? 0);
  const stats: PokemonStats = {
    attack: calcStat(baseStats.attack, level, ivs?.attack ?? 0),
    defense: calcStat(baseStats.defense, level, ivs?.defense ?? 0),
    speed: calcStat(baseStats.speed, level, ivs?.speed ?? 0),
    spAttack: calcStat(baseStats.spAttack, level, ivs?.spAttack ?? 0),
    spDefense: calcStat(baseStats.spDefense, level, ivs?.spDefense ?? 0),
  };
  applyNatureModifier(stats, nature);
  return { maxHp, stats };
}

export function calculateStatsForLevel(
  species: string,
  level: number,
  nature?: string,
  variantId?: string | null,
  ivs?: PokemonIVs,
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
