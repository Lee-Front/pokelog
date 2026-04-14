# Test Infrastructure Review

Date: 2026-04-14
Related: `docs/test-infrastructure-overview.md`

## Summary

- 현재 테스트 인프라는 동작한다.
- 2026-04-14 기준으로 실제 실행 검증 결과는 다음과 같다.
- `npm run test -w packages/server`: 30 files, 200 tests, all passed
- `npm run test -w packages/cli`: 2 files, 44 tests, all passed
- 총합은 문서에 적힌 것과 동일하게 32 files, 244 tests다.

즉, 지금 상태는 "테스트가 없는 프로젝트"는 아니다. 서버 쪽은 unit, API integration, QA 성격의 테스트가 적절히 분리되어 있고, CLI도 순수 로직은 잘 분리되어 있다. 다만 현재 인프라는 다음 두 가지 한계를 갖고 있다.

- 실제 사용자 경로 전체를 검증하지는 못한다.
- 전역 환경 변수와 파일 기반 저장 구조에 테스트가 다소 강하게 결합되어 있다.

이 문서는 공유용 리뷰 정리본이며, 개선 우선순위와 실행 순서를 함께 제안한다.

## What Works Well

- 서버 테스트 레이어가 분리되어 있다.
- `tests/game`: 순수 게임 로직 검증
- `tests/api`: `supertest` 기반 API 흐름 검증
- `tests/qa`: 문서/데이터/계약 정합성 검증
- CLI는 `src/logic`로 순수 로직을 분리해서 테스트 가능한 구조를 만들었다.
- API 테스트용 임시 data dir를 만들고 정리하는 패턴이 정착되어 있다.
- `docs/test-infrastructure-overview.md`에 적힌 총 테스트 파일 수와 테스트 개수는 실제 실행 결과와 일치한다.

## Main Findings

### 1. High: 실제 공개 API 표면 대비 테스트 범위가 비어 있는 구간이 있다

`packages/server/src/app.ts:49-55` 기준으로 현재 서버는 다음 라우트를 외부에 노출한다.

- `/api/auth`
- `/api/user`
- `/api/game`
- `/api/shop`
- `/api/battle`
- `/api/social`
- `/api/admin`

하지만 현재 API 통합 테스트는 사실상 `auth/game/shop/trade` 중심이다. 아래 영역은 실제 코드 규모와 중요도에 비해 테스트가 거의 없거나 없다.

- `packages/server/src/routes/user-routes.ts:31-365`
- `packages/server/src/routes/social-routes.ts:6-67`
- `packages/server/src/routes/admin-routes.ts:33-383`

영향:

- 사용자 프로필, 검색, 연동 관리, 공개 랭킹, 관리자 설정 변경 같은 경로에서 회귀가 나도 현재 스위트가 놓칠 수 있다.
- 특히 `/api/admin`은 테스트 편의용 엔드포인트까지 포함하고 있어, 여기가 깨지면 다른 테스트 전략까지 같이 약해진다.

### 2. High: API 통합 테스트가 저장 포맷을 직접 건드려 블랙박스 테스트가 아니다

예를 들어 아래 테스트들은 user JSON 파일을 직접 수정한다.

- `packages/server/tests/api/shop-items.test.ts:43-47`
- `packages/server/tests/api/shop-items.test.ts:93-108`
- `packages/server/tests/api/shop-items.test.ts:127-131`
- `packages/server/tests/api/auth-game-flow.test.ts` 안의 HP 직접 수정 구간

반면 서버에는 이미 테스트 편의를 위한 관리자 엔드포인트가 있다.

- `packages/server/src/routes/admin-routes.ts:161-383`

영향:

- API 테스트가 실제 API 계약보다 저장소 내부 포맷에 더 강하게 묶인다.
- 저장 포맷을 리팩터링할 때 기능은 멀쩡한데 테스트만 대량 수정해야 할 수 있다.
- 미들웨어, 검증, 캐시 경계를 우회하므로 "실제 사용자 경로가 괜찮은지"를 덜 정확하게 말해준다.

### 3. Medium: 서버 테스트가 전역 상태에 기대고 있어 병렬화와 확장성이 막혀 있다

관련 근거:

- `packages/server/vitest.config.ts:9-12`
- `packages/server/tests/api/test-helpers.ts:35-40`
- `packages/server/src/paths.ts`

현재 구조는 `process.env.POKELOG_DATA_DIR`를 바꾸고, 모듈 캐시를 `vi.resetModules()`로 날린 뒤, 다시 import해서 격리를 맞춘다. 이 구조 때문에 `fileParallelism: false`가 강제되어 있다.

