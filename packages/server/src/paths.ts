import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (pokelog/) — works regardless of cwd */
export const PROJECT_ROOT = path.resolve(__dirname, "../../..");

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

/** @deprecated Use getDataDir() — 하위 호환용, 모듈 로드 시점에 고정됨 */
export const DATA_DIR = getDataDir();
