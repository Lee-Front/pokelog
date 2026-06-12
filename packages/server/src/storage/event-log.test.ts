import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendEvent, query } from "./event-log.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = path.join(os.tmpdir(), `pokelog-eventlog-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  process.env.POKELOG_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.POKELOG_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("event-log", () => {
  it("파일이 없으면 빈 결과를 반환한다", async () => {
    const result = await query();
    expect(result).toEqual({ entries: [], total: 0 });
  });

  it("append한 이벤트에 id·timestamp가 채워진다", async () => {
    await appendEvent({ type: "point_gain", userId: "u1", detail: { points: 10 } });
    const { entries, total } = await query();
    expect(total).toBe(1);
    expect(entries[0].type).toBe("point_gain");
    expect(entries[0].userId).toBe("u1");
    expect(entries[0].detail).toEqual({ points: 10 });
    expect(entries[0].id).toMatch(/[0-9a-f-]{36}/);
    expect(Number.isNaN(Date.parse(entries[0].timestamp))).toBe(false);
  });

  it("최신순(역순)으로 반환한다", async () => {
    await appendEvent({ type: "battle_start", userId: "u1" });
    await appendEvent({ type: "battle_end", userId: "u1" });
    await appendEvent({ type: "point_gain", userId: "u1" });
    const { entries } = await query();
    expect(entries.map((e) => e.type)).toEqual(["point_gain", "battle_end", "battle_start"]);
  });

  it("userId·type로 필터링한다", async () => {
    await appendEvent({ type: "point_gain", userId: "u1" });
    await appendEvent({ type: "battle_end", userId: "u2" });
    await appendEvent({ type: "point_gain", userId: "u2" });

    const byUser = await query({ userId: "u2" });
    expect(byUser.total).toBe(2);
    expect(byUser.entries.every((e) => e.userId === "u2")).toBe(true);

    const byType = await query({ type: "point_gain" });
    expect(byType.total).toBe(2);
    expect(byType.entries.every((e) => e.type === "point_gain")).toBe(true);

    const both = await query({ userId: "u2", type: "point_gain" });
    expect(both.total).toBe(1);
    expect(both.entries[0].userId).toBe("u2");
  });

  it("since·until 시각 범위로 필터링한다", async () => {
    // detail에 의미 표시만; 시간 범위는 timestamp 기준이라 직접 파일을 구성해 검증한다.
    const filePath = path.join(dataDir, "event-log.jsonl");
    const mk = (ts: string, type: string) =>
      JSON.stringify({ id: randomUUID(), timestamp: ts, type }) + "\n";
    await fs.writeFile(
      filePath,
      mk("2026-01-01T00:00:00.000Z", "a") +
        mk("2026-06-01T00:00:00.000Z", "b") +
        mk("2026-12-01T00:00:00.000Z", "c"),
      "utf-8",
    );

    const since = await query({ since: "2026-05-01T00:00:00.000Z" });
    expect(since.entries.map((e) => e.type)).toEqual(["c", "b"]);

    const until = await query({ until: "2026-05-01T00:00:00.000Z" });
    expect(until.entries.map((e) => e.type)).toEqual(["a"]);

    const between = await query({
      since: "2026-05-01T00:00:00.000Z",
      until: "2026-07-01T00:00:00.000Z",
    });
    expect(between.entries.map((e) => e.type)).toEqual(["b"]);
  });

  it("limit·offset 페이지네이션이 동작한다 (total은 전체 필터 결과)", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent({ type: "point_gain", userId: "u1", detail: { i } });
    }
    const page1 = await query({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.entries).toHaveLength(2);
    // 최신순: i=4, i=3
    expect(page1.entries.map((e) => e.detail?.i)).toEqual([4, 3]);

    const page2 = await query({ limit: 2, offset: 2 });
    expect(page2.entries.map((e) => e.detail?.i)).toEqual([2, 1]);
  });

  it("손상된 줄은 건너뛴다", async () => {
    const filePath = path.join(dataDir, "event-log.jsonl");
    await fs.writeFile(
      filePath,
      JSON.stringify({ id: "1", timestamp: new Date().toISOString(), type: "ok" }) +
        "\n{ not json }\n",
      "utf-8",
    );
    const { entries, total } = await query();
    expect(total).toBe(1);
    expect(entries[0].type).toBe("ok");
  });
});
