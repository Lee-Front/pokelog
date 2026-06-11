# PokeLog 잔여 작업 이어받기 구현 플랜

**Status:** Phase 0-3 and Phase 5 (Tasks 1-14, 18-20) completed. Phase 4 (Tasks 15-17) handled separately under the Trade UX track.

> **Phase 3 note (2026-06-11):** Tasks 11-12 and the encounter half of Task 13 were already implemented in code before this pass (`scripts/pokeapi/variants.mjs`, `--only variants` sync step, `isEggEligible` = regional, region encounter pools carrying variant slugs, `resolveSpeciesOrVariant`-based factory). The remaining gap closed in this pass was the egg system: egg-eligible regional variants are now added to the egg gacha pool of their base species (`packages/server/src/game/egg-gacha.ts`), with tests in `egg-gacha.test.ts`.

> **Phase 5 note (2026-06-11):** Tasks 18-19 were already implemented in code (`determineTurnOrder`/`determineBattleTurnOrder` accept move priority and battle-routes pre-selects the wild move to pass its priority; `scripts/pokeapi/moves.mjs` filters `--` Z-move variants and `pp===0` shadow moves), with priority turn-order tests already present in `battle.test.ts` and `battle-state.test.ts`. The gap closed in this pass: the filter had never been applied to the committed `data/moves/moves.json` (still 969 unfiltered entries), so the same predicate was applied to regenerate it to 915 moves (removed 36 Z-move variants + 18 shadow moves; verified no species learnset referenced any removed move). Task 20 docs updated here.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 이전 작업자(2026-04-13)가 중단한 PokeAPI 동기화 마이그레이션을 마무리하고, 안정화 → 타입 보완 → Variant 활성화 → Trade UX → 배틀 v2까지 순차 진행. 각 Phase 완료 시 문서 갱신.

**Architecture:** monorepo (packages/server + packages/cli + shared/types.ts). 서버는 Express + JSON 파일 스토리지. CLI는 자체 raw-mode TUI. 데이터는 PokeAPI 동기화 파이프라인으로 생성.

**Tech Stack:** TypeScript, Node.js, Express, vitest, raw-mode terminal UI

---

## Phase 0: 이전 작업 마무리 (동기화 스펙 §4 미완성분)

### Task 1: OwnedPokemon에 nature 필드 추가

**Files:**
- Modify: `shared/types.ts:106-125`
- Modify: `packages/server/src/game/pokemon-factory.ts:1-12,67-96`
- Modify: `packages/server/src/game/growth.ts:56-75`
- Modify: `packages/server/src/storage/user-store.ts:106-124`
- Modify: `packages/server/src/game/data-loader.ts:281-286`
- Test: `packages/server/tests/game/growth.test.ts`
- Test: `packages/server/tests/game/pokemon-factory.test.ts`

- [x] **Step 1: shared/types.ts에 nature 필드 추가**

`OwnedPokemon` 인터페이스에 추가 (line 124 뒤):

```typescript
  nature?: string;
```

- [x] **Step 2: pokemon-factory.ts에 nature 랜덤 배정**

import에 `getNatures` 추가 (line 2):

```typescript
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getAllSpeciesList, getNatures } from "./data-loader.js";
```

`createPokemon` 함수 시작부에 nature 선택 로직 추가 (line 72 뒤):

```typescript
  const natures = getNatures();
  const nature = natures.length > 0
    ? natures[Math.floor(Math.random() * natures.length)].id
    : "hardy";
```

return 객체에 `nature` 필드 추가 (line 94 뒤):

```typescript
    nature,
```

- [x] **Step 3: growth.ts에 nature 보정 적용**

`calculateStatsForLevel` 시그니처 변경 (line 56-59):

```typescript
export function calculateStatsForLevel(
  species: string,
  level: number,
  nature?: string,
): { hp: number; maxHp: number; stats: PokemonStats } {
```

stat 계산 뒤 nature 보정 적용 (line 72 뒤, `return` 전):

```typescript
  if (nature) {
    const natureData = getNatureById(nature);
    if (natureData) {
      if (natureData.increasedStat && natureData.increasedStat in stats) {
        stats[natureData.increasedStat] = Math.floor(stats[natureData.increasedStat] * 1.1);
      }
      if (natureData.decreasedStat && natureData.decreasedStat in stats) {
        stats[natureData.decreasedStat] = Math.floor(stats[natureData.decreasedStat] * 0.9);
      }
    }
  }
```

