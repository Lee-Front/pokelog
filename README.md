# PokeLog

Git 커밋 활동을 게임 루프로 바꿔 포켓몬을 수집하고 성장시키는 TypeScript 기반 CLI 프로젝트입니다. 서버가 Git 저장소를 폴링해 커밋 바이트를 보상으로 환산하고, CLI는 멀티 서버 프로필을 기준으로 로그인, 전투, 포획, 상점, 도감 기능을 제공합니다.

## 현재 상태

- 워크스페이스 구조: `packages/server`, `packages/cli`, `shared`, `data`
- 서버 메타데이터 기반 멀티 서버 접속 지원: `join`, `servers`, `use`, `leave`, `whereami`
- 인터랙티브 CLI 셸 지원: 기본 실행 시 대체 화면 버퍼 기반 UI 진입
- 서버 테스트 통과: 1267개 (95개 테스트 파일)
- PvP 배틀 시스템 (Gen 1~9, 메가진화/기가맥스/다이맥스/테라스탈/울트라버스트/합체)
- Gen 9 테라스탈 타입, 울트라버스트, 합체(쿠레무/네크로즈마/버드렉스) 지원
- Battle Tower (타워형 스테이지 AI 전투, 연승 기록), 알/부화 시스템, 교환 시스템
- IV(개체값) 시스템 및 저지(Judge) 감정 기능
- 빌드: `packages/server`, `packages/cli` 모두 정상 통과

## 빠른 시작

```bash
npm install
npm run dev:server
npm run dev:cli
```

서버 실행 후 다른 터미널에서:

```bash
pokelog join http://localhost:3000
pokelog register
pokelog
```

## 주요 기능

- Git 커밋 바이트 기반 경험치/포인트 보상
- 콤보 배율, 야생 조우, 천장 시스템
- 턴제 전투, 포획, 레벨업, 진화
- 파티/보관함/도감/인벤토리/상점
- 랭킹과 프로필 조회
- 관리자용 repo 등록, polling 실행, 테스트 보조 명령

## CLI 명령

일반 CLI:

- `pokelog join <url>`
- `pokelog servers`
- `pokelog use <name>`
- `pokelog leave <name>`
- `pokelog whereami`
- `pokelog register`
- `pokelog login`
- `pokelog logout`
- `pokelog profile [nickname]`
- `pokelog nickname <name>`
- `pokelog match <app> <identifier>`
- `pokelog unmatch <app> <identifier>`
- `pokelog status`
- `pokelog events`
- `pokelog encounter <id>`
- `pokelog party`
- `pokelog party set <uids...>`
- `pokelog storage`
- `pokelog storage withdraw <uid>`
- `pokelog storage deposit <uid>`
- `pokelog pokemon <uid>`
- `pokelog pokedex`
- `pokelog inventory`
- `pokelog shop`
- `pokelog buy <item> [quantity]`
- `pokelog use-item <item> <pokemonUid>`
- `pokelog ranking --by <criteria>`
- `pokelog init --server <url>` (`join` 호환용 deprecated wrapper)

인터랙티브 셸 전용 명령:

- `heal`
- `debug`

## 관리자 명령

- `pokelog-admin repo add <url> [--branches main,develop]`
- `pokelog-admin repo list`
- `pokelog-admin repo remove <url>`
- `pokelog-admin config show`
- `pokelog-admin config set <key> <value>`
- `pokelog-admin status`
- `pokelog-admin users`
- `pokelog-admin polling run`
- `pokelog-admin test commit <userId> <bytes>`
- `pokelog-admin test encounter <userId> [species] [level]`
- `pokelog-admin test give-points <userId> <amount>`
- `pokelog-admin test give-item <userId> <item> [quantity]`
- `pokelog-admin test give-pokemon <userId> <species> [level]`

## 문서

- `PROJECT.md`: 현재 구현 기준 개요와 구조 설명
- `docs/project-analysis.md`: 코드/문서 현황 분석과 유지보수 메모
- `REFACTOR.md`: 멀티 서버 UX 개편 설계 기록
- `docs/terminal-rendering.md`: CLI 화면 재그리기 패턴 메모
- `docs/superpowers/...`: 초기 설계/계획 문서
