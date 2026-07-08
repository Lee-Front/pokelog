/**
 * 주간보스 "선착 처치 랭킹" 저장소 — pokelog-data/boss/clears-{week}-{bossId}.json 1파일에
 * 그 주·그 보스를 처치한 전 유저 순위를 기록한다. 전 유저가 공유하는 상태이므로 동시 처치 시
 * 순위가 경합하지 않도록 withLock(키=week:bossId)으로 read-append-write를 직렬화한다.
 *
 * 포인트 지급 자체는 여기서 하지 않는다 — registerBossClear가 순위+포인트만 계산해 돌려주고,
 * 실제 user.points 가산은 호출부(battle-routes.finishWin)가 한다(파일 I/O와 유저 저장을 분리).
 */
import path from "node:path";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";
import { withLock } from "./pvp-store.js";

/** 선착 1~3위 랭킹 보상(포인트). 4위 이후는 PARTICIPATION_POINTS. */
export const RANK_POINTS: number[] = [3000, 2000, 1000];
/** 4위 이후(또는 랭킹 조회 실패 시 안전 폴백) 처치자에게 주는 참가 포인트. */
export const PARTICIPATION_POINTS = 250;

export interface BossClearEntry {
  userId: string;
  nickname: string;
  rank: number;
  points: number;
  at: string;
}

interface BossClearsFile {
  week: number;
  bossId: string;
  clears: BossClearEntry[];
}

function clearsDir(): string {
  return path.join(getDataDir(), "boss");
}
function clearsPath(week: number, bossId: string): string {
  return path.join(clearsDir(), `clears-${week}-${bossId}.json`);
}

/** rank(1-based)에 해당하는 포인트. 1~3위는 RANK_POINTS, 이후는 PARTICIPATION_POINTS. */
export function pointsForRank(rank: number): number {
  return RANK_POINTS[rank - 1] ?? PARTICIPATION_POINTS;
}

/** 이번 주 이 보스의 처치 랭킹 목록(순위 오름차순, 즉 처치 순서). 없으면 빈 배열. */
export async function getClears(week: number, bossId: string): Promise<BossClearEntry[]> {
  const file = await readJson<BossClearsFile>(clearsPath(week, bossId));
  return file?.clears ?? [];
}

/**
 * 유저의 이번 주 첫 처치를 랭킹에 등록하고 순위+포인트를 매긴다. 호출부(finishWin)가
 * grantBossRewardOnce의 granted=true(이번 주 첫 처치)일 때만 호출하므로 정상 경로에서는
 * 유저당 한 번만 등록되지만, 방어적으로 이미 등록된 유저면 새 순위를 매기지 않고 기존
 * entry를 그대로 반환한다(중복 순위 없음, 재호출해도 안전).
 */
export async function registerBossClear(
  week: number,
  bossId: string,
  userId: string,
  nickname: string,
): Promise<BossClearEntry> {
  return withLock(`boss-clears:${week}:${bossId}`, async () => {
    const filePath = clearsPath(week, bossId);
    const file = (await readJson<BossClearsFile>(filePath)) ?? { week, bossId, clears: [] };
    const already = file.clears.find((c) => c.userId === userId);
    if (already) return already;

    const rank = file.clears.length + 1;
    const entry: BossClearEntry = {
      userId,
      nickname,
      rank,
      points: pointsForRank(rank),
      at: new Date().toISOString(),
    };
    file.clears.push(entry);
    await writeJson(filePath, file);
    return entry;
  });
}
