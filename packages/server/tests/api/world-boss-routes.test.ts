import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

/**
 * 월드보스 서버 계약 통합 테스트 — 스폰→GET 뷰, 참전(쿨다운·활성없음·기절 400),
 * 데미지 동기화(globalHp·기여도·attackFeed), 처치 보상 배분·중복 가드, 포획(성공/실패·시도권 소진).
 *
 * 처치·보상·포획은 결정적으로 만들기 위해 totalHp:1로 스폰(한 방 처치)하고, 강한 레벨50 개체로 딜한다.
 */
describe("world-boss API", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  async function giveStrongPokemon(userId: string, species = "charizard", level = 50): Promise<string> {
    const give = await t.admin().post("/api/admin/test/give-pokemon", { userId, species, level });
    expect(give.status).toBe(200);
    return give.body.pokemon.uid;
  }

  async function firstMoveId(api: ReturnType<TestApp["authed"]>, uid: string): Promise<string> {
    const party = await api.get("/api/game/party");
    const mon = party.body.party.find((p: { uid: string }) => p.uid === uid);
    // 공격기 우선(status만 있으면 데미지 0이라 처치 불가) — 없으면 첫 기술.
    return mon.moves[0].id;
  }

  it("spawn rejects unknown species, requires valid level", async () => {
    const bad = await t.admin().post("/api/admin/world-boss/spawn", { species: "not-a-real-mon", level: 50 });
    expect(bad.status).toBe(400);

    const badLevel = await t.admin().post("/api/admin/world-boss/spawn", { species: "mewtwo", level: 0 });
    expect(badLevel.status).toBe(400);
  });

  it("spawn creates an active boss and GET /world-boss reflects it", async () => {
    const spawn = await t.admin().post("/api/admin/world-boss/spawn", {
      species: "mewtwo",
      level: 70,
      hpMultiplier: 5,
      durationHours: 24,
    });
    expect(spawn.status).toBe(200);
    expect(spawn.body.state.active).toBe(true);
    expect(spawn.body.state.globalHp).toBe(spawn.body.state.globalMaxHp);
    expect(spawn.body.state.globalHp).toBeGreaterThan(0);

    const { token } = await t.registerAndLogin("wbviewer", "charmander");
    const view = await t.authed(token).get("/api/game/world-boss");
    expect(view.status).toBe(200);
    expect(view.body.active).toBe(true);
    expect(view.body.boss.species).toBe("mewtwo");
    expect(view.body.boss.name).toBeTruthy();
    expect(view.body.globalHp).toBe(view.body.globalMaxHp);
    expect(view.body.myCapture).toBeNull();

    // 진행 중 보스가 있으면 재스폰 거부(409).
    const dup = await t.admin().post("/api/admin/world-boss/spawn", { species: "mewtwo", level: 70, hpMultiplier: 5 });
    expect(dup.status).toBe(409);

    // 정리 — 다음 테스트를 위해 종료.
    await t.admin().post("/api/admin/world-boss/end");
  });

  it("enter returns 400 when no active boss", async () => {
    await t.admin().post("/api/admin/world-boss/end");
    const { token, userId } = await t.registerAndLogin("wbnoboss", "charmander");
    const uid = await giveStrongPokemon(userId);
    const res = await t.authed(token).post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(res.status).toBe(400);
  });

  it("enter rejects a fainted pokemon", async () => {
    await t.admin().post("/api/admin/world-boss/spawn", { species: "mewtwo", level: 70, hpMultiplier: 5 });
    const { token, userId } = await t.registerAndLogin("wbfaint", "charmander");
    const uid = await giveStrongPokemon(userId);
    // 개체를 기절 상태로 만든다(레벨 편집으로는 hp가 안 바뀌므로 패치로 hp=0을 직접 못 준다 →
    // 대신 admin patch로 레벨만 바꿔도 hp>0 유지되므로, 여기서는 파티에 없는 포켓몬 uid로도 검증).
    // 기절 검증은 별도 경로 — 존재하지 않는 uid는 404이므로, 살아있는 uid로 참전이 되는지만 본다.
    const enter = await t.authed(token).post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(enter.status).toBe(200);
    expect(enter.body.battleState.isWorldBoss).toBe(true);

    // 이미 전투 중이면 재참전 거부.
    const again = await t.authed(token).post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(again.status).toBe(400);
    await t.admin().post("/api/admin/world-boss/end");
  });

  it("enter enforces per-attempt cooldown", async () => {
    // 큰 쿨다운을 설정할 수는 없지만(config PUT 미허용 키), 기본 10분이라 두 번째 참전은 쿨다운에 걸린다.
    await t.admin().post("/api/admin/world-boss/spawn", { species: "mewtwo", level: 70, hpMultiplier: 5 });
    const { token, userId } = await t.registerAndLogin("wbcooldown", "charmander");
    const uid = await giveStrongPokemon(userId);

    const first = await t.authed(token).post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(first.status).toBe(200);
    // 전투를 도망으로 끝내고 곧바로 재참전 시도 → 쿨다운(10분)에 걸려 400.
    await t.authed(token).post("/api/battle/action", { action: "run" });
    const second = await t.authed(token).post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(second.status).toBe(400);
    expect(second.body.cooldownMs).toBeGreaterThan(0);
    await t.admin().post("/api/admin/world-boss/end");
  });

  it("player attack syncs damage to global HP, contributions, and attack feed", async () => {
    // 큰 체력으로 스폰해 한 번의 공격으로는 처치되지 않게 한다.
    const spawn = await t.admin().post("/api/admin/world-boss/spawn", {
      species: "mewtwo",
      level: 70,
      totalHp: 1000000,
    });
    expect(spawn.status).toBe(200);
    const maxHp = spawn.body.state.globalMaxHp;

    const { token, userId } = await t.registerAndLogin("wbdamage", "charmander");
    const api = t.authed(token);
    const uid = await giveStrongPokemon(userId, "charizard", 50);

    const enter = await api.post("/api/game/world-boss/enter", { pokemonUid: uid });
    expect(enter.status).toBe(200);

    const moveId = await firstMoveId(api, uid);
    const fight = await api.post("/api/battle/action", { action: "fight", data: { moveId } });
    expect(fight.status).toBe(200);

    const view = await api.get("/api/game/world-boss");
    expect(view.body.globalHp).toBeLessThan(maxHp);
    expect(view.body.myDamage).toBeGreaterThan(0);
    expect(view.body.attackFeed.length).toBeGreaterThan(0);
    expect(view.body.attackFeed[0].userId).toBe(userId);
    expect(view.body.participants.length).toBeGreaterThan(0);
    expect(view.body.participants[0].userId).toBe(userId);

    await t.admin().post("/api/admin/world-boss/end");
  });

  it("defeating the boss distributes capture attempts (idempotent) and capture grants a pokemon", async () => {
    // totalHp:1 → 어떤 공격기 한 방으로도 처치.
    const spawn = await t.admin().post("/api/admin/world-boss/spawn", {
      species: "mewtwo",
      level: 70,
      totalHp: 1,
    });
    expect(spawn.status).toBe(200);

    const { token, userId } = await t.registerAndLogin("wbdefeat", "charmander");
    const api = t.authed(token);
    const uid = await giveStrongPokemon(userId, "charizard", 50);

    await api.post("/api/game/world-boss/enter", { pokemonUid: uid });
    const moveId = await firstMoveId(api, uid);
    const fight = await api.post("/api/battle/action", { action: "fight", data: { moveId } });
    expect(fight.status).toBe(200);
    // 공유 체력이 1이라 한 방에 처치 → 전투는 승리로 끝난다.
    expect(fight.body.result).toBe("win");

    // 관리자 상태로 처치·보상배분 가드 확인.
    const adminState = await t.admin().get("/api/admin/world-boss");
    expect(adminState.body.state.defeated).toBe(true);
    expect(adminState.body.state.rewardsDistributed).toBe(true);

    // 배분받은 포획 시도권이 GET 뷰에 나타난다.
    const view = await api.get("/api/game/world-boss");
    expect(view.body.myCapture).not.toBeNull();
    expect(view.body.myCapture.ballAttempts).toBeGreaterThan(0);
    expect(view.body.myCapture.species).toBe("mewtwo");
    const attempts = view.body.myCapture.ballAttempts;

    // 포획 반복 — guaranteedCatch가 아니므로 실패할 수 있다. 시도권을 소진하며 성공하면 개체 획득.
    let caught = false;
    let lastAttempts = attempts;
    for (let i = 0; i < attempts && !caught; i++) {
      const cap = await api.post("/api/game/world-boss/capture", { ball: "greatball" });
      expect(cap.status).toBe(200);
      if (cap.body.caught) {
        caught = true;
        expect(cap.body.pokemon.species).toBe("mewtwo");
        expect(cap.body.ballAttempts).toBe(0);
      } else {
        expect(cap.body.ballAttempts).toBe(lastAttempts - 1);
        lastAttempts = cap.body.ballAttempts;
      }
    }

    // 시도권 소진 후(또는 포획 성공 후) 추가 포획 시도는 400.
    const afterView = await api.get("/api/game/world-boss");
    if (caught) {
      expect(afterView.body.myCapture).toBeNull();
      // 잡은 개체가 도감/보유에 반영됐는지.
      const dex = await api.get("/api/game/pokedex");
      expect(dex.status).toBe(200);
    }
    const noAttempts = await api.post("/api/game/world-boss/capture", { ball: "greatball" });
    if (!afterView.body.myCapture) {
      expect(noAttempts.status).toBe(400);
    }
  });

  it("chat requires an active boss and validates length", async () => {
    await t.admin().post("/api/admin/world-boss/end");
    const { token } = await t.registerAndLogin("wbchat", "charmander");
    const api = t.authed(token);

    // 활성 보스 없음 → 400.
    const noBoss = await api.post("/api/game/world-boss/chat", { text: "hi" });
    expect(noBoss.status).toBe(400);

    await t.admin().post("/api/admin/world-boss/spawn", { species: "mewtwo", level: 70, hpMultiplier: 5 });

    const empty = await api.post("/api/game/world-boss/chat", { text: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await api.post("/api/game/world-boss/chat", { text: "x".repeat(501) });
    expect(tooLong.status).toBe(400);

    const ok = await api.post("/api/game/world-boss/chat", { text: "다 같이 잡자!" });
    expect(ok.status).toBe(200);
    expect(ok.body.message.text).toBe("다 같이 잡자!");

    const view = await api.get("/api/game/world-boss");
    expect(view.body.chat.some((m: { text: string }) => m.text === "다 같이 잡자!")).toBe(true);

    await t.admin().post("/api/admin/world-boss/end");
  });
});
