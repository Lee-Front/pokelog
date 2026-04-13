import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const CACHE_ROOT = path.join(REPO_ROOT, ".cache", "pokeapi");

export const LEARNSET_VERSION_GROUP_PRIORITY = [
  "sword-shield",
  "legends-arceus",
  "scarlet-violet",
  "ultra-sun-ultra-moon",
];

export function projectPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath, data) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function slugifyId(value) {
  return String(value).trim();
}

export function pickLocalizedName(names, fallback) {
  const localized = names?.find((entry) => entry.language?.name === "ko")
    ?? names?.find((entry) => entry.language?.name === "en");
  return localized?.name ?? fallback;
}

export function pickLocalizedFlavorText(entries, fallback = "") {
  const localized = entries?.find((entry) => entry.language?.name === "ko")
    ?? entries?.find((entry) => entry.language?.name === "en");

  return localized?.flavor_text?.replace(/\s+/g, " ").trim() ?? fallback;
}

export function mapStatName(name) {
  switch (name) {
    case "special-attack":
      return "spAttack";
    case "special-defense":
      return "spDefense";
    default:
      return name;
  }
}

export function mapNatureStat(name) {
  if (!name) return null;
  const mapped = mapStatName(name);
  if (mapped === "hp") return null;
  return mapped;
}

export function compareBySlot(left, right) {
  return (left.slot ?? 0) - (right.slot ?? 0);
}

export async function mapWithConcurrency(items, worker, concurrency = 10) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => runWorker()),
  );

  return results;
}
