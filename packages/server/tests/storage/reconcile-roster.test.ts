import { describe, expect, it } from "vitest";
import type { OwnedPokemon } from "../../../../shared/types.js";
import { dropDanglingPending, reconcileRoster, type RosterSlice } from "../../src/storage/user-store.js";

/**
 * reconcileRoster enforces the roster invariant: every pokemon uid appears at
 * most once across pokemon[] ∪ storage[], and party references only uids in
 * pokemon[] (deduped, ≤ 6). It also repairs files that drifted into the
 * impossible state (same uid in both arrays / twice in one array, sometimes
 * diverged by evolution/leveling).
 */

function mon(overrides: Partial<OwnedPokemon> & { uid: string }): OwnedPokemon {
  return {
    species: "bulbasaur",
    variantId: null,
    nickname: null,
    level: 5,
    exp: 0,
    hp: 20,
    maxHp: 20,
    stats: { attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 },
    moves: [],
    caughtAt: "2026-04-13T00:00:00.000Z",
    ...overrides,
  };
}

function roster(overrides: Partial<RosterSlice> = {}): RosterSlice {
  return { party: [], pokemon: [], storage: [], ...overrides };
}

const uids = (list: OwnedPokemon[]): string[] => list.map((p) => p.uid);

describe("reconcileRoster", () => {
  it("collapses a uid present identically in both pokemon[] and storage[]; non-party copy lands in storage[]", () => {
    const a = mon({ uid: "a", species: "pikachu", level: 10 });
    const result = reconcileRoster(roster({ pokemon: [a], storage: [{ ...a }] }));

    // One copy total (first appearance kept). 파티에 없으므로 박스(storage[])로 보낸다 —
    // pokemon[]에만 남기면 파티·박스 어디에도 안 보이는 고아가 된다(개체 유실 버그).
    expect(uids(result.pokemon)).toEqual([]);
    expect(uids(result.storage)).toEqual(["a"]);
  });

  it("keeps the more-progressed diverged copy (deerling L6 in pokemon vs sawsbuck L58 in storage), not in party → lands in storage[]", () => {
    const deerling = mon({ uid: "2ef94542", species: "deerling", level: 6, exp: 100 });
    const sawsbuck = mon({ uid: "2ef94542", species: "sawsbuck", level: 58, exp: 90000 });

    const result = reconcileRoster(roster({ pokemon: [deerling], storage: [sawsbuck] }));

    // Kept copy is the L58 sawsbuck; its origin (storage) dictates destination
    // since the uid is not in party. pokemon[] no longer has the uid.
    expect(uids(result.pokemon)).toEqual([]);
    expect(result.storage).toHaveLength(1);
    expect(result.storage[0]).toMatchObject({ uid: "2ef94542", species: "sawsbuck", level: 58 });
  });

  it("collapses a uid appearing twice within pokemon[] for a party member; party references it exactly once", () => {
    const low = mon({ uid: "p1", species: "eevee", level: 5, exp: 0 });
    const high = mon({ uid: "p1", species: "eevee", level: 25, exp: 5000 });

    const result = reconcileRoster(roster({ party: ["p1"], pokemon: [low, high] }));

    expect(result.pokemon).toHaveLength(1);
    expect(result.pokemon[0]).toMatchObject({ uid: "p1", level: 25 });
    expect(result.storage).toEqual([]);
    expect(result.party).toEqual(["p1"]);
  });

  it("a party uid resolvable only after reconcile (its copy lived in storage) stays in party and is pulled into pokemon[]", () => {
    // uid "z" exists only in storage. Because party references it, reconcile
    // must route the kept copy into pokemon[] so party stays valid.
    const z = mon({ uid: "z", species: "snorlax", level: 40 });
    const result = reconcileRoster(roster({ party: ["z"], pokemon: [], storage: [z] }));

    expect(uids(result.pokemon)).toEqual(["z"]);
    expect(uids(result.storage)).toEqual([]);
    expect(result.party).toEqual(["z"]);
  });

  it("drops a party uid that has no surviving pokemon[] entry", () => {
    const keep = mon({ uid: "keep", level: 10 });
    const result = reconcileRoster(
      roster({ party: ["keep", "ghost"], pokemon: [keep] }),
    );

    expect(uids(result.pokemon)).toEqual(["keep"]);
    expect(result.party).toEqual(["keep"]);
  });

  it("returns clean input unchanged (same uids, party intact)", () => {
    const p1 = mon({ uid: "p1", species: "charmander", level: 12 });
    const p2 = mon({ uid: "p2", species: "squirtle", level: 8 });
    const s1 = mon({ uid: "s1", species: "rattata", level: 3 });

    const result = reconcileRoster(
      roster({ party: ["p1", "p2"], pokemon: [p1, p2], storage: [s1] }),
    );

    expect(uids(result.pokemon)).toEqual(["p1", "p2"]);
    expect(uids(result.storage)).toEqual(["s1"]);
    expect(result.party).toEqual(["p1", "p2"]);
  });

  it("caps party at 6 and de-duplicates party uids (first occurrence wins)", () => {
    const pokemon = Array.from({ length: 8 }, (_, i) =>
      mon({ uid: `m${i}`, level: 5 + i }),
    );
    // Party lists 8 distinct + a duplicate; expect first 6 distinct, capped.
    const party = ["m0", "m1", "m1", "m2", "m3", "m4", "m5", "m6", "m7"];

    const result = reconcileRoster(roster({ party, pokemon }));

    expect(result.party).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(result.party).toHaveLength(6);
  });

  it("preserves stable first-appearance order across pokemon[] then storage[]", () => {
    const result = reconcileRoster(
      roster({
        pokemon: [mon({ uid: "a" }), mon({ uid: "b" })],
        storage: [mon({ uid: "c" }), mon({ uid: "d" })],
      }),
    );

    // 비-파티 개체는 전부 박스(storage[])로 — 첫 등장 순서는 그대로 보존된다.
    expect(uids(result.pokemon)).toEqual([]);
    expect(uids(result.storage)).toEqual(["a", "b", "c", "d"]);
  });

  it("ties on level and exp keep the first-encountered copy (pokemon[] before storage[])", () => {
    const inPokemon = mon({ uid: "t", species: "ditto", level: 30, exp: 1000 });
    const inStorage = mon({ uid: "t", species: "dittoclone", level: 30, exp: 1000 });

    const result = reconcileRoster(roster({ pokemon: [inPokemon], storage: [inStorage] }));

    // Tie → first encountered (pokemon[]) wins. 파티에 없으므로 박스(storage[])로 간다.
    expect(result.storage).toHaveLength(1);
    expect(result.storage[0]).toMatchObject({ uid: "t", species: "ditto" });
    expect(result.pokemon).toEqual([]);
  });
});

