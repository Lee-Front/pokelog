import type { RegionData } from "../../../../shared/types.js";
import { getSpeciesByName } from "./data-loader.js";

type Encounter = RegionData["encounters"][number];
type Pick = { species: string; level: number };

/**
 * 종족 데이터 기준으로 전설/환상 출몰 엔트리인지 판정한다.
 * 출몰 엔트리(JSON)에는 종족 플래그가 없으므로 data-loader로 종족을 조회한다.
 */
export function isLegendaryEncounter(entry: Encounter): boolean {
  const species = getSpeciesByName(entry.species);
  return Boolean(species?.isLegendary || species?.isMythical);
}

/**
 * 지역 출몰 테이블을 일반/전설(전설+환상)로 분리한다.
 * 일반 풀은 가중 추첨의 기본 대상, 전설 풀은 게이팅된 주입 후보다.
 */
export function splitEncounters(regionData: RegionData): {
  normal: Encounter[];
  legendary: Encounter[];
} {
  const normal: Encounter[] = [];
  const legendary: Encounter[] = [];
  for (const entry of regionData.encounters) {
    if (isLegendaryEncounter(entry)) {
      legendary.push(entry);
    } else {
      normal.push(entry);
    }
  }
  return { normal, legendary };
}

/**
 * 주어진 출몰 엔트리 부분집합에서 가중 추첨으로 한 마리를 뽑는다.
 * random 주입 가능(테스트용) — 기본은 Math.random.
 */
export function selectFromEncounters(
  encounters: Encounter[],
  random: () => number = Math.random,
): Pick {
  const totalWeight = encounters.reduce((sum, e) => sum + e.weight, 0);
  let roll = random() * totalWeight;

  for (const entry of encounters) {
    roll -= entry.weight;
    if (roll <= 0) {
      return rollEntry(entry, random);
    }
  }

  // Fallback to last entry
  const last = encounters[encounters.length - 1];
  return rollEntry(last, random);
}

export function selectWildPokemon(
  regionData: RegionData,
  random: () => number = Math.random,
): Pick {
  return selectFromEncounters(regionData.encounters, random);
}

function rollEntry(entry: Encounter, random: () => number = Math.random): Pick {
  const [minLevel, maxLevel] = entry.levelRange;
  const level = Math.floor(random() * (maxLevel - minLevel + 1)) + minLevel;
  return { species: entry.species, level };
}
