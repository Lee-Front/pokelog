import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "../paths.js";
import { childLogger } from "../logger.js";
import type { EventLogEntry } from "../../../../shared/types.js";

const log = childLogger("event-log");

/**
 * 시스템 활동 로그(JSONL append-only). 모든 사용자의 핵심 흐름(전투·포인트 등)을
 * 한 줄 = 한 이벤트로 영속 기록해 운영자가 에러 원인을 추적할 수 있게 한다.
 *
 * V1은 단순함을 우선한다: 단일 파일에 append, 조회는 역순 스캔(최신순) + limit/offset.
 * 회전/보관 정책은 후순위 — 파일이 커지면 줄 단위 tail로 충분하다.
 */
function getEventLogPath(): string {
  return path.join(getDataDir(), "event-log.jsonl");
}

export interface AppendEventInput {
  type: string;
  userId?: string;
  detail?: Record<string, unknown>;
}

/**
 * 이벤트 한 건을 기록한다. 타임스탬프·랜덤 id를 채워 JSONL 한 줄로 append.
 *
 * 로깅은 부가 기능이므로 절대 호출부 흐름을 깨면 안 된다 — 실패는 삼키고 경고만 남긴다.
 */
export async function appendEvent(input: AppendEventInput): Promise<void> {
  const entry: EventLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: input.type,
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };

  try {
    const filePath = getEventLogPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    log.error({ err, type: input.type, userId: input.userId }, "Failed to append event log");
  }
}

export interface QueryOptions {
  userId?: string;
  type?: string;
  /** ISO 시각 — 이 시각 이후(포함) 이벤트만 */
  since?: string;
  /** ISO 시각 — 이 시각 이전(포함) 이벤트만 */
  until?: string;
  /** 반환 최대 개수 (기본 100) */
  limit?: number;
  /** 건너뛸 개수 (페이지네이션, 기본 0) */
  offset?: number;
}

export interface QueryResult {
  entries: EventLogEntry[];
  /** 필터를 통과한 전체 개수 (페이지네이션 UI용) */
  total: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * 필터에 맞는 이벤트를 최신순으로 반환한다. JSONL을 통째로 읽어 역순 스캔하는 단순
 * 구현 — 대용량 최적화(역방향 청크 읽기 등)는 후순위. 파일이 없으면 빈 결과.
 */
export async function query(opts: QueryOptions = {}): Promise<QueryResult> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(0, opts.offset ?? 0);
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  const untilMs = opts.until ? Date.parse(opts.until) : null;

  let content: string;
  try {
    content = await fs.readFile(getEventLogPath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { entries: [], total: 0 };
    }
    log.error({ err }, "Failed to read event log");
    return { entries: [], total: 0 };
  }

  const lines = content.split("\n");
  const matched: EventLogEntry[] = [];

  // 역순(최신 먼저)으로 스캔하며 필터를 적용한다.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    let entry: EventLogEntry;
    try {
      entry = JSON.parse(line) as EventLogEntry;
    } catch {
      // 손상된 줄(부분 기록 등)은 건너뛴다 — 조회가 깨지지 않도록.
      continue;
    }

    if (opts.userId && entry.userId !== opts.userId) continue;
    if (opts.type && entry.type !== opts.type) continue;
    if (sinceMs !== null || untilMs !== null) {
      const ts = Date.parse(entry.timestamp);
      if (sinceMs !== null && !(ts >= sinceMs)) continue;
      if (untilMs !== null && !(ts <= untilMs)) continue;
    }

    matched.push(entry);
  }

  return {
    entries: matched.slice(offset, offset + limit),
    total: matched.length,
  };
}
