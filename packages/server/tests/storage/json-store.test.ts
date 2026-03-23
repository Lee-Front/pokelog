import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readJson, writeJson } from "../../src/storage/json-store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("json-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-test-"));
  });

  afterEach(() => {
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
});
