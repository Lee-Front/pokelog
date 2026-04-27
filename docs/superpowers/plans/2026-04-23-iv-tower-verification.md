# IV 판정 + 배틀 타워 + 종합 검수 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) 개체값(IV) 시스템 추가, (2) 배틀 타워 추가, (3) 게임 전반 7개 영역 검수 완료.

**Architecture:** IV는 OwnedPokemon/WildPokemon/fusedPartnerData 세 곳에 추가하고 legacy 포켓몬 호환. 배틀 타워는 PvP 엔진의 `pvp-room.ts` 함수들을 HTTP 라우트에서 재호출하는 방식으로 어댑트. AI 행동은 매 턴 서버가 대신 `submitAction` 호출. 검수는 자동화 테스트 신규 추가.

**리뷰 대응 (Critical + Important 반영):**
- C1: 스탯 계산 호출부 4곳 전부 업데이트 (pokemon-stats, commit-processor, admin-routes, growth)
- C2: WildPokemon에도 ivs 필드 추가, wildPokemonToOwned로 전파
- C3: fusedPartnerData에 ivs 저장, unfuse 시 복구
- C4: 전설 종족 풀은 `tower-ai.ts`에 하드코딩 (species.json에 isLegendary 플래그 없음)
- C5: Tower 라우트가 pvp-room 함수 직접 호출 (HTTP 동기 어댑터)
- I1: HP/PP/transformationUsed를 activeTowerRun에 스냅샷
- I6: 서버 스타트업은 in-process (`app.listen(0)` + supertest)
- I8: 동시성은 "문서화 + 퍼-유저 뮤텍스 검토" 방향

**Tech Stack:** 기존 TypeScript/Vitest + child_process 기반 실행 스크립트.

---

## Design Notes (로직 설계)

### IV 시스템 설계

**스토리지:**
- `OwnedPokemon.ivs?: { hp: number; attack: number; defense: number; spAttack: number; spDefense: number; speed: number }` (각 0-31)
- undefined면 레거시 포켓몬

**호환성:**
- 스탯 계산 시 `ivs` 미존재면 기본값 16 (중간값) 사용 → 기존 포켓몬 스탯 거의 변화 없음
- 새 포켓몬 (createPokemon, 알 부화, 합체 결과 등) 생성 시 랜덤 IV

**스탯 공식 수정 (`pokemon-stats.ts`):**
- HP: `floor((2*base + IV) * level / 100) + level + 10`
- Non-HP: `floor((floor((2*base + IV) * level / 100) + 5) * natureMod)`
- EV는 현재 시스템에 없음 (도핑은 별도 보정값으로 동작 중)

**호출부 전파 (C1):**
- `buildStatsForPokemon(pokemon, battleForm?)` — pokemon.ivs 읽음
- `calculateStatsForLevel(species, level, nature, variantId?, ivs?)` — 새 파라미터
- 다음 호출부 업데이트:
  - `polling/commit-processor.ts` 레벨업 시 ivs 전달
  - `routes/admin-routes.ts` 관리자 레벨 조정
  - `game/growth.ts` 레벨업 판정 이후 스탯 재계산
  - `game/fusion.ts` fuse/unfuse 재계산

**레거시 마이그레이션 정책 (S3):**
- 기존 포켓몬 (ivs === undefined) → **각 IV 0으로 취급** (현재 스탯 유지)
- 이유: 16으로 default하면 다음 레벨업 시 스탯이 은근슬쩍 올라감. 명확하게 "구 포켓몬은 0 IV"로 확정
- Judge에서는 undefined면 "개체값 판정 불가 (레거시 포켓몬)" 표시

**CLI:**
- `pokelog judge <pokemonUid>` — 개체값 평가 화면
- 원작 스타일 멘트 (S5 반영 — 186은 only all-31):
  - 합계 ≥ 181: "환상적이야!"
  - 151-180: "정말 대단해!"
  - 121-150: "꽤 괜찮아"
  - ≤ 120: "좀 더 노력해볼까"
