import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../storage/json-store.js";
import { getDataDir } from "../paths.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { calculateElo } from "./pvp-rating.js";
import { adjustFriendshipBulk } from "../game/friendship.js";
import type { PvpMatchRecord } from "../../../../shared/pvp-types.js";

function matchHistoryPath(): string {
  return path.join(getDataDir(), "pvp-history.json");
}

export async function getMatchHistory(limit = 50): Promise<PvpMatchRecord[]> {
  const data = await readJson<PvpMatchRecord[]>(matchHistoryPath());
  const records = data ?? [];
  return records.slice(-limit);
}

export async function recordMatch(
  winnerUserId: string | null,
  loserUserId: string | null,
  reason: string,
): Promise<PvpMatchRecord | null> {
  if (!winnerUserId || !loserUserId) return null;
  if (winnerUserId === loserUserId) return null;

  // Acquire two per-user locks in a deterministic (lexicographic) order
  // to avoid deadlock with any other double-lock caller. The nested
  // callback is only entered once we own BOTH locks.
  const [firstId, secondId] = winnerUserId < loserUserId
    ? [winnerUserId, loserUserId]
    : [loserUserId, winnerUserId];

  return withUserLock(firstId, () => withUserLock(secondId, async () => {
    const winner = await getUser(winnerUserId);
    const loser = await getUser(loserUserId);
    if (!winner || !loser) return null;

    const wStats = winner.pvpStats ?? { rating: 1000, wins: 0, losses: 0, streak: 0 };
    const lStats = loser.pvpStats ?? { rating: 1000, wins: 0, losses: 0, streak: 0 };

    const elo = calculateElo(wStats.rating, lStats.rating);

    wStats.rating = elo.winnerNew;
    wStats.wins += 1;
    wStats.streak += 1;
    lStats.rating = elo.loserNew;
    lStats.losses += 1;
    lStats.streak = 0;

    winner.points += 100;
    loser.points += 20;

    // Friendship: +2 to every alive party member of the winner.
    // Battle copies (PvpPokemon) are mutated during the match but never
    // persisted; we adjust the OwnedPokemon party records directly.
    const winnerParty = winner.party
      .map((uid) => winner.pokemon.find((p) => p.uid === uid))
      .filter((p): p is NonNullable<typeof p> => p != null);
    adjustFriendshipBulk(winnerParty, "pvp-win");

    winner.pvpStats = wStats;
    loser.pvpStats = lStats;
    await saveUser(winner);
    await saveUser(loser);

    const record: PvpMatchRecord = {
      id: crypto.randomUUID(),
      playerA: { userId: winnerUserId, nickname: winner.account.nickname, rating: elo.winnerNew },
      playerB: { userId: loserUserId, nickname: loser.account.nickname, rating: elo.loserNew },
      winnerId: winnerUserId,
      reason,
      ratingChange: { a: elo.winnerDelta, b: elo.loserDelta },
      createdAt: new Date().toISOString(),
    };

    const history = await readJson<PvpMatchRecord[]>(matchHistoryPath()) ?? [];
    history.push(record);
    if (history.length > 500) history.splice(0, history.length - 500);
    await writeJson(matchHistoryPath(), history);

    return record;
  }));
}
