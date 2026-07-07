import { describe, expect, it } from "vitest";
import { applyMoveTeach, getTeachableMoves } from "../../src/game/growth.js";
import { GameRuleError } from "../../src/game/game-errors.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

// move-relearn.test.ts 와 동일 스타일 — 기본은 scratch 1개만 아는 charmander.
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

describe("getTeachableMoves", () => {
  it("returns the species tm/tutor/egg learnset union minus already-known moves", () => {
    // charmander: tm 예) dragon-claw/fire-blast, tutor 예) fire-pledge, egg 예) bite/wing-attack.
    const pool = getTeachableMoves(createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] }));

    expect(pool).toContain("dragon-claw"); // TM
    expect(pool).toContain("fire-blast"); // TM
    expect(pool).toContain("fire-pledge"); // tutor
    expect(pool).toContain("bite"); // egg
    expect(pool).toContain("wing-attack"); // egg
  });

  it("excludes level-up-only moves (those are the relearner's job)", () => {
    // flamethrower/flare-blitz 는 charmander의 레벨업 학습표에만 있고 tm/tutor/egg 엔 없다 → 제외.
    const pool = getTeachableMoves(createOwnedPokemon());
    expect(pool).not.toContain("flamethrower");
    expect(pool).not.toContain("flare-blitz");
    expect(pool).not.toContain("ember");
  });

  it("excludes every currently-known move", () => {
    const pool = getTeachableMoves(
      createOwnedPokemon({
        moves: [
          { id: "scratch", pp: 35, maxPp: 35 },
          { id: "dragon-claw", pp: 15, maxPp: 15 },
        ],
      }),
    );
    expect(pool).not.toContain("dragon-claw");
    expect(pool).toContain("fire-blast");
  });

  it("returns distinct ids (no duplicates)", () => {
    const pool = getTeachableMoves(createOwnedPokemon());
    expect(pool.length).toBe(new Set(pool).size);
  });

  it("returns an empty pool for an unknown species", () => {
    expect(getTeachableMoves(createOwnedPokemon({ species: "not-a-real-pokemon" }))).toEqual([]);
  });
});

describe("applyMoveTeach", () => {
  it("appends a new move slot and deducts game money when under 4 moves", () => {
    const user = { gameMoney: 1000 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    applyMoveTeach(user, pokemon, "dragon-claw", 800);

    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch", "dragon-claw"]);
    // 새 슬롯의 pp/maxPp 는 기술 데이터에서 채워진다.
    const learned = pokemon.moves.find((m) => m.id === "dragon-claw");
    expect(learned?.maxPp).toBeGreaterThan(0);
    expect(learned?.pp).toBe(learned?.maxPp);
    // 게임머니 차감.
    expect(user.gameMoney).toBe(200);
  });

  it("replaces the chosen slot in place (preserving order) when at 4 moves", () => {
    const user = { gameMoney: 800 };
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
        { id: "smokescreen", pp: 20, maxPp: 20 },
      ],
    });

    applyMoveTeach(user, pokemon, "fire-blast", 800, "growl");

    // growl 슬롯(인덱스 1)만 교체되고 나머지 순서는 유지.
    expect(pokemon.moves.map((m) => m.id)).toEqual([
      "scratch",
      "fire-blast",
      "ember",
      "smokescreen",
    ]);
    expect(user.gameMoney).toBe(0);
  });

  it("requires a valid forgetMoveId when the pokemon already has 4 moves", () => {
    const user = { gameMoney: 800 };
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
        { id: "smokescreen", pp: 20, maxPp: 20 },
      ],
    });

    // forgetMoveId 누락 → 거부, 상태 불변.
    expect(() => applyMoveTeach(user, pokemon, "fire-blast", 800)).toThrow(GameRuleError);
    // forgetMoveId 가 현재 기술이 아님 → 거부.
    expect(() => applyMoveTeach(user, pokemon, "fire-blast", 800, "surf")).toThrow(GameRuleError);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch", "growl", "ember", "smokescreen"]);
    expect(user.gameMoney).toBe(800);
  });

  it("rejects a move that is not in the teachable pool (level-up-only / already known / unknown)", () => {
    const user = { gameMoney: 800 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    // 레벨업 전용 기술은 가르침 풀에 없다 → 거부.
    expect(() => applyMoveTeach(user, pokemon, "flamethrower", 800)).toThrow(GameRuleError);
    // 종의 tm/tutor/egg 어디에도 없는 기술도 거부.
    expect(() => applyMoveTeach(user, pokemon, "surf", 800)).toThrow(GameRuleError);
    // 차감되지 않음.
    expect(user.gameMoney).toBe(800);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch"]);
  });

  it("rejects when the player cannot afford the cost", () => {
    const user = { gameMoney: 500 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    expect(() => applyMoveTeach(user, pokemon, "dragon-claw", 800)).toThrow(/게임머니/);
    // 실패 시 기술도 추가되지 않고 게임머니도 그대로.
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch"]);
    expect(user.gameMoney).toBe(500);
  });
});
