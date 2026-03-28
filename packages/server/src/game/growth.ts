import { getSpeciesByName, getEvolutions } from "./data-loader.js";
import type { OwnedPokemon, PokemonStats } from "../../../../shared/types.js";

export function getExpForLevel(level: number): number {
  return level ** 3;
}

export function checkLevelUp(pokemon: OwnedPokemon): {
  leveled: boolean;
  newLevel: number;
  newMoves: string[];
} {
  const speciesData = getSpeciesByName(pokemon.species);

  let currentLevel = pokemon.level;
  const newMoves: string[] = [];

  while (currentLevel < 100 && pokemon.exp >= getExpForLevel(currentLevel + 1)) {
    currentLevel++;

    // Check learnset for moves at this level
    if (speciesData) {
      const movesAtLevel = speciesData.learnset[String(currentLevel)];
      if (movesAtLevel) {
        newMoves.push(...movesAtLevel);
      }
    }
  }

  return {
    leveled: currentLevel > pokemon.level,
    newLevel: currentLevel,
    newMoves,
  };
}

export function calculateStatsForLevel(
  species: string,
  level: number,
): { hp: number; maxHp: number; stats: PokemonStats } {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const hp = Math.floor(((speciesData.baseStats.hp * 2 * level) / 100) + level + 10);
  const stats: PokemonStats = {
    attack: Math.floor(((speciesData.baseStats.attack * 2 * level) / 100) + 5),
    defense: Math.floor(((speciesData.baseStats.defense * 2 * level) / 100) + 5),
    speed: Math.floor(((speciesData.baseStats.speed * 2 * level) / 100) + 5),
    spAttack: Math.floor(((speciesData.baseStats.spAttack * 2 * level) / 100) + 5),
    spDefense: Math.floor(((speciesData.baseStats.spDefense * 2 * level) / 100) + 5),
  };

  return { hp, maxHp: hp, stats };
}

export function checkEvolution(species: string, level: number): string | null {
  const evolution = getEvolutions();
  const evo = evolution[species];

  if (!evo || !evo.evolvesTo || !evo.condition) {
    return null;
  }

  if (evo.condition.type === "level" && level >= evo.condition.level) {
    return evo.evolvesTo;
  }

  return null;
}
