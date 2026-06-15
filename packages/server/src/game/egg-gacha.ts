import crypto from "node:crypto";
import { getEvolutions, getSpecies, getVariants } from "./data-loader.js";
import { createPokemon } from "./pokemon-factory.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { getConfig } from "../storage/config-store.js";
import type { EggConfig, EggTierConfig, EggTierId, OwnedEgg, OwnedPokemon, SpeciesData } from "../../../../shared/types.js";

interface EggPoolEntry {
  species: string;
  weight: number;
}

// 등급 버킷 — 모든 알이 공유하는 단일 풀을 3등급으로 나눈다. 티어는 버킷 등장확률만
// 다르게 가져 같은 종을 다른 확률로 뽑는다.
type EggBucket = "common" | "rare" | "legendary";

// 티어별 라벨은 표시 전용 상수(운영 편집 대상 아님). cost·레벨·등급확률은 config.egg에서 온다.
const TIER_LABELS: Record<EggTierId, string> = {
  common: "Common Egg",
  rare: "Rare Egg",
  legend: "Legend Egg",
};

const EGG_TIER_ORDER: EggTierId[] = ["common", "rare", "legend"];

// 빈 버킷 폴백 우선순위 — 선택된 버킷이 비면(이론상 없음) 흔한 쪽으로 안전하게 내려간다.
const BUCKET_FALLBACK_ORDER: EggBucket[] = ["common", "rare", "legendary"];

let eggBaseStageSpecies: Set<string> | null = null;
// 버킷별 종/변이 풀 캐시 — config와 무관(종 데이터에만 의존)하므로 한 번만 빌드한다.
let bucketPools: Record<EggBucket, EggPoolEntry[]> | null = null;

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

// 등급 버킷 분류 — 기존 getEggEligibleSpecies의 티어 분기 로직을 그대로 재사용한다.
// 전설/환상은 legendary, (전설 아님) 베이비·저포획률은 rare, 그 외는 common.
function getSpeciesBucket(species: SpeciesData): EggBucket {
  if (species.isLegendary || species.isMythical) {
    return "legendary";
  }
  const rawCaptureRate = species.rawCaptureRate ?? 0;
  if (species.isBaby || rawCaptureRate < 120) {
    return "rare";
  }
  return "common";
}

// 버킷 내 종 가중치 — 포획률 높은 종이 버킷 안에서 더 잘 나오게(기존 getEggWeight 아이디어
// 재활용). legendary 버킷은 환상을 더 희귀하게(isMythical?1:3) 둔다.
function getEggWeight(species: SpeciesData, bucket: EggBucket): number {
  const rawCaptureRate = species.rawCaptureRate ?? 0;
  const baseExpYield = species.baseExpYield ?? 0;

  if (bucket === "common") {
    return Math.max(8, rawCaptureRate + Math.floor(baseExpYield / 12));
  }

  if (bucket === "rare") {
    if (species.isBaby) {
      return Math.max(24, 180 + Math.floor(baseExpYield / 6) + Math.floor(rawCaptureRate / 4));
    }
    return Math.max(16, (256 - rawCaptureRate) * 2 + Math.floor(baseExpYield / 4));
  }

  return species.isMythical ? 1 : 3;
}

// Egg-eligible regional variants ride on the bucket of their base species:
// a variant only appears when its base species is an egg-eligible base stage,
// so a Diglett-Alola lives in the same bucket as Diglett but a (line-evolved)
// Dugtrio-Alola never appears. Variants are rarer than the standard form, so
// their weight is scaled down from the base species' weight.
const VARIANT_EGG_WEIGHT_RATIO = 0.25;

// 최소 1로 클램프해 0-가중치 항목(가중 롤에서 영영 안 뽑힘)을 막는다.
function clampWeight(weight: number): number {
  return Math.max(1, Math.round(weight));
}

function getVariantBucketEntries(weightByBaseSpecies: Map<string, number>): EggPoolEntry[] {
  return getVariants()
    .filter((variant) => variant.eggEligible && weightByBaseSpecies.has(variant.baseSpecies))
    .map((variant) => ({
      species: variant.id,
      weight: clampWeight(weightByBaseSpecies.get(variant.baseSpecies)! * VARIANT_EGG_WEIGHT_RATIO),
    }));
}

// 단일 풀을 버킷별로 빌드 — egg 적격 베이스 종을 버킷으로 분류하고, 각 종의 변이를 같은
// 버킷에 합친다. config와 무관하므로 캐시한다(clearEggGachaCache로 초기화).
function buildBucketPools(): Record<EggBucket, EggPoolEntry[]> {
  if (bucketPools) {
    return bucketPools;
  }

  const pools: Record<EggBucket, EggPoolEntry[]> = { common: [], rare: [], legendary: [] };
  // 변이 가중치 산출용: 베이스 종 → (그 종의 버킷 가중치) 매핑을 버킷별로 모은다.
  const weightByBaseSpecies: Record<EggBucket, Map<string, number>> = {
    common: new Map(),
    rare: new Map(),
    legendary: new Map(),
  };

  for (const species of getSpecies()) {
    if (!isEggBaseSpecies(species)) {
      continue;
    }
    const bucket = getSpeciesBucket(species);
    const weight = clampWeight(getEggWeight(species, bucket));
    pools[bucket].push({ species: species.species, weight });
    weightByBaseSpecies[bucket].set(species.species, getEggWeight(species, bucket));
  }

  for (const bucket of BUCKET_FALLBACK_ORDER) {
    pools[bucket].push(...getVariantBucketEntries(weightByBaseSpecies[bucket]));
  }

  bucketPools = pools;
  return pools;
}

