import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (pokelog/) — works regardless of cwd */
export const PROJECT_ROOT = path.resolve(__dirname, "../../..");

/** Resolve a path relative to the project root */
export function projectPath(...segments: string[]): string {
  return path.resolve(PROJECT_ROOT, ...segments);
}

/** pokelog-data directory — always under project root */
export const DATA_DIR = process.env.POKELOG_DATA_DIR
  ? path.resolve(process.env.POKELOG_DATA_DIR)
  : path.join(PROJECT_ROOT, "pokelog-data");
