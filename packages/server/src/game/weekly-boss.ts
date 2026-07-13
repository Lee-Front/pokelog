// 주간보스(레이드형 PvE) — 매주 로테이션되는 단일 강력 보스.
// ─────────────────────────────────────────────────────────────────────────
// 콘셉트: 한 주에 하나, 의도적으로 까다롭고 기믹이 있는 보스가 등장한다. 플레이어는 커버리지
// 타입·기술(기술 가르침)·지닌물건·특성·상태이상 치료제 등을 "준비"해 파티 6마리로 도전한다.
// 야생 전투 엔진을 그대로 재사용한다(단일 강력 개체 = WildPokemon).
//
// 보상은 보스별로 다르지 않다 — "이번 주 몇 번째로 처치했는가"(선착 랭킹)로 전 보스 공통 포인트를
// 준다(boss-clears-store의 RANK_POINTS/PARTICIPATION_POINTS). 이 파일은 그 랭킹을 다루지 않고,
// 유저별 "이번 주에 이미 처치했는지" 멱등 가드(grantBossRewardOnce)까지만 담당한다.
//
// 이 파일은 순수(부수효과 없는) 데이터/헬퍼만 담는다. 라우트(game-routes)가 buildBossWild로
// 전투를 세팅하고, battle-routes.finishWin이 grantBossRewardOnce + boss-clears-store로 처치를
// 인정·기록한다.

import type {
  PokemonMove,
  PokemonStats,
  UserData,
  WeeklyBossConfig,
  WildPokemon,
} from "../../../../shared/types.js";
import { getMoveById } from "./data-loader.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { buildStats } from "./pokemon-stats.js";

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
  species: string;
  variantId?: string | null;
  /** 높은 레벨(예: 70~85) — 파티가 이를 넘어서면 computeBossLevel이 파티 기준으로 올린다. */
  level: number;
  /** 특성 id(예: "clear-body"·"drizzle"). 전투 엔진이 스위치인/피격 특성으로 반영한다. */
  ability?: string;
  /** 지닌물건 id(예: "leftovers"·"life-orb"). 전투 엔진이 공/방/EOT 회복에 반영한다. */
  heldItem?: string;
  /** 커버리지/기믹 기술 세트(move id). 야생 AI가 pp>0인 것 중 무작위로 고른다. */
  moves: string[];
  /** 스탯 배수(레이드 튜닝). hp는 두껍게(예: 2.5~3×), 나머지는 소폭(예: 1.1~1.2×). */
  statMultiplier?: BossStatMultiplier;
}

// ── 보스 로스터 ──────────────────────────────────────────────────────────
// 각 보스는 서로 다른 타입 테마/기믹을 가져 주마다 다른 준비를 요구한다(강철 벽, 비 스위퍼,
// 모래 탱커, 상태이상 요새, 멀티스케일 브루저, 햇살 스위퍼, 눈보라). 모든 종/특성/기술/아이템은
// data/*.json에 존재하는 유효 id다. 테마 설명·공략 힌트는 두지 않는다 — 포털이 특성/지닌물건의
// 실제 효과 설명(ABILITY_KO의 shortEffect·HELD_ITEM_EFFECT_KO)만으로 기믹을 안내한다.
export const BOSSES: BossDef[] = [
  {
    id: "steel-wall",
    name: "강철의 벽 메타그로스",
    species: "metagross",
    level: 75,
    ability: "clear-body",
    heldItem: "leftovers",
    moves: ["meteor-mash", "zen-headbutt", "earthquake", "bullet-punch"],
    statMultiplier: { hp: 2.6, defense: 1.25, spDefense: 1.2, attack: 1.15, spAttack: 1.15, speed: 1.1 },
  },
  {
    id: "rain-tyrant",
    name: "바다의 폭군 가이오가",
    species: "kyogre",
    level: 80,
    ability: "drizzle",
    heldItem: "life-orb",
    moves: ["hydro-pump", "ice-beam", "thunder", "dark-pulse"],
    statMultiplier: { hp: 2.4, spAttack: 1.2, spDefense: 1.15, defense: 1.1, speed: 1.1 },
  },
  {
    id: "sand-king",
    name: "모래의 제왕 마기라스",
    species: "tyranitar",
    level: 78,
    ability: "sand-stream",
    heldItem: "leftovers",
    moves: ["stone-edge", "crunch", "earthquake", "fire-punch"],
    statMultiplier: { hp: 2.5, attack: 1.2, defense: 1.15, spDefense: 1.1, speed: 1.05 },
  },
  {
    id: "poison-fortress",
    name: "맹독의 요새 더시마사리",
    species: "toxapex",
    level: 72,
    ability: "merciless",
    heldItem: "leftovers",
    moves: ["toxic", "scald", "recover", "sludge-bomb"],
    statMultiplier: { hp: 3.0, defense: 1.1, spDefense: 1.1, spAttack: 1.2, speed: 1.05 },
  },
  {
    id: "dragon-bruiser",
    name: "폭풍의 용 망나뇽",
    species: "dragonite",
    level: 80,
    ability: "multiscale",
    heldItem: "life-orb",
    moves: ["outrage", "earthquake", "hurricane", "fire-punch"],
    statMultiplier: { hp: 2.5, attack: 1.2, spAttack: 1.1, defense: 1.1, spDefense: 1.1 },
  },
  {
    id: "sun-scorcher",
    name: "불꽃의 화신 리자몽",
    species: "charizard",
    level: 78,
    ability: "drought",
    heldItem: "life-orb",
    moves: ["fire-blast", "air-slash", "focus-blast", "dragon-pulse"],
    statMultiplier: { hp: 2.4, spAttack: 1.2, speed: 1.15, spDefense: 1.1 },
  },
  {
    id: "blizzard-queen",
    name: "눈보라의 여왕 눈설왕",
    species: "abomasnow",
    level: 74,
    ability: "snow-warning",
    heldItem: "leftovers",
    moves: ["blizzard", "wood-hammer", "earthquake", "ice-shard"],
    statMultiplier: { hp: 2.6, attack: 1.15, spAttack: 1.15, defense: 1.1, spDefense: 1.1 },
  },
];

