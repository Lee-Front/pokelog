import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { setupTestApp, type TestApp } from "./test-helpers.js";

const exec = promisify(execFile);

describe("user routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("GET /profile returns user profile", async () => {
    const { token } = await t.registerAndLogin("profileuser", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/user/profile");
    expect(res.status).toBe(200);
    expect(res.body.account.nickname).toBe("profileuser");
    expect(typeof res.body.points).toBe("number");
    expect(Array.isArray(res.body.pokedex)).toBe(true);
  });

  it("GET /search finds users by query", async () => {
    const { token } = await t.registerAndLogin("searchalpha", "charmander");
    await t.registerAndLogin("searchbeta", "squirtle");
    const api = t.authed(token);

    const res = await api.get("/api/user/search?q=search");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    // searchalpha is excluded (own user), searchbeta should appear
    expect(res.body.users.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT /nickname changes nickname", async () => {
    const { token } = await t.registerAndLogin("oldnick", "charmander");
    const api = t.authed(token);

    const put = await api.put("/api/user/nickname", { nickname: "newnick" });
    expect(put.status).toBe(200);
    expect(put.body.nickname).toBe("newnick");

    const profile = await api.get("/api/user/profile");
    expect(profile.body.account.nickname).toBe("newnick");
  });

  it("POST /match creates a git matching", async () => {
    const { token } = await t.registerAndLogin("matchuser", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/match", {
      app: "git",
      identifier: "email@test.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.matchings.git.emails).toContain("email@test.com");
  });

  it("DELETE /match removes a matching", async () => {
    const { token } = await t.registerAndLogin("delmatch", "charmander");
    const api = t.authed(token);

    await api.post("/api/user/match", {
      app: "git",
      identifier: "del@test.com",
    });

    const res = await t.request
      .delete("/api/user/match")
      .set("Authorization", `Bearer ${token}`)
      .send({ app: "git", identifier: "del@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.matchings.git.emails).not.toContain("del@test.com");
  });

  it("GET /integrations returns empty list for new user", async () => {
    const { token } = await t.registerAndLogin("intuser", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/user/integrations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.integrations)).toBe(true);
    expect(res.body.integrations).toHaveLength(0);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await t.request.get("/api/user/profile");
    expect(res.status).toBe(401);
  });
});

describe("integration repo-authors & emails", () => {
  let t: TestApp;
  let repoUrl: string;
  let localRepo: string;

  beforeAll(async () => {
    t = await setupTestApp();

    // A real local repo, cloned over file:// so no network is needed. Two
    // commits from alice, one from bob — exercises count aggregation/sort.
    localRepo = path.join(os.tmpdir(), `pokelog-authors-${Date.now()}`);
    await fs.mkdir(localRepo, { recursive: true });
    await exec("git", ["init", "--initial-branch=main"], { cwd: localRepo });
    await exec("git", ["config", "user.name", "Alice"], { cwd: localRepo });
    await exec("git", ["config", "user.email", "alice@example.com"], { cwd: localRepo });
    await fs.writeFile(path.join(localRepo, "a.txt"), "a\n");
    await exec("git", ["add", "."], { cwd: localRepo });
    await exec("git", ["commit", "-m", "c1"], { cwd: localRepo });
    await fs.writeFile(path.join(localRepo, "a.txt"), "aa\n");
    await exec("git", ["add", "."], { cwd: localRepo });
    await exec("git", ["commit", "-m", "c2"], { cwd: localRepo });
    await exec("git", ["config", "user.email", "bob@example.com"], { cwd: localRepo });
    await fs.writeFile(path.join(localRepo, "b.txt"), "b\n");
    await exec("git", ["add", "."], { cwd: localRepo });
    await exec("git", ["commit", "-m", "c3"], { cwd: localRepo });

    repoUrl = pathToFileURL(localRepo).href;
  });

  afterAll(async () => {
    t?.cleanup();
    await fs.rm(localRepo, { recursive: true, force: true });
  });

  it("POST /integrations/repo-authors with body config returns sorted emails", async () => {
    const { token } = await t.registerAndLogin("repoauthors", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations/repo-authors", {
      provider: "git",
      config: { repoUrl },
    });
    expect(res.status).toBe(200);
    const emails = res.body.emails as { email: string; count: number }[];
    expect(emails[0]).toEqual({ email: "alice@example.com", count: 2 });
    expect(emails).toContainEqual({ email: "bob@example.com", count: 1 });
  }, 30000);

  it("POST /integrations/repo-authors with {id} reuses stored config", async () => {
    const { token } = await t.registerAndLogin("repoauthorsid", "charmander");
    const api = t.authed(token);

    const created = await api.post("/api/user/integrations", {
      provider: "git",
      config: { repoUrl },
    });
    expect(created.status).toBe(201);
    const id = created.body.integration.id as string;

    const res = await api.post("/api/user/integrations/repo-authors", { id });
    expect(res.status).toBe(200);
    expect((res.body.emails as unknown[]).length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("POST /integrations/repo-authors 404 for unknown id", async () => {
    const { token } = await t.registerAndLogin("repoauthors404", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations/repo-authors", { id: "nope" });
    expect(res.status).toBe(404);
  });

  it("POST /integrations/repo-authors 400 on missing repoUrl", async () => {
    const { token } = await t.registerAndLogin("repoauthorsbad", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations/repo-authors", {
      provider: "git",
      config: {},
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /integrations/:id/emails updates only emails", async () => {
    const { token } = await t.registerAndLogin("emailsedit", "charmander");
    const api = t.authed(token);

    const created = await api.post("/api/user/integrations", {
      provider: "git",
      config: { repoUrl },
      emails: ["alice@example.com"],
    });
    const id = created.body.integration.id as string;
    const before = created.body.integration.config.repoUrl as string;

    const res = await t.request
      .patch(`/api/user/integrations/${id}/emails`)
      .set("Authorization", `Bearer ${token}`)
      .send({ emails: ["bob@example.com"] });
    expect(res.status).toBe(200);
    expect(res.body.integration.emails).toEqual(["bob@example.com"]);
    // repoUrl (and all non-email fields) must be untouched
    expect(res.body.integration.config.repoUrl).toBe(before);
  });

  it("PATCH /integrations/:id/emails 404 for unknown id", async () => {
    const { token } = await t.registerAndLogin("emailsedit404", "charmander");
    const res = await t.request
      .patch("/api/user/integrations/nope/emails")
      .set("Authorization", `Bearer ${token}`)
      .send({ emails: [] });
    expect(res.status).toBe(404);
  });
});
