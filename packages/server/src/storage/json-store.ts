import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { childLogger } from "../logger.js";

const log = childLogger("json-store");

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    log.error({ err, filePath }, "Failed to read JSON file");
    return null;
  }
}

/**
 * Transient errors that the atomic rename can hit on Windows when another
 * process (antivirus, search indexer) or a concurrent writer briefly holds a
 * handle on the temp or destination file. These resolve within a few ms.
 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

async function renameWithRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT_RENAME_CODES.has(code) || attempt >= maxAttempts) {
        throw err;
      }
      // Short escalating backoff: 5ms, 10ms, ... capped at 50ms.
      const delay = Math.min(5 * attempt, 50);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = filePath + "." + crypto.randomUUID() + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    await renameWithRetry(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of the orphaned temp file before surfacing.
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
