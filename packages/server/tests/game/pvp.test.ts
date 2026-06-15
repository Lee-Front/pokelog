import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedPokemon, PvpMatch, UserData } from "../../../../shared/types.js";

type PvpModule = typeof import("../../src/game/pvp.js");
type UserStoreModule = typeof import("../../src/storage/user-store.js");
type FactoryModule = typeof import("../../src/game/pokemon-factory.js");

let tmpDir: string;
let pvp: PvpModule;
let userStore: UserStoreModule;
let factory: FactoryModule;

/** 결정적 rng — submitAction에 주입해 속도 동률 타이브레이크를 고정. */
const rng = () => 0.5;

function createUser(id: string, nickname: string, party: OwnedPokemon[]): UserData {
  return {
    account: { id, password: "pw", nickname, createdAt: "2026-04-13T00:00:00.000Z", matchings: {} },
    currentRegion: "default",
    points: 0,
    battleMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: party.map((p) => p.uid),
    pokemon: party,
    eggs: [],
    pokedex: party.map((p) => p.species),
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

/** tackle만 확실히 들고 있는 강한 포켓몬(공격 보장). */
function strongMon(species: string, level = 50): OwnedPokemon {
  const p = factory.createPokemon(species, level);
  p.moves = [{ id: "tackle", pp: 35, maxPp: 35 }];
  p.stats = { attack: 200, defense: 60, speed: 100, spAttack: 120, spDefense: 60 };
  p.maxHp = 120;
  p.hp = 120;
  return p;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-pvp-test-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  pvp = await import("../../src/game/pvp.js");
  userStore = await import("../../src/storage/user-store.js");
  factory = await import("../../src/game/pokemon-factory.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedTwoUsers(speed = false): Promise<void> {
  const alicePokemon = strongMon("bulbasaur");
  const bobPokemon = strongMon("charmander");
  if (speed) bobPokemon.stats.speed = 10; // alice 먼저 행동
  await userStore.saveUser(createUser("alice", "Alice", [alicePokemon]));
  await userStore.saveUser(createUser("bob", "Bob", [bobPokemon]));
}

/** 양측 모두 tackle 제출 → 라운드 1회 해결. rng 고정으로 결정적. */
async function bothTackle(matchId: string): Promise<PvpMatch> {
  await pvp.submitAction("alice", matchId, { kind: "move", moveId: "tackle" }, rng);
  return pvp.submitAction("bob", matchId, { kind: "move", moveId: "tackle" }, rng);
}

describe("지정 도전 라이프사이클", () => {
  it("도전 생성 → 수락 → active 전환", async () => {
    await seedTwoUsers();
    const created = await pvp.createChallenge({
      challengerUserId: "alice", opponentUserId: "bob", mode: "single",
    });
    expect(created.status).toBe("pending");
    expect(created.challenger.team).toHaveLength(1);
    expect(created.opponent.team).toHaveLength(0); // 수락 전엔 상대 팀 비어있음

    const accepted = await pvp.acceptChallenge("bob", created.id);
    expect(accepted.status).toBe("active");
    expect(accepted.round).toBe(1);
    expect(accepted.opponent.team).toHaveLength(1);
  });

  it("거절하면 finished/declined", async () => {
    await seedTwoUsers();
    const created = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    const declined = await pvp.declineChallenge("bob", created.id);
    expect(declined.status).toBe("finished");
    expect(declined.result?.kind).toBe("declined");
  });

  it("자기 자신에게 도전 불가", async () => {
    await seedTwoUsers();
    await expect(
      pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "alice", mode: "single" }),
    ).rejects.toThrow();
  });

  it("당사자 아닌 유저는 수락 불가", async () => {
    await seedTwoUsers();
    await userStore.saveUser(createUser("carol", "Carol", [strongMon("squirtle")]));
    const created = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await expect(pvp.acceptChallenge("carol", created.id)).rejects.toThrow();
  });
});

describe("라운드 해결 → 승패", () => {
  it("single 모드에서 한쪽 기절 시 매치 종료·승자 결정", async () => {
    await seedTwoUsers(true); // alice 선공
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);

    // tackle을 반복해 한쪽이 쓰러질 때까지.
    let match: PvpMatch | null = null;
    for (let i = 0; i < 40; i++) {
      match = await bothTackle(m.id);
      if (match.status === "finished") break;
    }
    expect(match!.status).toBe("finished");
    expect(match!.result?.kind).toBe("decided");
    expect(match!.result?.winnerUserId).not.toBeNull();
    expect(match!.roundLogs.length).toBeGreaterThan(0);
  });

  it("한쪽만 제출하면 라운드가 해결되지 않는다(pendingAction 유지)", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);

    const after = await pvp.submitAction("alice", m.id, { kind: "move", moveId: "tackle" }, rng);
    expect(after.round).toBe(1); // 아직 해결 안 됨
    expect(after.challenger.pendingAction).not.toBeNull();
    expect(after.roundLogs).toHaveLength(0);
  });

  it("같은 라운드에 두 번 제출 불가", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    await pvp.submitAction("alice", m.id, { kind: "move", moveId: "tackle" }, rng);
    await expect(
      pvp.submitAction("alice", m.id, { kind: "move", moveId: "tackle" }, rng),
    ).rejects.toThrow();
  });
});

