import { describe, expect, it } from "vitest";
import type { PokemonIVs, TuningConfig } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { tunePokemon } from "../../src/game/growth.js";
import { calculateStatsForLevel } from "../../src/game/pokemon-stats.js";
import { GameRuleError } from "../../src/game/game-errors.js";

// 개체 튜닝(IV/성격/특성 자유 변경) 단위 테스트. createPokemon 은 무작위 IV·성격·특성을 넣으므로,
// 결정적 검증을 위해 생성 후 관련 필드를 명시적으로 고정한다.
//  - pidgey: normal = [keen-eye, tangled-feet], hidden = big-pecks (특성 검증용)

const COSTS: TuningConfig = { ivCost: 2000, natureCost: 1000, abilityCost: 1500 };

const ZERO_IVS: PokemonIVs = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
const MAX_IVS: PokemonIVs = { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 };

function makePidgey() {
  const pokemon = createPokemon("pidgey", 50);
  // 결정적 시작 상태로 고정: IV 0, 무보정 성격, 일반 특성 normal[0], 스탯 재계산.
  pokemon.ivs = { ...ZERO_IVS };
  pokemon.nature = "hardy"; // 무보정
  pokemon.abilityId = "keen-eye";
  const s = calculateStatsForLevel(pokemon.species, pokemon.level, pokemon.nature, pokemon.variantId, pokemon.ivs, pokemon.evs);
  pokemon.maxHp = s.maxHp;
  pokemon.hp = s.maxHp;
  pokemon.stats = s.stats;
  return pokemon;
}

