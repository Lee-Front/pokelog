# PokeLog

현재 코드베이스 기준 프로젝트 개요 문서입니다. 상세 분석과 문서 인벤토리는 `docs/project-analysis.md`에 정리했습니다.

## 한 줄 요약

PokeLog는 Git 커밋 활동을 경험치와 포인트로 환산해 포켓몬을 수집하고 성장시키는 CLI 게임이며, Express 서버와 터미널 중심 클라이언트로 구성됩니다.

## 현재 아키텍처

- `packages/server`
  Git polling, 게임 로직, 인증, REST API, 관리자 기능 담당
- `packages/cli`
  일반 CLI 명령, 인터랙티브 셸, 서버 프로필 관리, API 호출 담당
- `shared`
  서버/게임 공용 타입 정의
- `data`
  포켓몬, 기술, 타입 상성, 지역, ANSI 아트 정적 데이터
- `pokelog-data`
  서버 런타임 데이터 저장소

## 핵심 흐름

1. 서버가 등록된 Git 저장소를 주기적으로 폴링합니다.
2. 새 커밋을 감지하면 바이트 변화량을 기준으로 유저 보상을 계산합니다.
3. 보상은 경험치, 포인트, 콤보, 야생 조우 확률에 반영됩니다.
4. 유저는 CLI에서 상태 확인, 전투, 포획, 파티 관리, 상점 이용을 수행합니다.
5. CLI는 하나 이상의 서버 프로필을 로컬에 저장하고 현재 서버를 전환할 수 있습니다.

## 구현 범위

### 서버

- `GET /api/meta` 서버 메타데이터 제공
- 회원가입/로그인
- 상태, 이벤트, 파티, 보관함, 인벤토리, 도감 조회
- 야생 조우 전투 및 포획
- 상점 조회, 구매, 아이템 사용
- 프로필/랭킹 조회
- 관리자 repo 관리, polling 실행, 테스트용 지급/조우 명령
- ANSI 아트 조회 API

### CLI

- `join`, `servers`, `use`, `leave`, `whereami` 기반 멀티 서버 접속 UX
- `pokelog` 실행 시 인터랙티브 셸 진입
- 명령 기반 일반 CLI와 선택형 프롬프트 UI 혼합
- 전투/상점/파티 화면용 ANSI 렌더링
- 서버별 토큰 분리 저장

## 현재 명령 구조

### 일반 사용자 CLI

- 서버 관리: `join`, `servers`, `use`, `leave`, `whereami`, `init`
- 인증: `register`, `login`, `logout`
- 프로필: `profile`, `nickname`, `match`, `unmatch`
- 게임: `status`, `events`, `encounter`
- 포켓몬 관리: `party`, `party set`, `storage`, `storage withdraw`, `storage deposit`, `pokemon`, `pokedex`, `inventory`
- 상점: `shop`, `buy`, `use-item`
- 랭킹: `ranking --by <criteria>`

### 인터랙티브 셸 전용

- `heal`
- `debug`

### 관리자 CLI

- `repo add|list|remove`
- `config show|set`
- `status`
- `users`
- `polling run`
- `test commit|encounter|give-points|give-item|give-pokemon`

## 설정과 데이터

### CLI 로컬 설정

저장 위치: `~/.pokelog`

- `config.json`
  현재 서버 ID와 참가한 서버 프로필 목록 저장
- `auth.json`
  서버 ID별 access token 저장

### 서버 런타임 데이터

저장 위치: `pokelog-data`

- `config.json`
  서버 포트, 메타데이터, polling, 보상, 상점 설정
- `users/*.json`
  계정, 포인트, 포켓몬, 인벤토리, 로그, 전투 상태 저장
- `sync-state.json`
  repo별 마지막 동기화 상태 저장

## 실행

```bash
npm install
npm run dev:server
npm run dev:cli
```

최초 접속 예시:

```bash
pokelog join http://localhost:3000
pokelog register
pokelog
```

## 확인된 상태

- 서버 테스트 73개 통과
- CLI 테스트 파일 없음
- 루트 `npm test`는 CLI 워크스페이스 때문에 실패
- 루트 `npm run build`는 현재 서버 TypeScript 오류 때문에 실패

## 관련 문서

- `README.md`: 빠른 소개와 시작 가이드
- `docs/project-analysis.md`: 문서 현황, 구현 상태, 개선 포인트
- `REFACTOR.md`: 멀티 서버 UX 개편 설계 문서
- `docs/terminal-rendering.md`: CLI 재렌더링 패턴 메모
