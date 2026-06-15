/**
 * PvP Phase 2 — 보상/베팅/에스크로/ELO/랭킹 테스트.
 *
 * 결정적: rng를 submitAction에 주입(0.5 고정), 전투 난수는 fixRandom으로 Math.random 고정.
 * 격리: 테스트마다 임시 POKELOG_DATA_DIR + vi.resetModules.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedPokemon, PvpMatch, UserData } from "../../../../shared/types.js";

type PvpModule = typeof import("../../src/game/pvp.js");
type RewardsModule = typeof import("../../src/game/pvp-rewards.js");
type UserStoreModule = typeof import("../../src/storage/user-store.js");
type FactoryModule = typeof import("../../src/game/pokemon-factory.js");

let tmpDir: string;
let pvp: PvpModule;
let rewards: RewardsModule;
let userStore: UserStoreModule;
let factory: FactoryModule;

const rng = () => 0.5;

function createUser(id: string, nickname: string, party: OwnedPokemon[], over: Partial<UserData> = {}): UserData {
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
    ...over,
  };
}

/** 공격 보장 강한 포켓몬(tackle). */
function strongMon(species: string, level = 50): OwnedPokemon {
  const p = factory.createPokemon(species, level);
  p.moves = [{ id: "tackle", pp: 35, maxPp: 35 }];
  p.stats = { attack: 200, defense: 60, speed: 100, spAttack: 120, spDefense: 60 };
  p.maxHp = 120;
  p.hp = 120;
  return p;
}

