import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeciesData } from "../../../../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

let speciesCache: SpeciesData[] | null = null;

function loadSpecies(): SpeciesData[] {
  if (!speciesCache) {
    const filePath = path.resolve(PROJECT_ROOT, "data/pokemon/species.json");
    speciesCache = JSON.parse(readFileSync(filePath, "utf-8")) as SpeciesData[];
  }
  return speciesCache;
}

export function calculateCaptureChance(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
): number {
  const chance = ballCatchBonus * (1 - currentHp / maxHp) * 0.5 + baseCatchRate;
  return Math.min(1.0, chance);
}

export function attemptCapture(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
): boolean {
  const chance = calculateCaptureChance(ballCatchBonus, currentHp, maxHp, baseCatchRate);
  return Math.random() < chance;
}

export function getCatchRate(species: string): number {
  const allSpecies = loadSpecies();
  const data = allSpecies.find((s) => s.species === species);
  return data?.catchRate ?? 0.1;
}

/** Clear caches (useful for testing) */
export function _clearCache(): void {
  speciesCache = null;
}
