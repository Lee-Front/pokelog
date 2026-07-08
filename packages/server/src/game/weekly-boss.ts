// 주간보스(레이드형 PvE) — 매주 로테이션되는 단일 강력 보스.
// ─────────────────────────────────────────────────────────────────────────
// 콘셉트: 한 주에 하나, 의도적으로 까다롭고 기믹이 있는 보스가 등장한다. 플레이어는 커버리지
// 타입·기술(기술 가르침)·지닌물건·특성·상태이상 치료제 등을 "준비"해 파티 6마리로 도전한다.
// 야생 전투 엔진을 그대로 재사용한다(단일 강력 개체 = WildPokemon). 주 1회 처치 보상.
//
// 이 파일은 순수(부수효과 없는) 데이터/헬퍼만 담는다. 라우트(game-routes)가 buildBossWild로
// 전투를 세팅하고, battle-routes.finishWin이 grantBossRewardOnce로 주 1회 보상을 지급한다.

import type {
  PokemonMove,
  PokemonStats,
  UserData,
  WildPokemon,
} from "../../../../shared/types.js";
import { getMoveById } from "./data-loader.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { buildStats } from "./pokemon-stats.js";
import { incrementItem } from "./inventory-utils.js";

/**
 * 보스 처치 보상. item은 인벤토리 키 기준(예: "leftovers"·"assault-vest") — 지닌물건 계열은
 * config.shop/battleShop.items 키와 items.json id가 동일해 지급·표시가 일관된다.
 *
 * 포인트는 여기 없다 — "먼저 깬 순서"로 지급되는 랭킹 보상(boss-clears-store의 RANK_POINTS/
 * PARTICIPATION_POINTS)으로 전 보스 공통 통일했다. gameMoney/item은 보스마다 다른 "준비" 보상으로
 * 남겨 공략 루프(테마 지닌물건 파밍)를 유지한다.
 */
export interface BossReward {
  gameMoney: number;
  item: { id: string; qty: number } | null;
}

/** 보스 스탯 배수 — 종족값 기반 스탯에 곱해 "레이드용" 두꺼운/강한 개체를 만든다. 미지정 스탯은 ×1. */
export interface BossStatMultiplier {
  hp?: number;
  attack?: number;
  defense?: number;
  spAttack?: number;
  spDefense?: number;
  speed?: number;
}

/** 한 주간보스 정의. species는 베이스 종, variantId가 있으면 변종 폼으로 만든다. */
export interface BossDef {
  id: string;
  /** 표시명(한글, 종명 포함). 예: "강철의 벽 메타그로스". */
  name: string;
  /** 테마/컨셉 설명(한글). */
  description: string;
  /** 공략 힌트(한글) — 어떤 준비(커버리지 타입·기술·아이템)가 필요한지. */
  gimmick: string;
  species: string;
  variantId?: string | null;
  /** 높은 레벨(예: 70~85). */
  level: number;
  /** 특성 id(예: "clear-body"·"drizzle"). 전투 엔진이 스위치인/피격 특성으로 반영한다. */
  ability?: string;
  /** 지닌물건 id(예: "leftovers"·"life-orb"). 전투 엔진이 공/방/EOT 회복에 반영한다. */
  heldItem?: string;
  /** 커버리지/기믹 기술 세트(move id). 야생 AI가 pp>0인 것 중 무작위로 고른다. */
  moves: string[];
  /** 스탯 배수(레이드 튜닝). hp는 두껍게(예: 2.5~3×), 나머지는 소폭(예: 1.1~1.2×). */
  statMultiplier?: BossStatMultiplier;
  reward: BossReward;
}

