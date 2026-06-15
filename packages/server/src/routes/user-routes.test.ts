import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// /user/list 는 getAllUsers(전체 유저)와 authMiddleware(verifyToken)에 의존한다.
// 둘을 목으로 갈아끼워 라우터를 실제 마운트 경로(/api/v1/user)로 올리고,
// 노출 경로(/api/v1/user/list)·본인제외·q필터·페이지네이션을 검증한다.
vi.mock("../auth/auth.js", () => ({
  verifyToken: (token: string) => (token === "good" ? { userId: "alice" } : null),
}));

const getAllUsers = vi.fn();
vi.mock("../storage/user-store.js", () => ({
  getAllUsers: () => getAllUsers(),
  // user-routes.ts가 import하는 나머지 심볼은 /list 경로에선 쓰이지 않지만,
  // 모듈 평가 시 존재해야 하므로 노옵으로 채운다.
  getUser: vi.fn(),
  isEmailTaken: vi.fn(),
  isGitIntegration: vi.fn(),
  isRepoEmailTaken: vi.fn(),
  searchUsersByIdentity: vi.fn(),
  saveUser: vi.fn(),
}));

// user-routes.ts는 통합/폴링 모듈을 import한다. /list 테스트엔 불필요하므로 가볍게 목.
vi.mock("../integrations/integration-parsers.js", () => ({ parseIntegrationInput: vi.fn() }));
vi.mock("../integrations/notion-polling.js", () => ({ pollNotionIntegration: vi.fn() }));
vi.mock("../integrations/jira-polling.js", () => ({ pollJiraIntegration: vi.fn() }));
vi.mock("../integrations/slack-polling.js", () => ({ pollSlackIntegration: vi.fn() }));
vi.mock("../integrations/provider-tests.js", () => ({ testIntegrationConnection: vi.fn() }));
vi.mock("../polling/polling-worker.js", () => ({
  pollUserIntegrations: vi.fn(),
  getRepoAuthorEmails: vi.fn(),
}));
vi.mock("../polling/git-client.js", () => ({ redactUrlCredentials: vi.fn() }));
vi.mock("../storage/sync-state-store.js", () => ({ getSyncState: vi.fn(), saveSyncState: vi.fn() }));

const { userRoutes, buildUserList, topPartyLevel } = await import("./user-routes.js");

type FakeUser = {
  account: { id: string; nickname: string };
  party?: string[];
  pokemon?: { uid: string; level: number }[];
};

function makeApp() {
  const app = express();
  app.use(express.json());
  // 실제 앱과 동일하게 `/api/v1/user`에 마운트 → 내부 상대경로 /list = /api/v1/user/list.
  app.use("/api/v1/user", userRoutes);
  return app;
}

const USERS: FakeUser[] = [
  { account: { id: "alice", nickname: "Alice" }, party: ["a1"], pokemon: [{ uid: "a1", level: 20 }] },
  {
    account: { id: "bob", nickname: "Bob" },
    party: ["b1"],
    pokemon: [
      { uid: "b1", level: 12 },
      { uid: "b2", level: 30 },
    ],
  },
  { account: { id: "carol", nickname: "Carol" }, pokemon: [] },
];

beforeEach(() => {
  getAllUsers.mockReset();
  getAllUsers.mockResolvedValue(USERS);
});

describe("topPartyLevel", () => {
  it("파티 uid에 해당하는 개체 중 최고 레벨을 쓴다", () => {
    expect(topPartyLevel(USERS[1])).toBe(12); // 파티는 b1(12)만, b2(30)는 비파티
  });
  it("보유 포켓몬이 없으면 undefined", () => {
    expect(topPartyLevel(USERS[2])).toBeUndefined();
  });
  it("파티가 비어도 보유 전체에서 최고 레벨로 폴백", () => {
    expect(topPartyLevel({ account: { id: "x", nickname: "X" }, pokemon: [{ uid: "z", level: 5 }] })).toBe(5);
  });
});

describe("buildUserList", () => {
  it("본인을 제외하고 닉네임순 정렬한다", () => {
    const { users, total } = buildUserList(USERS, "alice");
    expect(users.map((u) => u.id)).toEqual(["bob", "carol"]);
    expect(total).toBe(2);
  });
  it("q로 id/nickname 부분일치 필터", () => {
    const { users } = buildUserList(USERS, "alice", { q: "car" });
    expect(users.map((u) => u.id)).toEqual(["carol"]);
  });
  it("limit/offset 페이지네이션(total은 전체 매치 수)", () => {
    const { users, total } = buildUserList(USERS, "zzz", { limit: 1, offset: 1 });
    expect(total).toBe(3);
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("bob");
  });
  it("레벨 없으면 level 키를 생략한다", () => {
    const { users } = buildUserList(USERS, "alice", { q: "carol" });
    expect(users[0]).not.toHaveProperty("level");
  });
});

describe("GET /api/v1/user/list", () => {
  it("인증 없으면 401", async () => {
    const res = await request(makeApp()).get("/api/v1/user/list");
    expect(res.status).toBe(401);
  });

  it("본인(alice)을 제외한 목록을 반환한다", async () => {
    const res = await request(makeApp())
      .get("/api/v1/user/list")
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(["bob", "carol"]);
    expect(res.body.total).toBe(2);
    // bob은 파티 레벨(12)이 붙고 carol은 보유 없음 → level 생략.
    const bob = res.body.users.find((u: { id: string }) => u.id === "bob");
    expect(bob.level).toBe(12);
    const carol = res.body.users.find((u: { id: string }) => u.id === "carol");
    expect(carol).not.toHaveProperty("level");
  });

  it("q 부분검색으로 좁힌다", async () => {
    const res = await request(makeApp())
      .get("/api/v1/user/list?q=bob")
      .set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(["bob"]);
  });
});
