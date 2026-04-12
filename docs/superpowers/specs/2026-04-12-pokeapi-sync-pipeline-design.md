# PokeAPI Sync Pipeline Design

Date: 2026-04-12

## Purpose

PokeAPI를 데이터 소스로 사용하여 프로젝트의 포켓몬 데이터(종, 기술, 진화, 특성, 성격, 아이템)를 로컬 JSON으로 동기화하는 파이프라인을 설계한다.

## Scope

- 905 베이스 종 (8세대 + Legends Arceus, 아트 로스터 기준)
- Learnset 기준 버전: Sword/Shield (폴백 체인 있음)
- 대상 데이터: species, moves, evolutions, abilities, natures, items
- 스키마 확장 + sync 스크립트 + 런타임 마이그레이션 포함

## Excluded

- 9세대 (Scarlet/Violet) 포켓몬 (아트 없음)
- egg-gacha.ts 데이터 드리븐 전환 (별도 태스크)
- battle.ts priority/meta/statChanges 활용 (배틀 v2 별도 태스크)
- VariantData 레이어 (아키텍처 문서 step 4에서 처리)

---

## 1. Architecture

### 파일 구조

```
scripts/
  sync-pokeapi.mjs              ← 진입점 (CLI 파싱, 오케스트레이션)
  pokeapi/
    cache.mjs                   ← API 응답 캐시 (원자적 쓰기, try/catch 읽기)
    fetch.mjs                   ← rate-limited fetch (동시성 10, 지수 백오프 재시도)
    species.mjs                 ← 종 데이터 변환
    moves.mjs                   ← 기술 데이터 변환
    evolutions.mjs              ← 진화 체인 변환
    abilities.mjs               ← 특성 변환
    natures.mjs                 ← 성격 변환
    items.mjs                   ← 아이템 변환

.cache/pokeapi/                 ← gitignore, API 원본 JSON
  pokemon/{id}.json
  pokemon-species/{id}.json
  move/{name}.json
  evolution-chain/{id}.json
  ...

data/                           ← 변환 결과 (git 추적)
  pokemon/species.json
  pokemon/evolution.json
  pokemon/catch-rate-overrides.json   ← 운영자 커스텀, sync가 건드리지 않음
  moves/moves.json
  abilities/abilities.json            ← 신규
  natures/natures.json                ← 신규
  items/items.json                    ← 신규
```

### CLI

package.json에 추가: `"sync:pokeapi": "node scripts/sync-pokeapi.mjs"`

```bash
npm run sync:pokeapi                     # 전체 동기화
npm run sync:pokeapi -- --only species   # 종만
npm run sync:pokeapi -- --only moves     # 기술만
npm run sync:pokeapi -- --only evolutions
npm run sync:pokeapi -- --only abilities
npm run sync:pokeapi -- --only natures
npm run sync:pokeapi -- --only items
npm run sync:pokeapi -- --no-cache       # 캐시 무시, 전부 재호출
npm run sync:pokeapi -- --dry-run        # 미리보기 (파일 쓰기 안 함)
```

---

## 2. Schema Changes

### EvolutionData (완전 교체)

```ts
interface EvolutionCondition {
  level?: number;
  item?: string;
  heldItem?: string;
  friendship?: number;
  timeOfDay?: "day" | "night";
  knownMove?: string;
  knownMoveType?: string;
  gender?: "male" | "female";
  location?: string;
  statCompare?: "atk-gt-def" | "atk-lt-def" | "atk-eq-def";
  partySpecies?: string;
  extra?: Record<string, unknown>;
}

interface EvolutionBranch {
  targetSpecies: string;
  targetVariant?: string;
  trigger: "level-up" | "use-item" | "trade" | "other";
  conditions: EvolutionCondition[];  // AND 로직
}

// evolution.json: Record<string, { branches: EvolutionBranch[] }>
```

### SpeciesData (확장)

