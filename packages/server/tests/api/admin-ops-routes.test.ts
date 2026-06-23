/**
 * 운영(어드민) 도구 + 유저 공지 엔드포인트 테스트.
 *
 * 결정적 + register 비의존: bcrypt 회원가입 플로우(느리고 환경 의존적)를 피하려고
 * 유저를 saveUser로 직접 디스크에 시드한다. 어드민 라우트는 bcrypt를 쓰지 않아 빠르다.
 * 데이터 디렉토리는 임시 격리, 모듈 캐시는 리셋해 store/route가 같은 DATA_DIR를 본다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { UserData } from "../../../../shared/types.js";

type Ctx = {
  baseUrl: string;
  server: Server;
  dataDir: string;
  saveUser: (u: UserData) => Promise<void>;
  getUser: (id: string) => Promise<UserData | null>;
  cleanup: () => void;
};

const ADMIN_KEY = "test-admin-key";

function makeUser(id: string, overrides: Partial<UserData> = {}): UserData {
  return {
    account: {
      id,
      password: "x",
      nickname: id,
      createdAt: new Date().toISOString(),
      matchings: {},
    },
    currentRegion: "default",
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
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
    ...overrides,
  };
}

async function setup(): Promise<Ctx> {
  const dataDir = path.join(os.tmpdir(), `pokelog-ops-${randomUUID()}`);
  fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
  process.env.POKELOG_DATA_DIR = dataDir;
  process.env.POKELOG_ADMIN_KEY = ADMIN_KEY;
  process.env.POKELOG_JWT_SECRET ??= "vitest-global-secret";

  vi.resetModules();
  const { clearAllCaches } = await import("../../src/game/data-loader.js");
  clearAllCaches();

  const { createApp } = await import("../../src/app.js");
  const { saveUser, getUser } = await import("../../src/storage/user-store.js");

  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    server,
    dataDir,
    saveUser,
    getUser,
    cleanup() {
      try { server.close(); } catch { /* ignore */ }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
      delete process.env.POKELOG_DATA_DIR;
      delete process.env.POKELOG_ADMIN_KEY;
    },
  };
}