- 개별 멘트:
  - 31 (V): "최고다!"
  - 26-30: "훌륭해"
  - 16-25: "그럭저럭"
  - 1-15: "아쉽네"
  - 0: "안 좋아"

### 배틀 타워 설계

**저장소:**
```typescript
// UserData에 추가
towerRecord?: {
  currentStreak: number;
  bestStreak: number;
  totalClears: number;       // 총 스테이지 완수
  lastPlayedAt?: string;
};

// 진행 중 세션 (선택)
activeTowerRun?: {
  stage: number;
  party: Array<{ uid: string; currentHp: number; currentPp: Record<string, number>; transformationUsed: boolean }>;
  startedAt: string;
};
```

**AI 파티 생성:**
- 스테이지 1-4: Lv.40, 기본 기술 4개, 도구 없음
- 스테이지 5-9: Lv.45, 도구 랜덤
- 스테이지 10-19: Lv.50, 좋은 기술 선호
- 스테이지 20-49: Lv.50, 완전 경쟁 세팅
- 스테이지 50-99: Lv.55, 전설 포켓몬 포함
- 스테이지 100: Lv.60, 최종 보스 (랜덤 레전드 3마리 + mega/tera 활성)

**전설 풀 (C4 하드코딩):**
```typescript
const LEGENDARY_POOL = [
  "articuno", "zapdos", "moltres", "mewtwo", "mew",
  "raikou", "entei", "suicune", "lugia", "ho-oh", "celebi",
  "regirock", "regice", "registeel", "latias", "latios", "kyogre", "groudon", "rayquaza", "jirachi", "deoxys",
  "uxie", "mesprit", "azelf", "dialga", "palkia", "heatran", "regigigas", "giratina", "cresselia", "darkrai", "arceus",
  "cobalion", "terrakion", "virizion", "tornadus", "thundurus", "landorus", "reshiram", "zekrom", "kyurem", "keldeo", "meloetta",
  "xerneas", "yveltal", "zygarde", "diancie", "hoopa", "volcanion",
  "tapu-koko", "tapu-lele", "tapu-bulu", "tapu-fini", "cosmog", "solgaleo", "lunala", "necrozma",
  "zacian", "zamazenta", "eternatus", "kubfu", "urshifu", "calyrex", "glastrier", "spectrier",
  "koraidon", "miraidon", "ogerpon", "terapagos",
];
```

**Tera / 폼 (I2):**
- 생성 시 `teraType = pickWildTeraType(species)` 적용
- Stage 100: `teraActive` 배틀 시작 시 활성 (보스 효과)
- megaForm / gmaxForm 있으면 Stage 20+ 에서 랜덤 활성

**Species Clause (I3):**
- AI 파티 내 중복 금지
- 유저 파티 내 중복 금지 (기존 PvP와 동일)
- 하지만 AI-vs-User 교차 중복은 허용 (canon 배틀 타워는 교차 체크 안 함)

**룰 (Canon):**
- 파티 3마리 (원작 배틀 타워 싱글)
- 스테이지 간 HP/PP 유지 (명시적 스냅샷/복구)
- 회복 불가
- 메가/기가맥스/Tera/합체/Ultra Burst **배틀당 1회 리셋 (canon)** — activeTowerRun에는 기록하지 않음
- 종족값 조항 (Species Clause, AI/User 각 팀 내)
- 매 스테이지 AI 랜덤 생성 (유저 파티 고정)

**HP/PP 스냅샷 메카닉 (I1):**
- 매 스테이지 종료 시 유저 파티 상태를 activeTowerRun.party에 저장:
  - `currentHp` (0 이상)
  - `currentPp` (기술 id → 잔여 PP 맵)
  - `statusCondition` (잠듦 등은 유지, 일부 원작은 리셋)
- 다음 스테이지 시작 시 새 PvP 룸에 이 상태를 주입
- `transformationUsed`는 매 배틀 리셋 (스냅샷에 넣지 않음)

**세션 TTL (I5):**
- `activeTowerRun.startedAt` 시각 기준 24시간 초과 시 자동 무효화
- `POST /api/tower/start` 호출 시 만료된 런은 자동 정리