import에 `getNatureById` 추가. data-loader.ts에 헬퍼 추가:

```typescript
export function getNatureById(id: string): NatureData | undefined {
  return getNatures().find((n) => n.id === id);
}
```

- [x] **Step 4: user-store.ts에 nature 기본값 추가**

`normalizeOwnedPokemon` 함수 return 객체에 추가 (line 122 뒤):

```typescript
    nature: pokemon.nature ?? "hardy",
```

`"hardy"`는 neutral nature (스탯 보정 없음)이므로 기존 포켓몬의 스탯이 변하지 않음.

- [x] **Step 5: 기존 호출부에 nature 전달**

`growth.ts`의 `checkLevelUp` 함수에서 `calculateStatsForLevel` 호출 시 nature 전달:

```typescript
const { hp, maxHp, stats } = calculateStatsForLevel(pokemon.species, currentLevel, pokemon.nature);
```

`pokemon-factory.ts`의 `buildStats`에도 nature 반영:

```typescript
function buildStats(species: SpeciesData, level: number, nature?: string): { maxHp: number; stats: PokemonStats } {
  const maxHp = calcHp(species.baseStats.hp, level);
  const stats: PokemonStats = {
    attack: calcStat(species.baseStats.attack, level),
    defense: calcStat(species.baseStats.defense, level),
    speed: calcStat(species.baseStats.speed, level),
    spAttack: calcStat(species.baseStats.spAttack, level),
    spDefense: calcStat(species.baseStats.spDefense, level),
  };

  if (nature) {
    const natureData = getNatureById(nature);
    if (natureData) {
      if (natureData.increasedStat && natureData.increasedStat in stats) {
        stats[natureData.increasedStat] = Math.floor(stats[natureData.increasedStat] * 1.1);
      }
      if (natureData.decreasedStat && natureData.decreasedStat in stats) {
        stats[natureData.decreasedStat] = Math.floor(stats[natureData.decreasedStat] * 0.9);
      }
    }
  }

  return { maxHp, stats };
}
```

`createPokemon`에서 호출:

```typescript
const { maxHp, stats } = buildStats(speciesData, level, nature);
```

- [x] **Step 6: 테스트 업데이트**

`pokemon-factory.test.ts`에 nature 배정 테스트 추가:

```typescript
it("assigns a nature from natures data", () => {
  const pokemon = createPokemon("bulbasaur", 5);
  expect(pokemon.nature).toBeDefined();
  expect(typeof pokemon.nature).toBe("string");
});
```

`growth.test.ts`에 nature 보정 테스트 추가:

```typescript
it("applies nature stat modifier on level up", () => {
  const baseStats = calculateStatsForLevel("bulbasaur", 50);
  const adamantStats = calculateStatsForLevel("bulbasaur", 50, "adamant");
  expect(adamantStats.stats.attack).toBeGreaterThan(baseStats.stats.attack);
  expect(adamantStats.stats.spAttack).toBeLessThan(baseStats.stats.spAttack);
  expect(adamantStats.hp).toBe(baseStats.hp); // HP is unaffected by nature
});
```

- [x] **Step 7: 테스트 실행**

```bash
npm test -w packages/server
```

- [x] **Step 8: 커밋**

```
feat: add nature to OwnedPokemon with stat modifier support
```

---

### Task 2: OwnedPokemon에 isShiny 필드 추가

**Files:**
- Modify: `shared/types.ts:106-125`
- Modify: `packages/server/src/game/pokemon-factory.ts:67-96`
- Modify: `packages/server/src/storage/user-store.ts:106-124`

- [x] **Step 1: shared/types.ts에 isShiny 추가**

`OwnedPokemon`에 추가:

```typescript
  isShiny?: boolean;
```

- [x] **Step 2: pokemon-factory.ts에 isShiny 배정**

`createPokemon` return 객체에 추가:

```typescript
    isShiny: Math.random() < (1 / 4096),
```

- [x] **Step 3: user-store.ts에 기본값 추가**

`normalizeOwnedPokemon` return 객체에:

```typescript
    isShiny: pokemon.isShiny ?? false,
```

- [x] **Step 4: 테스트, 커밋**

