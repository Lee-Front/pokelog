/**
 * Trade 커맨드 순수 로직 — I/O 없음, 테스트 가능
 */

const GRN = "\x1b[32m";
const RED = "\x1b[31m";
const CYN = "\x1b[36m";
const YEL = "\x1b[33m";
const DIM = "\x1b[90m";
const R = "\x1b[0m";

export type TradeDirection = "incoming" | "outgoing";

export interface TradeView {
  id: string;
  status: string;
  direction: TradeDirection;
  requester: {
    userId: string;
    nickname: string;
    pokemonUid: string;
    species: string | null;
    speciesName: string | null;
  };
  responder: {
    userId: string;
    nickname: string;
    pokemonUid: string;
    species: string | null;
    speciesName: string | null;
  };
}

export interface TradePokemonCandidate {
  uid: string;
  species: string;
  speciesName: string;
  nickname: string | null;
  level: number;
  location: "party" | "storage";
}

export function formatTradeLine(trade: TradeView): string {
  const left = `${trade.requester.nickname} [${trade.requester.userId}]`;
  const right = `${trade.responder.nickname} [${trade.responder.userId}]`;
  const leftPokemon = trade.requester.speciesName ?? trade.requester.species ?? trade.requester.pokemonUid;
  const rightPokemon = trade.responder.speciesName ?? trade.responder.species ?? trade.responder.pokemonUid;
  return `${trade.id} | ${trade.status} | ${trade.direction} | ${leftPokemon} <-> ${rightPokemon} | ${left} -> ${right}`;
}

export function formatTradeItem(trade: TradeView): string {
  const arrow = trade.direction === "incoming" ? `${GRN}← 받은 요청${R}` : `${CYN}→ 보낸 요청${R}`;
  const leftPoke = trade.requester.speciesName ?? trade.requester.species ?? "?";
  const rightPoke = trade.responder.speciesName ?? trade.responder.species ?? "?";
  const partner = trade.direction === "incoming" ? trade.requester.nickname : trade.responder.nickname;
  const statusColor = trade.status === "pending" ? YEL : DIM;
  return `${arrow} ${partner}  ${leftPoke} ↔ ${rightPoke}  ${statusColor}${trade.status}${R}`;
}

export function formatCandidateLine(candidate: TradePokemonCandidate): string {
  const name = candidate.nickname
    ? `${candidate.nickname} (${candidate.speciesName})`
    : candidate.speciesName;
  const location = candidate.location === "party" ? "Party" : "Storage";
  return `${name} | Lv.${candidate.level} | ${location} | ${candidate.uid}`;
}

export interface TradeMenuItem {
  type: "separator" | "choice";
  text: string;
  value?: string;
}

export function buildTradeMenuItems(trades: TradeView[]): TradeMenuItem[] {
  const items: TradeMenuItem[] = [];

  const pending = trades.filter((t) => t.status === "pending");
  const resolved = trades.filter((t) => t.status !== "pending");

  if (pending.length > 0) {
    items.push({ type: "separator", text: `  ${YEL}── 대기 중 ──${R}` });
    for (const trade of pending) {
      items.push({ type: "choice", text: `  ${formatTradeItem(trade)}`, value: `trade:${trade.id}` });
    }
  }

  if (resolved.length > 0) {
    items.push({ type: "separator", text: `  ${DIM}── 완료 ──${R}` });
    for (const trade of resolved.slice(0, 10)) {
      items.push({ type: "choice", text: `  ${DIM}${formatTradeItem(trade)}${R}`, value: `resolved:${trade.id}` });
    }
  }

  if (trades.length === 0) {
    items.push({ type: "separator", text: `  ${DIM}교환 내역이 없습니다${R}` });
  }

  return items;
}

export function getTradeActions(trade: TradeView): Array<{ label: string; action: string }> {
  if (trade.direction === "incoming") {
    return [
      { label: `${GRN}수락${R}`, action: "accept" },
      { label: `${RED}거절${R}`, action: "reject" },
    ];
  }
  return [{ label: `${RED}취소${R}`, action: "cancel" }];
}

export function findTradeById(trades: TradeView[], tradeId: string): TradeView | undefined {
  return trades.find((t) => t.id === tradeId);
}

export function parseTradeChoice(choice: string): { type: "trade" | "resolved" | "new" | "back"; id?: string } {
  if (choice === "__new__") return { type: "new" };
  if (choice === "__back__" || !choice) return { type: "back" };
  if (choice.startsWith("trade:")) return { type: "trade", id: choice.slice(6) };
  if (choice.startsWith("resolved:")) return { type: "resolved", id: choice.slice(9) };
  return { type: "back" };
}
