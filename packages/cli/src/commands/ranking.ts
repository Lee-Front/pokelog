import { apiGet } from "../api-client.js";
import { BLD, DIM, R, YEL } from "../ui/colors.js";

interface PvpRankEntry {
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  streak: number;
}

interface StandardRankEntry {
  nickname: string;
  totalExp: number;
  points: number;
  pokedexCount: number;
  topLevel: number;
}

function fieldFor(by: string, entry: StandardRankEntry): number {
  switch (by) {
    case "level":
      return entry.topLevel;
    case "pokedex":
      return entry.pokedexCount;
    case "points":
      return entry.points;
    case "exp":
    default:
      return entry.totalExp;
  }
}

export async function rankingCommand(by: string = "exp") {
  if (by === "pvp") {
    const res = await apiGet("/api/social/ranking/pvp");
    if (!res.ok) {
      console.error(`오류: ${String(res.data.error ?? "Failed to load PvP ranking.")}`);
      return;
    }
    const ranking = (res.data.ranking as PvpRankEntry[] | undefined) ?? [];

    console.log(`\n  ${BLD}── PvP 랭킹 (Elo) ──${R}`);
    console.log("  " + "─".repeat(40));

    if (ranking.length === 0) {
      console.log(`  ${DIM}랭킹에 등록된 플레이어가 없습니다${R}`);
      return;
    }

    ranking.slice(0, 20).forEach((r, i) => {
      const rank = String(i + 1).padStart(2);
      const name = r.nickname.padEnd(12);
      const wl = `${r.wins}승 ${r.losses}패`;
      const streak = r.streak > 0 ? ` ${YEL}(${r.streak}연승)${R}` : "";
      console.log(`  ${rank}. ${name} ${BLD}${r.rating}${R} ${DIM}${wl}${R}${streak}`);
    });
    return;
  }

  const res = await apiGet(`/api/social/ranking?by=${by}`);
  if (!res.ok) {
    console.error(`오류: ${String(res.data.error ?? "Failed to load ranking.")}`);
    return;
  }
  const ranking = (res.data.ranking as StandardRankEntry[] | undefined) ?? [];

  console.log(`\n  ${BLD}── 랭킹 (기준: ${by}) ──${R}`);
  console.log("  " + "─".repeat(30));
  if (ranking.length === 0) {
    console.log(`  ${DIM}랭킹에 등록된 플레이어가 없습니다${R}`);
    return;
  }
  ranking.slice(0, 20).forEach((entry, i) => {
    const rank = String(i + 1).padStart(2);
    console.log(`  ${rank}. ${entry.nickname.padEnd(12)} ${BLD}${fieldFor(by, entry)}${R}`);
  });
}
