/**
 * Vitest 글로벌 setup — 모든 테스트 파일보다 먼저 실행됨.
 *
 * 환경변수를 여기서 한 번 설정하면 auth.ts의 process.exit(1)을
 * 어떤 import 순서에서도 안전하게 방어할 수 있음.
 */
export function setup() {
  process.env.POKELOG_JWT_SECRET ??= "vitest-global-secret";
}
