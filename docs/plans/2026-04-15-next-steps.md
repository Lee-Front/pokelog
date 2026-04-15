# Next Steps

Date: 2026-04-15

## 현재 상태

코드베이스 정리와 품질 강화가 완료된 상태. 서버/CLI 모두 빌드 통과, 599개 테스트 전부 통과.

### 완료된 작업 요약

- battle-routes.ts 분리 (1092→438줄), game-routes.ts 분리 (962→295줄, 5개 도메인 라우트)
- user-routes.ts integration parser 추출 (530→363줄)
- 게임 로직/HTTP 분리 (handleFainted, doWildAttackAndCheck에서 Express Response 제거)
- 공유 헬퍼 추출 (findPokemonByUid, getPartyPokemon, TradePokemonCandidate)
- CLI 화면 런타임 통합, dead code 제거, 터미널 안정성 강화
- 크리티컬 버그 수정 (혼란 레벨, 트레이드 아카이브, 폴링 중복, 포획 0나누기)
- 입력 검증, admin 화이트리스트, 에러 응답 표준화
- 테스트 492→599개 (7개 미테스트 모듈 커버, 에러/엣지케이스 추가)
- continuation-work.md Phase 0-2 (Task 1-10) 완료

---

## 남은 작업: 인프라 개선

코드 품질 감사에서 발견된 구조적 개선 사항. 기능 추가 전에 해결 권장.

### 1. getAllUsers() 스케일링 (HIGH)

**문제:** `user-store.ts`의 `getAllUsers()`가 모든 유저 JSON을 메모리에 로드. `findUserByEmail`, `searchUsersByIdentity`, `getUsersForRepoCommit` 등에서 호출.

**해결 방향:**
- 이메일/닉네임 → userId 인덱스 파일 생성 (JSON)
- `findUserByEmail`을 인덱스 기반 단건 조회로 변경
- `getAllUsers`는 admin/ranking에서만 사용하도록 제한

**영향 범위:** `packages/server/src/storage/user-store.ts`, 호출하는 라우트/폴링 파일

### 2. 구조적 로깅 (MEDIUM)

**문제:** 서버 67개, CLI 192개의 `console.log/error` 호출이 포맷/레벨 없이 사용됨. 프로덕션 디버깅 불가.

**해결 방향:**
- pino 또는 winston 도입
- 로그 레벨 (debug/info/warn/error) 적용
- 타임스탬프, 요청 ID 포함
- CLI는 현재 패턴 유지 (TUI 출력이므로)

**영향 범위:** `packages/server/src/` 전체

### 3. Rate Limiting (MEDIUM)

**문제:** 모든 엔드포인트에 속도 제한 없음. 인증 브루트포스, 공개 API 스팸 가능.

**해결 방향:**
- `express-rate-limit` 미들웨어 추가
- 인증 라우트: 엄격 (분당 10회)
- 게임 라우트: 보통 (분당 60회)
- 공개 라우트 (art, meta): 느슨 (분당 120회)

**영향 범위:** `packages/server/src/app.ts`

### 4. UserData 타입 분리 (LOW)

**문제:** `UserData` 인터페이스가 19개 프로퍼티의 God Object. 계정/게임상태/진행도/설정이 혼합.

**해결 방향:**
- `UserAccount` (account, password, nickname)
- `GameProgress` (points, totalExp, combo)
- `PokemonCollection` (party, pokemon, storage, eggs)
- `UserIntegrations` (integrations)
- `UserData`는 이들의 합성 타입으로 유지

**영향 범위:** `shared/types.ts`, 전체 import 경로

---

## 남은 작업: 기능 구현

`docs/plans/2026-04-14-continuation-work.md`의 미완료 Phase 3-5.

### Phase 3: Variant 레이어 활성화 (Tasks 11-14)

**목표:** 지역 변종(알로라/가라르 등) 시스템을 실제 게임플레이에 연결

- Task 11: PokeAPI variant 동기화 스크립트 확장
- Task 12: 지역별 변종 조우 풀 연결
- Task 13: 에그 시스템에 변종 후보 추가
- Task 14: variant 관련 문서 갱신

**선행 조건:** 없음 (독립 작업)

### Phase 4: Trade UX (Tasks 15-17)

**목표:** 트레이드 시스템의 인터랙티브 TUI 개선

- Task 15: raw-mode TUI로 트레이드 요청/수락/거절 UI 구현
- Task 16: 트레이드 진화 흐름 연결 (현재 API만 존재, CLI 흐름 미구현)
- Task 17: 트레이드 문서 갱신

**선행 조건:** 없음 (이미 API 존재)

### Phase 5: Battle v2 기반 (Tasks 18-20)

**목표:** 배틀 시스템 정확도 향상

- Task 18: 기술 우선도(priority) 시스템 구현
- Task 19: Z-move/shadow-move 필터링
- Task 20: 배틀 v2 문서화

**선행 조건:** Phase 3 (variant 활성화) 권장

---

## 권장 실행 순서

```
1. getAllUsers 스케일링     ← 데이터 무결성 직결
2. Phase 3: Variant 활성화 ← 기능 확장의 기반
3. Phase 4: Trade UX       ← 유저 경험 개선
4. 구조적 로깅             ← 운영 안정성
5. Rate Limiting           ← 보안
6. Phase 5: Battle v2      ← 게임 깊이
7. UserData 타입 분리      ← 장기 유지보수
```

## 변경하면 안 되는 것

- CLI 단일 프레임 원칙 (in-place redraw, 출력 누적 금지)
- 공유 Pokemon 상태/스탯 모듈 사용 (pokemon-state.ts, pokemon-stats.ts)
- findPokemonByUid/getPartyPokemon 헬퍼 사용 (로컬 중복 금지)
- connect.ts는 건드릴 때 레거시 텍스트 정리 병행

## 검증 명령어

```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```