/** 한 방에 쓰러뜨리는 압도적 공격 + 선공 셋업. winner가 항상 이긴다. */
function oneShotMon(species: string): OwnedPokemon {
  const p = strongMon(species);
  p.stats = { attack: 400, defense: 60, speed: 300, spAttack: 200, spDefense: 60 };
  return p;
}
function glassMon(species: string): OwnedPokemon {
  const p = strongMon(species);
  p.hp = 1; p.maxHp = 120;
  p.stats = { attack: 30, defense: 1, speed: 5, spAttack: 30, spDefense: 1 };
  return p;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-pvp-rewards-test-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  pvp = await import("../../src/game/pvp.js");
  rewards = await import("../../src/game/pvp-rewards.js");
  userStore = await import("../../src/storage/user-store.js");
  factory = await import("../../src/game/pokemon-factory.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** winner가 loser를 1라운드에 전멸시키는 single 매치를 만들어 decided로 종료. winner=challenger. */
async function playDecidedMatch(matchId: string): Promise<PvpMatch> {
  await pvp.submitAction("winner", matchId, { kind: "move", moveId: "tackle" }, rng);
  return pvp.submitAction("loser", matchId, { kind: "move", moveId: "tackle" }, rng);
}

// === ELO 순수 함수 ===
describe("nextRating (ELO)", () => {
  it("동률 상대에게 승리하면 +K/2, 패배하면 -K/2", () => {
    // 동률(1000 vs 1000): expected 0.5. 승 → +16(round), 패 → -16, 무 → 0.
    expect(rewards.nextRating(1000, 1000, 1, 32)).toBe(1016);
    expect(rewards.nextRating(1000, 1000, 0, 32)).toBe(984);
    expect(rewards.nextRating(1000, 1000, 0.5, 32)).toBe(1000);
  });

  it("강한 상대를 이기면 더 크게 오른다", () => {
    const weakBeatsStrong = rewards.nextRating(1000, 1400, 1, 32);
    const evenWin = rewards.nextRating(1000, 1000, 1, 32);
    expect(weakBeatsStrong - 1000).toBeGreaterThan(evenWin - 1000);
  });
});

// === stake 정규화 ===
describe("normalizeStakeSpec / isEmptyStake", () => {
  it("음수·비정수·중복을 제거하고 빈 stake를 식별한다", () => {
    const spec = rewards.normalizeStakeSpec({
      points: 50.9, items: { potion: 2, bad: 0, neg: -3 }, pokemonUids: ["a", "a", "b"],
    });
    expect(spec.points).toBe(50);
    expect(spec.items).toEqual({ potion: 2 });
    expect(spec.pokemonUids).toEqual(["a", "b"]);
    expect(rewards.isEmptyStake(spec)).toBe(false);
    expect(rewards.isEmptyStake(rewards.normalizeStakeSpec({}))).toBe(true);
  });
});

// === demand 정규화/충족 ===
describe("normalizeDemand / isEmptyDemand / buildOpponentStakeFromDemand", () => {
  it("음수·비정수를 제거하고 빈 demand를 식별한다", () => {
    const d = rewards.normalizeDemand({ points: 30.7, items: { potion: 2, bad: 0 }, pokemonCount: 1.9 });
    expect(d.points).toBe(30);
    expect(d.items).toEqual({ potion: 2 });
    expect(d.pokemonCount).toBe(1);
    expect(rewards.isEmptyDemand(d)).toBe(false);
    expect(rewards.isEmptyDemand(rewards.normalizeDemand({}))).toBe(true);
  });

  it("demand 충족 stake는 points/items를 그대로 쓰고 고른 포켓몬을 담는다", () => {
    const d = rewards.normalizeDemand({ points: 50, items: { potion: 1 }, pokemonCount: 2 });
    const spec = rewards.buildOpponentStakeFromDemand(d, ["x", "y"]);
    expect(spec.points).toBe(50);
    expect(spec.items).toEqual({ potion: 1 });
    expect(spec.pokemonUids).toEqual(["x", "y"]);
  });

  it("선택한 포켓몬 수가 demand.pokemonCount와 다르면 거부", () => {
    const d = rewards.normalizeDemand({ pokemonCount: 2 });
    expect(() => rewards.buildOpponentStakeFromDemand(d, ["x"])).toThrow();
    expect(() => rewards.buildOpponentStakeFromDemand(d, ["x", "y", "z"])).toThrow();
  });
});

// === 빈 stake = 친선전 ===
describe("빈 stake(친선전) — 정산 no-op", () => {
  it("stake 없이 도전·수락하면 자산 이동 없이 ELO만 갱신된다", async () => {
    await userStore.saveUser(createUser("winner", "Winner", [oneShotMon("bulbasaur")], { points: 1000 }));
    await userStore.saveUser(createUser("loser", "Loser", [glassMon("charmander")], { points: 1000 }));
    // stake·demand 생략 → 빈 에스크로 락(친선).
    const m = await pvp.createChallenge({ challengerUserId: "winner", opponentUserId: "loser", mode: "single" });
    expect(m.stakes.challengerEscrow?.points).toBe(0);
    expect(m.stakes.challengerEscrow?.pokemon).toHaveLength(0);
    await pvp.acceptChallenge("loser", m.id); // demand 빈 것 → opponentEscrow 빈 채 락
    const done = await playDecidedMatch(m.id);
    expect(done.result?.winnerUserId).toBe("winner");
    expect(done.stakes.settled).toBe(true);

    const w = await userStore.getUser("winner");
    const l = await userStore.getUser("loser");
    expect(w!.points).toBe(1000); // 이동 없음
    expect(l!.points).toBe(1000);
    // ELO는 갱신
    expect((await pvp.getUserStats("winner")).rating).toBe(1016);
    expect((await pvp.getUserStats("loser")).rating).toBe(984);
  });
});

// === 내기(에스크로) ===
describe("내기 — 에스크로 락/정산", () => {
  async function seedWager(): Promise<{ extraMonUid: string }> {
    const wMain = oneShotMon("bulbasaur");
    const wStake = strongMon("ivysaur"); // 전투 팀 밖에 둘 stake용 (storage)
    const winner = createUser("winner", "Winner", [wMain], { points: 1000, inventory: { potion: 5 } });
    winner.storage = [wStake];
    await userStore.saveUser(winner);

    const lMain = glassMon("charmander");
    const lStake = strongMon("charmeleon");
    const loser = createUser("loser", "Loser", [lMain], { points: 1000, inventory: { potion: 5 } });
    loser.storage = [lStake];
    await userStore.saveUser(loser);
    return { extraMonUid: wStake.uid };
  }

  it("stake 확정 시 자산이 유저 데이터에서 빠진다(락)", async () => {
    const { extraMonUid } = await seedWager();
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: { potion: 2 }, pokemonUids: [extraMonUid] },
    });
    // challenger 자산 차감 확인
    const w = await userStore.getUser("winner");
    expect(w!.points).toBe(900);
    expect(w!.inventory.potion).toBe(3);
    expect(w!.storage.find((p) => p.uid === extraMonUid)).toBeUndefined();
    // 에스크로에 보관
    expect(m.stakes.challengerEscrow?.points).toBe(100);
    expect(m.stakes.challengerEscrow?.pokemon).toHaveLength(1);
  });

  it("승자독식: 양측 에스크로 전부 승자에게", async () => {
    await seedWager();
    // challenger가 100을 걸고 상대에게 200포인트+potion 1을 요구. 상대가 보유하면 수락 시 자동 차감.
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: {}, pokemonUids: [] },
      demand: { points: 200, items: { potion: 1 }, pokemonCount: 0 },
    });
    await pvp.acceptChallenge("loser", m.id);
    const done = await playDecidedMatch(m.id);
    expect(done.result?.winnerUserId).toBe("winner");
    expect(done.stakes.settled).toBe(true);

    const w = await userStore.getUser("winner");
    const l = await userStore.getUser("loser");
    // winner: 시작 1000 - 100(건 것) + 100(자기 반환분) + 200(상대분) = 1200, potion 5+1
    expect(w!.points).toBe(1200);
    expect(w!.inventory.potion).toBe(6);
    // loser: 1000 - 200 = 800, potion 5-1 = 4
    expect(l!.points).toBe(800);
    expect(l!.inventory.potion).toBe(4);
  });

  it("무승부(동시전멸): 에스크로 원소유자 반환", async () => {
    // 진짜 동시전멸: 둘 다 1HP + 독. 공격은 서로 못 죽일 만큼 약하게(높은 방어),
    // 턴 종료 독 데미지로 양쪽이 같은 라운드에 쓰러진다 → cWiped && oWiped = 무승부.
    const a = strongMon("bulbasaur");
    a.hp = 1; a.statusCondition = "poison";
    a.stats = { attack: 1, defense: 500, speed: 100, spAttack: 1, spDefense: 500 };
    const b = strongMon("charmander");
    b.hp = 1; b.statusCondition = "poison";
    b.stats = { attack: 1, defense: 500, speed: 50, spAttack: 1, spDefense: 500 };
    const ua = createUser("winner", "A", [a], { points: 1000 });
    const ub = createUser("loser", "B", [b], { points: 1000 });
    await userStore.saveUser(ua);
    await userStore.saveUser(ub);

    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: {}, pokemonUids: [] },
      demand: { points: 150, items: {}, pokemonCount: 0 },
    });
    await pvp.acceptChallenge("loser", m.id);
    const done = await playDecidedMatch(m.id);
    expect(done.result?.kind).toBe("decided");
    expect(done.result?.winnerUserId).toBeNull(); // 동시전멸 = 무승부

    const w = await userStore.getUser("winner");
    const l = await userStore.getUser("loser");
    expect(w!.points).toBe(1000); // 정확히 반환
    expect(l!.points).toBe(1000);
  });

  it("기권: 기권자 stake 몰수 → 상대가 양측 에스크로 획득", async () => {
    await seedWager();
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: {}, pokemonUids: [] },
      demand: { points: 300, items: {}, pokemonCount: 0 },
    });
    await pvp.acceptChallenge("loser", m.id);
    // loser가 기권 → winner 승.
    const done = await pvp.forfeit("loser", m.id);
    expect(done.result?.kind).toBe("forfeit");
    expect(done.result?.winnerUserId).toBe("winner");

    const w = await userStore.getUser("winner");
    const l = await userStore.getUser("loser");
    expect(w!.points).toBe(1300); // 1000-100(락)+100(자기반환)+300(상대몰수)
    expect(l!.points).toBe(700);  // 1000-300
  });

  it("declined: challenger 에스크로 반환(이동 없음)", async () => {
    await seedWager();
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: {}, pokemonUids: [] },
    });
    expect((await userStore.getUser("winner"))!.points).toBe(900); // 락됨
    await pvp.declineChallenge("loser", m.id);
    expect((await userStore.getUser("winner"))!.points).toBe(1000); // 반환
  });

  it("voided(pending 기권): challenger 에스크로 반환", async () => {
    await seedWager();
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 100, items: {}, pokemonUids: [] },
    });
    const done = await pvp.forfeit("winner", m.id); // 아직 pending
    expect(done.result?.kind).toBe("voided");
    expect((await userStore.getUser("winner"))!.points).toBe(1000);
  });
});

