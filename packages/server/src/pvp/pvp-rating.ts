const K = 32;

export function calculateElo(
  winnerRating: number,
  loserRating: number,
): { winnerNew: number; loserNew: number; winnerDelta: number; loserDelta: number } {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 - expectedWinner;

  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));

  return {
    winnerNew: winnerRating + winnerDelta,
    loserNew: Math.max(0, loserRating + loserDelta),
    winnerDelta,
    loserDelta,
  };
}