```
feat: add isShiny field to OwnedPokemon with 1/4096 chance
```

---

### Task 3: 테스트 fixture 정합성 수정

**Files:**
- Modify: `packages/server/tests/game/held-item-usage.test.ts:6-30`
- Modify: `packages/server/tests/game/item-usage.test.ts:7-31`
- Modify: `packages/server/src/integrations/integration-reward.test.ts:6-30`

- [x] **Step 1: 3개 fixture에 누락 필드 추가**

각 `createUserData()` / `makeUser()` fixture에 추가:

```typescript
    pendingEvolutions: [],
    currentRegion: "default",
```

- [x] **Step 2: 테스트 실행 확인, 커밋**

```
fix: add missing pendingEvolutions and currentRegion to test fixtures
```

---

### Task 4: pokemon-gender.ts 데드코드 수정

**Files:**
- Modify: `packages/server/src/game/pokemon-gender.ts:4-11`

- [x] **Step 1: 조건 명확화**

Line 5의 `genderRate < 0`을 `genderRate < 0`으로 유지하되, line 9의 `genderRate <= 0`을 `genderRate === 0`으로 변경:

```typescript
export function resolvePokemonGender(genderRate: number | undefined, randomValue: number): PokemonGender {
  if (genderRate == null || genderRate < 0) {
    return "genderless";
  }

  if (genderRate === 0) {
    return "male";
  }

  if (genderRate >= 8) {
    return "female";
  }

  return randomValue < (genderRate / 8) ? "female" : "male";
}
```

- [x] **Step 2: 커밋**

```
fix: clarify gender rate boundary in resolvePokemonGender
```

---

## Phase 1: 안정화

### Task 5: getRegion 안전 처리

**Files:**
- Modify: `packages/server/src/game/data-loader.ts:322-328`

- [x] **Step 1: readJsonFile 패턴으로 변경**

```typescript
export function getRegion(name: string): RegionData {
  if (!regionCache.has(name)) {
    const raw = readJsonFile<RawRegionData | null>(`data/regions/${name}.json`, null);
    if (!raw) {
      throw new Error(`Region not found: ${name}`);
    }
    regionCache.set(name, normalizeRegionData(name, raw));
  }
  return regionCache.get(name)!;
}
```

- [x] **Step 2: game-routes.ts /status에 fallback 추가**

```typescript
let regionName = "알 수 없음";
try {
  regionName = getRegion(user.currentRegion ?? "default").name;
} catch {
  // region file missing - use fallback
}
```

- [x] **Step 3: 커밋**

```
fix: use safe readJsonFile in getRegion and add /status fallback
```

---

### Task 6: stale 감사 파일 재생성

**Files:**
- Run: `scripts/generate-species-scaffold.mjs`
- Run: `scripts/generate-pokemon-art-split.mjs`
- Run: `scripts/generate-pokemon-data-audit.mjs`

- [x] **Step 1: 스크립트 실행**

```bash
node scripts/generate-pokemon-art-split.mjs
node scripts/generate-species-scaffold.mjs
node scripts/generate-pokemon-data-audit.mjs
```

- [x] **Step 2: 결과 확인 후 커밋**

```
data: regenerate stale audit files (scaffold, art-split, data-audit)
```

---

### Task 7: evolution-runtime-gaps.mjs 감사 로직 수정

**Files:**
- Modify: `scripts/generate-evolution-runtime-gaps.mjs`

- [x] **Step 1: unsupportedTriggerFamilies 로직 구현**

현재 `unsupportedTriggerFamilies = {}`가 항상 비어있음. trigger 감사 로직 추가:

지원하는 트리거 목록 정의 후, evolution.json을 순회하며 미지원 트리거를 실제로 수집.

- [x] **Step 2: 재생성, 커밋**

```bash
node scripts/generate-evolution-runtime-gaps.mjs
```

```
fix: implement trigger family audit in evolution-runtime-gaps generator
```

---

### Task 8: CLI 불일치 수정

**Files:**
- Modify: `packages/cli/src/index.ts:47`
- Modify: `packages/cli/src/index.ts` (heal 추가)

- [x] **Step 1: leave 인자를 optional로 변경**

Line 47:

```typescript
// Before: program.command("leave <name>").description("leave server").action(leaveCommand);
// After:
program.command("leave [name]").description("leave server").action(leaveCommand);
```

