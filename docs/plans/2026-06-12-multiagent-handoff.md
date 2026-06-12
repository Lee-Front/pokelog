# 멀티에이전트 핸드오프 — PokeLog 웹화 + 게임 확장

작성: 2026-06-12. 이 문서 하나로 새 세션이 맥락 없이 이어갈 수 있도록 작성됨.
**새 세션 시작 시 이 문서를 먼저 읽고, 아래 "다음 할 일"부터 진행한다.**

> **갱신(2026-06-12 마지막)**: #15 웹 풀게임 **전체 완료·QA 통과**(컬렉션/파티/도감/배틀/보상 + 상점/배틀머니상점/가방 + 에그가챠/진화/박스/트레이드 + ANSI 아트). 프록시 14종, pokelog 테스트 146 그린. **pokelog는 전부 커밋됨**(e218eaf, f0baad6, a65ae05) — pokelog 워킹트리 클린. **포털(company-portal)은 미커밋**(워킹트리에 web-portal-dev 작업 + 사용자 assistant 작업 섞여 있음, 파일 단위 분리됨). 미구현은 트레이드 "신청(request)"뿐(UI 안내로 대체, 필요시 프록시 2개+UI로 추가).
> **다음 세션 할 일**: ① 포털의 pokelog 파일만 선별 커밋(사용자 assistant/embeddable 작업 제외) ② (사용자) 빌드블로커(assistant 함수명·sharp / embeddable 마이그레이션) 정리 + pokelog_links DB 마이그레이션 → 포털 next build/재배포 ③ 시각검증은 사용자 호스트(아래 §5 기동법). #15 추가 기능 원하면 트레이드 신청 등.

---

## 0. 프로젝트 구성

- **pokelog** (`C:\Users\user\projects\pokelog`): 터미널 포켓몬 게임. `packages/server`(Express 게임 서버 + REST API), `packages/cli`(TUI 클라이언트), `shared/types.ts`, `data/`(species/items/art 등). 브랜치 `refactor/codebase-cleanup`.
- **company-portal** (`C:\Users\user\projects\company-portal`): 사용자의 사내 통합 포털. Next.js 16 / React 19 / Drizzle(better-sqlite3) / NextAuth v5. PokeLog를 웹으로 붙이는 대상. **사용자가 실시간 작업 중인 프로젝트** — assistant 등 사용자 작업 파일 절대 건드리지 말 것.

---

## 1. 토큰 최적화 운영 규칙 (사용자 지정 — 반드시 준수)

**팀 구조**: 사용자 ⇄ 사령부(팀리드, 이 세션) ⇄ 작업자(Opus). 작업자는 사용자와 직접 대화 안 함.

**작업자 수명주기 — 상주 금지**:
- 작업 블록 시작 시 필요한 작업자만 스폰, 블록 끝나면 즉시 셧다운. 유휴 작업자 세워두지 않음(유휴도 토큰 소비).
- resume 재활용은 직전 응답 후 ~5분 내(캐시 따뜻할 때)만. 5분+ 쉰 워커 깨우면 전체 히스토리 재가열(기준가 1.25배) → 새 일감이면 **새 인스턴스가 쌈**.
- 한 작업자에 몰아주지 않음. 기능 단위 끝나면 교대해 히스토리 리셋.
- 동시 가동 1~3명. 겹치는 파일은 한 작업자 전담.

**토큰 절약**:
- 스폰 프롬프트 간결하게(작업 내용만). 작업자는 CLAUDE.md/rules/docs 자동 로드하니 프로젝트 규칙 재복창 금지.
- 지시는 묶어서(피드백 2~4건 모아 1회 wake).
- 작업자 보고 간소하게: 변경 파일:라인 + 특이사항 5줄 내외. 상세는 큰 작업만.
- 작업자는 변경마다 전역 타입체크/전체 테스트 금지. 수정 파일 단위만, 풀 검증은 커밋 직전 1회.
- 브라우저(MCP)는 사령부 전용. 사령부도 스크린샷 절제(사용자가 같은 화면 보면 보여주기용 캡처 생략).

**컨텍스트 위생**: 작업 단위 완결(커밋)되면 마무리 보고 끝에 "지금 /clear 하세요" 명시. clear 전 /rename 권장. compact는 auto에 맡김.

**완결 흐름**: 작업자 보고 → 사령부 검증 → 사용자에 핵심만 요약. 완결 시 단위별 분리 커밋 → 문서 갱신 → /clear 신호.

