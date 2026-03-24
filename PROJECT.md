# PokeLog

Git 커밋 활동을 기반으로 포켓몬을 획득하고 성장시키는 개발자 동기부여 CLI 게임.

## 컨셉

개발자가 코드를 작성하고 커밋하면, 그 작업량(바이트)에 비례하여 경험치와 포인트를 획득한다. 경험치로 포켓몬이 성장하고, 포인트로 아이템을 구매하며, 일정 확률로 야생 포켓몬을 조우하여 전투/포획할 수 있다. 사내 팀이나 개인이 서버를 띄워두고 사용하는 형태.

## 기술 스택

- **언어**: TypeScript
- **런타임**: Node.js
- **서버**: Express (REST API)
- **데이터 저장**: JSON 파일 (DB 없음)
- **CLI**: Commander + @inquirer/prompts
- **터미널 출력**: ANSI 24-bit True Color + 유니코드 반블록 문자
- **테스트**: Vitest (66개 유닛 테스트)

## 프로젝트 구조

```
pokelog/
├── packages/
│   ├── server/                 # API 서버 + Git Polling
│   │   ├── src/
│   │   │   ├── auth/           # 비밀번호 해시, JWT 인증
│   │   │   ├── game/           # 게임 로직 (보상, 콤보, 전투, 포획, 성장)
│   │   │   ├── middleware/     # 인증 미들웨어
│   │   │   ├── polling/        # Git repo polling, 커밋 처리
│   │   │   ├── routes/         # REST API 라우트
│   │   │   ├── storage/        # JSON 파일 읽기/쓰기 (atomic write)
│   │   │   ├── app.ts          # Express 앱 설정
│   │   │   └── index.ts        # 서버 진입점
│   │   └── tests/              # 유닛 테스트
│   └── cli/                    # CLI 클라이언트
│       └── src/
│           ├── commands/       # 각 CLI 명령어 구현
│           ├── ui/             # 터미널 UI (아트 렌더링, HP바, 프롬프트)
│           ├── index.ts        # CLI 진입점 (인터랙티브 모드 포함)
│           ├── interactive.ts  # 인터랙티브 셸 모드
│           ├── api-client.ts   # 서버 API 호출 클라이언트
│           ├── config.ts       # ~/.pokelog/ 로컬 설정 관리
│           └── admin-entry.ts  # pokelog-admin 진입점
├── shared/
│   └── types.ts                # 공유 TypeScript 인터페이스
├── data/
│   ├── pokemon/                # 포켓몬 종/진화 데이터 (JSON)
│   ├── moves/                  # 기술 데이터 (JSON)
│   ├── types/                  # 타입 상성표 (JSON)
│   ├── regions/                # 지역별 출현 테이블 (JSON)
│   └── colorscripts/           # 포켓몬 ANSI 아트
└── pokelog-data/               # 런타임 데이터 (유저, 설정 - gitignore)
```

## 구현된 기능

### 서버
- **Git Polling**: 등록된 repo를 주기적으로 fetch하여 새 커밋 감지
- **보상 시스템**: 커밋의 바이트 변화량 기준으로 경험치 + 포인트 지급
- **콤보 시스템**: 연속 작업(분당 바이트 기준) 시 배율 증가 (최대 2.0배, 설정 가능)
- **야생 조우**: 커밋마다 확률적 조우 + 천장 시스템 (일정 바이트 누적 시 보장)
- **턴제 전투**: 데미지 계산 (타입 상성, 물리/특수, 명중률), 속도 기반 선공
- **포획**: 볼 종류별 보정 × HP 비율 기반 확률
- **성장**: 레벨업 (N^3 경험치 곡선), 스탯 계산, 기술 습득, 진화
- **상점**: 포인트로 볼/회복 아이템 구매
- **유저 시스템**: 회원가입 (스타터 선택), JWT 인증, 매칭 정보 관리
- **소셜**: 랭킹, 타 유저 프로필 조회
- **관리자**: repo 등록/관리, 서버 설정, 수동 polling
- **테스트 도구**: 가짜 커밋, 강제 조우, 포인트/아이템/포켓몬 직접 지급
- **아트 API**: 포켓몬 ANSI 아트 제공 (`GET /api/art/:species`)

### CLI
- **인터랙티브 모드**: `pokelog`만 실행하면 셸 모드 진입 (Alternate Screen Buffer)
- **명령어 입력**: `pokelog> status` 형태로 명령어 타이핑
- **화살표 키 선택**: 명령어 내부에서 inquirer 기반 인터랙티브 UI
- **전투 UI**: 포켓몬 ANSI 아트 + HP바 + 턴제 행동 선택
- **화면 클리어**: 명령어 전환 시 이전 출력 제거

