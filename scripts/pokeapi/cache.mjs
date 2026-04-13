import path from "node:path";
import { CACHE_ROOT, ensureDir, readJsonFile, writeJsonFile } from "./common.mjs";

function sanitizePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function getCachePath(...parts) {
  const safeParts = parts.map(sanitizePart);
  return path.join(CACHE_ROOT, ...safeParts);
}

export async function readCache(...parts) {
  return readJsonFile(getCachePath(...parts), null);
}

export async function writeCache(parts, data) {
  const filePath = getCachePath(...parts);
  await ensureDir(path.dirname(filePath));
  await writeJsonFile(filePath, data);
}
