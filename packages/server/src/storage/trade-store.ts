import path from "node:path";
import crypto from "node:crypto";
import type { TradeRecord } from "../../../../shared/types.js";
import { DATA_DIR } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";

export const MAX_RESOLVED_TRADES = 200;

function tradeStorePath(): string {
  return path.join(DATA_DIR, "trades", "trades.json");
}

export async function getTrades(): Promise<TradeRecord[]> {
  const trades = await readJson<TradeRecord[]>(tradeStorePath());
  return Array.isArray(trades) ? trades : [];
}

export async function saveTrades(trades: TradeRecord[]): Promise<void> {
  await writeJson(tradeStorePath(), pruneTrades(trades));
}

function pruneTrades(trades: TradeRecord[]): TradeRecord[] {
  const pending = trades.filter((trade) => trade.status === "pending");
  const resolved = trades
    .filter((trade) => trade.status !== "pending")
    .sort((left, right) => (
      (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
    ))
    .slice(0, MAX_RESOLVED_TRADES);

  return [...pending, ...resolved];
}

export function createTradeRecord(input: {
  requesterUserId: string;
  requesterPokemonUid: string;
  responderUserId: string;
  responderPokemonUid: string;
}): TradeRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    requesterUserId: input.requesterUserId,
    requesterPokemonUid: input.requesterPokemonUid,
    responderUserId: input.responderUserId,
    responderPokemonUid: input.responderPokemonUid,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}