**보상:**
- Stage 1: +100P
- Stage 5: +500P + 1 rare egg
- Stage 10: +2000P + 1 epic egg
- Stage 20: +5000P + 1 random mega stone
- Stage 50: +20000P + 1 master ball
- Stage 100: +100000P + ultra-necrozium-z
- 최고 기록 갱신 보너스: +1000P × (new best - old best)

**API (C5 — PvP 엔진 동기 어댑터):**
- `POST /api/tower/start` — 파티 3 UID로 시작, 진행 중 세션 있으면 에러
  - AI 파티 생성 → tower 세션 저장 → 내부적으로 `createRoom()` 호출 → 양쪽 리드 자동 선택 → roomId 반환
- `GET /api/tower/status` — 현재 세션 정보 + 현재 룸 상태
- `POST /api/tower/action` — 유저의 PvpAction 제출
  - 내부: `submitAction(room, userId, action)` 호출
  - 즉시 AI action 계산 → `submitAction(room, aiUserId, aiAction)` 호출
  - 턴 해결 후 결과 반환
  - forced_switch 페이즈도 동일하게 처리
  - 배틀 종료 시: 다음 스테이지로 자동 준비 (HP/PP 스냅샷 → 새 룸 생성)
- `POST /api/tower/continue` — 스테이지 클리어 후 다음 스테이지 진입
- `POST /api/tower/forfeit` — 포기, 스트릭 저장

**PvP 룸 라이프사이클 어댑션:**
- 리드 선택은 항상 파티 첫 번째 포켓몬 자동 (원작 배틀 타워 스타일)
- AI 유저 ID는 `"__tower_ai__"`로 고정
- 유저 액션 받은 즉시 AI 액션 계산해서 동시 제출
- `getPlayerView(room, userId)`는 기존 그대로 사용

**CLI:**
- `pokelog tower` — 대화형 진입
- 메뉴: 새 도전 / 현재 기록 확인 / 포기
- PvP 배틀 UI 재사용 가능 (pvp.ts 일부 추출)

---

## Phase 1: IV 시스템

### Task 1.1: 타입 확장 & 스탯 계산

- [ ] Step 1: `shared/types.ts`의 OwnedPokemon, WildPokemon, fusedPartnerData 모두에 `ivs?` 추가
- [ ] Step 2: `packages/server/src/game/pokemon-stats.ts`
  - `buildStats(species, level, nature?, variantId?, ivs?)`에 ivs 파라미터
  - `buildStatsForPokemon(pokemon, battleForm?)` → pokemon.ivs 읽기
  - `calculateStatsForLevel(species, level, nature?, variantId?, ivs?)` — 시그니처 확장
  - **Legacy 정책**: ivs === undefined면 모두 0으로 취급 (현재 스탯 유지 보장)
- [ ] Step 3: 호출부 전파 (C1)
  - `packages/server/src/polling/commit-processor.ts` — 레벨업 시 pokemon.ivs 전달
  - `packages/server/src/routes/admin-routes.ts` — 관리자 레벨 조정
  - `packages/server/src/game/growth.ts` — 레벨업 판정
- [ ] Step 4: 단위 테스트
  - IV 31 vs 0의 최종 스탯 차이 검증
  - 레거시 (undefined) 포켓몬 스탯 변화 없음 확인
- [ ] Commit `feat(pokemon): add IV field and stat calculation with legacy compat`

### Task 1.2: 생성 지점에 IV 할당

- [ ] Step 1: `packages/server/src/game/pokemon-factory.ts`
  - `createPokemon`: 각 IV = `Math.floor(Math.random() * 32)` (0-31)
  - `createWildPokemon`: WildPokemon에도 ivs 필드 채움 (C2)
  - `wildPokemonToOwned`: wild.ivs를 owned에 복사 (C2)
