import { readFileSync } from "node:fs";
import { projectPath } from "../paths.js";
import type { SpeciesData, MoveData, EvolutionData, RegionData } from "../../../../shared/types.js";

type TypeChart = Record<string, Record<string, number>>;

let speciesCache: SpeciesData[] | null = null;
let movesCache: MoveData[] | null = null;
let typeChartCache: TypeChart | null = null;
let evolutionCache: Record<string, EvolutionData> | null = null;
const regionCache = new Map<string, RegionData>();

export function getSpecies(): SpeciesData[] {
  if (!speciesCache) {
    speciesCache = JSON.parse(readFileSync(projectPath("data/pokemon/species.json"), "utf-8"));
  }
  return speciesCache!;
}

export function getSpeciesByName(species: string): SpeciesData | undefined {
  return getSpecies().find((s) => s.species === species);
}

export function getMoves(): MoveData[] {
  if (!movesCache) {
    movesCache = JSON.parse(readFileSync(projectPath("data/moves/moves.json"), "utf-8"));
  }
  return movesCache!;
}

export function getMoveById(id: string): MoveData | undefined {
  return getMoves().find((m) => m.id === id);
}

export function getTypeChart(): TypeChart {
  if (!typeChartCache) {
    typeChartCache = JSON.parse(readFileSync(projectPath("data/types/type-chart.json"), "utf-8"));
  }
  return typeChartCache!;
}

export function getEvolutions(): Record<string, EvolutionData> {
  if (!evolutionCache) {
    evolutionCache = JSON.parse(readFileSync(projectPath("data/pokemon/evolution.json"), "utf-8"));
  }
  return evolutionCache!;
}

export function getRegion(name: string): RegionData {
  if (!regionCache.has(name)) {
    const data = JSON.parse(readFileSync(projectPath(`data/regions/${name}.json`), "utf-8"));
    regionCache.set(name, data);
  }
  return regionCache.get(name)!;
}

export function getAllSpeciesList(): Array<{ id: number; species: string; name: string }> {
  return getSpecies().map((s) => ({ id: s.id, species: s.species, name: s.name }));
}

export function clearAllCaches(): void {
  speciesCache = null;
  movesCache = null;
  typeChartCache = null;
  evolutionCache = null;
  regionCache.clear();
}