/**
 * 보스 지닌물건 효과 설명(한글, 포켓몬을 잘 모르는 유저 대상). items.json의 shortEffect는
 * 지닌물건류가 대부분 비어 있어서(실측 데이터 부재) 여기서 보스 로스터가 실제로 쓰는 지닌물건만
 * 손번역한다. 미등록 id는 game-routes가 null로 내려보낸다(포털은 이름만 표시).
 */
export const HELD_ITEM_EFFECT_KO: Record<string, string> = {
  leftovers: "매 턴 종료 시 최대 HP의 1/16을 회복한다. 장기전에서 체력을 계속 채운다.",
  "life-orb": "기술 위력이 1.3배가 되지만, 공격할 때마다 최대 HP의 1/10만큼 자신도 HP가 줄어든다.",
  "expert-belt": "상대의 약점을 찌르는 기술(효과가 굉장했다)의 위력이 1.2배가 된다.",
  "focus-sash": "HP가 가득 찬 상태에서 한 방에 기절할 데미지를 받아도 HP 1을 남기고 버틴다(1회용).",
  "muscle-band": "물리 기술의 위력이 1.1배가 된다.",
  "wise-glasses": "특수 기술의 위력이 1.1배가 된다.",
};

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

// 이 기능이 배포된 주(2026-07-06 월요일)의 연속 ISO 주 인덱스. "N주차" 표시가 이 기능이 생긴
// 시점부터 1주차로 시작하게 하는 기준점 — getIsoWeek의 원값(~2948)을 그대로 노출하면 어색하고,
// 달력 연주차("OO년 OO주차")도 "이번이 몇 번째 주간보스인가"라는 실제 궁금증과는 맞지 않는다.
const BOSS_FEATURE_LAUNCH_WEEK = getIsoWeek(new Date(2026, 6, 6));

/** "이 기능이 생긴 이후 몇 번째 주인가"(1부터 시작)를 계산한다. */
export function getDisplayWeekNumber(date: Date = new Date()): number {
  return getIsoWeek(date) - BOSS_FEATURE_LAUNCH_WEEK + 1;
}

/** 포털 표시용 "N주차" 라벨(이 기능이 생긴 주가 1주차). */
export function getIsoWeekLabel(date: Date = new Date()): string {
  return `${getDisplayWeekNumber(date)}주차`;
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

/** grantBossRewardOnce 결과. granted=이번이 이번 주 첫 처치, alreadyDefeated=이미 이번 주 처치. */
export interface BossRewardGrant {
  granted: boolean;
  alreadyDefeated: boolean;
}

/**
 * 유저의 "이번 주 첫 처치"를 ISO 주당 1회만 인정한다(멱등 가드). user.bossDefeat.week가 현재
 * week와 같고 bossId도 같으면 이미 이번 주에 처치를 인정받은 것 → granted=false. 아니면
 * user.bossDefeat={week,bossId}로 갱신하고 granted=true를 돌려준다.
 *
 * 실제 보상(랭킹 포인트)은 여기서 다루지 않는다 — 호출부(finishWin)가 granted=true일 때만
 * boss-clears-store.registerBossClear로 순위를 매기고 포인트를 지급한다. 순수 함수(파일 I/O 없음).
 */
export function grantBossRewardOnce(
  user: UserData,
  boss: BossDef,
  week: number,
): BossRewardGrant {
  const already = user.bossDefeat?.week === week && user.bossDefeat?.bossId === boss.id;
  if (already) {
    return { granted: false, alreadyDefeated: true };
  }

  user.bossDefeat = { week, bossId: boss.id };
  return { granted: true, alreadyDefeated: false };
}

/**
 * 이번 주 처치 순위(rank, 1-based)에 배분할 포획 시도권(볼) 개수를 정한다. 1~cfg.captureBallsByRank.length
 * 위(선착 상위)는 그 배열의 해당 값을, 그 밖(4위 이후 등)은 cfg.participationBalls(참가 보상)를 준다.
 * 월드보스가 기여도 비례로 나누는 것과 달리 주간보스는 "몇 번째로 깼는가"(선착 랭킹)만으로 결정된다.
 */
export function ballsForRank(rank: number, cfg: WeeklyBossConfig): number {
  if (rank >= 1 && rank <= cfg.captureBallsByRank.length) {
    return cfg.captureBallsByRank[rank - 1];
  }
  return cfg.participationBalls;
}
