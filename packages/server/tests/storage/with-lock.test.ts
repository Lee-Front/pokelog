import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PvpStoreModule = typeof import("../../src/storage/pvp-store.js");

let tmpDir: string;
let store: PvpStoreModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-with-lock-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  store = await import("../../src/storage/pvp-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("withLock (in-process + cross-process layering)", () => {
  it("serializes same-key work; no interleaving", async () => {
    const order: string[] = [];
    const run = (tag: string) =>
      store.withLock("k", async () => {
        order.push(`${tag}:enter`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`${tag}:exit`);
      });

    await Promise.all([run("A"), run("B"), run("C")]);

    // Each critical section runs atomically (enter immediately followed by exit).
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].endsWith(":enter")).toBe(true);
      expect(order[i + 1]).toBe(order[i].replace(":enter", ":exit"));
    }
  });

  it("runs different keys concurrently (no false serialization)", async () => {
    let bStarted = false;
    let aObservedBStart = false;
    const a = store.withLock("key-a", async () => {
      await new Promise((r) => setTimeout(r, 40));
      aObservedBStart = bStarted; // b should have started during a's sleep
    });
    const b = store.withLock("key-b", async () => {
      bStarted = true;
    });
    await Promise.all([a, b]);
    expect(aObservedBStart).toBe(true);
  });

  it("returns the fn result", async () => {
    await expect(store.withLock("k", async () => 42)).resolves.toBe(42);
  });

  it("propagates fn errors and does not wedge the key for later callers", async () => {
    await expect(
      store.withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Key must be usable again after a throw.
    await expect(store.withLock("k", async () => "ok")).resolves.toBe("ok");
  });

  it("is reentrant for the SAME key within one flow (no self-deadlock)", async () => {
    const result = await store.withLock("user:x", async () => {
      // Re-entering the same key from inside must not deadlock; it runs inline.
      const inner = await store.withLock("user:x", async () => "inner");
      return `outer+${inner}`;
    });
    expect(result).toBe("outer+inner");
  });

  it("allows nested locks on DIFFERENT keys within one flow", async () => {
    const result = await store.withLock("user:x", async () =>
      store.withLock("match:y", async () => "nested"),
    );
    expect(result).toBe("nested");
  });

  it("consistent global ordering of two keys avoids cross-key deadlock", async () => {
    // Two flows each need both a and b. If they acquired in opposite order they
    // could deadlock; acquiring in a fixed sorted order must let both complete.
    const twoKeys = (first: string, second: string, body: () => Promise<void>) => {
      const [x, y] = [first, second].sort();
      return store.withLock(`user:${x}`, () => store.withLock(`user:${y}`, body));
    };
    let ran = 0;
    await Promise.all([
      twoKeys("a", "b", async () => {
        await new Promise((r) => setTimeout(r, 20));
        ran++;
      }),
      twoKeys("b", "a", async () => {
        await new Promise((r) => setTimeout(r, 20));
        ran++;
      }),
    ]);
    expect(ran).toBe(2);
  });
});
