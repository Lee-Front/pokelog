# Code Review Guide

Date: 2026-04-14
Branch: `refactor/codebase-cleanup`

## 리뷰 대상

이번 세션에서 22개 커밋이 추가되었습니다. 이전 작업자가 중단한 PokeAPI 동기화 마이그레이션을 마무리하고, 기능 구현 + 테스트 인프라 구축 + 코드 리뷰 반영까지 진행했습니다.

### 변경 범위

```
커밋: 54b6d37 → f5a5b91 (22개)
테스트: 125개 → 299개
테스트 파일: 22개 → 39개
```

## 리뷰 시 읽어야 할 파일

### 게임 코어 (가장 중요)

| 파일 | 변경 내용 |
|------|----------|
| `packages/server/src/game/battle.ts` | STAB, stat stage multiplier, applyStatChanges |
| `packages/server/src/game/growth.ts` | applyNatureModifier(공유), calculateStatsForLevel에 nature, evolvePokemon에 targetVariantId |
| `packages/server/src/game/pokemon-factory.ts` | resolveSpeciesOrVariant, nature/isShiny 배정, variant slug 해석 |
| `packages/server/src/game/data-loader.ts` | species alias fallback, isValidEncounterSpecies, getNatureById |
| `packages/server/src/routes/battle-routes.ts` | stat stages, meta effects (drain/healing/flinch), async handleFainted, 교체 시 stage 초기화 |

### 인프라 (구조적 변경)

| 파일 | 변경 내용 |
|------|----------|
| `packages/server/src/paths.ts` | getDataDir() 함수 (모듈 로드 시 고정 → 호출 시 평가) |
| `packages/server/src/auth/auth.ts` | process.exit 제거 → lazy getJwtSecret() |
| `packages/server/vitest.config.ts` | globalSetup, fileParallelism, testTimeout |
| `packages/server/tests/api/test-helpers.ts` | setupTestApp, admin() 헬퍼, vi.resetModules |
| `shared/types.ts` | StatStages, nature/isShiny on OwnedPokemon, variantId on WildPokemon |

### 데이터

| 파일 | 변경 내용 |
|------|----------|
| `data/regions/alola.json`, `galar.json`, `hisui.json` | regional variant 인카운터 추가 |
| `scripts/pokeapi/variants.mjs` | variant override sync (typing, baseStats) |
| `packages/server/src/storage/*.ts` | 전부 getDataDir()로 마이그레이션 |

### 테스트 (패턴 확인)

| 디렉토리 | 용도 |
|----------|------|
| `tests/api/` | supertest API 통합 (auth, shop, trade, user, social, admin) |
| `tests/qa/` | 문서 기반 QA (데이터 무결성, 스키마 정합, 게임 메카닉, API 계약) |
| `tests/game/` | 단위 테스트 (battle-stages, variant-encounter, variant-evolution 신규) |
| `packages/cli/tests/logic/` | CLI 순수 함수 테스트 (formatters, trade, pokemon) |

## 리뷰 관점

### 1. 정확성

- 데미지 공식이 올바른가? (STAB, stat stages, type effectiveness, random factor 순서)
- nature 1.1x/0.9x가 모든 스탯 계산 경로에서 일관되게 적용되는가?
- 진화 시 targetVariantId가 모든 호출부에서 전달되는가?
- species alias 해석이 의도치 않은 부작용을 만드는가?

### 2. 안전성

- async/await 체인에 빠진 곳이 있는가?
- 사용자 입력이 검증 없이 파일 경로나 쿼리에 들어가는 곳이 있는가?
- JSON 파일 동시 쓰기 위험이 있는 경로가 있는가?

### 3. 일관성

- 같은 패턴이 다르게 구현된 곳이 있는가?
- 타입 정의(types.ts)와 실제 런타임 객체 간 불일치가 있는가?
- 에러 응답 형태가 라우트마다 다른가?

### 4. 테스트 품질

- 테스트가 구현 세부사항을 테스트하는가, 행동을 테스트하는가?
- 환경 의존적이거나 비결정적인 테스트가 있는가?
- 새로 추가된 기능에 대한 테스트가 충분한가?

### 5. 확장성

- 새 리전/종/기술을 추가할 때 코드 변경이 필요한가, 데이터만 추가하면 되는가?
- 새 배틀 효과(상태이상 등)를 추가할 때 구조가 수용하는가?

## 이전 리뷰에서 수정된 사항

첫 번째 리뷰(코드 리뷰어)에서 HIGH 3건, MEDIUM 7건, LOW 4건이 지적되었고 전부 수정 완료:

- Nature modifier 중복 → 공유 함수 추출
- `null as any` → 타입 명시
- deprecated DATA_DIR → 제거
- STAB 누락 → 구현
- saveUser 미await → async화
- stat stage 교체 미초기화 → 초기화 추가
- variantId 타입 불일치 → `string | null` 통일
- rawConfirm 동적 import → 정적 import
- trade 포맷 함수 중복 → logic에서 import
- 색상 상수 중복 → ui/colors에서 import

## 보고 형식

발견 사항마다:

```
[심각도] 파일:라인 — 문제 설명
→ 제안하는 수정 방향
```

심각도: 🔴 critical, 🟠 high, 🟡 medium, 🔵 low