### CLI 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `pokelog` | 인터랙티브 모드 진입 |
| `pokelog init --server <url>` | 서버 URL 설정 |
| `pokelog register` | 회원가입 (스타터 포켓몬 선택) |
| `pokelog login` | 로그인 |
| `pokelog logout` | 로그아웃 |
| `pokelog status` | 현황 요약 |
| `pokelog events` | 야생 조우 이벤트 목록 → 선택하여 전투 |
| `pokelog encounter <id>` | 야생 조우 진입 (턴제 전투) |
| `pokelog party` | 파티 포켓몬 확인 → 선택하여 상세 |
| `pokelog pokedex` | 도감 |
| `pokelog inventory` | 인벤토리 → 회복 아이템 사용 |
| `pokelog shop` | 상점 → 아이템 구매 |
| `pokelog buy <item> [qty]` | 아이템 구매 |
| `pokelog use <item> <uid>` | 아이템 사용 |
| `pokelog storage` | 보관함 → 파티로 이동 |
| `pokelog pokemon <uid>` | 포켓몬 상세 정보 |
| `pokelog ranking` | 랭킹 |
| `pokelog profile [nickname]` | 프로필 확인 |
| `pokelog nickname <name>` | 닉네임 변경 |
| `pokelog match <app> <id>` | 매칭 정보 추가 |

### 관리자 명령어 (pokelog-admin)

| 명령어 | 설명 |
|--------|------|
| `pokelog-admin repo add <url>` | repo 등록 |
| `pokelog-admin repo list` | repo 목록 |
| `pokelog-admin repo remove <url>` | repo 제거 |
| `pokelog-admin config show` | 서버 설정 확인 |
| `pokelog-admin config set <key> <value>` | 설정 변경 |
| `pokelog-admin status` | 서버 상태 |
| `pokelog-admin users` | 유저 목록 |
| `pokelog-admin polling run` | 수동 polling |
| `pokelog-admin test commit <uid> <bytes>` | 가짜 커밋 시뮬레이션 |
| `pokelog-admin test encounter <uid> [species] [level]` | 야생 조우 강제 발생 |
| `pokelog-admin test give-points <uid> <amount>` | 포인트 지급 |
| `pokelog-admin test give-item <uid> <item> [qty]` | 아이템 지급 |
| `pokelog-admin test give-pokemon <uid> <species> [level]` | 포켓몬 지급 |

## 데이터 구조

### 서버 설정 (pokelog-data/config.json)
- 서버 포트, polling 주기, 등록된 repo 목록
- 보상 계수 (바이트당 경험치/포인트)
- 콤보 설정 (분당 바이트 기준, 배율 테이블, 상한)
- 조우 설정 (기본 확률, 천장 바이트, 타임 리미트)
- 상점 아이템 목록/가격

### 유저 데이터 (pokelog-data/users/{id}.json)
- 계정 정보 (아이디, 닉네임, 매칭 정보)
- 포인트, 총 경험치, 콤보 상태
- 보유 포켓몬 (파티 + 보관함)
- 인벤토리, 도감, 미확인 이벤트, 전투 상태, 로그

### 게임 데이터 (data/)
- 포켓몬 20종 (1세대 중심: 스타터 3종 진화 라인, 피카츄, 미니룡 등)
- 기술 20종 (물리/특수/상태)
- 18타입 상성표
- 기본 지역 출현 테이블
- 포켓몬 ANSI 컬러 아트

## 설계 문서

- `docs/superpowers/specs/2026-03-23-pokelog-design.md` — 전체 설계 스펙
- `docs/superpowers/plans/2026-03-23-pokelog-phase1.md` — Phase 1 구현 계획

## 실행 방법

```bash
# 서버 시작
cd pokelog
npx tsx packages/server/src/index.ts

# CLI 사용 (별도 터미널)
pokelog init --server http://localhost:3000
pokelog register
pokelog
```

## 미구현 / 향후 계획

- [ ] Notion, Jira 등 git 외 서비스 연동 (매칭 구조는 준비됨)
- [ ] 바이옴/지역 시스템 (출현 테이블 구조는 준비됨)
- [ ] PvP 배틀
- [ ] 포켓몬 교환
- [ ] 업적/도전과제
- [ ] 일일 출석 보너스
- [ ] 포켓몬 종류 확대 (현재 20종)
- [ ] 서버 자동 시작 (시스템 서비스 등록)
