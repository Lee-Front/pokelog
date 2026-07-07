import { describe, expect, it } from "vitest";
import { applyMoveRelearn, getRelearnableMoves } from "../../src/game/growth.js";
import { GameRuleError } from "../../src/game/game-errors.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

// growth.test.ts 의 createOwnedPokemon 와 동일 스타일 — 기본은 scratch 1개만 아는 charmander.
function createOwnedPokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "charmander",
    nickname: null,
    level: 30,
    exp: 0,
    hp: 30,
    maxHp: 30,
    stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
    moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
    caughtAt: "2024-01-01T00:00:00Z",
    gender: null,
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    ...overrides,
  };
}

describe("getRelearnableMoves", () => {
  it("returns the species level-up learnset minus already-known moves (level-agnostic)", () => {
    // charmander 레벨업 학습표: growl/scratch/ember/.../flamethrower(24)/flare-blitz(40) 등.
    const pool = getRelearnableMoves(createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] }));

    // 레벨 무관: 고레벨(40) flare-blitz, 중레벨(24) flamethrower 모두 후보.
    expect(pool).toContain("ember");
    expect(pool).toContain("growl");
    expect(pool).toContain("flamethrower");
    expect(pool).toContain("flare-blitz");
    // 이미 아는 기술은 제외.
    expect(pool).not.toContain("scratch");
  });

  it("excludes every currently-known move", () => {
    const pool = getRelearnableMoves(
      createOwnedPokemon({
        moves: [
          { id: "scratch", pp: 35, maxPp: 35 },
          { id: "ember", pp: 25, maxPp: 25 },
        ],
      }),
    );
    expect(pool).not.toContain("scratch");
    expect(pool).not.toContain("ember");
    expect(pool).toContain("smokescreen");
  });

  it("returns distinct ids (no duplicates)", () => {
    const pool = getRelearnableMoves(createOwnedPokemon());
    expect(pool.length).toBe(new Set(pool).size);
  });

  it("returns an empty pool for an unknown species", () => {
    expect(getRelearnableMoves(createOwnedPokemon({ species: "not-a-real-pokemon" }))).toEqual([]);
  });
});

describe("applyMoveRelearn", () => {
  it("appends a new move slot and deducts game money when under 4 moves", () => {
    const user = { gameMoney: 500 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    applyMoveRelearn(user, pokemon, "ember", 300);

    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch", "ember"]);
    // 새 슬롯의 pp/maxPp 는 기술 데이터에서 채워진다(스크래치 35와 다른 값이어야 함).
    const ember = pokemon.moves.find((m) => m.id === "ember");
    expect(ember?.maxPp).toBeGreaterThan(0);
    expect(ember?.pp).toBe(ember?.maxPp);
    // 게임머니 차감.
    expect(user.gameMoney).toBe(200);
  });

  it("replaces the chosen slot in place (preserving order) when at 4 moves", () => {
    const user = { gameMoney: 300 };
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
        { id: "smokescreen", pp: 20, maxPp: 20 },
      ],
    });

    applyMoveRelearn(user, pokemon, "flamethrower", 300, "growl");

    // growl 슬롯(인덱스 1)만 교체되고 나머지 순서는 유지.
    expect(pokemon.moves.map((m) => m.id)).toEqual([
      "scratch",
      "flamethrower",
      "ember",
      "smokescreen",
    ]);
    expect(user.gameMoney).toBe(0);
  });

  it("requires a valid forgetMoveId when the pokemon already has 4 moves", () => {
    const user = { gameMoney: 300 };
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
        { id: "smokescreen", pp: 20, maxPp: 20 },
      ],
    });

    // forgetMoveId 누락 → 거부, 상태 불변.
    expect(() => applyMoveRelearn(user, pokemon, "flamethrower", 300)).toThrow(GameRuleError);
    // forgetMoveId 가 현재 기술이 아님 → 거부.
    expect(() => applyMoveRelearn(user, pokemon, "flamethrower", 300, "surf")).toThrow(GameRuleError);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch", "growl", "ember", "smokescreen"]);
    expect(user.gameMoney).toBe(300);
  });

  it("rejects a move that is not in the relearnable pool (unknown / already known)", () => {
    const user = { gameMoney: 300 };
    // 이미 아는 기술은 풀에 없다 → 거부.
    const known = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });
    expect(() => applyMoveRelearn(user, known, "scratch", 300)).toThrow(GameRuleError);
    // 종의 학습표에 없는 기술도 거부.
    expect(() => applyMoveRelearn(user, known, "surf", 300)).toThrow(GameRuleError);
    // 차감되지 않음.
    expect(user.gameMoney).toBe(300);
    expect(known.moves.map((m) => m.id)).toEqual(["scratch"]);
  });

  it("rejects when the player cannot afford the cost", () => {
    const user = { gameMoney: 100 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    expect(() => applyMoveRelearn(user, pokemon, "ember", 300)).toThrow(/게임머니/);
    // 실패 시 기술도 추가되지 않고 게임머니도 그대로.
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch"]);
    expect(user.gameMoney).toBe(100);
  });
});