```ts
interface SpeciesData {
  id: number;
  species: string;
  name: string;                    // 한글 (없으면 영문 fallback)
  types: string[];
  baseStats: {
    hp: number; attack: number; defense: number;
    spAttack: number; spDefense: number; speed: number;
  };
  catchRate: number;               // 0-1, 공식: rawCaptureRate / 255
  rawCaptureRate: number;          // 0-255, PokeAPI 원본
  expGroup: string;                // PokeAPI growth_rate.name과 동일
  baseExpYield: number;
  learnset: SpeciesLearnset;       // 기존 SpeciesLearnset 구조 변경 없음
  maxMoves: number;                // 항상 4
  abilities: { normal: string[]; hidden?: string };
  eggGroups: string[];
  /** -1=무성, 0~8 (암컷 비율을 8분율로 표현) */
  genderRate: number;
  baseHappiness: number;
  isBaby: boolean;
  isLegendary: boolean;
  isMythical: boolean;
}
```

### MoveData (확장)

```ts
interface MoveData {
  id: string;
  name: string;                    // 한글
  type: string;
  category: "physical" | "special" | "status";
  power: number;
  accuracy: number;
  pp: number;
  description: string;             // 한글
  priority: number;
  target: "selected-pokemon" | "all-opponents" | "user"
    | "all-other-pokemon" | "all-pokemon" | "user-and-allies"
    | "entire-field" | "opponents-field" | "users-field"
    | "random-opponent" | "specific-move" | string;
  meta: {
    ailment?: string;
    ailmentChance?: number;
    critRate?: number;
    drain?: number;
    flinchChance?: number;
    healing?: number;
    statChance?: number;
    minHits?: number;
    maxHits?: number;
  };
  statChanges: Array<{ stat: string; change: number }>;
}
```

### OwnedPokemon (확장)

```ts
interface OwnedPokemon {
  uid: string;
  species: string;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  caughtAt: string;
  // 신규 optional
  friendship?: number;
  heldItem?: string | null;
  abilityId?: string | null;
}
```

### 신규 타입

```ts
interface AbilityData {
  id: string;
  name: string;                    // 한글
  shortEffect: string;             // 한글
  isMainSeries: boolean;
}

type StatName = "attack" | "defense" | "spAttack" | "spDefense" | "speed";

interface NatureData {
  id: string;
  name: string;                    // 한글
  increasedStat: StatName | null;
  decreasedStat: StatName | null;
}

interface ItemData {
  id: string;
  name: string;                    // 한글
  category: string;
  cost: number;
  shortEffect: string;
}
```

---

## 3. Sync Pipeline Flow

### 실행 순서 (전체 sync)

```
1. natures     (25건, 의존성 없음)
2. abilities   (~300건, 의존성 없음)
3. items       (~200건 필터 후, 의존성 없음)
4. moves       (~920건 전체, 의존성 없음)
5. species     (905건, 의존성 없음 — moves/abilities 참조는 검증에서 경고)
6. evolutions  (~480 체인, 독립 fetch — /evolution-chain?limit=500)
```

`--only`로 개별 실행 가능. 의존성 누락은 경고만 출력, 차단하지 않음.

### 도메인별 상세

**natures**
- `GET /api/v2/nature?limit=25` → 목록
- 각 nature → NatureData 변환 (stat name 매핑: `special-attack` → `spAttack`)
- 출력: `data/natures/natures.json`

**abilities**
- `GET /api/v2/ability?limit=400` → 목록
- 각 ability → AbilityData 변환 (한글명, isMainSeries)
- 출력: `data/abilities/abilities.json`

**items**
- `GET /api/v2/item?limit=2000` → 목록
- 카테고리 필터 (PokeAPI slug 기준): `evolution`, `healing`, `standard-balls`, `special-balls`, `held-items`, `stat-boosts`
- 각 item → ItemData 변환
- 출력: `data/items/items.json`