// ── 보스 로스터 ──────────────────────────────────────────────────────────
// 각 보스는 서로 다른 타입 테마/기믹을 가져 주마다 다른 준비를 요구한다(강철 벽, 비 스위퍼,
// 모래 탱커, 상태이상 요새, 멀티스케일 브루저, 햇살 스위퍼, 눈보라). 모든 종/특성/기술/아이템은
// data/*.json에 존재하는 유효 id다.
export const BOSSES: BossDef[] = [
  {
    id: "steel-wall",
    name: "강철의 벽 메타그로스",
    description: "능력 하락을 무효화하는 클리어바디로 무장한 강철의 요새. 높은 방어와 남은밥으로 오래 버틴다.",
    gimmick: "위협·울음소리 등 능력 하락이 통하지 않는다. 불꽃·땅·고스트·악 타입으로 약점을 찔러 화력으로 뚫어라.",
    species: "metagross",
    level: 75,
    ability: "clear-body",
    heldItem: "leftovers",
    moves: ["meteor-mash", "zen-headbutt", "earthquake", "bullet-punch"],
    statMultiplier: { hp: 2.6, defense: 1.25, spDefense: 1.2, attack: 1.15, spAttack: 1.15, speed: 1.1 },
    reward: { gameMoney: 2500, item: { id: "assault-vest", qty: 1 } },
  },
  {
    id: "rain-tyrant",
    name: "바다의 폭군 가이오가",
    description: "등장과 동시에 비를 부르는 대해의 폭군. 빗속에서 물 기술이 거세지고 생명의구슬로 화력을 더한다.",
    gimmick: "잔비로 물 기술이 1.5배가 된다. 전기·풀 타입과 비에 강한(물 반감) 포켓몬으로 맞서라.",
    species: "kyogre",
    level: 80,
    ability: "drizzle",
    heldItem: "life-orb",
    moves: ["hydro-pump", "ice-beam", "thunder", "dark-pulse"],
    statMultiplier: { hp: 2.4, spAttack: 1.2, spDefense: 1.15, defense: 1.1, speed: 1.1 },
    reward: { gameMoney: 3000, item: { id: "leftovers", qty: 1 } },
  },
  {
    id: "sand-king",
    name: "모래의 제왕 마기라스",
    description: "모래날림으로 전장을 뒤덮는 바위·악의 제왕. 매턴 모래바람이 상대를 갉아먹는다.",
    gimmick: "모래바람이 바위·땅·강철 이외 타입을 매턴 깎는다. 격투·땅·강철 타입 + 모래 면역 포켓몬을 준비하라.",
    species: "tyranitar",
    level: 78,
    ability: "sand-stream",
    heldItem: "leftovers",
    moves: ["stone-edge", "crunch", "earthquake", "fire-punch"],
    statMultiplier: { hp: 2.5, attack: 1.2, defense: 1.15, spDefense: 1.1, speed: 1.05 },
    reward: { gameMoney: 2800, item: { id: "expert-belt", qty: 1 } },
  },
  {
    id: "poison-fortress",
    name: "맹독의 요새 더시마사리",
    description: "독과 화상을 뿌리고 자기회복으로 버티는 지구전의 요새. 압도적인 내구로 시간을 끈다.",
    gimmick: "맹독·화상을 걸고 리커버로 회복한다. 상태이상 치료제와 강한 특수 화력, 독 무효(강철·독) 포켓몬으로 속전속결하라.",
    species: "toxapex",
    level: 72,
    ability: "merciless",
    heldItem: "leftovers",
    moves: ["toxic", "scald", "recover", "sludge-bomb"],
    statMultiplier: { hp: 3.0, defense: 1.1, spDefense: 1.1, spAttack: 1.2, speed: 1.05 },
    reward: { gameMoney: 3200, item: { id: "focus-sash", qty: 1 } },
  },
  {
    id: "dragon-bruiser",
    name: "폭풍의 용 망나뇽",
    description: "풀 HP에서 받는 피해가 절반이 되는 멀티스케일의 용. 껍질을 깨기 전엔 좀처럼 쓰러지지 않는다.",
    gimmick: "풀 HP에서 피해 절반(멀티스케일). 얼음·페어리·드래곤으로 첫 방을 크게 넣어 껍질을 깨고 몰아쳐라.",
    species: "dragonite",
    level: 80,
    ability: "multiscale",
    heldItem: "life-orb",
    moves: ["outrage", "earthquake", "hurricane", "fire-punch"],
    statMultiplier: { hp: 2.5, attack: 1.2, spAttack: 1.1, defense: 1.1, spDefense: 1.1 },
    reward: { gameMoney: 3000, item: { id: "muscle-band", qty: 1 } },
  },
  {
    id: "sun-scorcher",
    name: "불꽃의 화신 리자몽",
    description: "강렬한 햇살을 부르는 불꽃의 화신. 햇빛 아래 불꽃 기술이 작열하며 빠르게 몰아친다.",
    gimmick: "가뭄으로 불꽃 기술이 1.5배가 된다. 리자몽은 바위 4배 약점 — 물·바위·전기 타입과 햇살에 강한 포켓몬으로 노려라.",
    species: "charizard",
    level: 78,
    ability: "drought",
    heldItem: "life-orb",
    moves: ["fire-blast", "air-slash", "focus-blast", "dragon-pulse"],
    statMultiplier: { hp: 2.4, spAttack: 1.2, speed: 1.15, spDefense: 1.1 },
    reward: { gameMoney: 2800, item: { id: "wise-glasses", qty: 1 } },
  },
  {
    id: "blizzard-queen",
    name: "눈보라의 여왕 눈설왕",
    description: "눈퍼뜨리기로 눈보라를 일으키는 풀·얼음의 여왕. 매턴 눈보라가 얼음 이외 타입을 갉아먹는다.",
    gimmick: "눈보라가 얼음 이외 타입을 매턴 깎는다. 눈설왕은 불꽃 4배 약점 — 불꽃·격투·강철·바위로 이중 약점(풀·얼음)을 찔러라.",
    species: "abomasnow",
    level: 74,
    ability: "snow-warning",
    heldItem: "leftovers",
    moves: ["blizzard", "wood-hammer", "earthquake", "ice-shard"],
    statMultiplier: { hp: 2.6, attack: 1.15, spAttack: 1.15, defense: 1.1, spDefense: 1.1 },
    reward: { gameMoney: 2800, item: { id: "life-orb", qty: 1 } },
  },
];

