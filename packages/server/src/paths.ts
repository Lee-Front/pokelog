import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the project root (the directory holding `data/`, `pokelog-data/`,
 * and the monorepo `package.json`).
 *
 * The compiled layout nests deeper than the source layout: tsc emits with
 * `rootDir` at the monorepo root, so `paths.js` lands at
 * `packages/server/dist/packages/server/src/paths.js` (two extra segments)
 * while the source sits at `packages/server/src/paths.ts`. A fixed
 * `resolve(__dirname, "../../..")` is therefore correct for `tsx src` but points
 * at `packages/server/dist` for a production `node dist/...` start, breaking all
 * `data/` loads (species.json etc.).
 *
 * Instead we walk up from this module's directory until we find the directory
 * that actually contains `data/`, which is robust to both layouts (and any
 * future nesting). `POKELOG_PROJECT_ROOT` overrides the search for unusual
 * deployments where assets live elsewhere.
 */
export function resolveProjectRoot(
  startDir: string = __dirname,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.POKELOG_PROJECT_ROOT;
  if (override) return path.resolve(override);

  let dir = startDir;
  // Walk up to the filesystem root looking for a directory containing `data/`.
  while (true) {
    if (fs.existsSync(path.join(dir, "data"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Fallback: the historical dev-layout assumption. Keeps behaviour sane even
  // if `data/` is somehow absent (e.g. partial checkout) rather than throwing
  // at import time.
  return path.resolve(startDir, "../../..");
}

/** Project root (pokelog/) — works regardless of cwd or dev/dist layout */
export const PROJECT_ROOT = resolveProjectRoot();

/** Resolve a path relative to the project root */
export function projectPath(...segments: string[]): string {
  return path.resolve(PROJECT_ROOT, ...segments);
}

/** pokelog-data directory — 호출 시점에 환경변수를 평가하여 테스트 격리 가능 */
export function getDataDir(): string {
  return process.env.POKELOG_DATA_DIR
    ? path.resolve(process.env.POKELOG_DATA_DIR)
    : path.join(PROJECT_ROOT, "pokelog-data");
}
