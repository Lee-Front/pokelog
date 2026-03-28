import crypto from "node:crypto";
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getAllSpeciesList } from "./data-loader.js";
import type {
  SpeciesData,
  MoveData,
  OwnedPokemon,
  WildPokemon,
  PokemonMove,
  PokemonStats,
} from "../../../../shared/types.js";

function calcHp(baseHp: number, level: number): number {
  return Math.floor(((baseHp * 2 * level) / 100) + level + 10);
}

function calcStat(baseStat: number, level: number): number {
  return Math.floor(((baseStat * 2 * level) / 100) + 5);
}

function buildStats(species: SpeciesData, level: number): { maxHp: number; stats: PokemonStats } {
  const maxHp = calcHp(species.baseStats.hp, level);
  const stats: PokemonStats = {
    attack: calcStat(species.baseStats.attack, level),
    defense: calcStat(species.baseStats.defense, level),
    speed: calcStat(species.baseStats.speed, level),
    spAttack: calcStat(species.baseStats.spAttack, level),
    spDefense: calcStat(species.baseStats.spDefense, level),
  };
  return { maxHp, stats };
}

function buildMoves(species: SpeciesData, level: number): PokemonMove[] {
  const allMoves = getMoves();
  const moveMap = new Map(allMoves.map((m) => [m.id, m]));

  // Collect all moves learnable at or below current level
  const learnableMoves: string[] = [];
  const sortedLevels = Object.keys(species.learnset)
    .map(Number)
    .sort((a, b) => a - b);

  for (const lvl of sortedLevels) {
    if (lvl <= level) {
      for (const moveId of species.learnset[String(lvl)]) {
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

export function createPokemon(species: string, level: number): OwnedPokemon {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level);
  const moves = buildMoves(speciesData, level);

  return {
    uid: crypto.randomUUID(),
    species,
    nickname: null,
    level,
    exp: 0,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    caughtAt: new Date().toISOString(),
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
