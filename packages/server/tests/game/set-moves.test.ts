import { describe, expect, it } from "vitest";
import { getAllLearnableMoves, setPokemonMoves } from "../../src/game/growth.js";
import { GameRuleError } from "../../src/game/game-errors.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

// move-relearn.test.ts / move-teach.test.ts 와 동일 스타일 — 기본은 scratch 1개만 아는 charmander.
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

describe("getAllLearnableMoves", () => {
  it("returns the union of levelUp ∪ tm ∪ tutor ∪ egg, keeping currently-known moves", () => {
    const pool = getAllLearnableMoves(createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] }));

    // levelUp 학습표(레벨 무관) — 저·고레벨 모두.
    expect(pool).toContain("ember");
    expect(pool).toContain("growl");
    expect(pool).toContain("flamethrower");
    expect(pool).toContain("flare-blitz");
    // tm / tutor / egg.
    expect(pool).toContain("dragon-claw"); // TM
    expect(pool).toContain("fire-blast"); // TM
    expect(pool).toContain("fire-pledge"); // tutor
    expect(pool).toContain("bite"); // egg
    expect(pool).toContain("wing-attack"); // egg
    // 재학습/가르침 풀과 달리 현재 아는 기술도 **포함**한다(에디터 재배치용).
    expect(pool).toContain("scratch");
  });

  it("returns distinct ids (no duplicates)", () => {
    const pool = getAllLearnableMoves(createOwnedPokemon());
    expect(pool.length).toBe(new Set(pool).size);
  });

  it("returns an empty pool for an unknown species", () => {
    expect(getAllLearnableMoves(createOwnedPokemon({ species: "not-a-real-pokemon" }))).toEqual([]);
  });
});

describe("setPokemonMoves", () => {
  it("charges changeCost per newly-learned move and deducts game money", () => {
    const user = { gameMoney: 2000 };
    // scratch 유지(무료), ember/growl 신규 2개 → 2 × 500 = 1000.
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    const { cost } = setPokemonMoves(user, pokemon, ["scratch", "ember", "growl"], 500);

    expect(cost).toBe(1000);
    expect(user.gameMoney).toBe(1000);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch", "ember", "growl"]);
  });

  it("is free for reorder / removal / keep (no newly-learned moves)", () => {
    const user = { gameMoney: 500 };
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
      ],
    });

    // 자리 이동 + 1개 삭제 — 모두 원래 알던 기술이라 비용 0.
    const { cost } = setPokemonMoves(user, pokemon, ["ember", "scratch"], 500);

    expect(cost).toBe(0);
    expect(user.gameMoney).toBe(500);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["ember", "scratch"]);
  });

  it("preserves pp/maxPp of kept slots (even when pp was already reduced) and gives new moves full pp", () => {
    const user = { gameMoney: 2000 };
    // scratch 의 pp 가 이미 10/35 로 감소돼 있어도 유지 슬롯이면 그대로 보존.
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 10, maxPp: 35 }] });

    setPokemonMoves(user, pokemon, ["scratch", "ember"], 500);

    const scratch = pokemon.moves.find((m) => m.id === "scratch");
    expect(scratch?.pp).toBe(10); // 감소된 pp 보존
    expect(scratch?.maxPp).toBe(35);
    // 새 기술은 풀 pp.
    const ember = pokemon.moves.find((m) => m.id === "ember");
    expect(ember?.maxPp).toBeGreaterThan(0);
    expect(ember?.pp).toBe(ember?.maxPp);
  });

  it("allows keeping a currently-known move that is outside the learnable pool", () => {
    const user = { gameMoney: 2000 };
    // surf 는 charmander 학습표 밖이지만 이미 보유 중이면 유지 허용(삭제만 강제하지 않음).
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "surf", pp: 15, maxPp: 15 },
      ],
    });

    const { cost } = setPokemonMoves(user, pokemon, ["surf", "ember"], 500);

    expect(cost).toBe(500); // ember 만 신규
    expect(pokemon.moves.map((m) => m.id)).toEqual(["surf", "ember"]);
    // 유지된 surf 슬롯 pp 보존.
    expect(pokemon.moves.find((m) => m.id === "surf")?.pp).toBe(15);
  });

  it("rejects a move outside both the learnable pool and current moves", () => {
    const user = { gameMoney: 2000 };
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    // surf 는 charmander 가 배울 수 없고 보유하지도 않았다 → 거부, 상태 불변.
    expect(() => setPokemonMoves(user, pokemon, ["scratch", "surf"], 500)).toThrow(GameRuleError);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch"]);
    expect(user.gameMoney).toBe(2000);
  });

  it("rejects duplicate move ids", () => {
    const user = { gameMoney: 2000 };
    const pokemon = createOwnedPokemon();

    expect(() => setPokemonMoves(user, pokemon, ["ember", "ember"], 500)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(2000);
  });

  it("rejects an empty selection or more than 4 moves", () => {
    const user = { gameMoney: 2000 };
    const pokemon = createOwnedPokemon();

    expect(() => setPokemonMoves(user, pokemon, [], 500)).toThrow(GameRuleError);
    expect(() =>
      setPokemonMoves(user, pokemon, ["scratch", "ember", "growl", "smokescreen", "flamethrower"], 500),
    ).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(2000);
  });

  it("rejects a non-array moveIds payload", () => {
    const user = { gameMoney: 2000 };
    const pokemon = createOwnedPokemon();

    // 라우트가 body.moveIds 를 그대로 넘기므로 잘못된 타입도 여기서 막혀야 한다.
    expect(() => setPokemonMoves(user, pokemon, undefined as unknown as string[], 500)).toThrow(GameRuleError);
    expect(user.gameMoney).toBe(2000);
  });

  it("rejects when the player cannot afford the cost", () => {
    const user = { gameMoney: 400 };
    // ember/growl 2개 신규 → 1000 필요한데 400 뿐 → 거부, 상태 불변.
    const pokemon = createOwnedPokemon({ moves: [{ id: "scratch", pp: 35, maxPp: 35 }] });

    expect(() => setPokemonMoves(user, pokemon, ["scratch", "ember", "growl"], 500)).toThrow(/게임머니/);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["scratch"]);
    expect(user.gameMoney).toBe(400);
  });
});