**moves**
- 전체 fetch (~920건), species 의존성 없음
- 각 move → MoveData 변환 (한글명, meta, statChanges, priority, target)
- 출력: `data/moves/moves.json`

**species**
- `art-species-split.json`의 `baseSpeciesSlugs` (905종) 기준
- 각 종 → `GET /pokemon/{name}` + `GET /pokemon-species/{name}`
- 변환:
  - baseStats: stat name 매핑 (`special-attack` → `spAttack`)
  - learnset: 버전 우선순위 필터 (아래 참조)
  - catchRate: `rawCaptureRate / 255`
  - 한글명: `names[ko]`, 없으면 영문 fallback + 경고
- 출력: `data/pokemon/species.json`

**evolutions**
- `GET /api/v2/evolution-chain?limit=500` → 전체 체인 목록 (독립 fetch)
- 재귀 탐색 → `EvolutionBranch[]` 변환
  - trigger 매핑
  - conditions 조합 (level, item, friendship, timeOfDay 등)
  - 희귀 조건 → `extra`에 보존
- 905 베이스 종에 해당하는 체인만 필터
- 출력: `data/pokemon/evolution.json`

### Learnset 버전 폴백 체인

```
1. sword-shield
2. legends-arceus
3. scarlet-violet
4. ultra-sun-ultra-moon
5. 아무 버전이든 가장 최신
```

해당 종에 Sword/Shield 데이터가 없으면 순서대로 폴백.

### Fetch 전략

- 동시성: 10개 병렬 (세마포어 패턴)
- 딜레이 없음 (동시성 제한으로 충분)
- 재시도: 429/5xx → 지수 백오프 (1s, 2s, 4s), 최대 3회
- 진행률: 도메인 레벨 (`=== species (5/6) ===`) + 아이템 레벨 (`[142/905]`)
- 예상 소요: ~2분 (캐시 없는 cold run)

### 캐시 전략

- 위치: `.cache/pokeapi/{endpoint}/{id}.json`
- 쓰기: `.tmp` 파일 → `rename` (원자적, Windows EPERM 대응 포함)
- 읽기: `try/catch`, 깨진 파일 자동 삭제 후 재요청
- `--no-cache`: 캐시 무시, 전부 재호출
- `.cache/` → `.gitignore` 추가

### 출력 전 검증

1. 건수 확인 (species 905건, natures 25건 등)
2. 필수 필드 존재 여부 (id, name, types 등)
3. 중복 ID 체크
4. 참조 무결성:
   - species learnset의 move ID가 `moves.json`에 존재하는지
   - evolution의 `targetSpecies`가 `species.json`에 존재하는지
   - species types가 `type-chart.json`에 존재하는지
   - catchRate 범위 [0, 1] 확인
5. 실패 시 덮어쓰기 거부 + 에러 출력

### --dry-run

- 캐시 활용 로컬 미리보기 (fetch는 캐시 miss분만)
- 파일 쓰기 대신 변경 요약 출력: `species: 885 added, 20 updated, 0 removed`

### catchRate 정책

- sync 스크립트는 항상 공식값 산출: `rawCaptureRate / 255`
- `data/pokemon/catch-rate-overrides.json`에 운영자가 종별 커스텀 값 지정 가능
- `data-loader.ts`가 species 데이터를 로드할 때 overrides를 merge하여 `catchRate` 필드를 덮어씀
- 이후 `capture.ts` 등 소비자는 변경 없이 기존처럼 `catchRate`를 읽으면 됨
- sync 스크립트는 overrides 파일을 절대 건드리지 않음
- overrides 파일이 없으면 초기 상태는 `{}` (빈 객체)

```json
// data/pokemon/catch-rate-overrides.json (예시)
{
  "bulbasaur": 0.12,
  "charmander": 0.10
}
```

---

## 4. Runtime Code Migration

### 사전 리팩터링

`admin-routes.ts`와 `commit-processor.ts`에 중복된 진화 처리 로직을 공통 함수로 추출한 뒤 마이그레이션 진행.