const MS_PER_DAY = 86400000;
// 1970-01-05는 월요일(ISO 주 시작). 이 월요일을 0주로 삼아 "연속 ISO 주 인덱스"를 센다.
const EPOCH_MONDAY_UTC = Date.UTC(1970, 0, 5);

/**
 * 연속 ISO 주 인덱스(월요일 경계 기준, 0부터 단조 증가). 표준 ISO 주번호(1~53)와 달리 연말에
 * 리셋되지 않아 (1) 로테이션이 연 경계에서 튀지 않고 (2) 주 1회 보상 가드가 매년 같은 주번호끼리
 * 충돌하지 않는다. 서버 실시간 Date를 그대로 쓴다(워크플로가 아니라 서버 코드).
 */
export function getIsoWeek(date: Date = new Date()): number {
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((d - EPOCH_MONDAY_UTC) / (7 * MS_PER_DAY));
}

/** 이번 주 보스. 주 인덱스로 로테이션한다(같은 주면 결정적으로 동일, 다음 주면 다음 보스). */
export function getCurrentBoss(date: Date = new Date()): BossDef {
  const week = getIsoWeek(date);
  // 음수 주(1970 이전 테스트 날짜)도 안전하게 양수 인덱스로 정규화.
  const idx = ((week % BOSSES.length) + BOSSES.length) % BOSSES.length;
  return BOSSES[idx];
}

const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * 사람이 읽는 "OO년 OO주차" 표시용 ISO 8601 캘린더 주(목요일 기준 연도, 1~53). getIsoWeek의
 * 연속 절대 인덱스(로테이션·주1회 가드용, 예: ~2948)는 raw 값이라 그대로 노출하면 어색하므로
 * 표시 전용으로 분리했다.
 */
export function getIsoCalendarWeek(date: Date = new Date()): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 월=0..일=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 이번 주 목요일로 이동(ISO 연도 결정 기준)
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const week = Math.round((d.getTime() - week1Monday.getTime()) / MS_PER_WEEK) + 1;
  return { year: isoYear, week };
}

/** 포털 표시용 "OO년 OO주차" 라벨. */
export function getIsoWeekLabel(date: Date = new Date()): string {
  const { year, week } = getIsoCalendarWeek(date);
  return `${year}년 ${week}주차`;
}

/**
 * 보스 레벨을 파티 최고 레벨 기준으로 스케일링한다 — 정의된 base level보다 낮게 내려가지 않고
 * (원래 컨셉인 "높은 레벨 강적" 유지), 파티가 그 이상으로 성장하면 파티 최고 레벨+8까지 따라
 * 올라가(최대 100) 항상 도전적이게 만든다. partyMaxLevel<=0(파티 없음)이면 base level 그대로.
 */
