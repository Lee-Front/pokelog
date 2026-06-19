import type { PokemonIVs } from "../../../../shared/types.js";

// 개체값(IV) — 6스탯 각 0~31. 본가식 그대로 완전 랜덤(하한·확정치 없음).
export const IV_MAX = 31;
export const IV_STAT_KEYS = ["hp", "attack", "defense", "spAttack", "spDefense", "speed"] as const;

function randInt(): number {
  return Math.floor(Math.random() * (IV_MAX + 1));
}

/** 신규 개체용 — 완전 랜덤 0~31. */
export function randomIvs(): PokemonIVs {
  return {
    hp: randInt(),
    attack: randInt(),
    defense: randInt(),
    spAttack: randInt(),
    spDefense: randInt(),
    speed: randInt(),
  };
}

// FNV-1a 해시 — seed 문자열에서 결정적 값 도출(재실행에도 고정).
function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 기존 개체 마이그레이션용 — uid 기반 결정적 IV(개체마다 다르고 안정적). */
export function seededIvs(seed: string): PokemonIVs {
  const out = {} as PokemonIVs;
  for (const key of IV_STAT_KEYS) {
    out[key] = hash(`${seed}:iv:${key}`) % (IV_MAX + 1);
  }
  return out;
}
