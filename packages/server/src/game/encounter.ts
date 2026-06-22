import type { RegionData } from "../../../../shared/types.js";

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
