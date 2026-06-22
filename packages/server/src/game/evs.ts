import type { PokemonEVs } from "../../../../shared/types.js";
import { getSpeciesByName, getEvYields } from "./data-loader.js";

// 노력치(EV) — 6스탯 각 0~252, 합 ≤510. 본가식 스탯 계산에 floor(EV/4)로 기여한다.
export const EV_STAT_MAX = 252;
export const EV_TOTAL_MAX = 510;
export const EV_STAT_KEYS = ["hp", "attack", "defense", "spAttack", "spDefense", "speed"] as const;

/** 영양제(영양제 아이템 id → 오르는 노력치 키). 한 번에 +10 적립한다. */
export const VITAMIN_STAT: Record<string, keyof PokemonEVs> = {
  protein: "attack",
  calcium: "spAttack",
  iron: "defense",
  zinc: "spDefense",
  carbos: "speed",
  "hp-up": "hp",
};

/** 신규/마이그레이션 개체용 — 전부 0. */
export function emptyEvs(): PokemonEVs {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    spAttack: 0,
    spDefense: 0,
    speed: 0,
  };
}

/** 스탯 기여분 — 본가식 floor(EV/4). */
export function evContribution(ev: number): number {
  return Math.floor(ev / 4);
}

/**
 * 격파한 야생 개체가 주는 EV 수확량.
 *
 * 우선 **본가 실측 수율**(data/pokemon/ev-yields.json, PokéAPI effort 유래)을 쓴다.
 * 해당 종이 표에 없으면(누락/폼) **종족값 파생 폴백**: 가장 높은 baseStat 한 칸에
 * EV 1(동률은 hp→attack→defense→spAttack→spDefense→speed 정규 순서로 앞선 키).
 * 도출/조회 로직을 이 함수 하나에 가둬 표 교체·확장이 쉽게.
 */
export function getEvYield(species: string): Partial<PokemonEVs> {
  const real = getEvYields()[species];
  if (real && Object.keys(real).length > 0) {
    return real as Partial<PokemonEVs>;
  }

  // 폴백 — 표에 없는 종.
  const speciesData = getSpeciesByName(species);
  if (!speciesData) return {};

  const baseStats = speciesData.baseStats;
  let bestKey: (typeof EV_STAT_KEYS)[number] = EV_STAT_KEYS[0];
  let bestValue = baseStats[bestKey];
  for (const key of EV_STAT_KEYS) {
    if (baseStats[key] > bestValue) {
      bestValue = baseStats[key];
      bestKey = key;
    }
  }
  return { [bestKey]: 1 };
}

/**
 * 현재 EV에 gain을 더한 **새 EV 객체**를 반환(순수 함수). 스탯별 252 상한과 합계
 * 510 상한을 모두 지킨다. 합계 여유분(510 - 현재합)을 정규 키 순서대로 소진한다.
 */
export function applyEvGain(current: PokemonEVs, gain: Partial<PokemonEVs>): PokemonEVs {
  const result = { ...current };
  let currentTotal = 0;
  for (const key of EV_STAT_KEYS) {
    currentTotal += result[key];
  }
  let remainingBudget = Math.max(0, EV_TOTAL_MAX - currentTotal);

  for (const key of EV_STAT_KEYS) {
    if (remainingBudget <= 0) break;
    const requested = gain[key] ?? 0;
    if (requested <= 0) continue;
    const perStatRoom = Math.max(0, EV_STAT_MAX - result[key]);
    const added = Math.min(requested, perStatRoom, remainingBudget);
    result[key] += added;
    remainingBudget -= added;
  }

  return result;
}
