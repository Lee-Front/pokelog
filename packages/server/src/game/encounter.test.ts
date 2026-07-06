import { describe, it, expect, vi, afterEach } from "vitest";
import {
  selectWildPokemon,
  selectFromEncounters,
  splitEncounters,
  isLegendaryEncounter,
} from "./encounter.js";
import { getRegion } from "./data-loader.js";
import type { RegionData } from "../../../../shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectWildPokemon", () => {
  const region: RegionData = {
    name: "test",
    encounters: [
      { species: "pidgey", weight: 1, levelRange: [4, 8] },
      { species: "rattata", weight: 1, levelRange: [10, 12] },
    ],
  };

  it("returns the rolled entry's species at its floor when random is 0", () => {
    // roll picks the first entry; level roll floors to the range minimum
    vi.spyOn(Math, "random").mockReturnValue(0);
    const pick = selectWildPokemon(region);
    expect(pick.species).toBe("pidgey");
    expect(pick.level).toBe(4);
  });

  it("rolls a level within the chosen entry's levelRange (species-natural)", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const pick = selectWildPokemon(region);
      const entry = region.encounters.find((e) => e.species === pick.species)!;
      const [min, max] = entry.levelRange;
      expect(pick.level).toBeGreaterThanOrEqual(min);
      expect(pick.level).toBeLessThanOrEqual(max);
      vi.restoreAllMocks();
    }
  });

  it("does not take or depend on any party input", () => {
    // selectWildPokemon takes only region data — the level is species-natural,
    // never scaled to the player's party.
    expect(selectWildPokemon.length).toBe(1);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const pick = selectWildPokemon(region);
    expect(pick.species).toBe("rattata");
    expect(pick.level).toBe(12);
  });
});

describe("legendary split + gated injection", () => {
  // 출몰 엔트리에 직접 종족 플래그가 없으므로 data-loader 분류를 검증한다.
  // kanto: 일반 다수 + 전설(articuno/zapdos/moltres/mewtwo, weight 2) + 환상(mew, weight 1).
  const region = getRegion("kanto");

  it("splits a region into non-legendary normal and legendary/mythical pools", () => {
    const { normal, legendary } = splitEncounters(region);
    expect(normal.length).toBeGreaterThan(0);
    expect(legendary.length).toBeGreaterThan(0);
    // 일반 풀에는 전설/환상이 하나도 없다.
    expect(normal.every((e) => !isLegendaryEncounter(e))).toBe(true);
    // 전설 풀은 전부 전설/환상이다.
    expect(legendary.every((e) => isLegendaryEncounter(e))).toBe(true);
    // mew(환상)와 mewtwo(전설)가 전설 풀에 들어간다.
    const legNames = legendary.map((e) => e.species);
    expect(legNames).toContain("mew");
    expect(legNames).toContain("mewtwo");
  });

  // 라우트의 게이팅 주입 로직을 그대로 재현하는 헬퍼(주입 가능 RNG).
  function rollBatch(
    regionData: RegionData,
    rollCount: number,
    wildLegendaryChance: number,
    rng: () => number,
  ): string[] {
    const { normal, legendary } = splitEncounters(regionData);
    const batch = Array.from({ length: rollCount }, () => selectFromEncounters(normal, rng).species);
    if (legendary.length && rng() < wildLegendaryChance) {
      const slot = Math.floor(rng() * batch.length);
      batch[slot] = selectFromEncounters(legendary, rng).species;
    }
    return batch;
  }

  const isLeg = (species: string) =>
    isLegendaryEncounter({ species, weight: 1, levelRange: [1, 1] });

  it("injects exactly one legendary when chance is forced to 1", () => {
    // 모든 random()이 0이면: 일반은 첫 엔트리, gate(0<1) 통과, slot 0, 전설 첫 엔트리.
    const batch = rollBatch(region, 12, 1, () => 0);
    const legCount = batch.filter(isLeg).length;
    expect(legCount).toBe(1);
    // 나머지 11마리는 전부 비전설이다.
    expect(batch.filter((s) => !isLeg(s)).length).toBe(11);
  });

  it("injects zero legendaries when chance is 0", () => {
    const batch = rollBatch(region, 12, 0, () => 0);
    expect(batch.some(isLeg)).toBe(false);
    expect(batch.filter((s) => !isLeg(s)).length).toBe(12);
  });
});

describe("wild level party scaling", () => {
  // 단일 엔트리 지역 — 가중 추첨은 항상 pidgey를 뽑고, 레벨만 스케일링 로직을 탄다.
  // 주입 random은 상수라 (가중 추첨 1회 소비 후) rollEntry의 레벨 롤도 같은 값을 받는다.
  const single: RegionData = {
    name: "test",
    encounters: [{ species: "pidgey", weight: 1, levelRange: [4, 8] }],
  };

  it("scales level to partyMax ± variance (delta from the level roll)", () => {
    // variance 3 → 2*3+1=7. random 0 → delta = floor(0*7)-3 = -3 → 40-3 = 37.
    const low = selectFromEncounters(single.encounters, () => 0, { partyMaxLevel: 40, variance: 3 });
    expect(low.level).toBe(37);
    // random 0.999 → delta = floor(0.999*7)-3 = 6-3 = 3 → 40+3 = 43.
    const high = selectFromEncounters(single.encounters, () => 0.999, { partyMaxLevel: 40, variance: 3 });
    expect(high.level).toBe(43);
  });

  it("clamps up to the entry minimum when partyMax - variance is below it", () => {
    // partyMax 5, variance 3, random 0 → 5-3 = 2, but entryMin is 4 → clamp to 4.
    const pick = selectFromEncounters(single.encounters, () => 0, { partyMaxLevel: 5, variance: 3 });
    expect(pick.level).toBe(4);
  });

  it("clamps down to the level ceiling (100)", () => {
    // partyMax 100, variance 3, random 0.999 → 100+3 = 103 → clamp to 100.
    const pick = selectFromEncounters(single.encounters, () => 0.999, { partyMaxLevel: 100, variance: 3 });
    expect(pick.level).toBe(100);
  });

  it("falls back to the species-natural levelRange when partyMaxLevel is 0", () => {
    // partyMaxLevel 0 → 스케일링 비활성, 균등 롤. random 0 → levelRange 하한(4).
    const pick = selectFromEncounters(single.encounters, () => 0, { partyMaxLevel: 0, variance: 3 });
    expect(pick.level).toBe(4);
  });

  it("falls back to levelRange when no scaling is provided (flag off)", () => {
    // 스케일링 미지정 → 균등 롤. random 0.999 → levelRange 상한(8).
    const pick = selectFromEncounters(single.encounters, () => 0.999);
    expect(pick.level).toBe(8);
  });

  it("threads scaling through selectWildPokemon", () => {
    // variance 2, random 0 → delta -2 → 50-2 = 48.
    const pick = selectWildPokemon(single, () => 0, { partyMaxLevel: 50, variance: 2 });
    expect(pick.level).toBe(48);
  });
});
