import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LockModule = typeof import("../../src/storage/xproc-lock.js");

let tmpDir: string;
let lock: LockModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-xproc-lock-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  lock = await import("../../src/storage/xproc-lock.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("xproc-lock primitive", () => {
  it("acquire creates a lock dir with diagnostics; release removes it", async () => {
    const dir = await lock.acquireProcessLock("user:ash");
    expect(fs.existsSync(dir)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8"));
    expect(meta.pid).toBe(process.pid);
    expect(meta.key).toBe("user:ash");
    expect(typeof meta.at).toBe("string");

    await lock.releaseProcessLock(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("lock dirs live under .locks and distinct keys never collide", () => {
    const root = lock.locksRoot();
    expect(root).toBe(path.join(tmpDir, ".locks"));
    // Keys that sanitize to the same safe name still map to different dirs
    // because of the appended key hash.
    expect(lock.lockDirFor("user:a/b")).not.toBe(lock.lockDirFor("user:a_b"));
    expect(lock.lockDirFor("world-boss")).toBe(lock.lockDirFor("world-boss"));
  });

  it("serializes two concurrent acquisitions of the same key (mutual exclusion)", async () => {
    const order: string[] = [];
    const run = (tag: string) =>
      lock.withProcessLock("user:same", async () => {
        order.push(`${tag}:enter`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`${tag}:exit`);
      });

    await Promise.all([run("A"), run("B")]);

    // Whichever ran first, its enter/exit must not be interleaved by the other.
    const first = order[0].split(":")[0];
    const second = first === "A" ? "B" : "A";
    expect(order).toEqual([`${first}:enter`, `${first}:exit`, `${second}:enter`, `${second}:exit`]);
  });

  it("does NOT block acquisitions of different keys", async () => {
    let bRan = false;
    await lock.withProcessLock("user:one", async () => {
      // A different key must be acquirable while we hold this one.
      await lock.withProcessLock("user:two", async () => {
        bRan = true;
      });
    });
    expect(bRan).toBe(true);
  });

  it("releases the lock even when fn throws (and propagates the error)", async () => {
    const dir = lock.lockDirFor("user:boom");
    await expect(
      lock.withProcessLock("user:boom", async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    // Lock dir must be gone so the next acquire can win immediately.
    expect(fs.existsSync(dir)).toBe(false);
    // Sanity: acquirable again right away.
    const dir2 = await lock.acquireProcessLock("user:boom", { timeoutMs: 500 });
    await lock.releaseProcessLock(dir2);
  });

  it("throws (does not hang) when the lock can't be acquired within the timeout", async () => {
    const held = await lock.acquireProcessLock("user:wedged");
    try {
      const start = Date.now();
      await expect(
        lock.acquireProcessLock("user:wedged", { timeoutMs: 200, staleMs: 60_000 }),
      ).rejects.toThrow(/Timed out .* acquiring cross-process lock 'user:wedged'/);
      // Bounded — should give up close to the timeout, not hang.
      expect(Date.now() - start).toBeLessThan(2000);
    } finally {
      await lock.releaseProcessLock(held);
    }
  });

  it("steals a stale lock (crashed holder) and lets a new acquirer win", async () => {
    // Simulate a crashed holder: create the lock dir directly and backdate it
    // beyond the stale threshold, leaving no releaser.
    const dir = lock.lockDirFor("user:crashed");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify({ pid: 999999, host: "dead", at: "old", key: "user:crashed" }));
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(dir, old, old);

    // With a small stale threshold the abandoned lock is stolen and we acquire.
    const acquired = await lock.acquireProcessLock("user:crashed", { staleMs: 1000, timeoutMs: 3000 });
    expect(fs.existsSync(acquired)).toBe(true);
    // Fresh diagnostics from us (not the dead holder).
    const meta = JSON.parse(fs.readFileSync(path.join(acquired, "meta.json"), "utf-8"));
    expect(meta.pid).toBe(process.pid);
    await lock.releaseProcessLock(acquired);
  });

  it("excludes a FRESH (non-stale) held lock from stealing", async () => {
    const held = await lock.acquireProcessLock("user:fresh");
    try {
      // A large stale threshold means the just-taken lock is NOT stolen, so a
      // short-timeout acquire must fail rather than steal.
      await expect(
        lock.acquireProcessLock("user:fresh", { timeoutMs: 150, staleMs: 60_000 }),
      ).rejects.toThrow(/Timed out/);
    } finally {
      await lock.releaseProcessLock(held);
    }
  });

  it("provides mutual exclusion against a SEPARATE node process on the same lock dir", async () => {
    // Real cross-process test: hold the lock here, then spawn a child node that
    // tries to acquire the SAME key against the SAME data dir. It must fail to
    // acquire while we hold it, then succeed once we release.
    const key = "user:crossproc";
    const held = await lock.acquireProcessLock(key);

    const childResultWhileHeld = await runChildAcquire(key, tmpDir, 400);
    expect(childResultWhileHeld.acquired).toBe(false); // blocked by our hold

    await lock.releaseProcessLock(held);

    const childResultAfterRelease = await runChildAcquire(key, tmpDir, 3000);
    expect(childResultAfterRelease.acquired).toBe(true); // now free
  }, 20000);
});

/**
 * Spawn a child `node` process that imports the compiled-on-the-fly lock module
 * (via tsx) and tries to acquire `key` against `dataDir` with the given timeout.
 * Returns whether it acquired. The child is fully independent (separate pid), so
 * this exercises the cross-process guarantee, not just in-process async flows.
 */
function runChildAcquire(
  key: string,
  dataDir: string,
  timeoutMs: number,
): Promise<{ acquired: boolean }> {
  const modUrl = new URL("../../src/storage/xproc-lock.ts", `file://${__dirname}/`).href;
  const script = `
    (async () => {
      const { acquireProcessLock, releaseProcessLock } = await import(${JSON.stringify(modUrl)});
      try {
        const dir = await acquireProcessLock(${JSON.stringify(key)}, { timeoutMs: ${timeoutMs}, staleMs: 600000 });
        await releaseProcessLock(dir);
        console.log("ACQUIRED");
      } catch {
        console.log("TIMEOUT");
      }
    })();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, POKELOG_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve({ acquired: out.includes("ACQUIRED") }));
  });
}
