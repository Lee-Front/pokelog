import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, getEvolutions, getSpeciesByName, getVariants } from "../../src/game/data-loader.js";
import { clearEggGachaCache, getEggTierSummaries, hatchEgg, getEggTierPool } from "../../src/game/egg-gacha.js";
import { resolveSpeciesOrVariant } from "../../src/game/pokemon-state.js";

function getPreEvolutionTargets(): Set<string> {
  const targets = new Set<string>();
  for (const evolution of Object.values(getEvolutions())) {
    for (const branch of evolution.branches) {
      targets.add(branch.targetSpecies);
    }
  }
  return targets;
}

function isLegendarySpecies(slug: string): boolean {
  const species = getSpeciesByName(slug);
  return Boolean(species?.isLegendary || species?.isMythical);
}

// 주입용 결정적 random — 호출 순서대로 값을 돌려준다. rollBucket→weighted→level 순으로
// hatchEgg가 3번 호출하므로 [버킷롤, 종롤, 레벨롤]을 넘긴다.
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

beforeEach(() => {
  clearAllCaches();
  clearEggGachaCache();
  vi.restoreAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("egg-gacha", () => {
  it("builds tier summaries with shared species count and per-tier bucket chances", async () => {
    const summaries = await getEggTierSummaries();
    expect(summaries.map((entry) => entry.tier)).toEqual(["common", "rare", "legend"]);
    // 단일 풀 모델: 모든 티어가 같은 전체 종 수를 본다.
    expect(summaries.every((entry) => entry.speciesCount > 0)).toBe(true);
    expect(new Set(summaries.map((entry) => entry.speciesCount)).size).toBe(1);
    expect(summaries.map((entry) => entry.cost)).toEqual([120, 450, 3200]);
    // 등급확률이 노출되고 common은 파생값(1 - legendary - rare).
    const common = summaries.find((s) => s.tier === "common")!;
    expect(common.legendaryChance).toBeCloseTo(0.002);
    expect(common.rareChance).toBeCloseTo(0.12);
    expect(common.commonChance).toBeCloseTo(0.878);
  });

  it("hatches a common-bucket species when the bucket roll lands above the rare/legendary band", async () => {
    // 버킷롤=0.99 → common 버킷, 종롤=0 → 첫 항목, 레벨롤=0 → minLevel.
    const result = await hatchEgg(
      { id: "egg-common", tier: "common", createdAt: new Date().toISOString() },
      seq(0.99, 0, 0),
    );
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(species!.isBaby).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(species!.rawCaptureRate).toBeGreaterThanOrEqual(120);
    expect(result.pokemon.level).toBe(1);
  });

  it("hatches a rare-bucket species when the bucket roll lands in the rare band", async () => {
    // common 알의 rare 밴드: [legendaryChance(0.002), legendaryChance+rareChance(0.122)).
    const result = await hatchEgg(
      { id: "egg-rare", tier: "rare", createdAt: new Date().toISOString() },
      seq(0.05, 0, 0),
    );
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(Boolean(species!.isBaby || (species!.rawCaptureRate ?? 0) < 120)).toBe(true);
    expect(result.pokemon.level).toBe(5);
  });

  it("hatches a legendary-bucket species when the bucket roll lands in the legendary band", async () => {
    // 버킷롤=0 → 항상 legendary 버킷(어떤 티어든 legendaryChance>0).
    const result = await hatchEgg(
      { id: "egg-legend", tier: "legend", createdAt: new Date().toISOString() },
      seq(0, 0, 0),
    );
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(true);
    expect(result.pokemon.level).toBe(15);
  });

  it("exposes every bucket's species in the shared tier pool", async () => {
    const pool = await getEggTierPool("common");
    const poolSlugs = new Set(pool.map((entry) => entry.species));
    // 단일 풀이므로 흔한 종도, 변이도, 전설도 모두 같은 풀에 있다.
    expect(poolSlugs.has("diglett-alola")).toBe(true);
    expect([...poolSlugs].some((slug) => isLegendarySpecies(slug))).toBe(true);
  });

  it("excludes variants whose base species is a line-evolved (non-base-stage) form", async () => {
    const allPoolSlugs = new Set<string>();
    for (const tier of ["common", "rare", "legend"] as const) {
      for (const entry of await getEggTierPool(tier)) allPoolSlugs.add(entry.species);
    }
    // arcanine evolves from growlithe, so arcanine-hisui must never be an egg candidate
    expect(allPoolSlugs.has("arcanine-hisui")).toBe(false);
  });

  it("every variant entry in egg pools resolves to a known base species", async () => {
    const variantIds = new Set(getVariants().map((variant) => variant.id));
    for (const tier of ["common", "rare", "legend"] as const) {
      for (const entry of await getEggTierPool(tier)) {
        if (variantIds.has(entry.species)) {
          const resolved = resolveSpeciesOrVariant(entry.species);
          expect(resolved.variantId).toBe(entry.species);
          expect(resolved.speciesData).not.toBeNull();
        }
      }
    }
  });

  it("hatches a variant egg into a Pokemon carrying the variantId", async () => {
    // diglett-alola는 common 버킷의 변이. 버킷롤=0.99 → common, 종롤=0.999999 → 마지막 항목
    // (변이는 베이스 종 뒤에 붙으므로 common 버킷 마지막은 변이).
    const result = await hatchEgg(
      { id: "egg-variant", tier: "common", createdAt: new Date().toISOString() },
      seq(0.99, 0.999999, 0),
    );
    expect(getVariants().some((variant) => variant.id === result.pokemon.variantId)).toBe(true);
    const resolved = resolveSpeciesOrVariant(result.pokemon.variantId!);
    expect(result.pokemon.species).toBe(resolved.baseSpecies);
  });

  it("keeps variants rarer than their base species within the shared pool", async () => {
    const pool = await getEggTierPool("common");
    const diglett = pool.find((entry) => entry.species === "diglett");
    const diglettAlola = pool.find((entry) => entry.species === "diglett-alola");
    expect(diglett).toBeDefined();
    expect(diglettAlola).toBeDefined();
    expect(diglettAlola!.weight).toBeLessThan(diglett!.weight);
  });
});

describe("egg-gacha bucket distribution", () => {
  // (a) legendaryChance=1이면 항상 전설/환상이 나온다.
  it("always hatches a legendary when the bucket roll always lands in the legendary band", async () => {
    for (const r of [0, 0.0001, 0.001, 0.0019]) {
      clearEggGachaCache();
      const result = await hatchEgg(
        { id: "e", tier: "common", createdAt: new Date().toISOString() },
        seq(r, 0.5, 0),
      );
      expect(isLegendarySpecies(result.pokemon.species)).toBe(true);
    }
  });

  // (b) 버킷롤이 legendary 밴드 밖이면 전설은 절대 안 나온다.
  it("never hatches a legendary when the bucket roll lands above the legendary band", async () => {
    // common 티어 legendaryChance=0.002 — 그 위 어떤 값이든 legendary 버킷이 아니다.
    for (const r of [0.003, 0.5, 0.99, 0.9999]) {
      for (let seed = 0; seed < 25; seed++) {
        clearEggGachaCache();
        const result = await hatchEgg(
          { id: "e", tier: "common", createdAt: new Date().toISOString() },
          seq(r, seed / 25, 0),
        );
        expect(isLegendarySpecies(result.pokemon.species)).toBe(false);
      }
    }
  });

  // (c) common 알에서 전설 비율은 매우 낮다(legendaryChance=0.002). 큰 표본 통계.
  // 버킷롤 값을 0~1 균등 스윕해 결정적으로 비율을 잰다(legendary 밴드 폭 = legendaryChance).
  it("hatches legendaries from common eggs at a very low rate over a large sample", async () => {
    const samples = 1500;
    let bucketRoll = 0;
    const step = 1 / samples;
    const random = () => {
      const v = bucketRoll;
      bucketRoll = (bucketRoll + step) % 1;
      return v; // 첫 호출만 버킷롤로 의미가 있다(이후 weighted/level 롤은 비율에 무관).
    };

    let legendary = 0;
    for (let i = 0; i < samples; i++) {
      const result = await hatchEgg(
        { id: "e", tier: "common", createdAt: new Date().toISOString() },
        random,
      );
      if (isLegendarySpecies(result.pokemon.species)) legendary++;
    }
    // legendaryChance=0.002 → 균등 스윕에서 약 0.2%만 legendary 밴드. 1% 미만이면 충분히 희귀.
    expect(legendary / samples).toBeLessThan(0.01);
  }, 30000);
});
