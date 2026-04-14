import crypto from "node:crypto";
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getAllSpeciesList, getNatures, getNatureById } from "./data-loader.js";
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

function applyNatureModifier(stats: PokemonStats, nature?: string): void {
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

function buildStats(species: SpeciesData, level: number, nature?: string): { maxHp: number; stats: PokemonStats } {
  const maxHp = calcHp(species.baseStats.hp, level);
  const stats: PokemonStats = {
    attack: calcStat(species.baseStats.attack, level),
    defense: calcStat(species.baseStats.defense, level),
    speed: calcStat(species.baseStats.speed, level),
    spAttack: calcStat(species.baseStats.spAttack, level),
    spDefense: calcStat(species.baseStats.spDefense, level),
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

function pickRandomNature(): string {
  const natures = getNatures();
  return natures.length > 0
    ? natures[Math.floor(Math.random() * natures.length)].id
    : "hardy";
}

export function createPokemon(species: string, level: number): OwnedPokemon {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const { maxHp, stats } = buildStats(speciesData, level, nature);
  const moves = buildMoves(speciesData, level);

  return {
    uid: crypto.randomUUID(),
    species,
    variantId: null,
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
    tradeLocked: false,
    nature,
    isShiny: Math.random() < (1 / 4096),
  };
}

export function createWildPokemon(species: string, level: number): WildPokemon {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level);
  const moves = buildMoves(speciesData, level);

  return {
    species,
    level,
    hp: maxHp,
    maxHp,
    stats,
    moves,
  };
}

export function getAllSpecies(): Array<{ id: number; species: string; name: string }> {
  return getAllSpeciesList();
}
