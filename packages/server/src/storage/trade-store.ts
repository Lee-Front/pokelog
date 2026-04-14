import path from "node:path";
import crypto from "node:crypto";
import type { TradeRecord } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";

export const MAX_RESOLVED_TRADES = 200;

function tradeStorePath(): string {
  return path.join(getDataDir(), "trades", "trades.json");
}

function archivePath(): string {
  return path.join(getDataDir(), "trades", "trades-archive.json");
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
    ));

  if (resolved.length > MAX_RESOLVED_TRADES) {
    const toArchive = resolved.slice(MAX_RESOLVED_TRADES);
    archiveTrades(toArchive); // async fire-and-forget
    return [...pending, ...resolved.slice(0, MAX_RESOLVED_TRADES)];
  }

  return trades;
}

async function archiveTrades(trades: TradeRecord[]): Promise<void> {
  const existing = await readJson<TradeRecord[]>(archivePath()) ?? [];
  const merged = [...existing, ...trades];
  await writeJson(archivePath(), merged);
}

export async function getArchivedTrades(): Promise<TradeRecord[]> {
  return await readJson<TradeRecord[]>(archivePath()) ?? [];
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