describe("dropDanglingPending", () => {
  // 가리키는 포켓몬이 살아있는 대기만 남기고, 사라진 개체를 가리키는 댕글링 대기는 버린다.
  // (resolve 404로 한 번에 하나씩 처리하는 큐가 막히는 회귀를 방지.)
  it("keeps entries whose pokemonUid is live and drops the rest", () => {
    const live = new Set(["alive-1", "alive-2"]);
    const entries = [
      { id: "a", pokemonUid: "alive-1", moveId: "tackle" },
      { id: "b", pokemonUid: "ghost-1", moveId: "wrap" },
      { id: "c", pokemonUid: "alive-2", moveId: "growl" },
      { id: "d", pokemonUid: "ghost-2", moveId: "hex" },
    ];

    const result = dropDanglingPending(entries, live);

    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns the same entries (none dropped) when every uid is live", () => {
    const live = new Set(["x"]);
    const entries = [{ id: "e1", pokemonUid: "x", moveId: "ember" }];
    expect(dropDanglingPending(entries, live)).toEqual(entries);
  });

  it("drops everything when no uid is live (e.g. all targets deleted)", () => {
    const entries = [
      { id: "e1", pokemonUid: "gone", moveId: "ember" },
      { id: "e2", pokemonUid: "gone", moveId: "scratch" },
    ];
    expect(dropDanglingPending(entries, new Set<string>())).toEqual([]);
  });
});