describe("party 모드 + 교체", () => {
  async function seedPartyUsers(): Promise<void> {
    const a1 = strongMon("bulbasaur"); a1.stats.speed = 200;
    const a2 = strongMon("ivysaur");
    const b1 = strongMon("charmander"); b1.stats.speed = 10;
    const b2 = strongMon("charmeleon");
    await userStore.saveUser(createUser("alice", "Alice", [a1, a2]));
    await userStore.saveUser(createUser("bob", "Bob", [b1, b2]));
  }

  it("party 모드는 팀 전체 스냅샷, 교체 행동이 적용된다", async () => {
    await seedPartyUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "party" });
    const accepted = await pvp.acceptChallenge("bob", m.id);
    expect(accepted.challenger.team).toHaveLength(2);
    expect(accepted.opponent.team).toHaveLength(2);

    // alice 교체(0→1), bob 공격.
    await pvp.submitAction("alice", m.id, { kind: "switch", teamIndex: 1 }, rng);
    const resolved = await pvp.submitAction("bob", m.id, { kind: "move", moveId: "tackle" }, rng);
    expect(resolved.challenger.activeIndex).toBe(1);
  });

  it("single 모드에서는 교체 불가", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    await expect(
      pvp.submitAction("alice", m.id, { kind: "switch", teamIndex: 0 }, rng),
    ).rejects.toThrow();
  });

  it("party: 활성 포켓몬 기절 시 예비로 자동 교체되고 매치는 계속된다", async () => {
    const a1 = strongMon("bulbasaur"); a1.stats = { attack: 300, defense: 60, speed: 200, spAttack: 120, spDefense: 60 };
    const a2 = strongMon("ivysaur");
    const b1 = strongMon("charmander"); b1.hp = 1; b1.maxHp = 120; b1.stats = { attack: 60, defense: 1, speed: 10, spAttack: 60, spDefense: 1 };
    const b2 = strongMon("charmeleon");
    await userStore.saveUser(createUser("alice", "Alice", [a1, a2]));
    await userStore.saveUser(createUser("bob", "Bob", [b1, b2]));

    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "party" });
    await pvp.acceptChallenge("bob", m.id);
    const resolved = await bothTackle(m.id);

    // bob의 첫 포켓몬은 기절, 두 번째로 자동 교체. 매치는 아직 active.
    expect(resolved.status).toBe("active");
    expect(resolved.opponent.activeIndex).toBe(1);
  });
});

describe("가방 아이템 사용", () => {
  /** alice가 더 약하게 — HP를 깎아두고 회복 아이템 사용을 검증. */
  async function seedForItems(): Promise<void> {
    const alicePokemon = strongMon("bulbasaur");
    alicePokemon.hp = 40; // 회복 여지
    alicePokemon.stats.speed = 200; // alice 선행(아이템이 어차피 기술보다 먼저지만 결정성 보강)
    const bobPokemon = strongMon("charmander");
    bobPokemon.stats = { attack: 1, defense: 200, speed: 10, spAttack: 1, spDefense: 200 }; // bob 데미지 미미
    const alice = createUser("alice", "Alice", [alicePokemon]);
    const bob = createUser("bob", "Bob", [bobPokemon]);
    alice.inventory = { superPotion: 2 };
    await userStore.saveUser(alice);
    await userStore.saveUser(bob);
  }

  it("회복 아이템으로 활성 포켓몬 HP가 회복되고 인벤토리가 차감된다", async () => {
    await seedForItems();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);

    await pvp.submitAction("alice", m.id, { kind: "item", itemId: "superPotion" }, rng);
    const resolved = await pvp.submitAction("bob", m.id, { kind: "move", moveId: "tackle" }, rng);

    // bob 데미지가 미미하므로 회복(+50)이 반영돼 40보다 확실히 높다.
    expect(resolved.challenger.team[0].hp).toBeGreaterThan(40);
    const alice = await userStore.getUser("alice");
    expect(alice!.inventory.superPotion).toBe(1); // 2 → 1
  });

  it("보유 0인 아이템 사용은 거부된다", async () => {
    await seedForItems();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    await expect(
      pvp.submitAction("alice", m.id, { kind: "item", itemId: "potion" }, rng), // 보유 없음
    ).rejects.toThrow();
  });

  it("전투 불가 아이템(볼 등) 사용은 거부된다", async () => {
    await seedForItems();
    const alice = await userStore.getUser("alice");
    alice!.inventory.masterball = 1;
    await userStore.saveUser(alice!);
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    await expect(
      pvp.submitAction("alice", m.id, { kind: "item", itemId: "masterball" }, rng),
    ).rejects.toThrow();
  });

  it("양측이 동시에 아이템을 쓰면 둘 다 회복·차감된다(party)", async () => {
    const a1 = strongMon("bulbasaur"); a1.hp = 30; a1.stats = { attack: 1, defense: 200, speed: 100, spAttack: 1, spDefense: 200 };
    const a2 = strongMon("ivysaur");
    const b1 = strongMon("charmander"); b1.hp = 30; b1.stats = { attack: 1, defense: 200, speed: 50, spAttack: 1, spDefense: 200 };
    const b2 = strongMon("charmeleon");
    const alice = createUser("alice", "Alice", [a1, a2]);
    const bob = createUser("bob", "Bob", [b1, b2]);
    alice.inventory = { superPotion: 1 };
    bob.inventory = { potion: 1 };
    await userStore.saveUser(alice);
    await userStore.saveUser(bob);

    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "party" });
    await pvp.acceptChallenge("bob", m.id);
    await pvp.submitAction("alice", m.id, { kind: "item", itemId: "superPotion" }, rng);
    const resolved = await pvp.submitAction("bob", m.id, { kind: "item", itemId: "potion" }, rng);

    expect(resolved.challenger.team[0].hp).toBe(80); // 30 + 50
    expect(resolved.opponent.team[0].hp).toBe(50); // 30 + 20
    const aliceAfter = await userStore.getUser("alice");
    const bobAfter = await userStore.getUser("bob");
    expect(aliceAfter!.inventory.superPotion).toBeUndefined(); // 1 → 0 (삭제)
    expect(bobAfter!.inventory.potion).toBeUndefined();
  });
});

