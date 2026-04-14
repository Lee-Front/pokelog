import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 글로벌 setup — 환경변수 설정, 모든 테스트보다 먼저 실행
    globalSetup: "./tests/global-setup.ts",
    // 테스트 타임아웃 (API 통합 테스트가 느릴 수 있음)
    testTimeout: 15000,
    // 파일 간 병렬 실행 비활성화 — process.env 공유 문제 방지
    fileParallelism: false,
  },
});
