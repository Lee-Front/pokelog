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
import { AsyncLocalStorage } from "node:async_hooks";
import type { PvpMatch, PvpQueueState } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";
import { withProcessLock } from "./xproc-lock.js";

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
//
// 2단 직렬화:
//  1) 프로세스 내부 — 키별 약속 체인(값싼 경로). 같은 프로세스의 같은 키 작업을 순차화해,
//     아래 파일 락에는 키당 최대 한 명의 대기자만 도달한다.
//  2) 프로세스 간 — xproc-lock의 mkdir 기반 파일 락(blue-green 배포 중 두 프로세스가
//     겹칠 때 같은 유저 JSON에 대한 읽기-수정-쓰기 유실을 막는다).
// 경합이 없을 때의 동작은 기존과 기능적으로 동일하다(임계구역 앞뒤로 락 획득/해제만 추가).
const locks = new Map<string, Promise<unknown>>();

/**
 * 현재 async 컨텍스트가 보유 중인 락 키 집합. 파일 락은 재진입 불가이므로, 이미 같은 키를
 * 쥔 흐름이 같은 키로 withLock을 다시 부르면(재진입) 락을 다시 잡지 않고 fn만 그대로 실행해
 * 자기 자신과의 교착을 막는다. AsyncLocalStorage로 흐름별 격리 — 서로 다른 요청이 우연히
 * 같은 키를 쓸 때는 격리되어 정상 직렬화된다.
 */
const heldKeys = new AsyncLocalStorage<Set<string>>();

/**
 * 프로세스 내부 키별 약속 체인. fn을 이전 같은 키 작업 뒤에 잇고, 호출자에게는 원본 결과를
 * (거부 포함) 그대로 전파한다. 체인 핸들은 성공/실패를 모두 흡수해 unhandled rejection이
 * 생기지 않게 한다.
 */
function chainInProcess<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // 재진입 가드 — 이미 이 키를 쥔 흐름이면 재획득 없이 그대로 실행(파일 락은 non-reentrant).
  const currentlyHeld = heldKeys.getStore();
  if (currentlyHeld?.has(key)) {
    return fn();
  }

  return chainInProcess(key, () => {
    // 이 흐름에서 잡은 키를 기록해, fn 내부의 같은 키 재진입을 위 가드가 감지하게 한다.
    const held = new Set(currentlyHeld ?? []);
    held.add(key);
    return heldKeys.run(held, () => withProcessLock(key, fn));
  });
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
