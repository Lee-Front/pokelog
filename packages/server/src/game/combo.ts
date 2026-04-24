import type { UserCombo, ComboConfig } from "../../../../shared/types.js";

// Any gap larger than this between the previous commit and the current one
// resets the combo, regardless of density. Protects against stale
// lastCommitAt values (clock skew, dormant users returning after months)
// from letting a user chain a months-old combo onto a fresh commit.
const COMBO_STALE_RESET_DAYS = 90;

export function judgeCombo(
  prevCombo: UserCombo | null,
  currentBytes: number,
  currentTime: string,
  config: ComboConfig
): UserCombo {
  if (prevCombo === null || prevCombo.lastCommitAt === null) {
    return { count: 1, lastCommitAt: currentTime };
  }

  const prevTime = new Date(prevCombo.lastCommitAt).getTime();
  const currTime = new Date(currentTime).getTime();

  // Guard against malformed timestamps on either side. If the stored
  // lastCommitAt cannot be parsed (corrupted user file, legacy data), or
  // the incoming commit timestamp is invalid, fall back to "start a fresh
  // combo" rather than propagating NaN through arithmetic.
  if (!Number.isFinite(prevTime) || !Number.isFinite(currTime)) {
    return { count: 1, lastCommitAt: currentTime };
  }

  const minutes = (currTime - prevTime) / (1000 * 60);

  // Stale combo: previous commit is more than COMBO_STALE_RESET_DAYS ago
  // (or the clock went backwards such that minutes < 0 by a long gap).
  // Reset to a fresh combo rather than letting ancient state linger.
  const STALE_MINUTES = COMBO_STALE_RESET_DAYS * 24 * 60;
  if (minutes > STALE_MINUTES || minutes < -STALE_MINUTES) {
    return { count: 1, lastCommitAt: currentTime };
  }

  const density = minutes <= 0 ? Infinity : currentBytes / minutes;

  if (density >= config.bytesPerMinute) {
    return { count: prevCombo.count + 1, lastCommitAt: currentTime };
  }

  return { count: 1, lastCommitAt: currentTime };
}

export function getComboMultiplier(count: number, config: ComboConfig): number {
  if (count >= config.multipliers.length) {
    return config.maxMultiplier;
  }
  return config.multipliers[count];
}
