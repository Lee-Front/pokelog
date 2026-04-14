# Test Infrastructure Overview

Date: 2026-04-14

## Purpose

이 문서는 pokelog 프로젝트의 테스트 인프라를 리뷰하기 위한 가이드입니다.
리뷰어는 이 문서를 읽고 관련 파일을 확인한 뒤 구조적 문제를 지적해주세요.

## 프로젝트 구조

```
pokelog/                         (monorepo)
├── shared/types.ts              (공유 타입 정의)
├── packages/server/             (Express API 서버)
│   └── src/
│       ├── app.ts               (Express 앱 팩토리)
│       ├── auth/auth.ts         (JWT 인증, process.exit 포함)
│       ├── paths.ts             (DATA_DIR, getDataDir)
│       ├── game/                (게임 로직 — 순수 함수)
│       ├── storage/             (JSON 파일 기반 저장소)
│       └── routes/              (Express 라우트)
├── packages/cli/                (터미널 CLI 클라이언트)
│   └── src/
│       ├── commands/            (커맨드 — UI + 로직 혼합)
│       ├── logic/               (순수 로직 분리 모듈)
│       └── ui/                  (raw-mode 터미널 유틸)
└── data/                        (PokeAPI 동기화 데이터 — git 추적)
```

## 테스트 파일 구조

```
packages/server/
  vitest.config.ts               ← vitest 설정 (globalSetup, 병렬 비활성화)
  tests/
    global-setup.ts              ← 환경변수 부트스트랩 (JWT_SECRET)
    api/                         ← API 통합 테스트 (supertest)
      test-helpers.ts            ← setupTestApp: 격리 데이터, 인증 헬퍼
      auth-game-flow.test.ts     ← 인증, 파티, 도감, 힐, 리전 (14개)
      shop-items.test.ts         ← 상점, 구매, 사용, 장착 (7개)
      trade-flow.test.ts         ← 교환 전체 플로우 (6개)
    qa/                          ← 문서 기반 QA 테스트
      data-integrity.test.ts     ← 데이터 파일 스키마/참조 무결성 (10개)
      schema-alignment.test.ts   ← 런타임 생성자 vs types.ts (4개)
      game-mechanics.test.ts     ← 문서화된 게임 규칙 검증 (12개)
      cross-system.test.ts       ← 시스템 간 참조 일관성 (5개)
      api-contract.test.ts       ← API 응답 형태 계약 (5개)
    game/                        ← 게임 로직 단위 테스트
      battle.test.ts             ← 데미지 공식, 턴 순서, priority (16개)
      growth.test.ts             ← 레벨업, 진화, 스탯계산, nature (33개)
      trade.test.ts              ← 교환 요청/수락/거절/취소 (7개)
      pokemon-factory.test.ts    ← 포켓몬 생성 구조 검증 (7개)
      egg-gacha.test.ts          ← 알 티어/풀/부화 (4개)
      capture.test.ts            ← 포획 확률 (8개)
      ... (그 외 10개 파일)
    storage/                     ← 저장소 레이어 테스트 (3개 파일)

packages/cli/
  tests/logic/
    formatters.test.ts           ← 공유 포맷터 순수 함수 (26개)
    trade.test.ts                ← 교환 UI 로직 순수 함수 (18개)

총: 39개 파일, 299개 테스트
```

## 핵심 설계 결정

### 1. 데이터 격리 방식
- `process.env.POKELOG_DATA_DIR`로 임시 디렉토리 지정
- `paths.ts`의 `getDataDir()`가 호출 시점에 환경변수 평가
- 모든 스토리지 모듈이 `getDataDir()` 함수 사용 (상수 아님)
- `fileParallelism: false`로 환경변수 경쟁 방지

### 2. 인증 처리
- `auth.ts`가 모듈 로드 시 `POKELOG_JWT_SECRET` 없으면 `process.exit(1)`
- `global-setup.ts`에서 모든 테스트 전에 환경변수 설정
- `test-helpers.ts`에서 `vi.resetModules()` 후 동적 import

