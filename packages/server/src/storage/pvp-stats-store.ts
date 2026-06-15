/**
 * 유저별 PvP 전적·ELO 레이팅 저장소 — pokelog-data/pvp/stats/{userId}.json.
 *
 * 매치당 1파일인 매치 스토어와 동일한 pvp/ 하위에 두되, 유저별 1파일로 누적 통계를 영속한다.
 * 갱신은 pvp-store의 키별 withLock(`pvp-stats:${userId}`)으로 직렬화해 동시 매치 종료 시
 * 같은 유저의 전적이 경합으로 유실되지 않게 한다. ELO 계산 자체는 pvp-rewards에 있다.
 */
import path from "node:path";
import fs from "node:fs/promises";
import type { PvpRankingEntry, PvpStats } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";
import { withLock } from "./pvp-store.js";

function statsDir(): string {
  return path.join(getDataDir(), "pvp", "stats");
}
function statsPath(userId: string): string {
  return path.join(statsDir(), `${userId}.json`);
}

/** 신규 유저의 기본 통계(레이팅은 config에서 주입 — 호출부가 start를 넘긴다). */
function freshStats(userId: string, nickname: string, start: number): PvpStats {
  return {
    userId,
    nickname,
    rating: start,
    wins: 0,
    losses: 0,
    draws: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function getStats(userId: string): Promise<PvpStats | null> {
  return await readJson<PvpStats>(statsPath(userId));
}

/**
 * 유저 통계를 락 하에서 읽고-수정-저장한다. 파일이 없으면 freshStats(start)로 시작한다.
 * mutator는 in-place로 stats를 변경하면 된다(updatedAt은 여기서 찍는다).
 */
export async function updateStats(
  userId: string,
  nickname: string,
  start: number,
  mutator: (stats: PvpStats) => void,
): Promise<PvpStats> {
  return withLock(`pvp-stats:${userId}`, async () => {
    const existing = await getStats(userId);
    const stats = existing ?? freshStats(userId, nickname, start);
    // 닉네임은 최신값으로 동기화(리더보드 표시용).
    stats.nickname = nickname;
    mutator(stats);
    stats.updatedAt = new Date().toISOString();
    await writeJson(statsPath(userId), stats);
    return stats;
  });
}

/** 전 유저 통계를 레이팅 내림차순으로 반환(리더보드). 동률은 승수·userId로 안정 정렬. */
export async function listRanking(limit = 100): Promise<PvpRankingEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(statsDir());
  } catch {
    return [];
  }
  const all: PvpStats[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const stats = await readJson<PvpStats>(path.join(statsDir(), file));
    if (stats) all.push(stats);
  }
  all.sort((a, b) => (
    b.rating - a.rating
    || b.wins - a.wins
    || a.userId.localeCompare(b.userId)
  ));
  return all.slice(0, Math.max(1, limit)).map((s) => ({
    userId: s.userId,
    nickname: s.nickname,
    rating: s.rating,
    wins: s.wins,
    losses: s.losses,
    draws: s.draws,
  }));
}
