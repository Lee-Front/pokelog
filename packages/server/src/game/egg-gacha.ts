import crypto from "node:crypto";
import { getEvolutions, getSpecies, getSpeciesByName } from "./data-loader.js";
import { createPokemon } from "./pokemon-factory.js";
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

// 의사전설(pseudo-legendary) 종족값 합계 기준 (600 이상)
const PSEUDO_LEGENDARY_BST = 600;

function getBaseStatTotal(species: SpeciesData): number {
  const s = species.baseStats;
  return s.hp + s.attack + s.defense + s.spAttack + s.spDefense + s.speed;
}

const EGG_TIER_CONFIGS: EggTierConfig[] = [
  {
    tier: "common",
    label: "Common Egg",
    cost: 120,
    levelRange: [1, 6],
    pool: () => getEggEligibleSpecies("common").map((species) => ({
      species: species.species,
      weight: getEggWeight(species, "common"),
    })),
  },
  {
    tier: "rare",
    label: "Rare Egg",
    cost: 450,
    levelRange: [5, 12],
    pool: () => getEggEligibleSpecies("rare").map((species) => ({
      species: species.species,
      weight: getEggWeight(species, "rare"),
    })),
  },
  {
    tier: "epic",
    label: "Epic Egg",
    cost: 1200,
    levelRange: [10, 18],
    pool: () => getEggEligibleSpecies("epic").map((species) => ({
      species: species.species,
      weight: getEggWeight(species, "epic"),
    })),
  },
  {
    tier: "legend",
    label: "Legendary Egg",
    cost: 3200,
    levelRange: [15, 25],
    pool: () => getEggEligibleSpecies("legend").map((species) => ({
      species: species.species,
      weight: getEggWeight(species, "legend"),
    })),
  },
  {
    tier: "manaphy",
    label: "Manaphy Egg",
    cost: 5000,
    levelRange: [1, 1],
    pool: () => getEggEligibleSpecies("manaphy").map((species) => ({
      species: species.species,
      weight: getEggWeight(species, "manaphy"),
    })),
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

    // manaphy: Manaphy + Phione only
    if (tier === "manaphy") {
      return species.species === "manaphy" || species.species === "phione";
    }

    if (tier === "legend") {
      return species.isLegendary || species.isMythical;
    }

    if (species.isLegendary || species.isMythical) {
      return false;
    }

    // epic: pseudo-legendary (BST >= 600) or very rare non-legendary (captureRate < 45)
    if (tier === "epic") {
      const bst = getBaseStatTotal(species);
      const rawCaptureRate = species.rawCaptureRate ?? 0;
      return bst >= PSEUDO_LEGENDARY_BST || rawCaptureRate < 45;
    }

    const rawCaptureRate = species.rawCaptureRate ?? 0;
    if (tier === "common") {
      return !species.isBaby && rawCaptureRate >= 120;
    }

    // rare: baby or mid-range difficulty (45 <= captureRate < 120)
    const bst = getBaseStatTotal(species);
    return (species.isBaby || rawCaptureRate < 120) && bst < PSEUDO_LEGENDARY_BST && rawCaptureRate >= 45;
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

  if (tier === "epic") {
    const bst = getBaseStatTotal(species);
    // Higher BST = rarer within epic tier
    return bst >= PSEUDO_LEGENDARY_BST ? 2 : Math.max(4, Math.floor((256 - rawCaptureRate) / 8));
  }

  if (tier === "manaphy") {
    // Manaphy is rarer than Phione
    return species.species === "manaphy" ? 1 : 3;
  }

  // legend
  return species.isMythical ? 1 : 3;
}

function getTierConfig(tier: EggTierId): EggTierConfig {
  const config = EGG_TIER_CONFIGS.find((entry) => entry.tier === tier);
  if (!config) {
    throw new Error(`Unknown egg tier: ${tier}`);
  }
  return config;
}

function getValidPoolEntries(tier: EggTierId): EggPoolEntry[] {
  return getTierConfig(tier).pool().filter((entry) => Boolean(getSpeciesByName(entry.species)));
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
