import type { UserCombo, ComboConfig } from "../../../../shared/types.js";

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
  const minutes = (currTime - prevTime) / (1000 * 60);

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
