import type { OwnedPokemon, PokemonStats, PokemonIVs, PokemonEVs, SpeciesData } from "../../../../shared/types.js";
import { getSpeciesByName, getNatureById } from "./data-loader.js";
import { getEffectiveVariant } from "./pokemon-state.js";

// 본가식 — 개체값(IV, 0~31)과 노력치(EV, floor(EV/4))를 종족값에 더해 반영한다.
// IV=0·EV=0이면 종전과 동일.
function calcHp(baseHp: number, level: number, iv = 0, ev = 0): number {
  return Math.floor(((2 * baseHp + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function calcStat(baseStat: number, level: number, iv = 0, ev = 0): number {
  return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + 5;
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
  evs?: PokemonEVs,
): { maxHp: number; stats: PokemonStats } {
  const baseStats = { ...species.baseStats };
  const variant = getEffectiveVariant(variantId);
  if (variant?.baseStatsOverride) {
    Object.assign(baseStats, variant.baseStatsOverride);
  }

  const maxHp = calcHp(baseStats.hp, level, ivs?.hp ?? 0, evs?.hp ?? 0);
  const stats: PokemonStats = {
    attack: calcStat(baseStats.attack, level, ivs?.attack ?? 0, evs?.attack ?? 0),
    defense: calcStat(baseStats.defense, level, ivs?.defense ?? 0, evs?.defense ?? 0),
    speed: calcStat(baseStats.speed, level, ivs?.speed ?? 0, evs?.speed ?? 0),
    spAttack: calcStat(baseStats.spAttack, level, ivs?.spAttack ?? 0, evs?.spAttack ?? 0),
    spDefense: calcStat(baseStats.spDefense, level, ivs?.spDefense ?? 0, evs?.spDefense ?? 0),
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
  evs?: PokemonEVs,
): { hp: number; maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId, ivs, evs);
  return { hp: maxHp, maxHp, stats };
}

export function buildStatsForPokemon(
  pokemon: Pick<OwnedPokemon, "species" | "level" | "nature" | "variantId" | "ivs" | "evs">,
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
    pokemon.evs,
  );
}
