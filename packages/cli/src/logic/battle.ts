/**
 * Battle result logic — pure, I/O-free, matches the server /api/battle/action
 * response contract. Kept here so it is unit-testable independent of the
 * interactive encounter screen.
 */

import { DIM, RED, GRN, YEL, CYN, R } from "../ui/colors.js";
import type { BattleRewards } from "../../../../shared/types.js";

/**
 * The `result` field the server returns from /api/battle/action and the fainted
 * handler. The server does NOT send `battleOver` or a boolean `caught`. A
 * `rewards` object IS sent when `result === "win"` (EXP / battle money / item
 * drops); it is absent for every other result.
 */
export type BattleActionResult =
  | "win"      // wild fainted — battle won
  | "lose"     // whole party fainted — battle lost
  | "caught"   // wild caught
  | "run"      // fled
  | "continue" // battle ongoing
  | "fainted"; // active Pokemon fainted, a switch is still possible

export interface BattleResult {
  result?: BattleActionResult;
  log?: string[];
  message?: string;
  battleState?: unknown | null;
  /** Present on result === "caught". */
  pokemon?: unknown;
  /** Present on result === "win": EXP, battle money, and any item drops. */
  rewards?: BattleRewards;
  [key: string]: unknown;
}

/** Results that end the battle (battleState becomes null server-side). */
const TERMINAL_RESULTS: ReadonlySet<BattleActionResult> = new Set([
  "win",
  "lose",
  "caught",
  "run",
]);

/** Whether the server result ends the battle. */
export function isBattleOver(result: BattleActionResult | undefined): boolean {
  return result !== undefined && TERMINAL_RESULTS.has(result);
}

/**
 * The colored banner line for a terminal battle result, or null if the battle
 * is not over. Keyed on the server's actual values (win/lose/caught/run).
 */
export function battleOutcomeBanner(result: BattleActionResult | undefined): string | null {
  switch (result) {
    case "win":    return `${GRN}전투 승리!${R}`;
    case "lose":   return `${RED}전투 패배...${R}`;
    case "caught": return `${YEL}포켓몬을 잡았다!${R}`;
    case "run":    return `${DIM}무사히 도망쳤다.${R}`;
    default:       return null;
  }
}

/**
 * Human-readable reward summary lines for a battle win, or [] when there are no
 * rewards to show. Consumes the server's `rewards` payload.
 */
export function battleRewardLines(rewards: BattleRewards | undefined): string[] {
  if (!rewards) return [];
  const lines: string[] = [];
  if (rewards.exp > 0) lines.push(`${CYN}+${rewards.exp} EXP${R}`);
  if (rewards.leveledUp && rewards.newLevel != null) {
    lines.push(`${GRN}레벨 ${rewards.newLevel} 달성!${R}`);
  }
  if (rewards.evolvedInto) lines.push(`${GRN}${rewards.evolvedInto}(으)로 진화!${R}`);
  if (rewards.gameMoney > 0) lines.push(`${YEL}+${rewards.gameMoney} 게임머니${R}`);
  for (const drop of rewards.droppedItems ?? []) {
    lines.push(`${CYN}${drop.item} ${drop.qty}개 획득!${R}`);
  }
  return lines;
}

/**
 * Append the terminal banner for a finished battle to `battleLog`; returns
 * whether the battle ended. On a win, also appends the reward summary lines.
 */
export function pushBattleOutcome(r: BattleResult, battleLog: string[]): boolean {
  const banner = battleOutcomeBanner(r.result);
  if (banner === null) return false;
  battleLog.push(banner);
  if (r.result === "win") {
    battleLog.push(...battleRewardLines(r.rewards));
  }
  return true;
}