describe("tunePokemon — 개체값(IV)", () => {
  it("IV 0→31 로 올리면 maxHp/스탯이 재계산되고 게임머니에서 ivCost 만큼 차감된다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const beforeMaxHp = pokemon.maxHp;
    const beforeAttack = pokemon.stats.attack;

    const { cost } = tunePokemon(user, pokemon, { ivs: MAX_IVS }, COSTS);

    expect(cost).toBe(COSTS.ivCost);
    expect(user.gameMoney).toBe(10000 - COSTS.ivCost);
    expect(pokemon.ivs).toEqual(MAX_IVS);
    expect(pokemon.maxHp).toBeGreaterThan(beforeMaxHp);
    expect(pokemon.stats.attack).toBeGreaterThan(beforeAttack);
  });

  it("hp 를 새 maxHp 로 클램프한다(구 maxHp 만큼 차 있어도 새 maxHp 를 넘지 않음)", () => {
    // maxHp 를 낮추는 방향으로: 현재 만렙 hp 를 유지한 채 IV 를 0 으로 두면 maxHp 는 그대로지만,
    // 여기선 hp 를 인위로 크게 높였다가 IV 변경 후 새 maxHp 로 클램프되는지 본다.
    const pokemon = makePidgey();
    pokemon.hp = 9999; // 비정상적으로 높은 hp
    const user = { gameMoney: 10000 };

    tunePokemon(user, pokemon, { ivs: MAX_IVS }, COSTS);

    expect(pokemon.hp).toBe(pokemon.maxHp);
    expect(pokemon.hp).toBeLessThanOrEqual(pokemon.maxHp);
  });

  it("IV 가 0~31 범위를 벗어나면(32) 거부하고 아무 변경도 하지 않는다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const badIvs = { ...MAX_IVS, attack: 32 };

    expect(() => tunePokemon(user, pokemon, { ivs: badIvs }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
    expect(pokemon.ivs).toEqual(ZERO_IVS);
  });

  it("IV 가 음수(-1)여도 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const badIvs = { ...ZERO_IVS, speed: -1 };
    expect(() => tunePokemon(user, pokemon, { ivs: badIvs }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
  });

  it("IV 가 정수가 아니면(소수) 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const badIvs = { ...ZERO_IVS, hp: 15.5 };
    expect(() => tunePokemon(user, pokemon, { ivs: badIvs }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
  });

  it("6스탯 중 하나라도 빠지면 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const partial = { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31 }; // speed 누락
    expect(() => tunePokemon(user, pokemon, { ivs: partial }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
  });
});

describe("tunePokemon — 성격(nature)", () => {
  it("성격을 바꾸면 스탯이 재계산되고(보정 반영) natureCost 가 차감된다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const neutralAttack = pokemon.stats.attack;

    // adamant = 공격↑ 특공↓
    const { cost } = tunePokemon(user, pokemon, { nature: "adamant" }, COSTS);

    expect(cost).toBe(COSTS.natureCost);
    expect(user.gameMoney).toBe(10000 - COSTS.natureCost);
    expect(pokemon.nature).toBe("adamant");
    expect(pokemon.stats.attack).toBeGreaterThan(neutralAttack);
  });

  it("존재하지 않는 성격은 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    expect(() => tunePokemon(user, pokemon, { nature: "not-a-nature" }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
    expect(pokemon.nature).toBe("hardy");
  });
});

describe("tunePokemon — 특성(ability)", () => {
  it("종이 가질 수 있는 특성으로 바꾸면 abilityCost 가 차감된다(스탯은 그대로)", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    const beforeStats = { ...pokemon.stats };
    const beforeMaxHp = pokemon.maxHp;

    // pidgey 숨은 특성 big-pecks 로 변경(normal ∪ hidden 에 포함).
    const { cost } = tunePokemon(user, pokemon, { abilityId: "big-pecks" }, COSTS);

    expect(cost).toBe(COSTS.abilityCost);
    expect(user.gameMoney).toBe(10000 - COSTS.abilityCost);
    expect(pokemon.abilityId).toBe("big-pecks");
    // 특성은 스탯에 영향 없음.
    expect(pokemon.stats).toEqual(beforeStats);
    expect(pokemon.maxHp).toBe(beforeMaxHp);
  });

  it("종이 가질 수 없는 특성은 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    // levitate 는 pidgey 특성이 아니다.
    expect(() => tunePokemon(user, pokemon, { abilityId: "levitate" }, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
    expect(pokemon.abilityId).toBe("keen-eye");
  });
});

describe("tunePokemon — 비용 합산 · 게임머니 부족 · 빈 요청", () => {
  it("여러 카테고리를 함께 바꾸면 해당 비용의 합만큼 차감한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };

    const { cost } = tunePokemon(
      user,
      pokemon,
      { ivs: MAX_IVS, nature: "adamant", abilityId: "big-pecks" },
      COSTS,
    );

    const expected = COSTS.ivCost + COSTS.natureCost + COSTS.abilityCost;
    expect(cost).toBe(expected);
    expect(user.gameMoney).toBe(10000 - expected);
    expect(pokemon.ivs).toEqual(MAX_IVS);
    expect(pokemon.nature).toBe("adamant");
    expect(pokemon.abilityId).toBe("big-pecks");
  });

  it("게임머니가 부족하면 거부하고 어떤 변경도 하지 않는다(부분 적용 없음)", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 500 }; // ivCost(2000) 미달
    const beforeIvs = { ...pokemon.ivs! };
    const beforeNature = pokemon.nature;
    const beforeAbility = pokemon.abilityId;
    const beforeStats = { ...pokemon.stats };

    expect(() =>
      tunePokemon(user, pokemon, { ivs: MAX_IVS, nature: "adamant", abilityId: "big-pecks" }, COSTS),
    ).toThrow(GameRuleError);

    expect(user.gameMoney).toBe(500);
    expect(pokemon.ivs).toEqual(beforeIvs);
    expect(pokemon.nature).toBe(beforeNature);
    expect(pokemon.abilityId).toBe(beforeAbility);
    expect(pokemon.stats).toEqual(beforeStats);
  });

  it("변경할 항목이 하나도 없으면 거부한다", () => {
    const pokemon = makePidgey();
    const user = { gameMoney: 10000 };
    expect(() => tunePokemon(user, pokemon, {}, COSTS)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(10000);
  });
});
