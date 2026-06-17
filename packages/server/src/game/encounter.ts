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
): { species: string; level: number } {
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
): { species: string; level: number } {
  const [minLevel, maxLevel] = entry.levelRange;
  const level = Math.floor(Math.random() * (maxLevel - minLevel + 1)) + minLevel;
  return { species: entry.species, level };
}
