import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/storage/config-store.js";

// 특성캡슐/특성패치는 게임머니 상점(battleShop)에서 제거됐다 — 특성은 이제 게임머니로 개체 상세
// 모달에서 자유 변경(PATCH /game/pokemon/:uid/tune)한다. 기존 보유분의 item-usage 핸들러는
// 유지되지만, 상점 판매 목록에는 더 이상 없어야 한다.
describe("특성 아이템 상점 제거 (ability-capsule / ability-patch)", () => {
  const items = DEFAULT_CONFIG.battleShop.items;

  it("게임머니 상점에서 특성캡슐(ability-capsule)을 팔지 않는다", () => {
    expect(items["ability-capsule"]).toBeUndefined();
  });

  it("게임머니 상점에서 특성패치(ability-patch)를 팔지 않는다", () => {
    expect(items["ability-patch"]).toBeUndefined();
  });

  it("다른 특수아이템/볼/지닌물건은 그대로 남아 있다(회귀 방지)", () => {
    // 특수아이템(진화/메가/거다이/키스톤)·볼·지닌물건은 계속 판매돼야 한다.
    expect(items["key-stone"]).toBeDefined();
    expect(items["fire-stone"]).toBeDefined();
    expect(items["linking-cord"]).toBeDefined();
    expect(items["pokeball"]).toBeDefined();
    expect(items["leftovers"]).toBeDefined();
  });

  it("튜닝 비용 기본값이 노출된다(IV 포인트당/성격/특성)", () => {
    expect(DEFAULT_CONFIG.tuning).toEqual({ ivPointCost: 100, natureCost: 1000, abilityCost: 1500 });
  });
});
