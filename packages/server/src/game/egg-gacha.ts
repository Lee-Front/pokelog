import crypto from "node:crypto";
import { getEvolutions, getSpecies, getVariants } from "./data-loader.js";
import { createPokemon } from "./pokemon-factory.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import type { EggTierId, OwnedEgg, OwnedPokemon, SpeciesData } from "../../../../shared/types.js";

interface EggPoolEntry {
  species: string;
  weight: number;
}

interface EggTierConfig {
  tier: EggTierId;
  label: string;
  cost: number;
  levelRange: [number, number];
  pool: () => EggPoolEntry[];
}

const EGG_TIER_CONFIGS: EggTierConfig[] = [
  {
    tier: "common",
    label: "Common Egg",
    cost: 120,
    levelRange: [1, 6],
    pool: () => buildTierPool("common"),
  },
  {
    tier: "rare",
    label: "Rare Egg",
    cost: 450,
    levelRange: [5, 12],
    pool: () => buildTierPool("rare"),
  },
  {
    tier: "legend",
    label: "Legend Egg",
    cost: 3200,
    levelRange: [15, 25],
    pool: () => buildTierPool("legend"),
  },
];

let eggBaseStageSpecies: Set<string> | null = null;

function getBaseStageSpecies(): Set<string> {
  if (!eggBaseStageSpecies) {
    const targets = new Set<string>();
    for (const evolution of Object.values(getEvolutions())) {
      for (const branch of evolution.branches) {
        targets.add(branch.targetSpecies);
      }
    }
    eggBaseStageSpecies = new Set(
      getSpecies()
        .filter((species) => !targets.has(species.species))
        .map((species) => species.species),
    );
  }

  return eggBaseStageSpecies;
}

function isEggBaseSpecies(species: SpeciesData): boolean {
  return getBaseStageSpecies().has(species.species);
}

function getEggEligibleSpecies(tier: EggTierId): SpeciesData[] {
  return getSpecies().filter((species) => {
    if (!isEggBaseSpecies(species)) {
      return false;
    }

    if (tier === "legend") {
      return species.isLegendary || species.isMythical;
    }

    if (species.isLegendary || species.isMythical) {
      return false;
    }

    const rawCaptureRate = species.rawCaptureRate ?? 0;
    if (tier === "common") {
      return !species.isBaby && rawCaptureRate >= 120;
    }

    return species.isBaby || rawCaptureRate < 120;
  });
}

function getEggWeight(species: SpeciesData, tier: EggTierId): number {
  const rawCaptureRate = species.rawCaptureRate ?? 0;
  const baseExpYield = species.baseExpYield ?? 0;

  if (tier === "common") {
    return Math.max(8, rawCaptureRate + Math.floor(baseExpYield / 12));
  }

  if (tier === "rare") {
    if (species.isBaby) {
      return Math.max(24, 180 + Math.floor(baseExpYield / 6) + Math.floor(rawCaptureRate / 4));
    }
    return Math.max(16, (256 - rawCaptureRate) * 2 + Math.floor(baseExpYield / 4));
  }

  return species.isMythical ? 1 : 3;
}

// Egg-eligible regional variants ride on the egg pool of their base species:
// a variant only appears in a tier when its base species qualifies for that
// tier, so a Diglett-Alola can hatch from a common egg but a (line-evolved)
// Dugtrio-Alola never can. Variants are rarer than the standard form, so their
// weight is scaled down from the base species' weight.
const VARIANT_EGG_WEIGHT_RATIO = 0.25;

function getEggEligibleVariantEntries(eligibleBaseSpecies: SpeciesData[], tier: EggTierId): EggPoolEntry[] {
  const weightByBaseSpecies = new Map(
    eligibleBaseSpecies.map((species) => [species.species, getEggWeight(species, tier)]),
  );

  return getVariants()
    .filter((variant) => variant.eggEligible && weightByBaseSpecies.has(variant.baseSpecies))
    .map((variant) => ({
      species: variant.id,
      weight: Math.max(1, Math.round(weightByBaseSpecies.get(variant.baseSpecies)! * VARIANT_EGG_WEIGHT_RATIO)),
    }));
}

function buildTierPool(tier: EggTierId): EggPoolEntry[] {
  const eligibleBaseSpecies = getEggEligibleSpecies(tier);
  const baseEntries = eligibleBaseSpecies.map((species) => ({
    species: species.species,
    weight: getEggWeight(species, tier),
  }));

  return [...baseEntries, ...getEggEligibleVariantEntries(eligibleBaseSpecies, tier)];
}

function getTierConfig(tier: EggTierId): EggTierConfig {
  const config = EGG_TIER_CONFIGS.find((entry) => entry.tier === tier);
  if (!config) {
    throw new Error(`Unknown egg tier: ${tier}`);
  }
  return config;
}

function getValidPoolEntries(tier: EggTierId): EggPoolEntry[] {
  return getTierConfig(tier).pool().filter((entry) => Boolean(resolveSpeciesOrVariant(entry.species).speciesData));
}

function rollWeightedEntry(entries: EggPoolEntry[]): EggPoolEntry {
  if (entries.length === 0) {
    throw new Error("Egg pool is empty");
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }

  return entries[entries.length - 1];
}

function rollLevel([minLevel, maxLevel]: [number, number]): number {
  return Math.floor(Math.random() * (maxLevel - minLevel + 1)) + minLevel;
}

export function getEggTierPool(tier: EggTierId): ReadonlyArray<{ species: string; weight: number }> {
  return getValidPoolEntries(tier);
}

export function getEggTierSummaries(): Array<{ tier: EggTierId; label: string; cost: number; speciesCount: number }> {
  return EGG_TIER_CONFIGS.map(({ tier, label, cost }) => ({
    tier,
    label,
    cost,
    speciesCount: getValidPoolEntries(tier).length,
  }));
}

export function createEgg(tier: EggTierId): OwnedEgg {
  return {
    id: crypto.randomUUID(),
    tier,
    createdAt: new Date().toISOString(),
  };
}

export function hatchEgg(egg: OwnedEgg): { pokemon: OwnedPokemon; label: string } {
  const config = getTierConfig(egg.tier);
  const entry = rollWeightedEntry(getValidPoolEntries(egg.tier));
  const level = rollLevel(config.levelRange);

  return {
    pokemon: createPokemon(entry.species, level),
    label: config.label,
  };
}

export function clearEggGachaCache(): void {
  eggBaseStageSpecies = null;
}
