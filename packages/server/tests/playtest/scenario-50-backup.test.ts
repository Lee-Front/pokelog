/**
 * Scenario 50 — Backup / Recovery.
 *
 * The user-store treats malformed JSON as "user not found" rather than
 * crashing (json-store.readJson swallows JSON.parse errors). This
 * scenario walks through:
 *
 *   1. Create a user, persist, snapshot the on-disk JSON.
 *   2. Corrupt the user file (write garbage). Verify subsequent profile
 *      reads return 404 (not 500).
 *   3. Restore the file from the snapshot. Verify state recovers and
 *      profile reads succeed again.
 *   4. Create user, delete file entirely. Verify 404 on profile.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import fs from "node:fs/promises";
import path from "node:path";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";

describe("Scenario 50 — Backup / Recovery", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("corrupted user JSON: profile read fails gracefully (no 500)", async () => {
    const { user, token } = await createTestUser({
      uid: "backupCorrupt",
      initialPokemon: [{ species: "pikachu", level: 30 }],
    });
    const http = new HttpClient(ctx.app, token);

    // Healthy profile read first.
    const before = await http.get("/api/user/profile");
    expect(before.status).toBe(200);

    // Snapshot then corrupt.
    const userFile = path.join(ctx.dataDir, "users", `${user.account.id}.json`);
    const snapshot = await fs.readFile(userFile, "utf-8");
    await fs.writeFile(userFile, "{ this is :: not !! json", "utf-8");

    const corruptRes = await http.get("/api/user/profile");
    // Server returns 404 (user not found) after readJson catches parse error.
    // We only insist that it's NOT a 500 — graceful degradation.
    expect(corruptRes.status).not.toBe(500);
    expect(corruptRes.status).toBeGreaterThanOrEqual(400);

    // Restore from snapshot.
    await fs.writeFile(userFile, snapshot, "utf-8");

    const after = await http.get("/api/user/profile");
    expect(after.status).toBe(200);
    expect(after.body.account?.id).toBe(user.account.id);
    expect(after.body.pokemon).toHaveLength(1);
  });

  it("missing user JSON returns 404, not 500", async () => {
    const { user, token } = await createTestUser({
      uid: "backupDeleted",
      initialPokemon: [{ species: "rattata", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);

    // Sanity: user exists.
    const before = await http.get("/api/user/profile");
    expect(before.status).toBe(200);

    // Delete the user file.
    const userFile = path.join(ctx.dataDir, "users", `${user.account.id}.json`);
    await fs.unlink(userFile);

    const after = await http.get("/api/user/profile");
    expect(after.status).toBe(404);
  });

  it("snapshot/restore preserves arbitrary state including pokemon and points", async () => {
    const { user, token } = await createTestUser({
      uid: "backupState",
      initialPoints: 12345,
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "charizard", level: 50 },
      ],
    });
    const http = new HttpClient(ctx.app, token);

    const userFile = path.join(ctx.dataDir, "users", `${user.account.id}.json`);
    const snapshot = await fs.readFile(userFile, "utf-8");

    // Mutate state — delete file then restore.
    await fs.unlink(userFile);
    await expect(http.get("/api/user/profile")).resolves.toMatchObject({ status: 404 });

    await fs.writeFile(userFile, snapshot, "utf-8");

    const restored = await http.get("/api/user/profile");
    expect(restored.status).toBe(200);
    expect(restored.body.points).toBe(12345);
    expect(restored.body.pokemon).toHaveLength(2);
    expect(restored.body.pokemon.map((p: { species: string }) => p.species).sort()).toEqual([
      "charizard", "pikachu",
    ]);
  });

  it("partial corruption (truncated file) treated as not-found rather than 500", async () => {
    const { user, token } = await createTestUser({
      uid: "backupTrunc",
      initialPokemon: [{ species: "magikarp", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);

    const userFile = path.join(ctx.dataDir, "users", `${user.account.id}.json`);
    const snapshot = await fs.readFile(userFile, "utf-8");

    // Truncate to first 50 bytes — invalid JSON.
    await fs.writeFile(userFile, snapshot.slice(0, 50), "utf-8");

    const res = await http.get("/api/user/profile");
    expect(res.status).not.toBe(500);

    await fs.writeFile(userFile, snapshot, "utf-8");
    const recovered = await http.get("/api/user/profile");
    expect(recovered.status).toBe(200);
  });
});