// === 합의형 demand 충족(수락) ===
describe("demand 충족 수락", () => {
  it("demand points/items를 보유하면 수락 시 자동 차감되어 opponentEscrow에 락된다", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], { points: 1000 }));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], { points: 1000, inventory: { potion: 3 } }));
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 200, items: { potion: 1 }, pokemonCount: 0 },
    });
    const accepted = await pvp.acceptChallenge("loser", m.id);
    expect(accepted.status).toBe("active");
    // demand대로 차감되어 에스크로에 락.
    expect(accepted.stakes.opponentEscrow?.points).toBe(200);
    expect(accepted.stakes.opponentEscrow?.items).toEqual({ potion: 1 });
    const l = await userStore.getUser("loser");
    expect(l!.points).toBe(800);
    expect(l!.inventory.potion).toBe(2);
  });

  it("opponent가 demand.pokemonCount만큼 직접 고른 포켓몬이 락된다", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    const lMain = glassMon("charmander");
    const lStake = strongMon("charmeleon"); // 전투 팀 밖(storage)
    const loser = createUser("loser", "L", [lMain], {});
    loser.storage = [lStake];
    await userStore.saveUser(loser);

    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 0, items: {}, pokemonCount: 1 },
    });
    const accepted = await pvp.acceptChallenge("loser", m.id, [lStake.uid]);
    expect(accepted.stakes.opponentEscrow?.pokemon).toHaveLength(1);
    expect(accepted.stakes.opponentEscrow?.pokemon[0].uid).toBe(lStake.uid);
    const l = await userStore.getUser("loser");
    expect(l!.storage.find((p) => p.uid === lStake.uid)).toBeUndefined();
  });

  it("demand 포인트 부족이면 수락 거부(아무것도 차감 안 함)", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], { points: 50 }));
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 200, items: {}, pokemonCount: 0 },
    });
    await expect(pvp.acceptChallenge("loser", m.id)).rejects.toThrow();
    // 거부 시 차감 없음 + 매치는 여전히 pending.
    expect((await userStore.getUser("loser"))!.points).toBe(50);
    expect((await pvp.getMatchForUser("loser", m.id)).status).toBe("pending");
  });

  it("demand 아이템 부족이면 수락 거부", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], { inventory: { potion: 0 } }));
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 0, items: { potion: 2 }, pokemonCount: 0 },
    });
    await expect(pvp.acceptChallenge("loser", m.id)).rejects.toThrow();
  });

  it("선택한 포켓몬 수가 demand.pokemonCount와 다르면 수락 거부", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    const lMain = glassMon("charmander");
    const lExtra = strongMon("charmeleon");
    const loser = createUser("loser", "L", [lMain], {});
    loser.storage = [lExtra];
    await userStore.saveUser(loser);
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 0, items: {}, pokemonCount: 2 },
    });
    // 1마리만 골라 수 불일치 → 거부.
    await expect(pvp.acceptChallenge("loser", m.id, [lExtra.uid])).rejects.toThrow();
  });

  it("전투 팀 포켓몬으로 demand를 충족하려 하면 거부(안전규칙)", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    const lMain = glassMon("charmander"); // single 전투 팀 = 이 1마리
    const lExtra = strongMon("charmeleon");
    const loser = createUser("loser", "L", [lMain], {});
    loser.storage = [lExtra];
    await userStore.saveUser(loser);
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 0, items: {}, pokemonCount: 1 },
    });
    // 전투에 나갈 lMain을 stake로 내면 거부.
    await expect(pvp.acceptChallenge("loser", m.id, [lMain.uid])).rejects.toThrow();
  });

  it("친선(빈 demand)은 포켓몬 선택 없이 수락된다", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], {}));
    const m = await pvp.createChallenge({ challengerUserId: "winner", opponentUserId: "loser", mode: "single" });
    const accepted = await pvp.acceptChallenge("loser", m.id);
    expect(accepted.status).toBe("active");
    expect(accepted.stakes.opponentEscrow?.locked).toBe(true);
    expect(accepted.stakes.opponentEscrow?.points).toBe(0);
    expect(accepted.stakes.opponentEscrow?.pokemon).toHaveLength(0);
  });
});

