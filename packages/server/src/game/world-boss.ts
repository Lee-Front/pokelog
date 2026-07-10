// 월드보스(전 유저 공유체력 공동전) — 순수 데이터/헬퍼(파일 I/O 없음).
// ─────────────────────────────────────────────────────────────────────────
// 보스 개체 생성은 주간보스 buildBossWild(weekly-boss.ts)와 같은 뼈대다 — 종족값 기반 스탯을
// 중립 성격·IV 0으로 계산하고 HP를 뻥튀기해 "공유 체력" 개체를 만든다. 차이점은 관리자가
// 임의의 종/변종/레벨/HP를 넘긴다는 것(주간보스는 고정 로스터)과, HP 뻥튀기를 배율(hpMultiplier)
// 또는 절대값(totalHp)으로 지정한다는 것이다.
//
// 라우트(game-routes/admin-routes)가 이 헬퍼로 상태를 만들고, 전투 데미지 동기화(battle-routes)가
// globalHp를 깎으며, 처치 시 distributeWorldBossRewards로 기여도 비례 포획 시도권을 나눈다.

import type {
  PokemonMove,
  PokemonStats,
  UserData,
  WildPokemon,
  WorldBossCapture,
  WorldBossContribution,
} from "../../../../shared/types.js";
import { getMoveById } from "./data-loader.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { buildStats } from "./pokemon-stats.js";

/**
 * 월드보스 전투 개체를 구성한다. resolveSpeciesOrVariant로 종/변종을 해석(존재 검증 포함)하고,
 * 종족값 기반 스탯(중립 성격·IV/EV 없음 → 결정적)을 만든 뒤, HP만 뻥튀기한다:
 *   - totalHp가 주어지면 그 절대값을 maxHp로(최소 1),
 *   - 아니면 종족 maxHp × hpMultiplier(기본 1)를 maxHp로.
 * 공격/방어 등 나머지 스탯은 종족값 그대로 둔다(공유 체력이 핵심이지 개체 위력이 아니다).
 * 종의 레벨업 학습표에서 기술 최대 4개를 뽑아 pp를 채운다. RNG 미사용 → 결정적.
 *
 * 전설/환상·변종 여부는 검증하지 않는다(월드보스는 이벤트성이라 무엇이든 스폰 허용) — 단,
 * 종/변종이 데이터에 존재하지 않으면 throw한다(라우트가 400으로 잡는다).
 */
export function buildWorldBossWild(
  species: string,
  variantId: string | null | undefined,
  level: number,
  opts: { hpMultiplier?: number; totalHp?: number },
): WildPokemon {
  const speciesKey = variantId ?? species;
  const { baseSpecies, variantId: resolvedVariantId, speciesData } = resolveSpeciesOrVariant(speciesKey);
  if (!speciesData) {
    throw new Error(`Unknown world-boss species: ${species}`);
  }

  const { maxHp, stats } = buildStats(speciesData, level, undefined, resolvedVariantId);

  let boostedMaxHp: number;
  if (typeof opts.totalHp === "number" && opts.totalHp > 0) {
    boostedMaxHp = Math.max(1, Math.floor(opts.totalHp));
  } else {
    const mult = typeof opts.hpMultiplier === "number" && opts.hpMultiplier > 0 ? opts.hpMultiplier : 1;
    boostedMaxHp = Math.max(1, Math.floor(maxHp * mult));
  }

  const boostedStats: PokemonStats = { ...stats };

  const moves: PokemonMove[] = buildBossMoves(speciesData.learnset.levelUp, level);

  return {
    species: baseSpecies,
    variantId: resolvedVariantId ?? null,
    level,
    hp: boostedMaxHp,
    maxHp: boostedMaxHp,
    stats: boostedStats,
    moves,
    nature: "hardy",
  };
}

/**
 * 종의 레벨업 학습표에서 현재 레벨까지 배우는 기술 중 최근 4개를 pp 슬롯으로 만든다.
 * pokemon-factory.buildMoves와 동일한 규칙(중복 제거·마지막 4개)이나, WildPokemon 개체를
 * 만드는 이 파일에 두어 SpeciesData 전체가 아니라 learnset만 받는다.
 */
function buildBossMoves(levelUpLearnset: Record<string, string[]>, level: number): PokemonMove[] {
  const learnable: string[] = [];
  const sortedLevels = Object.keys(levelUpLearnset)
    .map(Number)
    .sort((a, b) => a - b);
  for (const moveLevel of sortedLevels) {
    if (moveLevel > level) continue;
    for (const moveId of levelUpLearnset[String(moveLevel)]) {
      const dup = learnable.indexOf(moveId);
      if (dup !== -1) learnable.splice(dup, 1);
      learnable.push(moveId);
    }
  }
  const selected = learnable.slice(-4);
  // 학습표가 비면(데이터 이상) tackle 하나로라도 폴백해 "쓸 기술 없음" 무한 방어를 피한다.
  const ids = selected.length > 0 ? selected : ["tackle"];
  return ids.map((id) => {
    const md = getMoveById(id);
    const pp = md?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });
}

/** distributeWorldBossRewards 결과의 유저별 배분 요약(로깅/응답용). */
export interface WorldBossRewardShare {
  userId: string;
  ballAttempts: number;
}

/**
 * 처치 시 기여도 비례로 포획 시도권을 배분한다(순수 함수 — 파일 I/O 없음). 각 기여자(damage>0)에게
 *   balls = max(1, round(damage / 총damage × ballPool))
 * 개의 시도권을 계산해 그 유저의 worldBossCapture를 세팅하고, users 배열(호출자가 락 하에 로드)에
 * in-place로 반영한다. 총damage가 0이거나 기여자가 없으면 아무도 배분받지 못한다(빈 배열 반환).
 *
 * 이미 이 보스(bossId)의 worldBossCapture를 가진 유저는 건너뛴다(중복 배분 방지 — 처치 훅의
 * rewardsDistributed 가드와 별개의 개별 유저 멱등성). 반환값은 실제 배분된 유저별 요약이다.
 */
export function distributeWorldBossRewards(
  users: UserData[],
  contributions: Record<string, WorldBossContribution>,
  boss: { bossId: string; species: string; variantId: string | null; level: number; expiresAt: string },
  ballPool: number,
  ballItem: string,
): WorldBossRewardShare[] {
  const totalDamage = Object.values(contributions).reduce((sum, c) => sum + Math.max(0, c.damage), 0);
  if (totalDamage <= 0) return [];

  const byId = new Map(users.map((u) => [u.account.id, u]));
  const shares: WorldBossRewardShare[] = [];

  for (const [userId, contribution] of Object.entries(contributions)) {
    if (contribution.damage <= 0) continue;
    const user = byId.get(userId);
    if (!user) continue;
    // 개별 유저 멱등 — 같은 보스의 배분이 이미 있으면 다시 주지 않는다.
    if (user.worldBossCapture?.bossId === boss.bossId) continue;

    const balls = Math.max(1, Math.round((contribution.damage / totalDamage) * ballPool));
    const capture: WorldBossCapture = {
      species: boss.species,
      variantId: boss.variantId,
      level: boss.level,
      shiny: false,
      ballItem,
      ballAttempts: balls,
      bossId: boss.bossId,
      expiresAt: boss.expiresAt,
    };
    user.worldBossCapture = capture;
    shares.push({ userId, ballAttempts: balls });
  }

  return shares;
}
