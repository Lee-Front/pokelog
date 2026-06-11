import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readJson, writeJson } from "../../src/storage/json-store.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("json-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("writes and reads JSON file", async () => {
    const filePath = path.join(tmpDir, "test.json");
    const data = { hello: "world", num: 42 };
    await writeJson(filePath, data);
    const result = await readJson(filePath);
    expect(result).toEqual(data);
  });

  it("returns null for non-existent file", async () => {
    const result = await readJson(path.join(tmpDir, "nope.json"));
    expect(result).toBeNull();
  });

  it("creates parent directories if needed", async () => {
    const filePath = path.join(tmpDir, "sub", "dir", "test.json");
    await writeJson(filePath, { ok: true });
    const result = await readJson(filePath);
    expect(result).toEqual({ ok: true });
  });

  it("retries the atomic rename on transient EPERM and still persists", async () => {
    const filePath = path.join(tmpDir, "retry.json");
    const realRename = fsp.rename.bind(fsp);
    let calls = 0;
    const spy = vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      calls += 1;
      if (calls <= 2) {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return realRename(from as string, to as string);
    });

    await writeJson(filePath, { retried: true });
    expect(calls).toBe(3); // two failures + one success
    expect(await readJson(filePath)).toEqual({ retried: true });
    spy.mockRestore();
  });

  it("gives up and cleans up the temp file after persistent EPERM", async () => {
    const filePath = path.join(tmpDir, "fail.json");
    vi.spyOn(fsp, "rename").mockImplementation(async () => {
      const err = new Error("EPERM") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });

    await expect(writeJson(filePath, { nope: true })).rejects.toMatchObject({
      code: "EPERM",
    });
    // No orphaned *.tmp files left behind.
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("serializes concurrent writes to the same path without corruption", async () => {
    const filePath = path.join(tmpDir, "concurrent.json");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeJson(filePath, { n: i })),
    );
    const result = (await readJson(filePath)) as { n: number };
    expect(result).toHaveProperty("n");
    expect(result.n).toBeGreaterThanOrEqual(0);
    expect(result.n).toBeLessThan(20);
  });
});