### 3. API 통합 테스트 패턴
- `setupTestApp()`: 임시 데이터 디렉토리 + config.json 생성 + supertest 래핑
- `registerAndLogin()`: 유저 생성 + 토큰 반환
- `authed(token)`: 인증 헤더 자동 부착 헬퍼
- `cleanup()`: 임시 디렉토리 삭제 + env var 정리
- `afterAll`에서 `t?.cleanup()` (크래시 방어)

### 4. CLI 테스트 전략
- 커맨드에서 순수 로직을 `src/logic/`로 추출
- 추출된 순수 함수만 단위 테스트 (I/O 레이어는 테스트 안 함)
- `formatters.ts`: HP/PP 색상, 스크롤 클램핑, 시간 포맷, 교환 분류
- `trade.ts`: 메뉴 구성, 액션 판별, 선택 파싱

### 5. QA 테스트 전략
- 설계 문서(docs/)를 기준으로 "문서가 말하는 것 vs 실제 구현" 검증
- 데이터 파일의 스키마 정합성, 참조 무결성
- 런타임 생성자가 types.ts 타입 정의와 일치하는지
- 게임 메카닉이 문서화된 규칙대로 동작하는지

## 리뷰 시 확인할 파일

**인프라 코어 (필수 확인):**
- `packages/server/vitest.config.ts`
- `packages/server/tests/global-setup.ts`
- `packages/server/tests/api/test-helpers.ts`
- `packages/server/src/paths.ts`
- `packages/server/src/auth/auth.ts`

**테스트 패턴 (대표 파일 확인):**
- `packages/server/tests/api/auth-game-flow.test.ts` (API 통합 패턴)
- `packages/server/tests/qa/data-integrity.test.ts` (QA 패턴)
- `packages/server/tests/game/growth.test.ts` (단위 테스트 패턴)
- `packages/cli/tests/logic/formatters.test.ts` (CLI 패턴)

**소스 코드 (테스트 대상 이해):**
- `packages/server/src/app.ts`
- `packages/server/src/storage/user-store.ts` (앞 40줄)
- `packages/server/src/storage/config-store.ts` (앞 10줄 + 98~142줄)
- `packages/server/src/game/pokemon-factory.ts`

## 이전 리뷰에서 발견/수정된 사항

| 문제 | 상태 |
|------|------|
| DATA_DIR 모듈 로드 시 고정 | ✅ getDataDir() 함수로 전환 |
| JWT_SECRET import 순서 의존 | ✅ globalSetup으로 이관 |
| afterAll 크래시 시 TypeError | ✅ t?.cleanup() 방어 |
| ESM 모듈 캐시 누수 | ✅ vi.resetModules() 추가 |
| mock 미복원 위험 | ✅ afterEach 훅으로 이동 |
| 기만적 테스트명 | ✅ 이름 수정 |
| 무의미한 단언 | ✅ 정확한 값으로 교체 |
| 상점 성공 경로 미테스트 | ✅ 포션 사용/장착 테스트 추가 |
| 힐 테스트 실질 검증 없음 | ✅ HP 손상 후 회복 검증 |
| 종 이름 alias 미해석 (런타임 버그) | ✅ data-loader에 alias fallback |
| 문서 간 모순 (variant egg) | ✅ variant-model.md 수정 |

## 리뷰 관점 제안

1. **구조적 취약점** — 현재 설계가 깨질 수 있는 시나리오는?
2. **누락된 테스트 범주** — 어떤 종류의 테스트가 없는가?
3. **확장성** — 기능이 늘어날 때 테스트 추가가 용이한가?
4. **신뢰도** — 테스트가 통과했을 때 진짜 안심할 수 있는가?
5. **개발자 경험** — 새 기능 추가 시 테스트 작성이 직관적인가?
