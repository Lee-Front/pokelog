import crypto from "node:crypto";
import { getEvolutions, getSpecies, getVariants } from "./data-loader.js";
import { createPokemon } from "./pokemon-factory.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { getConfig } from "../storage/config-store.js";
import type { EggConfig, EggTierId, OwnedEgg, OwnedPokemon, SpeciesData } from "../../../../shared/types.js";

interface EggPoolEntry {
  species: string;
  weight: number;
}

// 티어별 라벨은 표시 전용 상수(운영 편집 대상 아님). cost·레벨·가중치는 config.egg에서 온다.
const TIER_LABELS: Record<EggTierId, string> = {
  common: "Common Egg",
  rare: "Rare Egg",
  legend: "Legend Egg",
};

const EGG_TIER_ORDER: EggTierId[] = ["common", "rare", "legend"];

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

// weightMultiplier(>0, 기본 1)를 종별 공식 결과에 곱해 티어 풀의 전체 가중치를 스케일.
// 풀 내부 상대비는 그대로 유지된다(같은 배수). 최소 1로 클램프해 0-가중치 항목을 막는다.
function scaleWeight(weight: number, multiplier: number): number {
  return Math.max(1, Math.round(weight * multiplier));
}

// Egg-eligible regional variants ride on the egg pool of their base species:
// a variant only appears in a tier when its base species qualifies for that
// tier, so a Diglett-Alola can hatch from a common egg but a (line-evolved)
// Dugtrio-Alola never can. Variants are rarer than the standard form, so their
// weight is scaled down from the base species' weight.
const VARIANT_EGG_WEIGHT_RATIO = 0.25;

function getEggEligibleVariantEntries(
  eligibleBaseSpecies: SpeciesData[],
  tier: EggTierId,
  multiplier: number,
): EggPoolEntry[] {
  const weightByBaseSpecies = new Map(
    eligibleBaseSpecies.map((species) => [species.species, getEggWeight(species, tier)]),
  );

  return getVariants()
    .filter((variant) => variant.eggEligible && weightByBaseSpecies.has(variant.baseSpecies))
    .map((variant) => ({
      species: variant.id,
      weight: scaleWeight(weightByBaseSpecies.get(variant.baseSpecies)! * VARIANT_EGG_WEIGHT_RATIO, multiplier),
    }));
}

function buildTierPool(tier: EggTierId, multiplier: number): EggPoolEntry[] {
  const eligibleBaseSpecies = getEggEligibleSpecies(tier);
  const baseEntries = eligibleBaseSpecies.map((species) => ({
    species: species.species,
    weight: scaleWeight(getEggWeight(species, tier), multiplier),
  }));

  return [...baseEntries, ...getEggEligibleVariantEntries(eligibleBaseSpecies, tier, multiplier)];
}

// config.egg에서 티어 설정을 읽어 폴백 적용. 값이 비정상이면 DEFAULT_CONFIG 머지가
// 이미 처리하므로 여기선 그대로 사용한다.
async function getEggConfig(): Promise<EggConfig> {
  return (await getConfig()).egg;
}

function getValidPoolEntries(tier: EggTierId, multiplier: number): EggPoolEntry[] {
  return buildTierPool(tier, multiplier).filter((entry) =>
    Boolean(resolveSpeciesOrVariant(entry.species).speciesData),
  );
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

function rollLevel(minLevel: number, maxLevel: number): number {
  return Math.floor(Math.random() * (maxLevel - minLevel + 1)) + minLevel;
}

export async function getEggTierPool(
  tier: EggTierId,
): Promise<ReadonlyArray<{ species: string; weight: number }>> {
  const egg = await getEggConfig();
  return getValidPoolEntries(tier, egg[tier].weightMultiplier);
}

export async function getEggTierSummaries(): Promise<
  Array<{ tier: EggTierId; label: string; cost: number; speciesCount: number }>
> {
  const egg = await getEggConfig();
  return EGG_TIER_ORDER.map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    cost: egg[tier].cost,
    speciesCount: getValidPoolEntries(tier, egg[tier].weightMultiplier).length,
  }));
}

export function createEgg(tier: EggTierId): OwnedEgg {
  return {
    id: crypto.randomUUID(),
    tier,
    createdAt: new Date().toISOString(),
  };
}

export async function hatchEgg(egg: OwnedEgg): Promise<{ pokemon: OwnedPokemon; label: string }> {
  const eggConfig = await getEggConfig();
  const tierConfig = eggConfig[egg.tier];
  const entry = rollWeightedEntry(getValidPoolEntries(egg.tier, tierConfig.weightMultiplier));
  const level = rollLevel(tierConfig.minLevel, tierConfig.maxLevel);

  return {
    pokemon: createPokemon(entry.species, level),
    label: TIER_LABELS[egg.tier],
  };
}

export function clearEggGachaCache(): void {
  eggBaseStageSpecies = null;
}