describe("자동 대기열 페어링", () => {
  it("두 명이 같은 mode로 등록하면 즉시 active 매치 생성", async () => {
    await seedTwoUsers();
    const first = await pvp.enqueue({ userId: "alice", mode: "single" });
    expect(first.matched).toBe(false);

    const second = await pvp.enqueue({ userId: "bob", mode: "single" });
    expect(second.matched).toBe(true);
    if (second.matched) {
      expect(second.match.status).toBe("active");
      expect(second.match.origin).toBe("queue");
      // 먼저 등록한 alice가 challenger.
      expect(second.match.challenger.userId).toBe("alice");
      expect(second.match.opponent.userId).toBe("bob");
    }
  });

  it("대기열 취소 후엔 페어링되지 않는다", async () => {
    await seedTwoUsers();
    await pvp.enqueue({ userId: "alice", mode: "single" });
    await pvp.dequeue("alice");
    const second = await pvp.enqueue({ userId: "bob", mode: "single" });
    expect(second.matched).toBe(false);
  });

  it("mode가 다르면 페어링되지 않는다", async () => {
    await seedTwoUsers();
    await pvp.enqueue({ userId: "alice", mode: "single" });
    const second = await pvp.enqueue({ userId: "bob", mode: "party" });
    expect(second.matched).toBe(false);
  });
});

describe("기권", () => {
  it("기권하면 상대 승리로 종료", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    const result = await pvp.forfeit("alice", m.id);
    expect(result.status).toBe("finished");
    expect(result.result?.kind).toBe("forfeit");
    expect(result.result?.winnerUserId).toBe("bob");
    expect(result.result?.loserUserId).toBe("alice");
  });
});

describe("인배틀 채팅", () => {
  it("메시지를 추가하고 매치에서 조회된다", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await pvp.acceptChallenge("bob", m.id);
    await pvp.postChat("alice", m.id, "ㅎㅇ");
    await pvp.postChat("bob", m.id, "gg");
    const view = await pvp.getMatchForUser("alice", m.id);
    expect(view.chat).toHaveLength(2);
    expect(view.chat[0].text).toBe("ㅎㅇ");
    expect(view.chat[0].nickname).toBe("Alice");
  });

  it("참가자가 아니면 채팅 불가", async () => {
    await seedTwoUsers();
    await userStore.saveUser(createUser("carol", "Carol", [strongMon("squirtle")]));
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await expect(pvp.postChat("carol", m.id, "끼어들기")).rejects.toThrow();
  });

  it("빈 메시지는 거절된다", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    await expect(pvp.postChat("alice", m.id, "   ")).rejects.toThrow();
  });
});

describe("폴링 조회", () => {
  it("참가자는 매치를 조회할 수 있고, 제3자는 불가", async () => {
    await seedTwoUsers();
    await userStore.saveUser(createUser("carol", "Carol", [strongMon("squirtle")]));
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    const view = await pvp.getMatchForUser("bob", m.id);
    expect(view.id).toBe(m.id);
    await expect(pvp.getMatchForUser("carol", m.id)).rejects.toThrow();
  });

  it("listMatches는 관여한 매치를 반환한다", async () => {
    await seedTwoUsers();
    const m = await pvp.createChallenge({ challengerUserId: "alice", opponentUserId: "bob", mode: "single" });
    const aliceMatches = await pvp.listMatches("alice");
    expect(aliceMatches.some((x) => x.id === m.id)).toBe(true);
  });
});
