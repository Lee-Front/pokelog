import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeRecord } from "../../../../shared/types.js";

type TradeStoreModule = typeof import("../../src/storage/trade-store.js");

let tmpDir: string;
let tradeStoreModule: TradeStoreModule;

function createResolvedTrade(id: string, updatedAt: string): TradeRecord {
  return {
    id,
    requesterUserId: `req-${id}`,
    requesterPokemonUid: `req-mon-${id}`,
    responderUserId: `res-${id}`,
    responderPokemonUid: `res-mon-${id}`,
    status: "accepted",
    createdAt: updatedAt,
    updatedAt,
    resolvedAt: updatedAt,
  };
}

describe("trade-store", () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-trade-store-test-"));
    process.env.POKELOG_DATA_DIR = tmpDir;
    vi.resetModules();
    tradeStoreModule = await import("../../src/storage/trade-store.js");
  });

  afterEach(() => {
    delete process.env.POKELOG_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps all pending trades and prunes old resolved trades", async () => {
    const pendingTrade: TradeRecord = {
      id: "pending-1",
      requesterUserId: "alice",
      requesterPokemonUid: "a1",
      responderUserId: "bob",
      responderPokemonUid: "b1",
      status: "pending",
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    };

    const resolvedTrades = Array.from({ length: tradeStoreModule.MAX_RESOLVED_TRADES + 5 }, (_, index) => (
      createResolvedTrade(
        `resolved-${index}`,
        new Date(Date.UTC(2026, 3, 1, 0, 0, index)).toISOString(),
      )
    ));

    await tradeStoreModule.saveTrades([pendingTrade, ...resolvedTrades]);
    const stored = await tradeStoreModule.getTrades();

    expect(stored.filter((trade) => trade.status === "pending")).toHaveLength(1);
    expect(stored.filter((trade) => trade.status !== "pending")).toHaveLength(tradeStoreModule.MAX_RESOLVED_TRADES);
    expect(stored.some((trade) => trade.id === "resolved-0")).toBe(false);
    expect(stored.some((trade) => trade.id === `resolved-${tradeStoreModule.MAX_RESOLVED_TRADES + 4}`)).toBe(true);
  });

  it("archives trades beyond MAX_RESOLVED_TRADES instead of dropping", async () => {
    const count = tradeStoreModule.MAX_RESOLVED_TRADES + 5;
    const trades = Array.from({ length: count }, (_, index) => (
      createResolvedTrade(
        `r-${index}`,
        new Date(Date.UTC(2026, 3, 1, 0, 0, index)).toISOString(),
      )
    ));

    await tradeStoreModule.saveTrades(trades);

    const active = await tradeStoreModule.getTrades();
    expect(active.filter((t) => t.status !== "pending")).toHaveLength(tradeStoreModule.MAX_RESOLVED_TRADES);

    const archivePath = path.join(tmpDir, "trades", "trades-archive.json");
    const archived = JSON.parse(fs.readFileSync(archivePath, "utf-8")) as TradeRecord[];
    expect(archived).toHaveLength(5);

    // The oldest 5 should be archived (indices 0..4 — lowest updatedAt)
    for (let i = 0; i < 5; i++) {
      expect(archived.some((t) => t.id === `r-${i}`)).toBe(true);
    }
  });

  it("getArchivedTrades returns archived records", async () => {
    const count = tradeStoreModule.MAX_RESOLVED_TRADES + 3;
    const trades = Array.from({ length: count }, (_, index) => (
      createResolvedTrade(
        `a-${index}`,
        new Date(Date.UTC(2026, 3, 2, 0, 0, index)).toISOString(),
      )
    ));

    await tradeStoreModule.saveTrades(trades);

    const archived = await tradeStoreModule.getArchivedTrades();
    expect(archived).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(archived.some((t) => t.id === `a-${i}`)).toBe(true);
    }
  });

  it("getCompletedTradeCount counts accepted trades where the user was requester or responder, across active + archive", async () => {
    const pendingTrade: TradeRecord = {
      id: "pending-1",
      requesterUserId: "alice",
      requesterPokemonUid: "a1",
      responderUserId: "bob",
      responderPokemonUid: "b1",
      status: "pending",
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    };
    const rejectedTrade: TradeRecord = {
      ...pendingTrade,
      id: "rejected-1",
      status: "rejected",
      resolvedAt: "2026-04-13T00:00:01.000Z",
    };
    const aliceAsRequester: TradeRecord = {
      id: "acc-1",
      requesterUserId: "alice",
      requesterPokemonUid: "a2",
      responderUserId: "carol",
      responderPokemonUid: "c1",
      status: "accepted",
      createdAt: "2026-04-13T00:00:02.000Z",
      updatedAt: "2026-04-13T00:00:02.000Z",
      resolvedAt: "2026-04-13T00:00:02.000Z",
    };
    const aliceAsResponder: TradeRecord = {
      id: "acc-2",
      requesterUserId: "dave",
      requesterPokemonUid: "d1",
      responderUserId: "alice",
      responderPokemonUid: "a3",
      status: "accepted",
      createdAt: "2026-04-13T00:00:03.000Z",
      updatedAt: "2026-04-13T00:00:03.000Z",
      resolvedAt: "2026-04-13T00:00:03.000Z",
    };
    await tradeStoreModule.saveTrades([pendingTrade, rejectedTrade, aliceAsRequester, aliceAsResponder]);

    // 아카이브에도 alice가 참여한 성사 트레이드 하나를 직접 심는다(MAX_RESOLVED_TRADES 초과분 흉내).
    const archivePath = path.join(tmpDir, "trades", "trades-archive.json");
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, JSON.stringify([{
      id: "archived-1",
      requesterUserId: "alice",
      requesterPokemonUid: "a4",
      responderUserId: "eve",
      responderPokemonUid: "e1",
      status: "accepted",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      resolvedAt: "2026-03-01T00:00:00.000Z",
    } satisfies TradeRecord]));

    expect(await tradeStoreModule.getCompletedTradeCount("alice")).toBe(3);
    expect(await tradeStoreModule.getCompletedTradeCount("bob")).toBe(0); // pending만 관여, 성사 아님
    expect(await tradeStoreModule.getCompletedTradeCount("nobody")).toBe(0);
  });
});