// === 소유권/안전규칙 검증 ===
describe("stake 검증 거부", () => {
  it("보유보다 많은 포인트는 거부", async () => {
    await userStore.saveUser(createUser("winner", "W", [strongMon("bulbasaur")], { points: 10 }));
    await userStore.saveUser(createUser("loser", "L", [strongMon("charmander")], { points: 10 }));
    await expect(pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 999, items: {}, pokemonUids: [] },
    })).rejects.toThrow();
    // 거부 시 차감 없음
    expect((await userStore.getUser("winner"))!.points).toBe(10);
  });

  it("보유하지 않은 포켓몬 stake 거부", async () => {
    await userStore.saveUser(createUser("winner", "W", [strongMon("bulbasaur")], { points: 10 }));
    await userStore.saveUser(createUser("loser", "L", [strongMon("charmander")], { points: 10 }));
    await expect(pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 0, items: {}, pokemonUids: ["no-such-uid"] },
    })).rejects.toThrow();
  });

  it("전투에 내보낸 포켓몬은 stake 불가", async () => {
    const battleMon = strongMon("bulbasaur");
    await userStore.saveUser(createUser("winner", "W", [battleMon], { points: 10 }));
    await userStore.saveUser(createUser("loser", "L", [strongMon("charmander")], { points: 10 }));
    // single 팀 = battleMon 1마리. 그걸 stake로 걸려 하면 거부.
    await expect(pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 0, items: {}, pokemonUids: [battleMon.uid] },
    })).rejects.toThrow();
  });

  it("마지막 1마리는 남겨야 한다(전부 stake 불가)", async () => {
    const only = strongMon("bulbasaur");
    await userStore.saveUser(createUser("winner", "W", [only], { points: 10 }));
    await userStore.saveUser(createUser("loser", "L", [strongMon("charmander")], { points: 10 }));
    await expect(pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 0, items: {}, pokemonUids: [only.uid] },
    })).rejects.toThrow();
  });

  it("빈 stake는 허용된다(친선전)", async () => {
    await userStore.saveUser(createUser("winner", "W", [strongMon("bulbasaur")], { points: 10 }));
    await userStore.saveUser(createUser("loser", "L", [strongMon("charmander")], { points: 10 }));
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      challengerStake: { points: 0, items: {}, pokemonUids: [] },
    });
    expect(m.status).toBe("pending");
    expect(m.stakes.challengerEscrow?.locked).toBe(true);
    expect((await userStore.getUser("winner"))!.points).toBe(10); // 차감 없음
  });
});