### 마이그레이션 대상 파일

| Phase | 파일 | 변경 내용 |
|-------|------|----------|
| 1 | `shared/types.ts` | EvolutionBranch/EvolutionCondition 신규, SpeciesData 필드 추가, MoveData 필드 추가 (신규 필드는 optional), AbilityData/NatureData/ItemData 신규, OwnedPokemon optional 필드 추가 |
| 2+3 | `data-loader.ts` | `getEvolutions()` 리턴 타입 변경, `getAbilities()`/`getNatures()`/`getItems()` 로더 추가, catch-rate-overrides 로드 시 species 데이터에 merge |
| 2+3 | `growth.ts` | `checkEvolution(pokemon: OwnedPokemon): string \| null` — branches 배열 순회, trigger별 조건 평가. 현재 지원 조건: level, item, friendship, timeOfDay. 미지원 조건(location, partySpecies 등)은 무시하고 경고 로그 |
| 2+3 | `admin-routes.ts` | 공통 진화 처리 함수 호출로 교체 |
| 2+3 | `commit-processor.ts` | 공통 진화 처리 함수 호출로 교체 |

> **주의**: Phase 2와 3은 원자적으로 같이 진행해야 한다. `getEvolutions()` 리턴 타입을 변경하면 소비자(`growth.ts` 등)도 동시에 수정하지 않으면 컴파일이 깨진다.
| 4 | `pokemon-factory.ts` | friendship 초기값 (`baseHappiness`), abilityId 랜덤 배정 |
| 4 | `user-store.ts` | `normalizeUserData()`에서 새 OwnedPokemon 필드 기본값 처리 |
| 5 | `data-loader.test.ts` | 새 스키마 fixture 및 assertion |
| 5 | `growth.test.ts` | `checkEvolution` 테스트 업데이트 |
| 5 | `battle.test.ts` | MoveData fixture에 optional 신규 필드 |
| 5 | `capture.test.ts` | catchRate overrides 적용 검증 (data-loader 경유) |

### 별도 태스크 (이 설계 범위 밖)

- `egg-gacha.ts`: 하드코딩 풀 → 데이터 드리븐 전환
- `battle.ts` + `battle-routes.ts`: move priority, meta/statChanges 활용 (배틀 v2)

### 하위 호환성

- `OwnedPokemon`의 신규 필드는 전부 optional
- `user-store.ts`의 `normalizeUserData()`에서 기본값 부여:
  - `friendship`: 없으면 70 (가장 흔한 baseHappiness)
  - `heldItem`: 없으면 `null`
  - `abilityId`: 없으면 `null`
- `MoveData`의 신규 필드(`priority`, `target`, `meta`, `statChanges`)는 optional로 선언하여 기존 battle.ts 코드가 깨지지 않도록 함. 배틀 v2에서 required로 전환.

---

## 5. Data Flow Summary

```
PokeAPI (remote)
    │
    ▼
.cache/pokeapi/ (raw JSON, gitignored)
    │
    ▼
scripts/sync-pokeapi.mjs + scripts/pokeapi/*.mjs (transform)
    │
    ▼
data/*.json (git tracked)
    │
    ▼
data-loader.ts (runtime load + cache in memory + overrides merge)
    │
    ▼
game logic (growth.ts, capture.ts, pokemon-factory.ts, ...)
```

---

## 6. PokeAPI → Project Field Mapping Reference

### Species

