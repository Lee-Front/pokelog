import type { RegionData } from "../../../../shared/types.js";

export function checkEncounter(
  ceiling: number,
  commitBytes: number,
  baseChance: number,
  comboMultiplier: number,
  ceilingBytes: number
): { encountered: boolean; newCeiling: number } {
  const newCeiling = ceiling + commitBytes;

  const effectiveChance = baseChance * comboMultiplier;
  const probabilityTriggered = Math.random() < effectiveChance;
  const ceilingTriggered = newCeiling >= ceilingBytes;

  if (probabilityTriggered || ceilingTriggered) {
    return { encountered: true, newCeiling: 0 };
  }

  return { encountered: false, newCeiling };
}

export function selectWildPokemon(
  regionData: RegionData
): { species: string; level: number; minLevel: number } {
  const totalWeight = regionData.encounters.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const entry of regionData.encounters) {
    roll -= entry.weight;
    if (roll <= 0) {
      return rollEntry(entry);
    }
  }

  // Fallback to last entry
  const last = regionData.encounters[regionData.encounters.length - 1];
  return rollEntry(last);
}

function rollEntry(
  entry: RegionData["encounters"][number]
): { species: string; level: number; minLevel: number } {
  const [minLevel, maxLevel] = entry.levelRange;
  const level = Math.floor(Math.random() * (maxLevel - minLevel + 1)) + minLevel;
  return { species: entry.species, level, minLevel };
}

const WILD_LEVEL_VARIANCE = 3;
const WILD_LEVEL_CAP = 100;

/**
 * Scale a wild encounter's level to the player's party so that a stronger party
 * meets stronger wild Pokémon. Anchors on the party's highest level, applies a
 * ±variance jitter, and clamps to the species' natural floor and a hard cap.
 *
 * Falls back to the species-rolled base level when the party is empty (new users).
 */
export function scaleWildLevel(
  baseLevel: number,
  partyLevels: number[],
  speciesMinLevel: number
): number {
  if (partyLevels.length === 0) {
    return baseLevel;
  }

  const anchor = Math.max(...partyLevels);
  const jitter =
    Math.floor(Math.random() * (WILD_LEVEL_VARIANCE * 2 + 1)) - WILD_LEVEL_VARIANCE;
  const target = anchor + jitter;

  const floor = Math.max(1, speciesMinLevel);
  return Math.min(WILD_LEVEL_CAP, Math.max(floor, target));
}
