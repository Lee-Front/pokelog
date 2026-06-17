import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

type UserStoreModule = typeof import("../../src/storage/user-store.js");
type FactoryModule = typeof import("../../src/game/pokemon-factory.js");

let tmpDir: string;
let userStore: UserStoreModule;
let factory: FactoryModule;

function createUser(id: string, pokemon: OwnedPokemon[], pokedex: string[]): UserData {
  return {
    account: { id, password: "pw", nickname: id, createdAt: "2026-04-13T00:00:00.000Z", matchings: {} },
    currentRegion: "default",
    points: 0,
    battleMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: pokemon.map((p) => p.uid),
    pokemon,
    eggs: [],
    pokedex,
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-dex-test-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  userStore = await import("../../src/storage/user-store.js");
  factory = await import("../../src/game/pokemon-factory.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("도감 영구화(caught/seen)", () => {
  it("보유 종은 caught(pokedex)에 보강되고, 방생해도 유지된다(버그 회귀)", async () => {
    const charmander = factory.createPokemon("charmander", 5);
    await userStore.saveUser(createUser("ash", [charmander], []));

    let user = (await userStore.getUser("ash"))!;
    expect(user.pokedex).toContain("charmander"); // 보유 → caught 보강

    // 방생: pokemon/party에서 제거 후 저장.
    user.pokemon = [];
    user.party = [];
    await userStore.saveUser(user);

    user = (await userStore.getUser("ash"))!;
    expect(user.pokedex).toContain("charmander"); // 방생해도 caught 유지
  });

  it("seen은 caught와 기존 seen을 항상 포함한다(단조 증가)", async () => {
    const pikachu = factory.createPokemon("pikachu", 5);
    const u = createUser("misty", [pikachu], ["bulbasaur"]); // 잡은적 bulbasaur(미보유)
    u.seenSpecies = ["squirtle"]; // 만난적 squirtle
    await userStore.saveUser(u);

    const user = (await userStore.getUser("misty"))!;
    // caught = 기존 pokedex ∪ 보유 종.
    expect(new Set(user.pokedex)).toEqual(new Set(["bulbasaur", "pikachu"]));
    // seen ⊇ (기존 seen ∪ caught).
    for (const s of ["squirtle", "bulbasaur", "pikachu"]) {
      expect(user.seenSpecies).toContain(s);
    }
  });
});