| PokeAPI field | Project field | Transform |
|--------------|---------------|-----------|
| `pokemon.id` | `id` | 그대로 |
| `pokemon.name` | `species` | 그대로 |
| `pokemon-species.names[ko]` | `name` | 한글, 없으면 영문 fallback |
| `pokemon.types[].type.name` | `types` | 배열 추출 |
| `pokemon.stats[].base_stat` | `baseStats.*` | `special-attack` → `spAttack` 등 매핑 |
| `pokemon-species.capture_rate` | `rawCaptureRate` | 그대로 (0-255) |
| — | `catchRate` | `rawCaptureRate / 255` |
| `pokemon-species.growth_rate.name` | `expGroup` | 그대로 |
| `pokemon.base_experience` | `baseExpYield` | 그대로 |
| `pokemon.moves[]` | `learnset` | sword-shield 필터 + method별 분류 |
| `pokemon.abilities[]` | `abilities` | slot 1,2 → normal, slot 3 → hidden |
| `pokemon-species.egg_groups[]` | `eggGroups` | name 추출 |
| `pokemon-species.gender_rate` | `genderRate` | 그대로 (-1~8) |
| `pokemon-species.base_happiness` | `baseHappiness` | 그대로 |
| `pokemon-species.is_baby` | `isBaby` | 그대로 |
| `pokemon-species.is_legendary` | `isLegendary` | 그대로 |
| `pokemon-species.is_mythical` | `isMythical` | 그대로 |

### Moves

| PokeAPI field | Project field | Transform |
|--------------|---------------|-----------|
| `move.name` | `id` | 그대로 (slug) |
| `move.names[ko]` | `name` | 한글 |
| `move.type.name` | `type` | 그대로 |
| `move.damage_class.name` | `category` | 그대로 |
| `move.power` | `power` | null → 0 |
| `move.accuracy` | `accuracy` | null → 0 |
| `move.pp` | `pp` | 그대로 |
| `move.flavor_text_entries[ko]` | `description` | 한글, 최신 버전 그룹 우선 |
| `move.priority` | `priority` | 그대로 |
| `move.target.name` | `target` | 그대로 |
| `move.meta.*` | `meta.*` | camelCase 변환 |
| `move.stat_changes[]` | `statChanges` | stat name 매핑 |

### Evolutions

| PokeAPI field | Project field | Transform |
|--------------|---------------|-----------|
| `chain.evolves_to[].species.name` | `targetSpecies` | 그대로 |
| `evolution_details[].trigger.name` | `trigger` | 그대로 |
| `evolution_details[].min_level` | `conditions[].level` | 그대로 |
| `evolution_details[].item.name` | `conditions[].item` | 그대로 |
| `evolution_details[].held_item.name` | `conditions[].heldItem` | 그대로 |
| `evolution_details[].min_happiness` | `conditions[].friendship` | 그대로 |
| `evolution_details[].time_of_day` | `conditions[].timeOfDay` | 그대로 |
| `evolution_details[].known_move.name` | `conditions[].knownMove` | 그대로 |
| `evolution_details[].known_move_type.name` | `conditions[].knownMoveType` | 그대로 |
| `evolution_details[].gender` | `conditions[].gender` | 1→female, 2→male |
| `evolution_details[].location.name` | `conditions[].location` | 그대로 |
| `evolution_details[].relative_physical_stats` | `conditions[].statCompare` | 1→`atk-gt-def`, -1→`atk-lt-def`, 0→`atk-eq-def` |
| 기타 희귀 조건 | `conditions[].extra` | 원본 보존 |

### Natures

| PokeAPI field | Project field | Transform |
|--------------|---------------|-----------|
| `nature.name` | `id` | 그대로 |
| `nature.names[ko]` | `name` | 한글 |
| `nature.increased_stat.name` | `increasedStat` | stat name 매핑 |
| `nature.decreased_stat.name` | `decreasedStat` | stat name 매핑 |

### Stat Name Mapping

> 이 매핑은 species baseStats, moves statChanges 등 전반에 사용되는 범용 매핑이다.
> `NatureData`의 `StatName` union 타입은 HP를 제외한 5개만 포함 (성격은 HP를 수정하지 않음).

| PokeAPI | Project |
|---------|---------|
| `hp` | `hp` |
| `attack` | `attack` |
| `defense` | `defense` |
| `special-attack` | `spAttack` |
| `special-defense` | `spDefense` |
| `speed` | `speed` |