async function api(
  ctx: Ctx,
  method: string,
  url: string,
  opts: { admin?: boolean; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.admin) headers["x-admin-key"] = ADMIN_KEY;
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${ctx.baseUrl}${url}`, init);
  const text = await res.text();
  let body: any = undefined;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: res.status, body };
}

describe("admin ops + announcement routes", () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await setup(); });
  afterEach(() => { ctx?.cleanup(); });

  // ── 유저 스냅샷 ──────────────────────────────────────────────
  it("GET /users/:id returns a full snapshot, integrations without secrets", async () => {
    await ctx.saveUser(makeUser("snap", {
      points: 42,
      totalExp: 100,
      gameMoney: 7,
      pokedex: ["pikachu", "eevee"],
      inventory: { pokeball: 3 },
      integrations: [
        {
          id: "int1", provider: "github", label: "gh", status: "ok", failCount: 0,
          addedAt: new Date().toISOString(),
          config: { repoUrl: "https://x/y", token: "SECRET" },
          emails: ["a@b.c"],
        } as any,
      ],
    }));

    const res = await api(ctx, "GET", "/api/admin/users/snap", { admin: true });
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe("snap");
    expect(res.body.points).toBe(42);
    expect(res.body.pokedexCount).toBe(2);
    expect(res.body.inventory.pokeball).toBe(3);
    expect(res.body.integrations[0]).toMatchObject({ provider: "github", emails: ["a@b.c"] });
    // 비밀(token)은 절대 노출되지 않음
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
  });

  it("GET /users/:id 404 for unknown", async () => {
    const res = await api(ctx, "GET", "/api/admin/users/nope", { admin: true });
    expect(res.status).toBe(404);
  });

  // ── git 작성자 이메일 ─────────────────────────────────────────
  it("GET /users/:id/git-emails returns [] when no matching set", async () => {
    await ctx.saveUser(makeUser("ge0"));
    const res = await api(ctx, "GET", "/api/admin/users/ge0/git-emails", { admin: true });
    expect(res.status).toBe(200);
    expect(res.body.emails).toEqual([]);
  });

  it("GET /users/:id/git-emails returns existing matchings.git.emails", async () => {
    await ctx.saveUser(makeUser("ge1", { account: {
      id: "ge1", password: "x", nickname: "ge1", createdAt: new Date().toISOString(),
      matchings: { git: { emails: ["dev@corp.example"] } },
    } }));
    const res = await api(ctx, "GET", "/api/admin/users/ge1/git-emails", { admin: true });
    expect(res.status).toBe(200);
    expect(res.body.emails).toEqual(["dev@corp.example"]);
  });

  it("GET /users/:id/git-emails 404 for unknown", async () => {
    const res = await api(ctx, "GET", "/api/admin/users/nope/git-emails", { admin: true });
    expect(res.status).toBe(404);
  });

  it("PUT /users/:id/git-emails normalizes (trim/lowercase/dedupe/@-filter) and persists", async () => {
    await ctx.saveUser(makeUser("ge2"));
    const res = await api(ctx, "PUT", "/api/admin/users/ge2/git-emails", {
      admin: true,
      body: { emails: ["  Dev@Corp.Example ", "dev@corp.example", "", "not-an-email", "A@B.C"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // 소문자·트림·중복제거 + '@' 없는 항목/빈문자 제거
    expect(res.body.emails).toEqual(["dev@corp.example", "a@b.c"]);
    // 디스크에도 account.matchings.git.emails로 저장됨
    const stored = await ctx.getUser("ge2");
    expect(stored?.account.matchings.git?.emails).toEqual(["dev@corp.example", "a@b.c"]);
  });

  it("PUT /users/:id/git-emails 400 when emails is not an array", async () => {
    await ctx.saveUser(makeUser("ge3"));
    const res = await api(ctx, "PUT", "/api/admin/users/ge3/git-emails", {
      admin: true, body: { emails: "x@y.z" },
    });
    expect(res.status).toBe(400);
  });

  it("PUT /users/:id/git-emails 404 for unknown", async () => {
    const res = await api(ctx, "PUT", "/api/admin/users/nope/git-emails", {
      admin: true, body: { emails: [] },
    });
    expect(res.status).toBe(404);
  });

  // ── 재화 조정 ────────────────────────────────────────────────
  it("POST /users/:id/adjust set/add and clamps negatives to 0", async () => {
    await ctx.saveUser(makeUser("adj", { points: 100, totalExp: 50, gameMoney: 10 }));

    const setRes = await api(ctx, "POST", "/api/admin/users/adj/adjust", {
      admin: true, body: { setPoints: 500, addTotalExp: 25 },
    });
    expect(setRes.status).toBe(200);
    expect(setRes.body.points).toBe(500);
    expect(setRes.body.totalExp).toBe(75);

    // addGameMoney 음수 → 0 클램프
    const clampRes = await api(ctx, "POST", "/api/admin/users/adj/adjust", {
      admin: true, body: { addGameMoney: -9999 },
    });
    expect(clampRes.status).toBe(200);
    expect(clampRes.body.gameMoney).toBe(0);

    const persisted = await ctx.getUser("adj");
    expect(persisted?.points).toBe(500);
    expect(persisted?.gameMoney).toBe(0);
  });

  it("POST /users/:id/adjust rejects set+add on the same field", async () => {
    await ctx.saveUser(makeUser("adj2", { points: 100 }));
    const res = await api(ctx, "POST", "/api/admin/users/adj2/adjust", {
      admin: true, body: { setPoints: 5, addPoints: 5 },
    });
    expect(res.status).toBe(400);
  });

  // ── 아이템/포켓몬 지급 검증 ──────────────────────────────────
  it("POST /users/:id/give-item validates item existence", async () => {
    await ctx.saveUser(makeUser("gi"));
    const ok = await api(ctx, "POST", "/api/admin/users/gi/give-item", {
      admin: true, body: { item: "pokeball", qty: 2 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.inventory.pokeball).toBe(2);

    const bad = await api(ctx, "POST", "/api/admin/users/gi/give-item", {
      admin: true, body: { item: "not-a-real-item", qty: 1 },
    });
    expect(bad.status).toBe(400);
  });

  it("POST /users/:id/give-pokemon validates species and honors shiny/level", async () => {
    await ctx.saveUser(makeUser("gp"));
    const ok = await api(ctx, "POST", "/api/admin/users/gp/give-pokemon", {
      admin: true, body: { species: "pikachu", level: 12, shiny: true },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.pokemon).toMatchObject({ species: "pikachu", level: 12, shiny: true });

    const bad = await api(ctx, "POST", "/api/admin/users/gp/give-pokemon", {
      admin: true, body: { species: "not-a-pokemon" },
    });
    expect(bad.status).toBe(400);

    const persisted = await ctx.getUser("gp");
    expect(persisted?.party.length).toBe(1);
    expect(persisted?.pokedex).toContain("pikachu");
  });

  // ── 게임 초기화(개별) ────────────────────────────────────────
  it("POST /users/:id/reset-game clears game data but preserves account/integrations", async () => {
    const integration = {
      id: "i1", provider: "github", label: "gh", status: "ok", failCount: 0,
      addedAt: new Date().toISOString(),
      config: { repoUrl: "https://x/y", token: "T" }, emails: ["e@x.y"],
    } as any;
    await ctx.saveUser(makeUser("reset", {
      points: 999, totalExp: 999, gameMoney: 50,
      party: ["uid1"],
      pokemon: [{ uid: "uid1", species: "pikachu", level: 5 } as any],
      storage: [{ uid: "uid2", species: "eevee", level: 5 } as any],
      eggs: [{ id: "egg1", tier: "common", createdAt: "x" } as any],
      pokedex: ["pikachu"],
      inventory: { pokeball: 9 },
      combo: { count: 5, lastCommitAt: "2020-01-01T00:00:00Z" },
      integrations: [integration],
      log: [{ type: "reward", timestamp: "2020-01-01T00:00:00Z" } as any],
    }));

    const res = await api(ctx, "POST", "/api/admin/users/reset/reset-game", { admin: true });
    expect(res.status).toBe(200);

    const u = await ctx.getUser("reset");
    // reset
    expect(u?.points).toBe(0);
    expect(u?.totalExp).toBe(0);
    expect(u?.gameMoney).toBe(0);
    expect(u?.party).toEqual([]);
    expect(u?.pokemon).toEqual([]);
    expect(u?.storage).toEqual([]);
    expect(u?.eggs).toEqual([]);
    expect(u?.pokedex).toEqual([]);
    expect(u?.inventory).toEqual({});
    expect(u?.combo).toEqual({ count: 0, lastCommitAt: null });
    // preserve
    expect(u?.account.id).toBe("reset");
    expect(u?.integrations.length).toBe(1);
    expect((u?.integrations[0] as any).emails).toEqual(["e@x.y"]);
    expect(u?.log.length).toBe(1);
  });

  // ── 개체 포켓몬 편집/삭제 ────────────────────────────────────
  it("GET /users/:id snapshot includes a full pokemonList (party + storage)", async () => {
    await ctx.saveUser(makeUser("plist", {
      party: ["uid1"],
      pokemon: [{ uid: "uid1", species: "pikachu", nickname: "Sparky", level: 10, hp: 30, maxHp: 30, isShiny: true } as any],
      storage: [{ uid: "uid2", species: "eevee", nickname: null, level: 7, hp: 22, maxHp: 22 } as any],
    }));
    const res = await api(ctx, "GET", "/api/admin/users/plist", { admin: true });
    expect(res.status).toBe(200);
    expect(res.body.pokemonList).toHaveLength(2);
    const party = res.body.pokemonList.find((p: any) => p.uid === "uid1");
    expect(party).toMatchObject({ species: "pikachu", nickname: "Sparky", shiny: true, inParty: true });
    const boxed = res.body.pokemonList.find((p: any) => p.uid === "uid2");
    expect(boxed).toMatchObject({ species: "eevee", nickname: null, inParty: false });
  });

  it("PATCH /users/:id/pokemon/:uid edits nickname/shiny and recalculates stats on level change", async () => {
    await ctx.saveUser(makeUser("edit", {
      party: ["m1"],
      pokemon: [{ uid: "m1", species: "pikachu", nickname: null, level: 5, exp: 0, hp: 20, maxHp: 20, stats: {}, moves: [] } as any],
    }));

    const res = await api(ctx, "PATCH", "/api/admin/users/edit/pokemon/m1", {
      admin: true, body: { nickname: "  Bolt  ", level: 50, shiny: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.pokemon).toMatchObject({ nickname: "Bolt", level: 50, shiny: true });

    const u = await ctx.getUser("edit");
    const mon = u!.pokemon[0];
    expect(mon.level).toBe(50);
    expect(mon.nickname).toBe("Bolt");
    expect(mon.isShiny).toBe(true);
    // 레벨 50은 레벨 5보다 maxHp가 커야 한다(스탯 재계산 확인).
    expect(mon.maxHp).toBeGreaterThan(20);
    expect(mon.hp).toBeLessThanOrEqual(mon.maxHp);
  });

  it("PATCH /users/:id/pokemon/:uid changes species (validated) and updates pokedex", async () => {
    await ctx.saveUser(makeUser("sp", {
      party: ["m1"],
      pokemon: [{ uid: "m1", species: "pikachu", nickname: null, level: 10, exp: 0, hp: 30, maxHp: 30, stats: {}, moves: [] } as any],
      pokedex: ["pikachu"],
    }));

    const bad = await api(ctx, "PATCH", "/api/admin/users/sp/pokemon/m1", {
      admin: true, body: { species: "not-a-pokemon" },
    });
    expect(bad.status).toBe(400);

    const ok = await api(ctx, "PATCH", "/api/admin/users/sp/pokemon/m1", {
      admin: true, body: { species: "eevee" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.pokemon.species).toBe("eevee");
    const u = await ctx.getUser("sp");
    expect(u!.pokemon[0].species).toBe("eevee");
    expect(u!.pokedex).toContain("eevee");
  });

  it("PATCH /users/:id/pokemon/:uid 404 for unknown pokemon / 400 for bad level", async () => {
    await ctx.saveUser(makeUser("edit404", {
      party: ["m1"],
      pokemon: [{ uid: "m1", species: "pikachu", nickname: null, level: 5, exp: 0, hp: 20, maxHp: 20, stats: {}, moves: [] } as any],
    }));
    expect((await api(ctx, "PATCH", "/api/admin/users/edit404/pokemon/nope", { admin: true, body: { level: 9 } })).status).toBe(404);
    expect((await api(ctx, "PATCH", "/api/admin/users/edit404/pokemon/m1", { admin: true, body: { level: 0 } })).status).toBe(400);
    expect((await api(ctx, "PATCH", "/api/admin/users/edit404/pokemon/m1", { admin: true, body: { level: 101 } })).status).toBe(400);
  });

  it("DELETE /users/:id/pokemon/:uid removes from party and storage, syncs party array", async () => {
    await ctx.saveUser(makeUser("del", {
      party: ["a", "b"],
      pokemon: [
        { uid: "a", species: "pikachu", nickname: null, level: 5, hp: 20, maxHp: 20 } as any,
        { uid: "b", species: "eevee", nickname: null, level: 5, hp: 20, maxHp: 20 } as any,
      ],
      storage: [{ uid: "c", species: "bulbasaur", nickname: null, level: 5, hp: 20, maxHp: 20 } as any],
    }));

    // 보관함 포켓몬 삭제
    const delBox = await api(ctx, "DELETE", "/api/admin/users/del/pokemon/c", { admin: true });
    expect(delBox.status).toBe(200);
    expect((await ctx.getUser("del"))?.storage).toEqual([]);

    // 파티 포켓몬 삭제 — party 배열에서도 빠진다
    const delParty = await api(ctx, "DELETE", "/api/admin/users/del/pokemon/a", { admin: true });
    expect(delParty.status).toBe(200);
    const u = await ctx.getUser("del");
    expect(u?.pokemon.map((p) => p.uid)).toEqual(["b"]);
    expect(u?.party).toEqual(["b"]);

    // 존재하지 않는 uid → 404
    expect((await api(ctx, "DELETE", "/api/admin/users/del/pokemon/zzz", { admin: true })).status).toBe(404);
  });

  it("DELETE /users/:id/pokemon/:uid promotes storage to party when party would be emptied", async () => {
    await ctx.saveUser(makeUser("promote", {
      party: ["a"],
      pokemon: [{ uid: "a", species: "pikachu", nickname: null, level: 5, hp: 20, maxHp: 20 } as any],
      storage: [{ uid: "b", species: "eevee", nickname: null, level: 5, hp: 20, maxHp: 20 } as any],
    }));

    const res = await api(ctx, "DELETE", "/api/admin/users/promote/pokemon/a", { admin: true });
    expect(res.status).toBe(200);
    const u = await ctx.getUser("promote");
    // 보관함의 eevee가 파티로 승격
    expect(u?.party).toEqual(["b"]);
    expect(u?.pokemon.map((p) => p.uid)).toEqual(["b"]);
    expect(u?.storage).toEqual([]);
  });

  // ── 일괄 보상(broadcast) ─────────────────────────────────────
  it("POST /broadcast/reward applies filter and reports processed count", async () => {
    await ctx.saveUser(makeUser("poor", { points: 100 }));
    await ctx.saveUser(makeUser("mid", { points: 600_000 }));
    await ctx.saveUser(makeUser("rich", { points: 2_000_000 }));

    // points < 500,000 인 유저에게 +500,000 (poor만 대상)
    const res = await api(ctx, "POST", "/api/admin/broadcast/reward", {
      admin: true, body: { points: 500_000, filter: { maxPoints: 499_999 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);
    expect(res.body.processed).toBe(1);
    expect(res.body.failed).toEqual([]);

    expect((await ctx.getUser("poor"))?.points).toBe(500_100);
    expect((await ctx.getUser("mid"))?.points).toBe(600_000);
    expect((await ctx.getUser("rich"))?.points).toBe(2_000_000);
  });

  it("POST /broadcast/reward rejects unknown item/species before processing", async () => {
    await ctx.saveUser(makeUser("any", { points: 0 }));
    const badItem = await api(ctx, "POST", "/api/admin/broadcast/reward", {
      admin: true, body: { items: { "not-real": 1 } },
    });
    expect(badItem.status).toBe(400);
    const badMon = await api(ctx, "POST", "/api/admin/broadcast/reward", {
      admin: true, body: { pokemon: [{ species: "not-real" }] },
    });
    expect(badMon.status).toBe(400);
  });

  it("POST /broadcast/reward grants items and pokemon to all when no filter", async () => {
    await ctx.saveUser(makeUser("u1"));
    await ctx.saveUser(makeUser("u2"));
    const res = await api(ctx, "POST", "/api/admin/broadcast/reward", {
      admin: true, body: { items: { pokeball: 2 }, pokemon: [{ species: "pikachu", level: 3 }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(2);
    for (const id of ["u1", "u2"]) {
      const u = await ctx.getUser(id);
      expect(u?.inventory.pokeball).toBe(2);
      expect(u?.pokemon.some((p) => p.species === "pikachu")).toBe(true);
    }
  });

  // ── 전체 초기화 confirm 가드 ─────────────────────────────────
  it("POST /reset-all-game requires confirm RESET-ALL", async () => {
    await ctx.saveUser(makeUser("a", { points: 100 }));
    await ctx.saveUser(makeUser("b", { points: 200 }));

    const missing = await api(ctx, "POST", "/api/admin/reset-all-game", { admin: true, body: {} });
    expect(missing.status).toBe(400);
    expect((await ctx.getUser("a"))?.points).toBe(100); // unchanged

    const wrong = await api(ctx, "POST", "/api/admin/reset-all-game", { admin: true, body: { confirm: "nope" } });
    expect(wrong.status).toBe(400);

    const ok = await api(ctx, "POST", "/api/admin/reset-all-game", { admin: true, body: { confirm: "RESET-ALL" } });
    expect(ok.status).toBe(200);
    expect(ok.body.processed).toBe(2);
    expect((await ctx.getUser("a"))?.points).toBe(0);
    expect((await ctx.getUser("b"))?.points).toBe(0);
  });

  // ── 공지 CRUD + active/dismiss ───────────────────────────────
  it("announcements CRUD + active filtering reflects dismiss", async () => {
    // 생성
    const created = await api(ctx, "POST", "/api/admin/announcements", {
      admin: true, body: { title: "T1", body: "B1" },
    });
    expect(created.status).toBe(201);
    const id1 = created.body.announcement.id;
    expect(created.body.announcement.active).toBe(true);

    const created2 = await api(ctx, "POST", "/api/admin/announcements", {
      admin: true, body: { title: "T2", body: "B2" },
    });
    const id2 = created2.body.announcement.id;

    // 목록
    const list = await api(ctx, "GET", "/api/admin/announcements", { admin: true });
    expect(list.body.announcements.length).toBe(2);

    // title/body 누락 시 400
    const bad = await api(ctx, "POST", "/api/admin/announcements", { admin: true, body: { title: "only" } });
    expect(bad.status).toBe(400);

    // 유저 토큰 발급(register 없이 직접 서명) + 유저 시드
    await ctx.saveUser(makeUser("viewer"));
    const { issueToken } = await import("../../src/auth/auth.js");
    const token = issueToken("viewer");

    // 둘 다 active → 유저에게 2개
    let active = await api(ctx, "GET", "/api/game/announcements/active", { token });
    expect(active.status).toBe(200);
    expect(active.body.announcements.map((a: any) => a.id).sort()).toEqual([id1, id2].sort());

    // id2 비활성 → 1개
    const patched = await api(ctx, "PATCH", `/api/admin/announcements/${id2}`, { admin: true, body: { active: false } });
    expect(patched.status).toBe(200);
    active = await api(ctx, "GET", "/api/game/announcements/active", { token });
    expect(active.body.announcements.map((a: any) => a.id)).toEqual([id1]);

    // id1 dismiss → 0개, 유저 데이터에 기록
    const dismiss = await api(ctx, "POST", `/api/game/announcements/${id1}/dismiss`, { token });
    expect(dismiss.status).toBe(200);
    active = await api(ctx, "GET", "/api/game/announcements/active", { token });
    expect(active.body.announcements).toEqual([]);
    expect((await ctx.getUser("viewer"))?.dismissedAnnouncementIds).toContain(id1);

    // dismiss 멱등 — 다시 호출해도 중복 안 쌓임
    await api(ctx, "POST", `/api/game/announcements/${id1}/dismiss`, { token });
    const dismissed = (await ctx.getUser("viewer"))?.dismissedAnnouncementIds ?? [];
    expect(dismissed.filter((x) => x === id1).length).toBe(1);

    // DELETE
    const del = await api(ctx, "DELETE", `/api/admin/announcements/${id1}`, { admin: true });
    expect(del.status).toBe(200);
    const after = await api(ctx, "GET", "/api/admin/announcements", { admin: true });
    expect(after.body.announcements.map((a: any) => a.id)).toEqual([id2]);

    // 없는 공지 PATCH/DELETE → 404
    expect((await api(ctx, "PATCH", "/api/admin/announcements/nope", { admin: true, body: { active: true } })).status).toBe(404);
    expect((await api(ctx, "DELETE", "/api/admin/announcements/nope", { admin: true })).status).toBe(404);
  });
});