- [x] **Step 2: heal 커맨드 CLI 등록**

```typescript
program.command("heal").description("heal party").action(healCommand);
```

import에 `healCommand` 추가.

- [x] **Step 3: 커밋**

```
fix: register heal in CLI, make leave argument optional
```

---

### Task 9: Phase 0-1 문서 갱신

**Files:**
- Modify: `docs/pokemon-pokeapi-sync-status.md`

- [x] **Step 1: 현재 상태 반영**

Sync status 문서에 다음 업데이트:
- nature 필드 추가 완료
- isShiny 필드 추가 완료
- getRegion 안전 처리 완료
- 감사 파일 재생성 완료
- CLI 불일치 수정 완료

- [x] **Step 2: 커밋**

```
docs: update sync status with Phase 0-1 completion
```

---

## Phase 2: 타입 시스템 보완

### Task 10: WildPokemon에 nature/gender/ability 추가

**Files:**
- Modify: `shared/types.ts:135-142`
- Modify: `packages/server/src/game/pokemon-factory.ts:98-115`

- [x] **Step 1: WildPokemon 인터페이스 확장**

```typescript
export interface WildPokemon {
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  nature?: string;
  gender?: PokemonGender;
  ability?: string;
}
```

- [x] **Step 2: createWildPokemon에 필드 배정**

```typescript
export function createWildPokemon(species: string, level: number): WildPokemon {
  const speciesData = getSpeciesByName(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const natures = getNatures();
  const nature = natures.length > 0
    ? natures[Math.floor(Math.random() * natures.length)].id
    : "hardy";

  const { maxHp, stats } = buildStats(speciesData, level, nature);
  const moves = buildMoves(speciesData, level);

  return {
    species,
    level,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    nature,
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    ability: speciesData.abilities?.normal[0] ?? undefined,
  };
}
```

- [x] **Step 3: 테스트, 커밋**

```
feat: extend WildPokemon with nature, gender, ability
```

---

## Phase 3: Variant 레이어 활성화

### Task 11: variant 오버라이드 데이터 스크립트 작성

**Files:**
- Create: `scripts/pokeapi/variants.mjs`
- Modify: `scripts/sync-pokeapi.mjs`

regional variant의 타입/스탯을 PokeAPI에서 가져와 `variants.json`에 채움.

- [x] **Step 1: variants.mjs 작성**

PokeAPI의 `/pokemon/{variant-slug}` 엔드포인트에서 타입, baseStats를 가져와 기존 variants.json의 `typing`, `baseStatsOverride`에 채움.

- [x] **Step 2: sync-pokeapi.mjs에 variants 단계 추가**

```bash
npm run sync:pokeapi -- --only variants
```

- [x] **Step 3: 커밋**

```
feat: add PokeAPI variant override sync for regional forms
```

---

### Task 12: isEggEligible 스텁 해제

**Files:**
- Modify: `scripts/generate-pokemon-variants.mjs:63-65`

- [x] **Step 1: kind 기반 판정으로 변경**

```javascript
function isEggEligible(kind) {
  return kind === "regional";
}
```

- [x] **Step 2: 재생성, 커밋**

```bash
node scripts/generate-pokemon-variants.mjs
```

```
fix: enable egg eligibility for regional variants
```

---

### Task 13: regional variant 인카운터 연결

**Files:**
- Modify: 리전 JSON 파일들 (`data/regions/*.json`)
- Modify: `packages/server/src/game/data-loader.ts`

해당 리전의 encounters에 regional variant를 추가. 예: `alola.json`에 `vulpix-alola` 추가.

- [x] **Step 1: 리전 파일에 variant 엔트리 추가**
- [x] **Step 2: data-loader의 normalizeRegionData에서 variant 참조 처리**
- [x] **Step 3: 커밋**

```
feat: add regional variants to encounter pools
```

---

### Task 14: Phase 2-3 문서 갱신

- [x] **Step 1: pokemon-variant-model.md 업데이트**
- [x] **Step 2: pokemon-pokeapi-sync-status.md 업데이트**
- [x] **Step 3: 커밋**

```
docs: update variant model and sync status with Phase 2-3 completion
```

---

## Phase 4: Trade UX 완성