- [ ] Step 2: `egg-gacha.ts`의 `hatchEgg` 결과에 랜덤 IV 추가
- [ ] Step 3: `fusion.ts`
  - fuse 시 partner의 IV를 `fusedPartnerData.ivs`에 저장 (C3)
  - base의 IV는 그대로 유지
  - unfuse 시 partner 복원에 ivs 사용
- [ ] Step 4: 테스트
  - 1000회 생성 시 IV 분포 0-31 확인
  - 포획 후 owned에 ivs 전파 확인
  - fuse → unfuse 후 partner IV 보존 확인
- [ ] Commit `feat(pokemon-factory): randomize IVs on creation`

### Task 1.3: Judge CLI

- [ ] Step 1: `packages/server/src/routes/user-routes.ts`에 `GET /judge/:uid` 엔드포인트
  - 반환: `{ ivs, total, verdict, perStat: { [stat]: verdict } }`
- [ ] Step 2: `packages/cli/src/commands/judge.ts` 생성
  - 원작 판정 멘트 + 개별 IV 바 표시
  - 형식:
    ```
      ── 개체값 판정 ──
      환상적이야! (합계 186/186)
    
        HP: [V] 최고다!       ████████████ 31
        공격: [V] 최고다!      ████████████ 31
        방어: 훌륭해           ██████████░░ 27
        특공: [V] 최고다!      ████████████ 31
        특방: 훌륭해           ███████████░ 29
        스피드: 그럭저럭        ███████░░░░░ 18
    ```
- [ ] Step 3: `packages/cli/src/index.ts` 및 `interactive.ts`에 등록
- [ ] Step 4: 테스트
- [ ] Commit `feat(cli): add judge command for IV appraisal`

---

## Phase 2: 배틀 타워

### Task 2.1: 타입 & 저장소

- [ ] Step 1: `shared/types.ts` UserData에 `towerRecord`, `activeTowerRun` 추가
- [ ] Step 2: 초기값 기본 처리
- [ ] Commit `feat(tower): add type definitions for battle tower`

### Task 2.2: AI 파티 생성기

- [ ] Step 1: `packages/server/src/game/tower-ai.ts` 생성
  - `generateTowerParty(stage: number): OwnedPokemon[]` 함수
  - 스테이지별 레벨/종족/기술/도구 규칙
- [ ] Step 2: 타워 전용 "신전 종족 풀" 정의 (배틀 타워에 등장 가능한 종족)
- [ ] Step 3: 테스트
  - 각 스테이지의 파티가 3마리
  - 레벨 규칙 준수
  - Species Clause
- [ ] Commit `feat(tower): add AI party generator`

### Task 2.3: 타워 세션 관리

- [ ] Step 1: `packages/server/src/game/tower.ts` 생성
  - `startTower(user, partyUids): TowerSession`
  - `advanceStage(user): TowerSession`
  - `forfeitTower(user): void`
  - `grantStageReward(user, stage): { points, items }`
- [ ] Step 2: 스테이지별 보상 표 상수화
- [ ] Step 3: 기록 갱신 로직
- [ ] Commit `feat(tower): add tower session manager`

### Task 2.4: 라우트

- [ ] Step 1: `packages/server/src/routes/tower-routes.ts` 생성
  - `POST /start` — 파티 선택
  - `GET /status` — 진행 상태
  - `POST /turn` — 턴 실행 (기존 PvP 엔진 재사용)
  - `POST /forfeit` — 포기
- [ ] Step 2: `app.ts`에 등록
- [ ] Step 3: 통합 테스트
- [ ] Commit `feat(tower): add tower API routes`

### Task 2.5: CLI

- [ ] Step 1: `packages/cli/src/commands/tower.ts` 생성
- [ ] Step 2: 파티 선택 UI → 배틀 UI 재사용 → 결과 → 계속 or 포기
- [ ] Step 3: 기록 조회 하위메뉴
- [ ] Step 4: 테스트
- [ ] Commit `feat(cli): add tower command`

---

## Phase 3: 검수 작업

### Task 3.1: 실서버 수동 플레이 자동화 (I6 — in-process)

