import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readJson, writeJson } from "../../src/storage/json-store.js";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
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

  it("retries rename on transient EPERM and eventually succeeds", async () => {
    const filePath = path.join(tmpDir, "retry.json");
    const realRename = fsPromises.rename.bind(fsPromises);
    let attempts = 0;
    const spy = vi.spyOn(fsPromises, "rename").mockImplementation(async (src, dst) => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("EPERM: operation not permitted");
        (err as NodeJS.ErrnoException).code = "EPERM";
        throw err;
      }
      return realRename(src, dst);
    });

    await writeJson(filePath, { ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await readJson(filePath)).toEqual({ ok: true });
  });

  it("rethrows non-transient rename errors without retry", async () => {
    const filePath = path.join(tmpDir, "fatal.json");
    const spy = vi.spyOn(fsPromises, "rename").mockImplementation(async () => {
      const err = new Error("EROFS: read-only file system");
      (err as NodeJS.ErrnoException).code = "EROFS";
      throw err;
    });

    await expect(writeJson(filePath, { ok: true })).rejects.toThrow("EROFS");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
