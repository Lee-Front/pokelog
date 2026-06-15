import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveRound, resolveActionOrder, hasAliveReserve, isWipedOut, freshStatStages,
  type EngineSide, type Rng, type ItemLookup,
} from "./pvp-engine.js";
import type { PvpCombatant, PvpAction } from "../../../../shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 전투 난수(명중·급소·난수보정)를 결정적으로 만들기 위해 Math.random을 고정한다.
 * 0.5 → 명중(tackle acc 100), 급소 미발생(critDenominator*0.5 ≥ 1), 난수보정 0.85+0.075.
 */
function fixRandom(value = 0.5): void {
  vi.spyOn(Math, "random").mockReturnValue(value);
}

function mon(over: Partial<PvpCombatant> = {}): PvpCombatant {
  return {
    uid: over.uid ?? "u-" + Math.random().toString(36).slice(2, 8),
    species: over.species ?? "testmon",
    variantId: null,
    nickname: over.nickname ?? null,
    level: over.level ?? 50,
    hp: over.hp ?? 100,
    maxHp: over.maxHp ?? 100,
    stats: over.stats ?? { attack: 80, defense: 80, speed: 80, spAttack: 80, spDefense: 80 },
    moves: over.moves ?? [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: over.statusCondition ?? null,
    sleepTurns: over.sleepTurns,
    volatile: over.volatile ?? [],
    statStages: over.statStages ?? freshStatStages(),
  };
}

function side(team: PvpCombatant[], over: Partial<EngineSide> = {}): EngineSide {
  return {
    userId: over.userId ?? "user",
    nickname: over.nickname ?? "Trainer",
    team,
    activeIndex: over.activeIndex ?? 0,
  };
}

const move = (moveId: string): PvpAction => ({ kind: "move", moveId });
const switchTo = (teamIndex: number): PvpAction => ({ kind: "switch", teamIndex });
const useItem = (itemId: string, targetUid?: string): PvpAction => ({ kind: "item", itemId, targetUid });
const constRng = (v: number): Rng => () => v;

/** 테스트용 아이템 룩업 — potion(20)/superPotion(50)만 전투 사용가능. */
const items: ItemLookup = (id) =>
  id === "potion" ? { name: "Potion", healAmount: 20 }
    : id === "superPotion" ? { name: "Super Potion", healAmount: 50 }
      : undefined;

describe("resolveActionOrder", () => {
  it("교체가 기술보다 항상 먼저 행동한다", () => {
    const fast = mon({ stats: { attack: 80, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } });
    const slow = mon({ stats: { attack: 80, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } });
    // 느린 쪽이 교체, 빠른 쪽이 기술 → 교체한 느린 쪽이 먼저.
    const order = resolveActionOrder(slow, switchTo(1), fast, move("tackle"), constRng(0.9));
    expect(order).toBe("challenger");
  });

  it("속도가 빠른 쪽이 먼저 행동한다", () => {
    const fast = mon({ stats: { attack: 80, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } });
    const slow = mon({ stats: { attack: 80, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } });
    expect(resolveActionOrder(fast, move("tackle"), slow, move("tackle"), constRng(0.9))).toBe("challenger");
    expect(resolveActionOrder(slow, move("tackle"), fast, move("tackle"), constRng(0.9))).toBe("opponent");
  });

  it("속도 동률이면 rng로 타이브레이크한다", () => {
    const a = mon();
    const b = mon();
    expect(resolveActionOrder(a, move("tackle"), b, move("tackle"), constRng(0.4))).toBe("challenger");
    expect(resolveActionOrder(a, move("tackle"), b, move("tackle"), constRng(0.6))).toBe("opponent");
  });
});

describe("resolveRound — single 모드(1마리씩)", () => {
  it("빠른 쪽이 먼저 데미지를 주고, 양쪽 모두 행동한다", () => {
    fixRandom(0.5);
    const fast = side([mon({ nickname: "Fast", stats: { attack: 120, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } })]);
    const slow = side([mon({ nickname: "Slow", stats: { attack: 120, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } })]);

    const outcome = resolveRound(fast, move("tackle"), slow, move("tackle"), constRng(0.5));
    expect(fast.team[0].hp).toBeLessThan(100);
    expect(slow.team[0].hp).toBeLessThan(100);
    expect(outcome.messages.some((m) => m.includes("Fast의"))).toBe(true);
    expect(outcome.messages.some((m) => m.includes("Slow의"))).toBe(true);
  });

  it("선공이 후공을 기절시키면 후공은 행동하지 못한다", () => {
    fixRandom(0.5);
    const killer = side([mon({ nickname: "Killer", stats: { attack: 255, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } })]);
    const victim = side([mon({ nickname: "Victim", hp: 1, maxHp: 100, stats: { attack: 120, defense: 1, speed: 10, spAttack: 80, spDefense: 80 } })]);

    const outcome = resolveRound(killer, move("tackle"), victim, move("tackle"), constRng(0.5));
    expect(victim.team[0].hp).toBe(0);
    expect(outcome.opponentFainted).toBe(true);
    // 후공(victim)은 기절해 공격 메시지가 없어야 한다.
    expect(outcome.messages.some((m) => m.includes("Victim의 몸통박치기") || m.includes("Victim의"))).toBe(false);
    // 선공(killer)은 데미지를 입지 않았다.
    expect(killer.team[0].hp).toBe(100);
  });
});

describe("resolveRound — 교체", () => {
  it("party 모드에서 교체하면 활성 포켓몬이 바뀐다", () => {
    fixRandom(0.5);
    const switcher = side([
      mon({ nickname: "First", stats: { attack: 80, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } }),
      mon({ nickname: "Second", stats: { attack: 80, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } }),
    ]);
    const attacker = side([mon({ nickname: "Foe", stats: { attack: 120, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } })]);

    const outcome = resolveRound(switcher, switchTo(1), attacker, move("tackle"), constRng(0.5));
    expect(switcher.activeIndex).toBe(1);
    // 교체로 나온 Second가 상대 공격을 맞는다(First는 빠져서 풀피).
    expect(switcher.team[0].hp).toBe(100);
    expect(switcher.team[1].hp).toBeLessThan(100);
    expect(outcome.messages.some((m) => m.includes("Second(으)로 교체"))).toBe(true);
  });
});

describe("상태이상 — 마비 속도 반감", () => {
  it("마비된 빠른 포켓몬이 느린 포켓몬보다 늦게 행동할 수 있다", () => {
    // base speed 100, 마비 시 50. 상대 speed 70 → 마비된 쪽이 후공.
    const para = mon({ statusCondition: "paralysis", stats: { attack: 80, defense: 80, speed: 100, spAttack: 80, spDefense: 80 } });
    const normal = mon({ stats: { attack: 80, defense: 80, speed: 70, spAttack: 80, spDefense: 80 } });
    expect(resolveActionOrder(para, move("tackle"), normal, move("tackle"), constRng(0.9))).toBe("opponent");
  });
});

describe("resolveActionOrder — 아이템(가방)", () => {
  it("아이템은 기술보다 먼저 행동한다(아이템 우선)", () => {
    const fastMover = mon({ stats: { attack: 80, defense: 80, speed: 200, spAttack: 80, spDefense: 80 } });
    const slowBag = mon({ stats: { attack: 80, defense: 80, speed: 10, spAttack: 80, spDefense: 80 } });
    // 느린 쪽이 아이템, 빠른 쪽이 기술 → 아이템 쓴 느린 쪽이 먼저.
    expect(resolveActionOrder(slowBag, useItem("potion"), fastMover, move("tackle"), constRng(0.9))).toBe("challenger");
  });
});

describe("resolveRound — 아이템 사용", () => {
  it("회복 아이템으로 활성 포켓몬 HP가 회복되고 consumed에 기록된다", () => {
    fixRandom(0.5);
    const healer = side([mon({ uid: "h1", nickname: "Healer", hp: 30, maxHp: 100 })]);
    const foe = side([mon({ nickname: "Foe", moves: [{ id: "growl", pp: 40, maxPp: 40 }] })]);
    const outcome = resolveRound(healer, useItem("superPotion"), foe, move("growl"), constRng(0.5), items);
    expect(healer.team[0].hp).toBe(80); // 30 + 50
    expect(outcome.consumed.challenger).toEqual({ itemId: "superPotion" });
    expect(outcome.consumed.opponent).toBeUndefined();
  });

  it("targetUid로 예비 포켓몬을 회복할 수 있다(파티)", () => {
    fixRandom(0.5);
    const healer = side([
      mon({ uid: "active", nickname: "Active", hp: 100, maxHp: 100 }),
      mon({ uid: "reserve", nickname: "Reserve", hp: 10, maxHp: 100 }),
    ]);
    // 상대는 growl(위력0)로 데미지를 주지 않아 활성 HP가 변하지 않는다.
    const foe = side([mon({ moves: [{ id: "growl", pp: 40, maxPp: 40 }] })]);
    resolveRound(healer, useItem("potion", "reserve"), foe, move("growl"), constRng(0.5), items);
    expect(healer.team[1].hp).toBe(30); // 10 + 20, 예비가 회복됨
    expect(healer.team[0].hp).toBe(100); // 활성은 데미지 없음
  });

  it("양측이 동시에 아이템을 쓰면 둘 다 회복·소비된다", () => {
    fixRandom(0.5);
    const a = side([mon({ uid: "a", hp: 40, maxHp: 100 })], { nickname: "A" });
    const b = side([mon({ uid: "b", hp: 50, maxHp: 100 })], { nickname: "B" });
    const outcome = resolveRound(a, useItem("potion"), b, useItem("superPotion"), constRng(0.5), items);
    expect(a.team[0].hp).toBe(60); // 40 + 20
    expect(b.team[0].hp).toBe(100); // 50 + 50
    expect(outcome.consumed.challenger).toEqual({ itemId: "potion" });
    expect(outcome.consumed.opponent).toEqual({ itemId: "superPotion" });
  });

  it("전투 불가 아이템은 효과 없이 소비도 기록되지 않는다", () => {
    fixRandom(0.5);
    const a = side([mon({ uid: "a", hp: 40, maxHp: 100 })]);
    const b = side([mon({ moves: [{ id: "growl", pp: 40, maxPp: 40 }] })]);
    const outcome = resolveRound(a, useItem("masterball"), b, move("growl"), constRng(0.5), items);
    expect(a.team[0].hp).toBe(40); // 회복 없음(데미지도 없음)
    expect(outcome.consumed.challenger).toBeUndefined();
  });
});

describe("hasAliveReserve / isWipedOut", () => {
  it("예비 포켓몬 유무를 판정한다", () => {
    const s = side([mon({ hp: 0 }), mon({ hp: 100 })], { activeIndex: 0 });
    expect(hasAliveReserve(s)).toBe(true);
    expect(isWipedOut(s)).toBe(false);
  });
  it("전원 기절이면 전멸로 판정한다", () => {
    const s = side([mon({ hp: 0 }), mon({ hp: 0 })]);
    expect(hasAliveReserve(s)).toBe(false);
    expect(isWipedOut(s)).toBe(true);
  });
});