> 이전 세션 비효율 교훈: 환경 디버깅(CSS→auth→webpack)을 여러 워커로 오래 핑퐁한 것 + 유휴 워커 상주 + 워커 한 명(trade/infra)에 몰빵이 토큰 주범이었음. 재캐싱(cache write) 반복이 비용. 한 워커 집중 연속작업 + 끝나면 해산이 핵심.

## 1b. 작업자 역할 명부(권장 — `.claude/agents/`로 정식화하면 스폰 더 간결)

- **server-dev**: `packages/server` 게임로직/배틀/스토리지/라우트/config. (이전 variant-worker/infra-worker 역할)
- **cli-dev**: `packages/cli` TUI/명령/배틀 표시. CLI 단일프레임 원칙 준수.
- **web-portal-dev**: `company-portal` 웹 연동/게임 클라이언트. 서버사이드 프록시 방식.
- **qa**: 코드 수정 없이(테스트 추가만) 디프 적대 검증. 완료 게이트.
- **infra**: 서버 기동/배포/환경. (필요 시만)

---

## 2. 완료된 작업 (전부 QA 통과, 단 미커밋 — 워킹트리에만)

pokelog 서버 테스트 688 / CLI 72 그린 기준.

- #1 user 이메일/닉네임 인덱스(getAllUsers 스케일링) + EPERM 재시도(json-store)
- #2 variant 에그 활성화 / #3 trade TUI / #4 pino 로깅 / #5 rate-limit
- #6 battle v2 / #8 GitLab 연동 하드닝(토큰 마스킹·refspec 버그·사설 CA TLS)
- #9 file:// 실연동 데모 / #10 dist PROJECT_ROOT 경로버그 / #11 CORS+/api/v1 별칭+web-integration-guide
- #12 멀티브랜치 커밋 중복집계 dedup / #13 보수적 보상 기본값(pointsPerByte 0.01, 콤보 1.5)
- #16 CLI 배틀 死코드 정정(승/패/포획 배너) / #17 배틀 보상(EXP/배틀머니/드랍/배틀머니 상점)

**QA 보강 테스트 5건(머지 필수)**: user-index 동시성 2, rate-limit 와이어링 2, multibranch-dedup 크로스폴 머지 1.

## 2b. 보류/미결

- **#7 UserData 타입 분리** (보류): shared/types.ts 대규모 리팩터. battleMoney는 #17이 UserData 최상위에 두고 "#7에서 GameProgress로 이동" 주석 남김.
- **#5 trust proxy**: 리버스 프록시 뒤 배포 시 `app.set('trust proxy')` 결정 필요(코드 결함 아님).
- **#11 social 공개표기**: /social/ranking·/profile 문서 표기 확인(실제 authMiddleware 없는 공개 맞음 — 확인됨).

---

## 3. 진행 중 — #14/#15 웹화 (company-portal, 미커밋)

**방식**: 서버사이드 프록시 — 포털 Next 서버(`src/app/api/pokelog/**`)가 PokeLog API 중계. `src/lib/pokelog/client.ts`(jira client 패턴), `session.ts`(requirePokelogToken). CORS 불필요, JWT는 포털 DB(`pokelog_links` 테이블)에 서버 보관. BASE URL = `data/app-config.json`→env→기본 `http://localhost:3000/api/v1`.

**#14 (조회/연동) — 코드 완성, 검증됨**: 랭킹 위젯(/pokelog, 실데이터 렌더 확인), 계정연동(pokelog_links), 내현황, 관리탭. 1단계 게임(컬렉션/파티/도감)도 완성.

**#15 (풀 게임) — 진행 중, ANSI 아트 1단계에서 중단**:
- ✅ 2단계 배틀(BattleModal: 조우→start/action/state 프록시, 클릭 UX, 강제교체, 결과배너) 코드 완성·테스트(92). 서버 result 6종({win,lose,caught,run,continue,fainted}), rewards는 win 응답에만.
- ✅ **이미지 ANSI 전환 — 1단계 완결·빌드 클린**: 사용자가 "CLI ANSI 아트를 웹에 그대로" 요청. PokeLog `/api/v1/art/:species`(+ball/egg)가 24비트 트루컬러 ANSI(escape 2종: `38;2;r;g;b`/`48;2`/`0m`, 블록문자 ▀▄) 제공. **자체 무의존 변환기**(ansi_up 등 의존성 추가 금지). 완료: `src/lib/pokelog/ansi-art.ts`(+test10), `src/app/api/pokelog/art/[species]/route.ts`, `src/app/pokelog/game/PokemonArt.tsx`, BattleModal/GameClient의 PokemonAvatar→PokemonArt 전면 교체, `PokemonAvatar.tsx` 삭제. pokelog lib 테스트 14통과·lint 0·반쯤 짠 파일 없음(빌드 안 깨짐). **새 세션은 빌드 재확인 불필요 — 바로 3단계부터.**
- ⬜ **남은 것**: ① 3단계 상점(포인트 `/api/v1/game/shop` + 배틀머니 `/api/v1/battle-shop`)+가방(inventory/use/equip) ② 4단계 에그가챠(eggs/buy/hatch/pull)·진화(evolutions)·박스(storage)·트레이드(trades). 게임 API는 서버에 다 있음 → 프록시+UI만. (ANSI 아트 폴백=색상아바타, <pre> line-height 압축은 이미 적용됨.)