- [ ] Step 1: 통합 테스트 `packages/server/tests/integration/server-startup.test.ts`
  - **In-process 부트**: `createApp()` + `app.listen(0)` → 랜덤 포트 획득
  - `beforeAll`에서 서버 시작, `afterAll`에서 `server.close()`
  - `/api/auth/...` 등 알려진 엔드포인트로 readiness 체크
  - (spawn 방식 X — CI 플래키)
- [ ] Step 2: 주요 API 플로우 통합 테스트 `tests/integration/api-flow.test.ts`
  - `supertest(app)` 기반
  - register → login → encounter 생성 → 배틀 → capture 성공 → pokemon 조회
- [ ] Commit `test: add server startup and API flow integration tests`

### Task 3.2: Socket.IO E2E

- [ ] Step 1: `tests/integration/pvp-socket-e2e.test.ts`
  - `createServer` + `SocketServer` + `socket.io-client` × 2
  - 매칭 → lead 선택 → 2-3턴 진행 → 종료
  - 이벤트 시퀀스 검증
- [ ] Commit `test: add PvP Socket.IO E2E integration test`

### Task 3.3: 동시성 (I8 — 문서화 + 선택적 뮤텍스)

- [ ] Step 1: `tests/integration/concurrency.test.ts`
  - 같은 유저에 대해 `Promise.all([req, req])` 으로 동시 요청
  - 시나리오: 동시 아이템 사용, 동시 PvP 큐잉, 동시 파티 변경
  - **실패 허용**: JSON 파일 스토리지는 RMW 레이스가 있음 (알려진 제약)
  - 테스트는 증상을 문서화 — 데이터 손실이 발생하는 케이스를 명시
- [ ] Step 2: 간단히 막을 수 있으면 per-user 뮤텍스 (async-mutex 또는 간이 큐)
  - 큰 리팩토링 아니면 진행, 크면 알려진 제약으로 문서화
- [ ] Step 3: `docs/known-limitations.md` 에 결과 기록
- [ ] Commit `test/docs: concurrency regression tests and limitations`

### Task 3.4: 데이터 품질 재확인

- [ ] Step 1: `tests/integration/data-integrity-full.test.ts`
  - 1037 종 전체 순회 — 참조 무결성
  - 기존 J1-J4 확장 버전 (더 엄격)
- [ ] Step 2: 발견된 orphan 수정
- [ ] Commit `test: comprehensive data integrity audit`

### Task 3.5: 에러 응답 일관성

- [ ] Step 1: `tests/integration/error-consistency.test.ts`
  - 모든 라우트에 대해 비정상 입력 주입
  - **4xx/5xx 응답만** `{ error: string }` 검증 (2xx는 각자 포맷 허용, I7)
  - 검증 항목: 인증 없음, 잘못된 JSON, 존재하지 않는 리소스, 잘못된 body
- [ ] Commit `test: add error response consistency checks`

### Task 3.6: 보안 검토

- [ ] Step 1: `tests/integration/security.test.ts`
  - JWT 만료 처리
  - 다른 유저 데이터 접근 시도
  - 파일 경로 조작 (user UID에 `../` 등)
  - admin 라우트 비권한 접근
- [ ] Step 2: 발견된 이슈 수정
- [ ] Commit `test/fix: security review findings`

### Task 3.7: 성능 베이스라인

- [ ] Step 1: `tests/bench/baseline.test.ts` (vitest bench 모드)
  - 서버 시작 시간
  - 데이터 로딩
  - 배틀 턴 처리 (PvP + tower)
  - 매치 기록 조회
  - 타워 AI 생성
- [ ] Step 2: 결과를 `docs/performance-baseline.md` 에 기록
- [ ] Commit `test: add performance baseline benchmarks`

---

## Phase 4: 통합 & 최종 검증

- [ ] Step 1: 전체 테스트 실행 — 1131 + 신규 전부 통과
- [ ] Step 2: 타입 체크 — 에러 없음
- [ ] Step 3: README 업데이트 (배틀 타워, IV 판정 추가)
- [ ] Step 4: Commit `feat: complete IV, Battle Tower, and verification`
