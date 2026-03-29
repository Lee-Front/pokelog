# PokeLog 프로젝트 분석

## 목적

이 문서는 2026-03-29 기준으로 저장소 구조, 기존 문서 상태, 현재 구현과 문서 간 차이를 정리한 운영 메모입니다.

## 요약

- 문서 자산은 이미 존재하지만 루트 진입 문서가 없었습니다.
- `PROJECT.md`는 초기 설계 기준 설명이 남아 있어 현재 코드와 어긋나는 부분이 있었습니다.
- 멀티 서버 접속 UX는 이미 코드에 반영되어 있으며 `REFACTOR.md`의 방향과 대체로 일치합니다.
- 테스트와 빌드 상태는 문서화가 필요했습니다.

## 코드베이스 구조

### 1. 서버

경로: `packages/server`

주요 책임:

- Express 앱 생성과 API 라우팅
- Git 저장소 polling
- 커밋 보상 계산
- 야생 조우, 전투, 포획, 성장
- JSON 파일 기반 저장소 관리
- 관리자 API 제공

관찰 사항:

- `app.ts`에 `/api/meta`, `/api/art/ball/:name`, `/api/art/:species`가 직접 등록되어 있습니다.
- 서버 메타데이터는 `pokelog-data/config.json`의 `meta` 필드에서 내려갑니다.
- 관리자 기능은 별도 관리자 CLI와 `/api/admin/*` 라우트로 연결됩니다.

### 2. CLI

경로: `packages/cli`

주요 책임:

- 일반 CLI 명령 파싱
- 인터랙티브 셸
- 서버 프로필 저장/전환
- 서버별 토큰 저장
- API 호출과 출력 렌더링

관찰 사항:

- 기본 실행 시 `interactiveMode()`로 진입합니다.
- 멀티 서버 프로필은 `~/.pokelog/config.json`과 `~/.pokelog/auth.json`에 저장됩니다.
- 구형 단일 `serverUrl`/`token` 포맷을 마이그레이션하는 코드가 있습니다.
- `heal`, `debug`는 인터랙티브 셸에는 있으나 일반 CLI 엔트리에는 등록되어 있지 않습니다.

### 3. 공용 타입과 데이터

경로:

- `shared/types.ts`
- `data/*`

관찰 사항:

- 타입 정의는 서버와 CLI 문서 기준점으로 사용하기 좋습니다.
- ANSI 아트 데이터 양이 많아 `rg --files` 결과가 매우 커집니다. 문서 작업 시 이 디렉터리는 구조 단위로만 다루는 편이 낫습니다.

## 기존 문서 점검

### 유지 가치가 높은 문서

- `REFACTOR.md`
  멀티 서버 UX 개편의 의도와 수용 기준이 잘 정리돼 있습니다.
- `docs/terminal-rendering.md`
  CLI 깜빡임 없는 재렌더링 패턴을 정확히 설명합니다.
- `docs/superpowers/specs/2026-03-23-pokelog-design.md`
  초기 전체 설계 기록으로 가치가 있습니다.
- `docs/superpowers/plans/*.md`
  초기 구현 계획 히스토리로 유지할 만합니다.

### 갱신이 필요했던 문서

- `PROJECT.md`
  아래 내용이 현재 코드와 달랐습니다.
  - 단일 서버 URL 설정 중심 설명
  - 옛 명령어 목록
  - 테스트 수치와 현재 상태 미반영
  - 루트 진입 문서 부재

## 확인된 구현 상태

### 문서와 일치하는 부분

- 멀티 서버 접속 UX
- `GET /api/meta` 제공
- 서버별 토큰 저장
- 인터랙티브 셸 프롬프트에 현재 서버명 노출
- 관리자 repo/polling/test 명령

### 문서와 차이가 있었던 부분

- 사용자 아이템 사용 명령은 `use`가 아니라 `use-item`
- 서버 전환 명령으로 `use`가 이미 사용됨
- `party set`, `storage withdraw`, `storage deposit`, `unmatch`, `whereami` 등 신규 명령 존재
- `heal`, `debug`는 인터랙티브 셸 한정 기능

## 품질 상태 메모

### 테스트

- 서버 테스트: 73개 통과
- CLI 테스트: 테스트 파일 없음
- 루트 `npm test`: 실패
  이유: `packages/cli`에서 `vitest run` 시 테스트 파일 없음으로 종료 코드 1 반환

### 빌드

- 루트 `npm run build`: 실패

확인된 원인:

- `packages/server/src/auth/auth.ts`
  `jsonwebtoken` 시크릿이 `string | undefined`로 추론되어 타입 오류 발생
- `packages/server/src/routes/battle-routes.ts`
  move 선택 분기에서 `undefined` 가능성이 제거되지 않아 타입 오류 발생

### 구현 리스크

- `packages/cli/src/api-client.ts`의 안내 문구는 아직 `pokelog init --server <url>` 중심입니다.
- `packages/cli/src/commands/status.ts`는 `comboCount`를 기대하지만 서버 `status` 응답은 `combo` 객체를 반환합니다.
  실제 실행 시 출력 불일치 가능성이 있습니다.

## 이번 갱신 내용

- `README.md` 신규 작성
- `PROJECT.md` 현재 코드 기준으로 재작성
- `docs/project-analysis.md` 신규 작성

## 다음 문서 작업 제안

우선순위 1:

- API 엔드포인트 문서 분리
- 로컬/서버 데이터 포맷 예시 문서화
- 운영자용 서버 설정 가이드 작성

우선순위 2:

- 인터랙티브 셸 전용 명령과 일반 CLI 명령을 분리한 UX 문서 작성
- 관리자 CLI 사용 시나리오 정리
- 테스트/빌드 실패 원인 추적 문서화 또는 실제 수정