영향:

- 새 테스트 파일이 이 패턴을 하나라도 놓치면 테스트 오염이 발생할 수 있다.
- 테스트 파일 수가 늘수록 실행 시간이 선형으로 늘어난다.
- 장기적으로는 테스트 인프라가 애플리케이션 구조 개선을 방해하는 방향으로 작동한다.

### 4. Medium: 인증 모듈이 import 시점에 프로세스를 종료한다

관련 근거:

- `packages/server/src/auth/auth.ts:4-8`
- `packages/server/tests/global-setup.ts:6-7`

현재는 `POKELOG_JWT_SECRET`가 없으면 `auth.ts`가 import 시점에 `process.exit(1)` 한다. Vitest에서는 global setup으로 간신히 방어하고 있지만, 이 패턴은 테스트 러너 친화적이지 않다.

영향:

- 테스트 실패 대신 프로세스 종료로 보일 수 있다.
- IDE test explorer, 다른 러너, 일부 리팩터링 상황에서 디버깅이 어려워진다.
- 환경 변수 로딩 순서에 대한 숨은 결합이 생긴다.

### 5. Medium: 저장소 내부 기준으로는 CI/coverage gate가 보이지 않는다

관련 근거:

- 루트 스크립트: `package.json:13-16`
- 서버 스크립트: `packages/server/package.json:6-10`
- CLI 스크립트: `packages/cli/package.json:10-13`
- 리뷰 시점에 `.github/workflows` 디렉터리는 저장소 내에서 확인되지 않았다.

영향:

- 로컬에서만 초록이고 PR 단계에서 자동 검증이 빠질 수 있다.
- coverage 기준이 없어서 테스트 숫자는 늘어도 중요한 코드가 비어 있는 상태를 방치할 수 있다.

### 6. Medium-low: CLI는 순수 로직만 검증하고, 실제 command/UI 계층은 거의 비어 있다

현재 CLI 테스트는 다음에 집중되어 있다.

- `packages/cli/tests/logic/formatters.test.ts`
- `packages/cli/tests/logic/trade.test.ts`

반면 실제 사용자 상호작용이 몰려 있는 영역은 별도 자동 검증이 거의 없다.

- `packages/cli/src/commands/*`
- `packages/cli/src/ui/*`

영향:

- raw-mode 정리 누락
- `process.exit` 경로
- 키 입력 처리
- API 응답을 CLI 텍스트로 렌더링하는 최종 경로

같은 사용자 체감 버그가 테스트 없이 남을 수 있다.

## Recommended Improvement Plan

### Phase 1. Quick Wins

목표:

- 현재 구조를 크게 흔들지 않고 빈 커버리지를 메운다.
- 파일 직접 수정 기반 테스트를 API 기반 테스트로 바꾼다.

작업:

- `packages/server/tests/global-setup.ts` 또는 `test-helpers.ts`에서 `POKELOG_ADMIN_KEY`를 테스트 전용 값으로 세팅한다.
- `setupTestApp()`에 `admin()` 헬퍼를 추가해서 `x-admin-key` 헤더를 붙인 요청을 쉽게 만든다.
- 현재 JSON 파일을 직접 고치는 API 테스트를 다음 관리자 테스트 API로 치환한다.
- `/api/admin/test/give-points`
- `/api/admin/test/give-item`
- `/api/admin/test/give-pokemon`
- `/api/admin/test/encounter`
- `/api/admin/test/clear-battle`
- `/api/user` 최소 smoke test를 추가한다.
- 프로필 조회
- 검색
- 닉네임 변경
- match/unmatch
- integration create/list/delete
- `/api/social` 최소 smoke test를 추가한다.
- ranking 정렬
- profile 조회
- 없는 사용자 404
- `/api/admin` 최소 smoke test를 추가한다.
- admin key 없음 503
- 잘못된 admin key 403
- config 조회/수정
- repo 추가/목록/삭제

완료 기준:

- 저장 파일을 직접 수정하는 API 테스트가 없어지거나 최소화된다.
- `user`, `social`, `admin` 라우트에 대해 최소 happy path와 auth/error path가 생긴다.

예상 효과:

- 리뷰에서 가장 큰 리스크였던 "테스트가 안 닿는 공개 API" 문제를 가장 빨리 줄일 수 있다.

### Phase 2. Structural Hardening

목표:

- 전역 env와 import 순서에 대한 결합을 줄인다.
- 병렬 실행 가능성을 열어 둔다.

작업:

- `auth.ts`에서 import 시점 `process.exit(1)`를 제거한다.
- 대안 1: 앱 시작 시점에 명시적으로 env를 검증한다.
- 대안 2: secret을 함수나 app factory에 주입한다.
- `getDataDir()` 중심 구조를 한 단계 더 밀어, 가능하면 store/app 생성 시 `dataDir`를 주입하도록 바꾼다.
- `setupTestApp()`이 전역 env를 덜 건드리도록 app factory를 정리한다.
- 구조 변경 후 `fileParallelism: false`를 제거할 수 있는지 별도 브랜치에서 검증한다.

완료 기준:

- 테스트가 env 변경과 `vi.resetModules()`에 덜 의존한다.
- 최소한 새 테스트를 추가할 때 "env 바꾸고 모듈 재import"를 반복하지 않아도 된다.

예상 효과:

- 테스트 추가 비용이 낮아지고, 장기적으로 실행 시간과 flaky 리스크를 줄일 수 있다.

### Phase 3. Automation and Metrics

목표:

- 로컬 성공을 팀 차원의 자동 검증으로 끌어올린다.

작업:

- 저장소 내부에 CI workflow를 추가한다.
- 추천 최소 단계: install, build, test
- 서버와 CLI 모두에 coverage 수집을 붙인다.
- 첫 1회는 baseline 측정만 하고, 그 결과를 문서화한다.
- baseline 확인 후 threshold를 정한다.
- 무작정 높은 숫자를 고정하지 말고, critical path 우선 기준으로 잡는다.
- 추천 우선 대상: auth, routes, game core, storage

완료 기준:

- PR 또는 main push 시 자동으로 build/test가 돌고 실패를 막는다.
- coverage가 가시화되고, 최소한 "비어 있는 영역"이 어디인지 숫자로 확인 가능하다.

예상 효과:

- 테스트 숫자보다 중요한 "무엇이 빠졌는가"를 관리할 수 있게 된다.

### Phase 4. CLI Confidence Expansion

목표:

- 현재 순수 로직 중심 테스트에서 실제 사용자 command 흐름까지 범위를 넓힌다.

작업:

- `packages/cli/src/commands/*`에 대해 API client mock 기반 command test를 추가한다.
- stdout/stderr 렌더링 결과를 검증하는 snapshot 또는 string assertion 테스트를 추가한다.
- raw-mode 진입/해제와 `Ctrl+C` 종료 경로를 감싼 테스트 유틸을 만든다.
- 최소 1개 명령은 end-to-end 성격의 smoke test를 추가한다.
- 추천 시작점: `status`, `trade`, `shop`, `admin`

완료 기준:

- 로직 함수뿐 아니라 실제 command 레이어에서도 최소 회귀 방지가 된다.

예상 효과:

- 사용자가 실제로 만지는 UX 경로의 안정성이 올라간다.

## Suggested Execution Order

공유와 실행을 동시에 고려하면 아래 순서가 가장 효율적이다.

1. `admin()` 테스트 헬퍼 추가
2. 파일 직접 수정 API 테스트를 관리자 테스트 API 기반으로 교체
3. `user`, `social`, `admin` 라우트 smoke test 추가
4. `auth.ts`의 import-time `process.exit` 제거
5. data dir / secret 주입 구조로 점진 리팩터링
6. CI workflow 추가
7. coverage baseline 수집
8. CLI command/UI 테스트 확장

## Suggested Tickets

아래 정도로 티켓을 나누면 바로 전달 가능하다.

- `test(server): add admin test client and replace file mutation setup`
- `test(server): add smoke coverage for user routes`
- `test(server): add smoke coverage for social routes`
- `test(server): add smoke coverage for admin routes`
- `refactor(server): remove import-time process.exit from auth module`
- `refactor(server): inject data dir into app/store creation path`
- `ci: add repository-local build and test workflow`
- `test: collect vitest coverage baseline for server and cli`
- `test(cli): add command-level tests for api-client driven flows`
- `test(cli): add raw-mode cleanup and interrupt path coverage`

## Handoff Notes

- 현재 인프라는 "다 뜯어고쳐야 하는 상태"는 아니다.
- 우선순위는 새 프레임워크 도입이 아니라, 이미 있는 테스트 자산을 더 올바른 방향으로 연결하는 것이다.
- 가장 먼저 손댈 부분은 구조 리팩터링보다 `admin helper 기반 API 테스트 정리 + user/social/admin 라우트 커버리지 확보`다.
- 그 다음이 `auth/env/global state` 축소다.

이 순서로 진행하면 리스크를 빨리 줄이면서도, 테스트 인프라를 장기적으로 확장 가능한 구조로 바꿔갈 수 있다.
