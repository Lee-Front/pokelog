import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    console.error(`Failed to read ${filePath}:`, err);
    return null;
  }
}

/**
 * Codes that indicate a transient rename failure on Windows. The OS
 * grants exclusive access to the destination during a rename, so a
 * concurrent rename against the same destination can fail even when
 * both source files exist. Linux and macOS rename(2) is atomic for
 * overwriting an existing file and never produces these.
 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_BASE_MS = 10;

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt < RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      const isLast = attempt === RENAME_RETRY_ATTEMPTS - 1;
      if (isLast || !TRANSIENT_RENAME_CODES.has(code)) throw err;
      // Exponential backoff with jitter: 10, 20, 40, 80 ms (+ up to 5 ms jitter)
      const delay = RENAME_RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 5);
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
    // Best-effort cleanup of the orphaned tmp file. Swallow secondary
    // errors so the caller still sees the original rename failure.
    fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
