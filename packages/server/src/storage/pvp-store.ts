/**
 * PvP 매치/대기열 파일 저장소 — pokelog-data/pvp/ 하위.
 *  - 매치: pvp/matches/{matchId}.json (매치당 1파일)
 *  - 대기열: pvp/queue.json (단일 파일)
 *
 * 동시성: 매치 행동은 읽기-수정-쓰기라 경합에 취약하다. 기존 코드베이스에
 * 전역 직렬화 헬퍼가 없어, 여기서 키별 약속 체인(mutex)으로 같은 매치/대기열에 대한
 * 변경을 직렬화한다. 같은 프로세스 내 호출 한정(파일 레벨 atomic rename은 json-store가 보장).
 */
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { PvpMatch, PvpQueueState } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";

function pvpDir(): string {
  return path.join(getDataDir(), "pvp");
}
function matchesDir(): string {
  return path.join(pvpDir(), "matches");
}
function matchPath(matchId: string): string {
  return path.join(matchesDir(), `${matchId}.json`);
}
function queuePath(): string {
  return path.join(pvpDir(), "queue.json");
}

// --- 키별 직렬화(mutex) ------------------------------------------------------
// 같은 키에 대한 작업을 순차 실행해 읽기-수정-쓰기 경합을 막는다.
const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  // 이전 작업의 성공/실패와 무관하게 다음 작업을 잇는다(fn 자체는 한 번만 실행).
  const run = prev.then(() => fn(), () => fn());
  // 체인용 핸들(성공/실패 모두 흡수)을 락 맵에 저장 — 다음 작업의 게이트 역할만 하고
  // 거부를 여기서 소비하므로 unhandled rejection이 생기지 않는다. 호출자에게는
  // 원본 run을 반환해 거부가 그대로 전파된다.
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

// --- 매치 CRUD ---------------------------------------------------------------

export function newMatchId(): string {
  return crypto.randomUUID();
}

export async function getMatch(matchId: string): Promise<PvpMatch | null> {
  return await readJson<PvpMatch>(matchPath(matchId));
}

export async function saveMatch(match: PvpMatch): Promise<void> {
  match.updatedAt = new Date().toISOString();
  await writeJson(matchPath(match.id), match);
}

/**
 * 매치를 락 하에서 읽고-수정-저장한다. mutator가 null을 반환하면 저장하지 않는다.
 * 매치가 없으면 GameRuleError 없이 null 반환(라우트가 404 처리).
 */
export async function updateMatch(
  matchId: string,
  mutator: (match: PvpMatch) => PvpMatch | null | Promise<PvpMatch | null>,
): Promise<PvpMatch | null> {
  return withLock(`match:${matchId}`, async () => {
    const match = await getMatch(matchId);
    if (!match) return null;
    const updated = await mutator(match);
    if (!updated) return match;
    await saveMatch(updated);
    return updated;
  });
}

/** 한 유저가 관여한(도전자/상대) 모든 매치를 최신순으로 반환. */
export async function listMatchesForUser(userId: string): Promise<PvpMatch[]> {
  let files: string[];
  try {
    files = await fs.readdir(matchesDir());
  } catch {
    return [];
  }
  const matches: PvpMatch[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const match = await readJson<PvpMatch>(path.join(matchesDir(), file));
    if (!match) continue;
    if (match.challenger.userId === userId || match.opponent.userId === userId) {
      matches.push(match);
    }
  }
  return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// --- 대기열 ------------------------------------------------------------------

export async function getQueue(): Promise<PvpQueueState> {
  const queue = await readJson<PvpQueueState>(queuePath());
  return queue && Array.isArray(queue.entries) ? queue : { entries: [] };
}

export async function saveQueue(queue: PvpQueueState): Promise<void> {
  await writeJson(queuePath(), queue);
}

/** 대기열을 락 하에서 읽고-수정-저장. mutator가 반환한 값을 저장한다. */
export async function updateQueue<T>(
  mutator: (queue: PvpQueueState) => { queue: PvpQueueState; result: T } | Promise<{ queue: PvpQueueState; result: T }>,
): Promise<T> {
  return withLock("queue", async () => {
    const queue = await getQueue();
    const { queue: next, result } = await mutator(queue);
    await saveQueue(next);
    return result;
  });
}