export function computeBossLevel(boss: BossDef, partyMaxLevel: number): number {
  return Math.min(100, Math.max(boss.level, partyMaxLevel + 8));
}

/**
 * 보스를 야생 개체(WildPokemon)로 구성한다. 종족값 기반 스탯(중립 성격·IV 0)을 계산한 뒤
 * statMultiplier를 곱해(floor, 최소 1) 레이드용으로 강화하고, moves를 pp 있는 기술 슬롯으로,
 * ability/heldItem을 부착하고 HP를 풀피로 채운다. RNG 미사용 → 결정적.
 *
 * levelOverride가 주어지면(파티 기준 스케일링, computeBossLevel 결과) boss.level 대신 그 레벨로
 * 스탯을 계산한다 — 미지정 시 기존처럼 boss.level 그대로(테스트·단순 조회에서 안전한 기본값).
 */
export function buildBossWild(boss: BossDef, levelOverride?: number): WildPokemon {
  const speciesKey = boss.variantId ?? boss.species;
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(speciesKey);
  if (!speciesData) {
    throw new Error(`Unknown boss species: ${boss.species}`);
  }
  const level = levelOverride ?? boss.level;

  // 중립 성격(undefined)·IV/EV 없음 → 종족값만의 결정적 스탯.
  const { maxHp, stats } = buildStats(speciesData, level, undefined, variantId);
  const mult = boss.statMultiplier ?? {};
  const boostedMaxHp = Math.max(1, Math.floor(maxHp * (mult.hp ?? 1)));
  const boostedStats: PokemonStats = {
    attack: Math.max(1, Math.floor(stats.attack * (mult.attack ?? 1))),
    defense: Math.max(1, Math.floor(stats.defense * (mult.defense ?? 1))),
    spAttack: Math.max(1, Math.floor(stats.spAttack * (mult.spAttack ?? 1))),
    spDefense: Math.max(1, Math.floor(stats.spDefense * (mult.spDefense ?? 1))),
    speed: Math.max(1, Math.floor(stats.speed * (mult.speed ?? 1))),
  };

  const moves: PokemonMove[] = boss.moves.map((id) => {
    const md = getMoveById(id);
    const pp = md?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });

  return {
    species: baseSpecies,
    variantId: variantId ?? null,
    level,
    hp: boostedMaxHp,
    maxHp: boostedMaxHp,
    stats: boostedStats,
    moves,
    nature: "hardy",
    ability: boss.ability,
    heldItem: boss.heldItem ?? null,
  };
}

/** grantBossRewardOnce 결과. granted=이번 호출에서 실제 지급됨, alreadyDefeated=이미 이번 주 처치. */
export interface BossRewardGrant {
  granted: boolean;
  alreadyDefeated: boolean;
  reward: BossReward;
}

/**
 * 주간보스 "준비" 보상(gameMoney/item)을 ISO 주당 1회만 지급한다(멱등 가드). user.bossDefeat.week가
 * 현재 week와 같고 bossId도 같으면 이미 이번 주에 처치·수령한 것 → 재지급하지 않고 granted=false를
 * 돌려준다. 아니면 gameMoney/inventory에 보상을 적립하고 user.bossDefeat={week,bossId}로 갱신한다.
 * 포인트(순위 보상)는 여기서 다루지 않는다 — 호출부(finishWin)가 granted=true일 때만
 * boss-clears-store.registerBossClear로 순위를 매기고 별도로 points를 지급한다.
 * 순수-ish: 파일 I/O 없음. incrementItem(순수 유틸)만 사용 → finishWin에서 factor-out해 테스트 가능.
 */
export function grantBossRewardOnce(
  user: UserData,
  boss: BossDef,
  week: number,
): BossRewardGrant {
  const already = user.bossDefeat?.week === week && user.bossDefeat?.bossId === boss.id;
  if (already) {
    return { granted: false, alreadyDefeated: true, reward: boss.reward };
  }

  user.gameMoney += boss.reward.gameMoney;
  if (boss.reward.item && boss.reward.item.qty > 0) {
    incrementItem(user.inventory, boss.reward.item.id, boss.reward.item.qty);
  }
  user.bossDefeat = { week, bossId: boss.id };

  return { granted: true, alreadyDefeated: false, reward: boss.reward };
}