// === 정산 멱등(이중지급 방지) ===
describe("정산 멱등성", () => {
  it("settleMatch를 여러 번 호출해도 한 번만 지급된다", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], { points: 0 }));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], { points: 1000 }));
    // winner가 loser에게 100을 요구(demand) → winner 승 → 100 획득.
    const m = await pvp.createChallenge({
      challengerUserId: "winner", opponentUserId: "loser", mode: "single",
      demand: { points: 100, items: {}, pokemonCount: 0 },
    });
    await pvp.acceptChallenge("loser", m.id);
    await playDecidedMatch(m.id); // 정산 1회

    // 강제로 settleMatch를 추가 호출 — settled 가드로 무동작.
    await rewards.settleMatch(m.id);
    await rewards.settleMatch(m.id);

    const w = await userStore.getUser("winner");
    const l = await userStore.getUser("loser");
    expect(w!.points).toBe(100); // 에스크로 100, 한 번만
    expect(l!.points).toBe(900); // 1000 - 100(락), 재지급 없음
  });
});

// === ELO/전적 갱신 ===
describe("ELO/전적 갱신", () => {
  it("decided 결과에 승자 +, 패자 - / 전적 반영", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], {}));
    const m = await pvp.createChallenge({ challengerUserId: "winner", opponentUserId: "loser", mode: "single" });
    await pvp.acceptChallenge("loser", m.id);
    await playDecidedMatch(m.id);

    const ws = await pvp.getUserStats("winner");
    const ls = await pvp.getUserStats("loser");
    expect(ws.rating).toBe(1016);
    expect(ws.wins).toBe(1);
    expect(ls.rating).toBe(984);
    expect(ls.losses).toBe(1);
  });

  it("랭킹은 레이팅 내림차순", async () => {
    await userStore.saveUser(createUser("winner", "W", [oneShotMon("bulbasaur")], {}));
    await userStore.saveUser(createUser("loser", "L", [glassMon("charmander")], {}));
    const m = await pvp.createChallenge({ challengerUserId: "winner", opponentUserId: "loser", mode: "single" });
    await pvp.acceptChallenge("loser", m.id);
    await playDecidedMatch(m.id);

    const ranking = await pvp.getRanking();
    expect(ranking).toHaveLength(2);
    expect(ranking[0].userId).toBe("winner");
    expect(ranking[0].rating).toBeGreaterThan(ranking[1].rating);
  });
});
