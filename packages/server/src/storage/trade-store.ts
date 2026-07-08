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
  const pruned = await pruneTrades(trades);
  await writeJson(tradeStorePath(), pruned);
}

async function pruneTrades(trades: TradeRecord[]): Promise<TradeRecord[]> {
  const pending = trades.filter((trade) => trade.status === "pending");
  const resolved = trades
    .filter((trade) => trade.status !== "pending")
    .sort((left, right) => (
      (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
    ));

  if (resolved.length > MAX_RESOLVED_TRADES) {
    const toArchive = resolved.slice(MAX_RESOLVED_TRADES);
    await archiveTrades(toArchive);
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

/**
 * 유저가 요청자/응답자로 참여해 실제로 성사(status="accepted")한 트레이드 통산 횟수(업적용).
 * 현재 파일(trades.json)과 아카이브(trades-archive.json, MAX_RESOLVED_TRADES 초과분) 둘 다 센다
 * — 오래된 트레이드도 통산 집계에서 빠지면 안 되므로.
 */
export async function getCompletedTradeCount(userId: string): Promise<number> {
  const [active, archived] = await Promise.all([getTrades(), getArchivedTrades()]);
  const isMine = (t: TradeRecord) =>
    t.status === "accepted" && (t.requesterUserId === userId || t.responderUserId === userId);
  return active.filter(isMine).length + archived.filter(isMine).length;
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