---

## 4. 배포 막는 것 (사용자 영역 — 사령부 손대지 말 것)

1. **포털 next build 블로커**: ① assistant 리팩터 미완성(`src/app/api/assistant/screenshots/[name]/route.ts`가 `config.ts`의 옛 함수명 import + `sharp` 타입) ② DB `embeddable` 컬럼 마이그레이션 미적용(홈 500). **둘 다 사용자 작업**. 풀려야 포털 빌드/배포 가능.
2. **DB 마이그레이션**: `pokelog_links`(drizzle 0021)도 미적용 → 연동 저장 시 실패 가능. db:push는 사용자 embeddable 작업과 얽혀 사용자 허가 필요.
3. PokeLog 서버 #16/#17 변경은 재배포 필요. CLI는 서버와 별개.

---

## 5. 환경 제약 / 실전 정보

- **샌드박스 한계**: 에이전트 환경에서 Next dev의 무거운 모듈(auth/홈) 컴파일 시 자식프로세스 스폰 실패(turbopack=0xc0000142, webpack=jest-worker child exceptions, 같은 뿌리). **로그인 필요한 게임 UI 시각검증은 샌드박스 불가 → 사용자 호스트에서 확인**. 코드는 단위테스트+라우트 401로 검증. (사용자 PC엔 이 제약 없음.)
- **테스트 계정**: PokeLog `gitdemo`/`GitDemo2026!`(charizard Lv100 1마리, 도감 3종, ~910만P). 포털 `portaltest`/`PortalTest2026!`. 기존 PokeLog 유저 `wkdrmadl3`(이재희, ~984만P).
- **로컬 기동**(시각확인용): PokeLog = `npm run build -w packages/server` 후 `node packages/server/dist/packages/server/src/index.js`(포트 3000, dist 안정). 포털 = company-portal에서 `npx next dev -p 3100 --webpack`(turbopack 말고 webpack — auth 안정). `.next` 스테일 캐시 깨지면 삭제 후 재시작.
- **연동된 실 repo**(사용자 작업): company-portal(github), withflow_core_fe(사내 GitLab). file:// 또는 원격 연동으로 커밋→포인트 적립 동작 확인됨.

---

## 6. 게임 보상 산정 (확정 — 전부 config 런타임 조정 가능)

- 커밋 보상: `points = 변경bytes × pointsPerByte(0.01) × combo(≤1.5)`, `exp = bytes × expPerByte(0.05) × combo`. 머지커밋 제외. (보수적 시작, admin PUT으로 점진 인상.)
- 배틀 보상(win): `EXP = floor(baseExpYield × wildLevel / 7)`(본가식), `배틀머니 = floor(레벨×2)+3`, 드랍 단일가중롤 17.5%(potion8/super3/ball5/great1.5%). 배틀머니 상점(super-potion30/hyper60/great-ball25/ultra70/fire-stone200 BM).

---

## 7. 다음 할 일 (우선순위)

1. **company-portal 빌드 상태 확인** — ANSI 아트 중단 지점이 tsc/lint 깨뜨렸는지. 깨졌으면 정리(반쯤 짠 파일 구문 완결 or 되돌리기).
2. **#15 마저 구현** — web-portal-dev 1명 스폰, 집중 연속: ANSI 아트 마무리 → 상점 → 에그/진화/박스/트레이드. 단위테스트+라우트검증. 시각검증은 사용자 호스트.
3. **커밋 정리** — 단위별 분리 커밋(pokelog #16/#17 / 포털 #14/#15). pokelog와 사용자 assistant 작업은 파일 단위 분리됨.
4. (사용자) 빌드 블로커(assistant/embeddable) 정리 → 재배포.
5. (선택) #7 UserData 분리.

**작업 끝낼 때마다: 검증 → 분리 커밋 → 문서 갱신 → 사용자에 "/clear 하세요" 신호.**
