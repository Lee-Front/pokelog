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
