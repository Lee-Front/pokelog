import { apiGet } from "../api-client.js";
import { BLD, DIM, GRN, R, YEL } from "../ui/colors.js";

interface MatchRecord {
  id: string;
  playerA: { userId: string; nickname: string; rating: number };
  playerB: { userId: string; nickname: string; rating: number };
  winnerId: string | null;
  reason: string;
  ratingChange: { a: number; b: number };
  createdAt: string;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export async function pvpHistoryCommand(limit = 20) {
  const res = await apiGet(`/api/social/pvp-history?limit=${limit}`);
  if (!res.ok) {
    console.error(`오류: ${String(res.data.error ?? "Failed to load PvP history.")}`);
    return;
  }

  const matches: MatchRecord[] = (res.data.matches as MatchRecord[] | undefined) ?? [];

  console.log(`\n  ${BLD}── PvP 전적 (최근 ${matches.length}경기) ──${R}`);
  if (matches.length === 0) {
    console.log(`  ${DIM}전적이 없습니다${R}`);
    return;
  }

  for (const m of matches.slice().reverse()) {
    const winnerName = m.winnerId === m.playerA.userId
      ? m.playerA.nickname
      : m.winnerId === m.playerB.userId
        ? m.playerB.nickname
        : "무승부";
    const date = new Date(m.createdAt).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    console.log(`  ${DIM}${date}${R}  ${m.playerA.nickname} vs ${m.playerB.nickname}`);
    console.log(
      `    승자: ${GRN}${winnerName}${R} ${DIM}(${m.reason})${R}  ${YEL}Δ${R} ${signed(m.ratingChange.a)} / ${signed(m.ratingChange.b)}`,
    );
  }
}