### Task 15: trade 커맨드 인터랙티브 UI

**Files:**
- Modify: `packages/cli/src/commands/trade.ts`
- Modify: `packages/cli/src/interactive.ts` (preserveOutput 제거)

기존 raw-mode 패턴(rawSelect, enterRaw, waitKey)을 사용하여 trade 목록 → 상세 → 수락/거절/취소 플로우 구현.

- [ ] **Step 1: rawConfirm 유틸 추가** (`packages/cli/src/ui/prompts.ts`)

```typescript
export async function rawConfirm(message: string): Promise<boolean> {
  process.stdout.write(`  ${message} (y/n) `);
  enterRaw();
  while (true) {
    const key = await waitKey();
    if (key === "y" || key === "Y") {
      process.stdout.write("y\n");
      return true;
    }
    if (key === "n" || key === "N" || key === "\x1b") {
      process.stdout.write("n\n");
      return false;
    }
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
  }
}
```

- [ ] **Step 2: tradeCommand를 인터랙티브로 재작성**

rawSelect 기반 목록 표시 → 선택 시 상세 → 액션 선택 (수락/거절/취소). 새 교환 요청도 메뉴에서 시작 가능.

- [ ] **Step 3: interactive.ts에서 preserveOutput 제거**

```typescript
    case "trade":
      await tradeCommand();
      break; // preserveOutput = true 제거
```

- [ ] **Step 4: 테스트, 커밋**

```
feat: redesign trade command as interactive raw-mode TUI
```

---

### Task 16: equip/unequip 인터랙티브 접근 추가

현재 inventory TUI에서 held item → `/api/game/items/equip`으로 이미 연결됨.
별도 `equip` CLI 커맨드 추가는 불필요 — inventory TUI가 이미 처리.

대신 pokemon detail 화면(`pokemon.ts`)에서 아이템 장착/해제 UI 추가.

- [ ] **Step 1: pokemon.ts에 equip/unequip 액션 추가**
- [ ] **Step 2: 커밋**

```
feat: add held item equip/unequip to pokemon detail screen
```

---

### Task 17: Phase 4 문서 갱신

- [ ] **Step 1: pokemon-trade-system.md 업데이트**
- [ ] **Step 2: 커밋**

```
docs: update trade system doc with interactive UI completion
```

---

## Phase 5: 배틀 v2 기초

### Task 18: 무브 priority 배틀 적용

**Files:**
- Modify: `packages/server/src/game/battle.ts:75-79`
- Modify: `packages/server/src/routes/battle-routes.ts:161`

- [x] **Step 1: determineTurnOrder에 priority 추가**

```typescript
export function determineTurnOrder(
  mySpeed: number,
  wildSpeed: number,
  myMovePriority: number = 0,
  wildMovePriority: number = 0,
): "player" | "wild" {
  if (myMovePriority !== wildMovePriority) {
    return myMovePriority > wildMovePriority ? "player" : "wild";
  }
  if (mySpeed !== wildSpeed) return mySpeed > wildSpeed ? "player" : "wild";
  return Math.random() < 0.5 ? "player" : "wild";
}
```

- [x] **Step 2: battle-routes.ts에서 move priority 전달**

fight 액션 시 선택한 무브의 priority를 `determineTurnOrder`에 전달.

- [x] **Step 3: 테스트 업데이트, 커밋**

```
feat: add move priority to battle turn order
```

---

### Task 19: Z-무브/섀도무브 데이터 필터링

**Files:**
- Modify: `scripts/pokeapi/moves.mjs`

- [x] **Step 1: sync 시 필터 추가**

`id`에 `--`가 포함된 Z-무브 변형과 `pp === 0`인 섀도무브를 필터링.

- [x] **Step 2: 재동기화, 커밋**

```bash
npm run sync:pokeapi -- --only moves
```

```
data: filter Z-move variants and shadow moves from moves.json
```

---

### Task 20: Phase 5 문서 갱신 + 전체 진행상황 업데이트

- [x] **Step 1: pokemon-pokeapi-sync-status.md 최종 갱신**
- [x] **Step 2: pokemon-mechanics-architecture.md 현재 상태 반영**
- [x] **Step 3: 본 플랜 문서에 완료 체크 마킹**
- [x] **Step 4: 커밋**

```
docs: final documentation update after all phases complete
```