// 알 부화 후보로 실제 해석되는 항목만 남긴다(누락 종 데이터 방어).
function getValidBucketPool(bucket: EggBucket): EggPoolEntry[] {
  return buildBucketPools()[bucket].filter((entry) =>
    Boolean(resolveSpeciesOrVariant(entry.species).speciesData),
  );
}

// config.egg에서 티어 설정을 읽어 폴백 적용. 값이 비정상이면 DEFAULT_CONFIG 머지가
// 이미 처리하므로 여기선 그대로 사용한다.
async function getEggConfig(): Promise<EggConfig> {
  return (await getConfig()).egg;
}

// 티어의 버킷 등장확률 → 선택 버킷. common 확률은 파생(1 - legendary - rare). 선택된
// 버킷이 비어있으면 폴백 순서로 비지 않은 버킷을 찾는다(빈 풀 throw 방지). 주입 가능한
// random으로 결정적 테스트를 지원한다.
function rollBucket(tierConfig: EggTierConfig, random: () => number): EggBucket {
  const legendaryChance = tierConfig.legendaryChance;
  const rareChance = tierConfig.rareChance;
  const roll = random();

  let bucket: EggBucket;
  if (roll < legendaryChance) {
    bucket = "legendary";
  } else if (roll < legendaryChance + rareChance) {
    bucket = "rare";
  } else {
    bucket = "common";
  }

  if (getValidBucketPool(bucket).length > 0) {
    return bucket;
  }
  for (const fallback of BUCKET_FALLBACK_ORDER) {
    if (getValidBucketPool(fallback).length > 0) {
      return fallback;
    }
  }
  return bucket;
}

function rollWeightedEntry(entries: EggPoolEntry[], random: () => number): EggPoolEntry {
  if (entries.length === 0) {
    throw new Error("Egg pool is empty");
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * totalWeight;

  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }

  return entries[entries.length - 1];
}

function rollLevel(minLevel: number, maxLevel: number, random: () => number): number {
  return Math.floor(random() * (maxLevel - minLevel + 1)) + minLevel;
}

// 티어 전체 풀(모든 버킷 합) — 단일 풀 모델이므로 티어와 무관하게 같은 종 집합이지만,
// 기존 export 시그니처(티어별 풀 조회)를 유지한다.
export async function getEggTierPool(
  _tier: EggTierId,
): Promise<ReadonlyArray<{ species: string; weight: number }>> {
  return BUCKET_FALLBACK_ORDER.flatMap((bucket) => getValidBucketPool(bucket));
}

export async function getEggTierSummaries(): Promise<
  Array<{
    tier: EggTierId;
    label: string;
    cost: number;
    speciesCount: number;
    legendaryChance: number;
    rareChance: number;
    commonChance: number;
  }>
> {
  const egg = await getEggConfig();
  const totalSpeciesCount = BUCKET_FALLBACK_ORDER.reduce(
    (sum, bucket) => sum + getValidBucketPool(bucket).length,
    0,
  );
  return EGG_TIER_ORDER.map((tier) => {
    const tierConfig = egg[tier];
    return {
      tier,
      label: TIER_LABELS[tier],
      cost: tierConfig.cost,
      // 단일 풀이므로 모든 티어가 동일한 전체 종 수를 본다(버킷 확률만 다름).
      speciesCount: totalSpeciesCount,
      legendaryChance: tierConfig.legendaryChance,
      rareChance: tierConfig.rareChance,
      commonChance: Math.max(0, 1 - tierConfig.legendaryChance - tierConfig.rareChance),
    };
  });
}

export function createEgg(tier: EggTierId): OwnedEgg {
  return {
    id: crypto.randomUUID(),
    tier,
    createdAt: new Date().toISOString(),
  };
}

export async function hatchEgg(
  egg: OwnedEgg,
  random: () => number = Math.random,
): Promise<{ pokemon: OwnedPokemon; label: string }> {
  const eggConfig = await getEggConfig();
  const tierConfig = eggConfig[egg.tier];

  const bucket = rollBucket(tierConfig, random);
  const entry = rollWeightedEntry(getValidBucketPool(bucket), random);
  const level = rollLevel(tierConfig.minLevel, tierConfig.maxLevel, random);

  return {
    pokemon: createPokemon(entry.species, level),
    label: TIER_LABELS[egg.tier],
  };
}

export function clearEggGachaCache(): void {
  eggBaseStageSpecies = null;
  bucketPools = null;
}
