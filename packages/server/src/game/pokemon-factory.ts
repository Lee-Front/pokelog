import crypto from "node:crypto";
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getAllSpeciesList, getNatures, getVariants } from "./data-loader.js";
import { applyNatureModifier } from "./growth.js";
import type {
  SpeciesData,
  MoveData,
  OwnedPokemon,
  WildPokemon,
  PokemonMove,
  PokemonStats,
} from "../../../../shared/types.js";
import { resolvePokemonGender } from "./pokemon-gender.js";

function calcHp(baseHp: number, level: number): number {
  return Math.floor(((baseHp * 2 * level) / 100) + level + 10);
}

function calcStat(baseStat: number, level: number): number {
  return Math.floor(((baseStat * 2 * level) / 100) + 5);
}

export function buildStats(species: SpeciesData, level: number, nature?: string, variantId?: string | null): { maxHp: number; stats: PokemonStats } {
  const baseStats = { ...species.baseStats };

  // Apply variant stat overrides
  if (variantId) {
    const variant = getVariants().find(v => v.id === variantId);
    if (variant?.baseStatsOverride) {
      Object.assign(baseStats, variant.baseStatsOverride);
    }
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

function buildMoves(species: SpeciesData, level: number): PokemonMove[] {
  const allMoves = getMoves();
  const moveMap = new Map(allMoves.map((m) => [m.id, m]));
  const levelUpLearnset = species.learnset.levelUp;

  // Collect all moves learnable at or below current level
  const learnableMoves: string[] = [];
  const sortedLevels = Object.keys(levelUpLearnset)
    .map(Number)
    .sort((a, b) => a - b);

  for (const lvl of sortedLevels) {
    if (lvl <= level) {
      for (const moveId of levelUpLearnset[String(lvl)]) {
        // Remove duplicates - keep last occurrence
        const idx = learnableMoves.indexOf(moveId);
        if (idx !== -1) {
          learnableMoves.splice(idx, 1);
        }
        learnableMoves.push(moveId);
      }
    }
  }

  // Take last 4 moves
  const selectedIds = learnableMoves.slice(-4);

  return selectedIds.map((id) => {
    const moveData = moveMap.get(id);
    const pp = moveData?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });
}

/** variant slug이면 { baseSpecies, variantId }를, 일반 종이면 { baseSpecies, variantId: null }을 반환 */
function resolveSpeciesOrVariant(species: string): { baseSpecies: string; variantId: string | null } {
  if (getSpeciesByName(species)) {
    return { baseSpecies: species, variantId: null };
  }
  const variant = getVariants().find((v) => v.id === species);
  if (variant && getSpeciesByName(variant.baseSpecies)) {
    return { baseSpecies: variant.baseSpecies, variantId: variant.id };
  }
  return { baseSpecies: species, variantId: null };
}

function pickRandomNature(): string {
  const natures = getNatures();
  return natures.length > 0
    ? natures[Math.floor(Math.random() * natures.length)].id
    : "hardy";
}

export function createPokemon(species: string, level: number): OwnedPokemon {
  const { baseSpecies, variantId } = resolveSpeciesOrVariant(species);
  const speciesData = getSpeciesByName(baseSpecies);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId);
  const moves = buildMoves(speciesData, level);

  return {
    uid: crypto.randomUUID(),
    species: baseSpecies,
    variantId,
    nickname: null,
    level,
    exp: 0,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    caughtAt: new Date().toISOString(),
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    friendship: speciesData.baseHappiness ?? 70,
    heldItem: null,
    abilityId: speciesData.abilities?.normal[0] ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature,
    isShiny: Math.random() < (1 / 4096),
  };
}

export function createWildPokemon(species: string, level: number): WildPokemon {
  const { baseSpecies, variantId } = resolveSpeciesOrVariant(species);
  const speciesData = getSpeciesByName(baseSpecies);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId);
  const moves = buildMoves(speciesData, level);

  return {
    species: baseSpecies,
    variantId: variantId ?? null,
    level,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    nature,
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    ability: speciesData.abilities?.normal[0] ?? undefined,
    isShiny: Math.random() < (1 / 4096),
  };
}

export function wildPokemonToOwned(wild: WildPokemon): OwnedPokemon {
  const speciesData = getSpeciesByName(wild.species);
  return {
    uid: crypto.randomUUID(),
    species: wild.species,
    variantId: wild.variantId ?? null,
    nickname: null,
    level: wild.level,
    exp: 0,
    hp: wild.hp,
    maxHp: wild.maxHp,
    stats: { ...wild.stats },
    moves: wild.moves.map(m => ({ ...m })),
    caughtAt: new Date().toISOString(),
    gender: wild.gender ?? null,
    friendship: speciesData?.baseHappiness ?? 70,
    heldItem: null,
    abilityId: wild.ability ?? speciesData?.abilities?.normal[0] ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: wild.nature ?? "hardy",
    isShiny: wild.isShiny ?? false,
  };
}

export function getAllSpecies(): Array<{ id: number; species: string; name: string }> {
  return getAllSpeciesList();
}
