import { describe, it, expect } from "vitest";
import {
  isBattleOver,
  battleOutcomeBanner,
  pushBattleOutcome,
  battleRewardLines,
  type BattleResult,
} from "../../src/logic/battle.js";

describe("isBattleOver", () => {
  it("is true for terminal server results", () => {
    for (const r of ["win", "lose", "caught", "run"] as const) {
      expect(isBattleOver(r)).toBe(true);
    }
  });

  it("is false for ongoing results", () => {
    expect(isBattleOver("continue")).toBe(false);
    expect(isBattleOver("fainted")).toBe(false);
    expect(isBattleOver(undefined)).toBe(false);
  });

  it("does not treat the old CLI values as terminal", () => {
    // The CLI used to check "victory"/"defeat", which the server never sends.
    expect(isBattleOver("victory" as never)).toBe(false);
    expect(isBattleOver("defeat" as never)).toBe(false);
  });
});

describe("battleOutcomeBanner", () => {
  it("returns a banner for each terminal result", () => {
    expect(battleOutcomeBanner("win")).toContain("전투 승리!");
    expect(battleOutcomeBanner("lose")).toContain("전투 패배...");
    expect(battleOutcomeBanner("caught")).toContain("포켓몬을 잡았다!");
    expect(battleOutcomeBanner("run")).toContain("무사히 도망쳤다.");
  });

  it("returns null while the battle continues", () => {
    expect(battleOutcomeBanner("continue")).toBeNull();
    expect(battleOutcomeBanner("fainted")).toBeNull();
    expect(battleOutcomeBanner(undefined)).toBeNull();
  });
});

describe("pushBattleOutcome", () => {
  function run(result: BattleResult["result"]): { ended: boolean; log: string[] } {
    const log: string[] = [];
    const ended = pushBattleOutcome({ result } as BattleResult, log);
    return { ended, log };
  }

  it("appends a victory banner and reports the battle over on win", () => {
    const { ended, log } = run("win");
    expect(ended).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("전투 승리!");
  });

  it("appends a defeat banner on lose", () => {
    const { ended, log } = run("lose");
    expect(ended).toBe(true);
    expect(log[0]).toContain("전투 패배...");
  });

  it("appends a caught banner on caught", () => {
    const { ended, log } = run("caught");
    expect(ended).toBe(true);
    expect(log[0]).toContain("포켓몬을 잡았다!");
  });

  it("does nothing and reports not-over while the battle continues", () => {
    const { ended, log } = run("continue");
    expect(ended).toBe(false);
    expect(log).toHaveLength(0);
  });

  it("appends reward lines after the victory banner when rewards are present", () => {
    const log: string[] = [];
    pushBattleOutcome(
      {
        result: "win",
        rewards: {
          exp: 71,
          gameMoney: 23,
          droppedItems: [{ item: "potion", qty: 1 }],
          leveledUp: true,
          newLevel: 11,
        },
      } as BattleResult,
      log,
    );
    expect(log[0]).toContain("전투 승리!");
    expect(log.join("\n")).toContain("71 EXP");
    expect(log.join("\n")).toContain("레벨 11");
    expect(log.join("\n")).toContain("23 게임머니");
    expect(log.join("\n")).toContain("potion 1개");
  });
});

describe("battleRewardLines", () => {
  it("returns an empty array when rewards are absent", () => {
    expect(battleRewardLines(undefined)).toEqual([]);
  });

  it("omits zero-value reward lines", () => {
    const lines = battleRewardLines({ exp: 0, gameMoney: 0, droppedItems: [] });
    expect(lines).toEqual([]);
  });

  it("shows an evolution line when the winner evolved", () => {
    const lines = battleRewardLines({
      exp: 100,
      gameMoney: 5,
      droppedItems: [],
      evolvedInto: "charmeleon",
    });
    expect(lines.join("\n")).toContain("charmeleon");
  });
});
