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
});
