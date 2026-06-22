import { describe, expect, it } from "vitest";
import type { OwnedPokemon, PokemonMove, UserData } from "../../../../shared/types.js";
import { applyLearnedMoves } from "../../src/game/growth.js";
import {
  queuePendingMoveLearns,
  resolvePendingMoveLearn,
} from "../../src/game/pending-move-learn.js";

function createUserData(): UserData {
  return {
    account: {
      id: "test-user",
      password: "pw",
      nickname: "tester",
      createdAt: "2026-01-01T00:00:00.000Z",
      matchings: {},
    },
    points: 0,
    gameMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon: [],
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    pendingMoveLearns: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

function move(id: string): PokemonMove {
  return { id, pp: 10, maxPp: 10 };
}

function createOwnedPokemon(moves: string[]): OwnedPokemon {
  return {
    uid: "mon-1",
    species: "charmander",
    nickname: null,
    level: 20,
    exp: 0,
    hp: 30,
    maxHp: 30,
    stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
    moves: moves.map(move),
    caughtAt: "2026-01-01T00:00:00.000Z",
  };
}

function addPokemon(user: UserData, pokemon: OwnedPokemon): void {
  user.pokemon = [pokemon];
  user.party = [pokemon.uid];
}

describe("applyLearnedMoves", () => {
  it("with <4 moves adds the new move and returns no pending", () => {
    const pokemon = createOwnedPokemon(["tackle", "growl"]);

    const result = applyLearnedMoves(pokemon, ["ember"]);

    expect(result.learned).toEqual(["ember"]);
    expect(result.pending).toEqual([]);
    expect(pokemon.moves.map((m) => m.id)).toEqual(["tackle", "growl", "ember"]);
  });

  it("with 4 moves returns the overflow as pending and does NOT change moves", () => {
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);

    const result = applyLearnedMoves(pokemon, ["dragon-breath"]);

    expect(result.learned).toEqual([]);
    expect(result.pending).toEqual(["dragon-breath"]);
    expect(pokemon.moves.map((m) => m.id)).toEqual([
      "tackle",
      "growl",
      "ember",
      "smokescreen",
    ]);
  });
});

describe("queuePendingMoveLearns", () => {
  it("queues one pending entry per new move", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);

    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);

    expect(user.pendingMoveLearns).toHaveLength(1);
    expect(user.pendingMoveLearns?.[0].moveId).toBe("dragon-breath");
    expect(user.pendingMoveLearns?.[0].pokemonUid).toBe(pokemon.uid);
  });

  it("dedupes already-known moves and duplicate pending entries", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);

    // 이미 아는 기술(tackle)은 대기에 쌓이지 않는다.
    queuePendingMoveLearns(user, pokemon.uid, ["tackle"]);
    expect(user.pendingMoveLearns).toHaveLength(0);

    // 같은 (pokemonUid, moveId) 중복 호출은 한 건만 남긴다.
    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);
    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);
    expect(user.pendingMoveLearns).toHaveLength(1);
  });
});

describe("resolvePendingMoveLearn", () => {
  it("with forgetMoveId replaces the chosen move and drops the pending", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);
    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);
    const pendingId = user.pendingMoveLearns![0].id;

    const result = resolvePendingMoveLearn(user, pendingId, "growl");

    expect(result.skipped).toBe(false);
    expect(result.learnedMoveId).toBe("dragon-breath");
    expect(result.forgottenMoveId).toBe("growl");
    expect(pokemon.moves.map((m) => m.id)).toEqual([
      "tackle",
      "ember",
      "smokescreen",
      "dragon-breath",
    ]);
    expect(user.pendingMoveLearns).toHaveLength(0);
  });

  it("with no forgetMoveId skips — moves unchanged, pending dropped", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);
    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);
    const pendingId = user.pendingMoveLearns![0].id;

    const result = resolvePendingMoveLearn(user, pendingId, null);

    expect(result.skipped).toBe(true);
    expect(result.learnedMoveId).toBeNull();
    expect(pokemon.moves.map((m) => m.id)).toEqual([
      "tackle",
      "growl",
      "ember",
      "smokescreen",
    ]);
    expect(user.pendingMoveLearns).toHaveLength(0);
  });

  it("when the pokemon has <4 moves just adds the new move (ignores forgetMoveId)", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl"]);
    addPokemon(user, pokemon);
    // 4개 미만이라도 대기가 존재할 수 있다(다른 기술을 잊는 사이 슬롯이 비는 등) — 그냥 추가.
    queuePendingMoveLearns(user, pokemon.uid, ["ember"]);
    const pendingId = user.pendingMoveLearns![0].id;

    const result = resolvePendingMoveLearn(user, pendingId, "tackle");

    expect(result.learnedMoveId).toBe("ember");
    expect(result.forgottenMoveId).toBeNull();
    expect(pokemon.moves.map((m) => m.id)).toEqual(["tackle", "growl", "ember"]);
    expect(user.pendingMoveLearns).toHaveLength(0);
  });

  it("throws 404 GameRuleError for a missing pending id", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);

    expect(() => resolvePendingMoveLearn(user, "nope", "growl")).toThrowError();
  });

  it("throws when forgetMoveId is not a current move (4 moves)", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon(["tackle", "growl", "ember", "smokescreen"]);
    addPokemon(user, pokemon);
    queuePendingMoveLearns(user, pokemon.uid, ["dragon-breath"]);
    const pendingId = user.pendingMoveLearns![0].id;

    expect(() => resolvePendingMoveLearn(user, pendingId, "not-a-move")).toThrowError();
    // 실패 시 대기는 유지되고 기술도 그대로다.
    expect(user.pendingMoveLearns).toHaveLength(1);
    expect(pokemon.moves).toHaveLength(4);
  });
});
