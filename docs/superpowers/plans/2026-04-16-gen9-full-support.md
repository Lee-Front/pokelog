# Gen 9 Full Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pokemon Scarlet/Violet(Gen 9)을 완전 지원한다. 포켓몬 906-1025번, 테라스탈 시스템, 합체 시스템(Kyurem/Necrozma/Calyrex), Gen 9 특성/기술 전부 구현.

**Architecture:** 기존 레지스트리 시스템(pvp-moves, pvp-abilities, pvp-items)에 Gen 9 내용을 등록. 테라스탈은 기존 변신 시스템(mega/gmax/dynamax) 확장. 합체는 배틀 외 API/UI, Ultra Burst만 배틀 내. 1:1 싱글 배틀 호환성 전제.

**Tech Stack:** 기존 TypeScript/Vitest + PokeAPI 싱크 스크립트.

---

## Design Notes (로직 설계)

### 리뷰 대응 사항 요약

1. `CustomResolveResult`에 `overrideMove` 지원 (Tera Blast, Ivy Cudgel 등 타입 변경 필수)
2. Adaptability는 기존 onAttack 유지, `computeStab`에서도 명시적 처리 (2.0x STAB for non-Tera-matching, 2.25x for combined)
3. `originalTypes`는 `getEffectiveTypes(species, variantId, null)`로 초기화 (Mega/Ogerpon 폼 반영)
4. Tera Type 기본값은 `getEffectiveTypes(...)[0]`, Ogerpon 마스크는 마스크 타입 강제
5. 상태 필드 Pokemon vs Player 구분 명시 (rageFistHits/stellarTypesUsed는 Pokemon, 나머지는 Player)
6. Paradox Boost (Booster Energy) 별도 Task로 분리
7. Species slug 리스트는 기존 데이터셋과 대조 후 신규만 추가

### 테라스탈 설계 결정

**스토리지:**
- `OwnedPokemon.teraType: string` (기본값 = `getEffectiveTypes(species, variantId, null)[0]`; Ogerpon 마스크는 마스크 타입 강제)
- `PvpPokemon.teraType: string`
- `PvpPokemon.originalTypes: string[]` (per-pokemon; 배틀 시작 시 `getEffectiveTypes`로 초기화)
- `PvpPokemon.stellarTypesUsed: string[]` (per-pokemon; Stellar 테라 포켓몬용)
- `PvpPlayerState.teraActive: boolean` (현재 테라스탈 상태인지)
- `PvpPlayerState.transformationUsed` 재사용 (변신 슬롯 — mega/gmax/dynamax/tera 중 하나)
- `PvpAction.fight.tera?: boolean`

**타입 오버라이드:**
- Terastalized 상태에서 `getEffectiveTypes()` 는 `[teraType]` 반환
- 기존 타입은 STAB 계산을 위해 별도 저장 (`originalTypes`)

**STAB 계산 (Adaptability 포함):**
- 기본 STAB 1.5x (기존)
- Adaptability: STAB 2.0x (non-Tera)
- Tera STAB 규칙:
  - `moveType === teraType && originalTypes.includes(moveType)` → combined STAB: **2.0x** (또는 Adaptability면 **2.25x**)
  - `moveType === teraType && !originalTypes.includes(moveType)` → new STAB only: **1.5x** (Adaptability는 canon상 원본 타입에만 적용이라 일관성을 위해 유지: **1.5x**)
  - `originalTypes.includes(moveType) && moveType !== teraType` → original STAB preserved: **1.5x** (Adaptability면 **2.0x**)
  - 외 → **1.0x**

**구현 방식:**
- 기존 `calculateDamage`의 내부 STAB 계산은 제거, `stabMultiplier` 파라미터로 전달
- pvp-room.ts의 `computeStab()` 헬퍼가 위 규칙 적용
- battle-state.ts (PvE)도 동일 로직 사용하도록 마이그레이션 (기존 Adaptability 동작 보존)

**Tera Blast:**
- customResolve의 `overrideMove` 반환 사용 (신규 기능)
- `CustomResolveResult` 확장: `boolean | { redirectTo: string } | { overrideMove: Partial<MoveData> }`
- pvp-room.ts: overrideMove 반환 시 `moveData` / `effectiveMoveData`에 머지 후 정상 흐름 계속
- Terastalized: type=`teraType`, category=`atk > spAtk ? physical : special`
- 아닐 때: Normal, special, 80 BP (기본)

**Stellar Tera Type:**
- Terapagos-Stellar / Ogerpon 전용
- 각 타입의 첫 공격에 1.2x 보너스 (한 번씩만)
- Terastalized 상대에게 super-effective (2.0x)
- `PvpPlayerState.stellarTypesUsed: string[]` 추가

### 합체 설계 결정

**합체 포켓몬 처리:**
- 합체 후 포켓몬 = 독립 species (kyurem-black, calyrex-ice-rider 등)
- species.json에 별도 엔트리 추가 (sync로 가져옴)
- `OwnedPokemon.fusedPartnerUid?: string` (해제용)
- `OwnedPokemon.fusedPartnerData?: Partial<OwnedPokemon>` (해제 시 복구 데이터)

**합체 API:**
- `POST /fusion/fuse { userUid, baseUid, partnerUid, itemId }`
- `POST /fusion/unfuse { userUid, fusedUid }`

**Ultra Burst (Necrozma):**
- 배틀 내 변신 (Mega 패턴과 동일)
- Dusk Mane + Ultra Necrozium Z → Ultra Necrozma
- `PvpAction.fight.ultraBurst?: boolean` 추가 (또는 기존 `mega` 재사용)

### Gen 9 특성 설계

**새 훅 필요:**
- `onStatBoostTrigger` (Opportunist — 상대 스탯 상승 시 복사)
- `onSwitchInOnce` (Supersweet Syrup — 1회 한정)
- `onTerastalize` (Embody Aspect — 테라 시 발동)
- `absorbMove` (Earth Eater, Well-Baked Body — 흡수 + 효과)

**기존 훅 재사용:**
- Supreme Overlord → onMoveUse (쓰러진 아군 수 계산)
- Good as Gold → canReceiveStatus / 독립 플래그
- Mind's Eye → 기존 Scrappy + Keen Eye 조합
- Armor Tail → onDefense + priority check

### Gen 9 기술 설계

**대부분 기존 훅으로 커버:**
- Trailblaze/Aqua Step → onHit + applyStatChanges (이미 statChanges로 처리됨)
- Chilling Water / Torch Song → 동일
- Population Bomb → multi-hit (minHits/maxHits 이미 지원)
- Ice Spinner → onHit (terrain 제거)
- Salt Cure → applyEffect (volatile 추가)

**customResolve 필요:**
- Tera Blast (타입/카테고리 동적)
- Shed Tail (sub + switch)
- Upper Hand (priority check + flinch)
- Ivy Cudgel (Ogerpon 폼별 타입)
- Doodle (특성 복사)
- Revival Blessing (1:1에선 무의미)
- Comeuppance (Counter 변종)
- Double Shock (타입 제거)

**새 플래그:**
- `slicing: true` (Sharpness 특성용)
- `wind: true` (Wind Power/Rider 용)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/tests/pvp/pvp-gen9-terastal.test.ts` | 테라스탈 테스트 |
| `packages/server/tests/pvp/pvp-gen9-abilities.test.ts` | Gen 9 특성 테스트 |
| `packages/server/tests/pvp/pvp-gen9-moves.test.ts` | Gen 9 기술 테스트 |
| `packages/server/tests/simulation/fusion-sim.test.ts` | 합체 시뮬레이션 |
| `packages/server/src/game/fusion.ts` | 합체 로직 |
| `packages/server/src/routes/fusion-routes.ts` | 합체 API 엔드포인트 |

### Modified Files
| File | Change |
|------|--------|
| `scripts/pokeapi/common.mjs` | LEARNSET_VERSION_GROUP_PRIORITY에서 scarlet-violet 최우선 |
| `data/pokemon/art-species-split.json` | 906-1025번 species 추가 |
| `shared/types.ts` | teraType 필드, fusedPartnerUid 등 |
| `shared/pvp-types.ts` | PvpPokemon.teraType, PvpPlayerState.teraActive/originalTypes/stellarTypesUsed, PvpTransformationType에 "tera"/"ultra-burst" 추가, PvpAction.fight.tera/ultraBurst |
| `packages/server/src/game/pokemon-state.ts` | getEffectiveTypes가 teraActive 체크 |
| `packages/server/src/game/battle.ts` | STAB 계산에 Tera 보정 |
| `packages/server/src/pvp/pvp-moves.ts` | Tera Blast + Gen 9 기술 ~30개 등록 |
| `packages/server/src/pvp/pvp-abilities.ts` | Gen 9 특성 ~25개 등록 + 새 훅 |
| `packages/server/src/pvp/pvp-room.ts` | 테라스탈 훅 통합 |
| `packages/server/src/pvp/pvp-socket.ts` | userPartyToPvp에 teraType/originalTypes 복사 |

---

## Phase 1: 데이터 싱크 (Gen 9)

### Task 1.1: LEARNSET 우선순위 변경

- [ ] Step 1: `scripts/pokeapi/common.mjs` 수정

```javascript
export const LEARNSET_VERSION_GROUP_PRIORITY = [
  "scarlet-violet",      // Gen 9 최우선
  "sword-shield",
  "legends-arceus",
  "ultra-sun-ultra-moon",
];
```

### Task 1.2: Gen 9 종 목록 추가

**중요**: 기존 `art-species-split.json`에 이미 있는 종(kyurem/reshiram/zekrom/necrozma/solgaleo/lunala/calyrex/glastrier/spectrier)은 **중복 추가 금지**. 아래 리스트에서 "이미 있는 것" 제거 후 merge.

- [ ] Step 0: 기존 슬러그 확인
```bash
cat data/pokemon/art-species-split.json | jq '.baseSpeciesSlugs | length'
```

- [ ] Step 1: Gen 9 *신규 전용* slug 추가 (파라데아 106개 base + form variants)

Gen 9 종목록 (slug):
```
sprigatito, floragato, meowscarada, fuecoco, crocalor, skeledirge, quaxly, quaxwell, quaquaval,
lechonk, oinkologne, tarountula, spidops, nymble, lokix, pawmi, pawmo, pawmot,
tandemaus, maushold, fidough, dachsbun, smoliv, dolliv, arboliva,
squawkabilly, nacli, naclstack, garganacl, charcadet, armarouge, ceruledge,
tadbulb, bellibolt, wattrel, kilowattrel, maschiff, mabosstiff, shroodle, grafaiai,
bramblin, brambleghast, toedscool, toedscruel, klawf, capsakid, scovillain, rellor, rabsca,
flittle, espathra, tinkatink, tinkatuff, tinkaton, wiglett, wugtrio, bombirdier,
finizen, palafin, varoom, revavroom, cyclizar, orthworm, glimmet, glimmora,
greavard, houndstone, flamigo, cetoddle, cetitan, veluza, dondozo, tatsugiri,
annihilape, clodsire, farigiraf, dudunsparce, kingambit,
great-tusk, scream-tail, brute-bonnet, flutter-mane, slither-wing, sandy-shocks,
iron-treads, iron-bundle, iron-hands, iron-jugulis, iron-moth, iron-thorns,
frigibax, arctibax, baxcalibur, gimmighoul, gholdengo, wo-chien, chien-pao, ting-lu, chi-yu,
roaring-moon, iron-valiant, koraidon, miraidon, walking-wake, iron-leaves,
dipplin, poltchageist, sinistcha, okidogi, munkidori, fezandipiti, ogerpon,
archaludon, hydrapple, gouging-fire, raging-bolt, iron-boulder, iron-crown,
terapagos, pecharunt
```

**Form variants** (species로 추가, 기존 variants.json과 별개 처리):
- kyurem-black, kyurem-white (Gen 5 but fusion)
- necrozma-dusk-mane, necrozma-dawn-wings (Gen 7 fusion), necrozma-ultra (Ultra Burst, Gen 7)
- calyrex-ice-rider, calyrex-shadow-rider (Gen 8)
- ogerpon-wellspring-mask, ogerpon-hearthflame-mask, ogerpon-cornerstone-mask (Gen 9)
- terapagos-terastal, terapagos-stellar (Gen 9)

**필수 후속 파일 업데이트:**
- `data/pokemon/pokeapi-species-aliases.json`에 각 form variant의 PokeAPI pokemon slug 매핑 추가
  (예: `kyurem-black` → `kyurem-black`, `calyrex-ice-rider` → `calyrex-ice` 등)
- 기존 `art-species-split.json`에 중복 엔트리 없는지 확인

### Task 1.3: 싱크 실행

- [ ] Step 1: `node scripts/sync-pokeapi.mjs --only species`
- [ ] Step 2: `node scripts/sync-pokeapi.mjs --only evolutions`
- [ ] Step 3: `node scripts/sync-pokeapi.mjs --only moves`
- [ ] Step 4: `node scripts/sync-pokeapi.mjs --only abilities`
- [ ] Step 5: `node scripts/sync-pokeapi.mjs --only variants`
- [ ] Step 6: `node scripts/sync-pokeapi.mjs --only items`

### Task 1.4: 검증

- [ ] Step 1: species 1025개 확인
- [ ] Step 2: 새 기술(tera-blast, shed-tail 등) 학습자 있는지 확인
- [ ] Step 3: Gen 9 특성 데이터 확인
- [ ] Step 4: 전체 테스트 통과 확인
- [ ] Step 5: Commit `feat(data): sync Gen 9 Pokemon data (species 906-1025)`

---

## Phase 2: 테라스탈 시스템

### Task 2.0: customResolve 프레임워크 확장 (선행 조건)

- [ ] Step 1: `packages/server/src/pvp/pvp-moves.ts` 수정

```typescript
export type CustomResolveResult =
  | boolean
  | { redirectTo: string }
  | { overrideMove: Partial<MoveData> };

export function tryCustomResolve(ctx: MoveContext): CustomResolveResult {
  const effects = getMoveEffects(ctx.moveId);
  const result = effects?.customResolve?.(ctx);
  return result ?? false;
}
```

- [ ] Step 2: `packages/server/src/pvp/pvp-room.ts` 수정

tryCustomResolve 호출부 확장:
```typescript
const custom = tryCustomResolve(moveCtx);
if (custom === true) { /* handled */ return; }
if (custom && typeof custom === "object") {
  if ("redirectTo" in custom) { /* existing redirect logic */ }
  else if ("overrideMove" in custom) {
    moveData = { ...moveData, ...custom.overrideMove };
    if (custom.overrideMove.meta) {
      moveData.meta = { ...moveData.meta, ...custom.overrideMove.meta };
    }
    effectiveMoveData = { ...moveData };
    moveCtx.move = effectiveMoveData;
    // Fall through to normal flow with modified move
  }
}
```

- [ ] Step 3: 테스트 — 임시 "test-override" 기술로 overrideMove 작동 확인
- [ ] Commit `feat(pvp): extend customResolve to support overrideMove`

### Task 2.1: 타입 확장

- [ ] Step 1: `shared/pvp-types.ts`

```typescript
export type PvpTransformationType = "mega" | "gigantamax" | "primal" | "dynamax" | "tera" | "ultra-burst";

export interface PvpPokemon {
  // ... 기존
  teraType?: string | null;         // 정해진 Tera Type (기본: getEffectiveTypes[0]; Ogerpon 마스크는 강제)
  originalTypes?: string[];          // 배틀 시작 시 getEffectiveTypes로 초기화 (Mega/Ogerpon 반영)
  stellarTypesUsed?: string[];       // Stellar 테라 포켓몬용 (per-pokemon)
  rageFistHits?: number;             // 받은 공격 횟수 (Rage Fist 파워 계산)
  lastEatenBerry?: string | null;    // Cud Chew 용
}

export interface PvpPlayerState {
  // ... 기존
  teraActive?: boolean;              // 현재 Terastalized 상태
  supersweetSyrupUsed?: boolean;     // 1회 한정 (배틀 전체)
  boostedStatsThisTurn?: boolean;    // Alluring Voice 판정 (이번 턴 스탯 상승했는지)
  paradoxBoost?: {                   // Protosynthesis/Quark Drive 활성 상태
    stat: "attack" | "defense" | "spAttack" | "spDefense" | "speed";
    source: "weather" | "terrain" | "booster-energy";
  };
}

export type PvpAction =
  | { type: "fight"; moveId: string; mega?: boolean; gigantamax?: boolean; dynamax?: boolean; tera?: boolean; ultraBurst?: boolean }
  | { type: "switch"; pokemonIndex: number }
  | { type: "forfeit" };
```

- [ ] Step 2: `shared/types.ts`

```typescript
export interface OwnedPokemon {
  // ... 기존
  teraType?: string | null;
  fusedPartnerUid?: string;
  fusedPartnerData?: {
    species: string;
    level: number;
    stats: PokemonStats;
    moves: PokemonMove[];
    abilityId?: string | null;
    nature?: string;
    heldItem?: string | null;
    gender?: PokemonGender | null;
  };
}
```

### Task 2.2: pvp-socket userPartyToPvp 업데이트

- [ ] Step 1: Tera/original types 초기화 (변형 폼 반영)

```typescript
import { getEffectiveTypes } from "../game/pokemon-state.js";

const effectiveTypes = getEffectiveTypes(p.species, p.variantId ?? null, null);
const defaultTeraType = getDefaultTeraType(p.species, effectiveTypes);

return {
  // ... existing
  teraType: p.teraType ?? defaultTeraType,
  originalTypes: effectiveTypes,
  stellarTypesUsed: [],
  rageFistHits: 0,
};

function getDefaultTeraType(species: string, types: string[]): string {
  // Ogerpon 마스크는 강제
  if (species === "ogerpon") return "grass";
  if (species === "ogerpon-wellspring-mask") return "water";
  if (species === "ogerpon-hearthflame-mask") return "fire";
  if (species === "ogerpon-cornerstone-mask") return "rock";
  // Terapagos-Stellar는 Stellar
  if (species === "terapagos-stellar") return "stellar";
  return types[0] ?? "normal";
}
```

### Task 2.3: getEffectiveTypes 테라 오버라이드

- [ ] Step 1: `packages/server/src/game/pokemon-state.ts`

기존 `getEffectiveTypes(species, variantId, battleForm)` 시그니처에 teraActive 옵션 추가 OR 래퍼 함수 생성:

```typescript
export function getBattleTypes(
  poke: PvpPokemon,
  player: PvpPlayerState,
): string[] {
  if (player.teraActive && poke.teraType) {
    return [poke.teraType];
  }
  return getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
}
```

pvp-room.ts에서 기존 getEffectiveTypes 호출부를 이 새 헬퍼로 교체.

### Task 2.4: STAB 보정 (Tera STAB 2.0x)

- [ ] Step 1: `calculateDamage`의 STAB 체크 수정

현재:
```typescript
if (attackerTypes.includes(move.type)) {
  damage *= 1.5; // STAB
}
```

수정:
```typescript
// Caller passes stabMultiplier instead of computing internally
damage *= stabMultiplier ?? 1.0;
```

pvp-room.ts에서 호출 전 STAB 계산:
```typescript
function computeStab(move: MoveData, attacker: PvpPlayerState, atkPoke: PvpPokemon): number {
  const moveType = move.type;
  const teraType = attacker.teraActive ? atkPoke.teraType : null;
  const original = atkPoke.originalTypes ?? [];
  const hasAdaptability = atkPoke.abilityId === "adaptability";

  const matchesOriginal = original.includes(moveType);
  const matchesTera = teraType && moveType === teraType;

  // Combined STAB: Tera type matches move AND move type was one of originals
  if (matchesTera && matchesOriginal) {
    return hasAdaptability ? 2.25 : 2.0;
  }
  // Tera-only STAB: new type, no original match (Adaptability doesn't stack on non-original types)
  if (matchesTera && !matchesOriginal) {
    return 1.5;
  }
  // Original STAB (either no Tera, or Tera on different type; original move still gets STAB)
  if (matchesOriginal) {
    return hasAdaptability ? 2.0 : 1.5;
  }
  return 1.0;
}
```

- [ ] Step 2: `calculateDamage` 시그니처 변경

기존:
```typescript
function calculateDamage(attackerLevel, attackerStats, defenderStats, move, attackerTypes, defenderTypes, attackerStages, defenderStages, weatherModifier)
```

신규 (STAB는 외부에서 계산):
```typescript
function calculateDamage(attackerLevel, attackerStats, defenderStats, move, attackerTypes, defenderTypes, attackerStages, defenderStages, weatherModifier, stabMultiplier)
```

- [ ] Step 3: 내부 STAB 체크 제거
```typescript
// 제거:
// if (attackerTypes.includes(move.type)) damage *= 1.5;

// 추가:
damage *= stabMultiplier ?? 1.0;
```

- [ ] Step 4: Adaptability의 기존 onAttack 핸들러 제거
  - `pvp-abilities.ts`에서 `register("adaptability", { onAttack: ... })` 부분 삭제
  - computeStab가 대체

- [ ] Step 5: 모든 calculateDamage 호출부 마이그레이션
  - `pvp-room.ts`: `computeStab` 사용
  - `battle-state.ts` (PvE, 2곳): 동일 로직 사용 (Adaptability 보존용 헬퍼 공용화)
  - 헬퍼를 `battle.ts`로 추출하는 것이 깔끔함

- [ ] Step 6: 기존 Gen 1-8 테스트 전부 통과 확인 (Adaptability 회귀 방지)

### Task 2.5: Terastalize 액션 처리

- [ ] Step 1: executeFight 초입에 Tera 핸들러 추가 (mega/gmax 블록 옆)

```typescript
if (tera && !attacker.transformationUsed && atkPoke.teraType) {
  attacker.teraActive = true;
  attacker.transformationType = "tera";
  attacker.transformationUsed = true;
  // Embody Aspect trigger
  triggerOnTerastalize({ attacker, atkPoke, room });
  room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 테라스탈! (${atkPoke.teraType}타입)`);
}
```

### Task 2.6: Tera Blast 기술 등록 (overrideMove 사용)

- [ ] Step 1: pvp-moves.ts에

```typescript
register("tera-blast", {
  customResolve: (ctx) => {
    if (!ctx.attacker.teraActive || !ctx.atkPoke.teraType) {
      return false; // Normal 80 BP special, no override
    }
    const category: "physical" | "special" =
      ctx.atkPoke.stats.attack > ctx.atkPoke.stats.spAttack ? "physical" : "special";
    return {
      overrideMove: {
        type: ctx.atkPoke.teraType as any,
        category,
        power: 80,
      },
    };
  },
});
```

`overrideMove` 반환으로 Task 2.0의 신규 프레임워크 활용.

### Task 2.7: Stellar Type 처리 (단순화 버전)

- [ ] Step 1: `stellarTypesUsed` 추적
- [ ] Step 2: Terapagos-Stellar가 공격할 때, 해당 타입이 stellarTypesUsed에 없으면 1.2x + 상대가 Terastalized면 추가 2.0x, 그 외 1.0x
- [ ] Step 3: 공격 후 stellarTypesUsed에 타입 추가

### Task 2.8: 테스트

- [ ] Step 1: 테라스탈 발동, 타입 변경 확인
- [ ] Step 2: STAB 2.0x 계산 (combined)
- [ ] Step 3: Tera Blast 타입/카테고리 변경
- [ ] Step 4: 1회 제한 (transformationUsed)
- [ ] Step 5: 교체해도 Tera 유지
- [ ] Commit `feat(pvp): add Terastalization system`

---

## Phase 3: Gen 9 특성 구현 (~25종)

### Task 3.0: Paradox Boost (Protosynthesis / Quark Drive / Booster Energy)

**로직:**
- 활성 조건: (protosynthesis + sun) or (quark-drive + electric terrain) or (booster-energy 소지)
- 가장 높은 스탯 선택 순서 (priority): attack > defense > spAttack > spDefense > speed
- 멀티플라이어: speed는 1.5x, 나머지는 1.3x
- 적용 방식: 데미지 계산 시점에서 해당 스탯에 곱셈 (stat stages와 multiplicative)
- 지속: 조건이 사라져도 switch-out 전까지 유지 (canon behavior)
- Booster Energy: 최초 활성 시 소비 (heldItem → null)

- [ ] Step 1: `pvp-abilities.ts`에 헬퍼

```typescript
export function paradoxHighestStat(poke: PvpPokemon): "attack" | "defense" | "spAttack" | "spDefense" | "speed" {
  const stats = poke.stats;
  let best: "attack" | "defense" | "spAttack" | "spDefense" | "speed" = "attack";
  let bestVal = stats.attack;
  const checkOrder = ["defense", "spAttack", "spDefense", "speed"] as const;
  for (const s of checkOrder) {
    if (stats[s] > bestVal) { bestVal = stats[s]; best = s; }
  }
  return best;
}

function activateParadoxBoost(ctx: OnSwitchInContext, source: "weather" | "terrain" | "booster-energy"): void {
  if (ctx.player.paradoxBoost) return; // already active
  const stat = paradoxHighestStat(ctx.pokemon);
  ctx.player.paradoxBoost = { stat, source };
  if (source === "booster-energy") ctx.pokemon.heldItem = null; // consume
  ctx.room.log.push(`${ctx.pokemon.species}: 고대활성/쿼크차지! ${stat} 상승!`);
}

register("protosynthesis", {
  onSwitchIn: (ctx) => {
    if (ctx.room.weather === "sun") {
      activateParadoxBoost(ctx, "weather");
    } else if (ctx.pokemon.heldItem === "booster-energy") {
      activateParadoxBoost(ctx, "booster-energy");
    }
  },
});
register("quark-drive", {
  onSwitchIn: (ctx) => {
    if (ctx.room.terrain === "electric") {
      activateParadoxBoost(ctx, "terrain");
    } else if (ctx.pokemon.heldItem === "booster-energy") {
      activateParadoxBoost(ctx, "booster-energy");
    }
  },
});
```

- [ ] Step 2: pvp-room.ts에서 데미지 계산 시 `paradoxBoost` 반영

```typescript
// In executeFight before calculateDamage:
let effectiveAtkStats = atkPoke.stats;
if (attacker.paradoxBoost && effectiveMoveData.category !== "status") {
  const stat = attacker.paradoxBoost.stat;
  const mult = stat === "speed" ? 1.5 : 1.3;
  effectiveAtkStats = { ...effectiveAtkStats, [stat]: Math.floor(effectiveAtkStats[stat] * mult) };
}
// similar for defender on defensive stats
```

- [ ] Step 3: applySwitch에서 `paradoxBoost = undefined` (리셋)
- [ ] Step 4: 날씨/필드 변경 시 재체크 (weather set / terrain set → try activate)
- [ ] Step 5: 테스트 3+개
- [ ] Commit `feat(pvp): add Paradox Boost (Protosynthesis/Quark Drive/Booster Energy)`

### Task 3.1: 새 훅 추가

- [ ] Step 1: pvp-abilities.ts에 새 훅 타입

```typescript
interface AbilityEffects {
  // 기존
  onTerastalize?: (ctx: { attacker: PvpPlayerState; atkPoke: PvpPokemon; room: PvpRoomState }) => void;
  onStatBoostTrigger?: (ctx: { player: PvpPlayerState; opponent: PvpPlayerState; changes: Array<{stat: string; change: number}>; room: PvpRoomState }) => void;
  absorbMove?: (ctx: DamageModContext) => { absorbed: boolean; effect?: () => void };
}
```

### Task 3.2: 특성 등록

각 특성 구현 (축약):

```typescript
register("supreme-overlord", {
  onAttack: (ctx) => {
    const fainted = ctx.attacker.party.filter((p, i) => i !== ctx.attacker.activeIndex && p.hp <= 0).length;
    return 1 + 0.1 * fainted;
  },
});

// protosynthesis / quark-drive: Task 3.0에서 이미 등록 (Paradox Boost)

register("toxic-debris", {
  // in pvp-room.ts after physical hit on holder
});

register("armor-tail", {
  // Canon: 상대가 priority 기술 사용 불가 (>0 priority)
  // pvp-room.ts executeFight 초입에서:
  // if (defPoke.abilityId === "armor-tail" && (moveData.priority ?? 0) > 0) {
  //   room.log.push("아머테일로 우선도 기술이 막혔다!"); return;
  // }
});

register("earth-eater", {
  onDefense: (ctx) => {
    if (ctx.move.type === "ground") {
      const heal = Math.floor(ctx.defPoke.maxHp / 4);
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.room.log.push(`${ctx.defPoke.species}의 흙먹기! HP 회복!`);
      return 0;
    }
    return 1;
  },
});

register("mycelium-might", {
  // Canon: status 기술 항상 마지막 + 상대 특성 무시
  // pvp-room.ts turn order: if (atkPoke.abilityId === "mycelium-might" && moveData.category === "status") { priority -= 999; }
  // 상대 특성 무시: ignoresOpponentAbility flag와 유사하지만 status 기술에만 한정
  flags: { ignoresOpponentAbility: true }, // 단순화 (status/non-status 모두 무시. 엄밀하진 않지만 허용 가능)
});

register("minds-eye", {
  // combines scrappy + keen eye
  // onAttack + preventStatDrop
});

register("supersweet-syrup", {
  onSwitchIn: (ctx) => {
    if (!ctx.player.supersweetSyrupUsed) {
      ctx.opponent.statStages = applyStatChanges(ctx.opponent.statStages, [{ stat: "evasion", change: -1 }]);
      ctx.player.supersweetSyrupUsed = true;
    }
  },
});

register("toxic-chain", {
  // 30% toxic poison on damaging hit
  // trigger in executeFight after damage
});

register("tera-shell", {
  onDefense: (ctx) => {
    if (ctx.defPoke.hp >= ctx.defPoke.maxHp) {
      return 0.5; // all moves not very effective
    }
    return 1;
  },
});

register("tera-shift", {
  // Terapagos auto-form change on switch-in
});

register("opportunist", {
  onStatBoostTrigger: (ctx) => {
    // Copy opponent's boosts to player
    const positive = ctx.changes.filter(c => c.change > 0);
    if (positive.length > 0) {
      ctx.player.statStages = applyStatChanges(ctx.player.statStages, positive);
    }
  },
});

register("embody-aspect", {
  onTerastalize: (ctx) => {
    // Ogerpon form-dependent stat boost
    const boosts: Record<string, string> = {
      "ogerpon": "speed",
      "ogerpon-wellspring-mask": "spDefense",
      "ogerpon-hearthflame-mask": "attack",
      "ogerpon-cornerstone-mask": "defense",
    };
    const stat = boosts[ctx.atkPoke.species];
    if (stat) {
      ctx.attacker.statStages = applyStatChanges(ctx.attacker.statStages, [{ stat, change: 1 }]);
    }
  },
});

register("good-as-gold", {
  // Canon: 모든 status category 기술 무효 (primary status와 별개)
  // canReceiveStatus 훅이 아닌 전용 처리 필요
  // pvp-room.ts에서: if (defPoke.abilityId === "good-as-gold" && moveData.category === "status") { log + return }
});

register("purifying-salt", {
  canReceiveStatus: (ctx) => !["poison", "burn", "paralysis", "sleep", "freeze", "infatuation"].includes(ctx.status),
  onDefense: (ctx) => ctx.move.type === "ghost" ? 0.5 : 1,
});

register("well-baked-body", {
  onDefense: (ctx) => {
    if (ctx.move.type === "fire") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "defense", change: 2 }]);
      return 0;
    }
    return 1;
  },
});

register("wind-power", {
  // Electromorphosis-like but for wind moves
});

register("wind-rider", {
  onDefense: (ctx) => {
    const WIND_MOVES = new Set(["gust", "twister", "air-cutter", "air-slash", "aeroblast", "tailwind", "whirlwind", "hurricane", "bleakwind-storm", "sandsear-storm", "wildbolt-storm", "springtide-storm"]);
    if (WIND_MOVES.has(ctx.move.id)) {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "attack", change: 1 }]);
      return 0;
    }
    return 1;
  },
});

register("rocky-payload", {
  onAttack: (ctx) => ctx.move.type === "rock" ? 1.5 : 1,
});

register("electromorphosis", {
  // Gain "charged" volatile after being hit, +1.3x next electric move
});

register("sharpness", {
  onAttack: (ctx) => {
    const SLICING = new Set(["cut", "slash", "air-slash", "psycho-cut", "leaf-blade", "night-slash", "sacred-sword", "razor-shell", "fury-cutter", "x-scissor", "cross-poison", "solar-blade", "stone-axe", "ceaseless-edge", "aqua-cutter", "behemoth-blade", "kowtow-cleave", "psyblade"]);
    return SLICING.has(ctx.move.id) ? 1.5 : 1;
  },
});

register("cud-chew", {
  // Re-eat berry next turn - needs lastEatenBerry tracking
});

register("lingering-aroma", {
  // Contact attackers gain this ability
});

register("seed-sower", {
  // Set grassy terrain when hit by any attack
});

register("thermal-exchange", {
  // Canon: Fire 데미지 안 받음 + Attack +1 + burn 면역
  onDefense: (ctx) => {
    if (ctx.move.type === "fire") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "attack", change: 1 }]);
      ctx.room.log.push(`${ctx.defPoke.species}의 열교환!`);
      return 0; // 완전 면역 (canon)
    }
    return 1;
  },
  canReceiveStatus: (ctx) => ctx.status !== "burn",
});

register("costar", {
  // Doubles only - flag only for now
});
```

- [ ] 모든 특성 등록 + pvp-room.ts에서 필요한 훅 wiring
- [ ] 테스트 10+개 추가
- [ ] Commit `feat(pvp): register Gen 9 abilities`

---

## Phase 4: Gen 9 기술 구현 (~30종)

### Task 4.1: 단순 등록 (modifyPower / statChanges 기반)

```typescript
register("trailblaze", { flags: { contact: true } }); // +1 speed via statChanges in data
register("aqua-step", { flags: { contact: true } });
register("chilling-water", {}); // -1 atk via data
register("torch-song", {}); // +1 spAtk via data, sound
register("ice-spinner", {
  onHit: (ctx) => {
    if (ctx.room.terrain) {
      ctx.room.log.push(`${ctx.room.terrain}필드가 사라졌다!`);
      ctx.room.terrain = undefined;
      ctx.room.terrainTurns = undefined;
    }
  },
});
register("salt-cure", {
  onHit: (ctx) => {
    ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "salt-cure", -1);
  },
});
// ... and so on
```

### Task 4.2: customResolve 기술

```typescript
register("tera-blast", {
  customResolve: (ctx) => {
    if (ctx.attacker.teraActive && ctx.atkPoke.teraType) {
      const useAtk = ctx.atkPoke.stats.attack > ctx.atkPoke.stats.spAttack;
      ctx.move = {
        ...ctx.move,
        type: ctx.atkPoke.teraType,
        category: useAtk ? "physical" : "special",
      };
    }
    return false; // continue normal flow with modified move
  },
});

register("shed-tail", {
  customResolve: (ctx) => {
    // Canon: HP의 1/2 소비해서 대타출동 (1/4 maxHp) 생성 후 교체
    // 1:1 안전: 교체할 포켓몬이 없으면 실패
    const aliveOthers = ctx.attacker.party.some(
      (p, i) => i !== ctx.attacker.activeIndex && p.hp > 0,
    );
    const hpCost = Math.floor(ctx.atkPoke.maxHp / 2);
    if (ctx.atkPoke.hp <= hpCost || !aliveOthers) {
      ctx.room.log.push(`${ctx.attacker.nickname}: 탈피꼬리 실패!`);
      return true;
    }
    ctx.atkPoke.hp -= hpCost;
    ctx.attacker.substitute = Math.floor(ctx.atkPoke.maxHp / 4);
    ctx.room.pendingSwitchAfterMove = ctx.room.pendingSwitchAfterMove ?? {};
    const side = ctx.room.playerA === ctx.attacker ? "a" : "b";
    ctx.room.pendingSwitchAfterMove[side] = true;
    ctx.room.log.push(`${ctx.attacker.nickname}: 탈피꼬리!`);
    return true;
  },
});

register("upper-hand", {
  beforeMove: (ctx) => {
    // Only succeeds if opponent is using priority move this turn
    // Need to inspect pending action
    const oppAction = ctx.room.playerA === ctx.attacker ? ctx.room._lastActionB : ctx.room._lastActionA;
    if (!oppAction || oppAction.type !== "fight") {
      return { cancel: true, message: "업퍼핸드 실패!" };
    }
    const oppMove = getMoveById(oppAction.moveId);
    if (!oppMove || (oppMove.priority ?? 0) <= 0) {
      return { cancel: true, message: "업퍼핸드 실패!" };
    }
  },
  onHit: (ctx) => {
    // flinch on hit
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "flinch", 1);
    }
  },
});

register("ivy-cudgel", {
  customResolve: (ctx) => {
    const typeMap: Record<string, string> = {
      "ogerpon": "grass",
      "ogerpon-wellspring-mask": "water",
      "ogerpon-hearthflame-mask": "fire",
      "ogerpon-cornerstone-mask": "rock",
    };
    const type = typeMap[ctx.atkPoke.species] ?? "grass";
    ctx.move = { ...ctx.move, type, meta: { ...ctx.move.meta, critRate: 1 } };
    return false;
  },
});

register("revival-blessing", {
  customResolve: (ctx) => {
    // Revive a fainted teammate
    const faintedIdx = ctx.attacker.party.findIndex(p => p.hp <= 0);
    if (faintedIdx >= 0) {
      const poke = ctx.attacker.party[faintedIdx];
      poke.hp = Math.floor(poke.maxHp / 2);
      ctx.room.log.push(`${poke.species}이(가) 부활했다!`);
    } else {
      ctx.room.log.push("부활축도 실패!");
    }
    return true;
  },
});

register("comeuppance", {
  customResolve: (ctx) => {
    if (ctx.attacker.lastDamageTaken) {
      const dmg = Math.floor(ctx.attacker.lastDamageTaken.amount * 1.5);
      ctx.defPoke.hp = Math.max(0, ctx.defPoke.hp - dmg);
      ctx.room.log.push(`${ctx.attacker.nickname}: 복수! ${dmg} 데미지!`);
      ctx.attacker.lastDamageTaken = undefined;
    } else {
      ctx.room.log.push("복수 실패!");
    }
    return true;
  },
});

register("double-shock", {
  customResolve: (ctx) => {
    // Normal damage but remove attacker's electric type after
    // Run normal damage flow, then clean up
    // Need an afterMove hook or just modify originalTypes
    return false; // continue normal, handle type removal in onHit
  },
  onHit: (ctx) => {
    if (ctx.atkPoke.originalTypes) {
      ctx.atkPoke.originalTypes = ctx.atkPoke.originalTypes.filter(t => t !== "electric");
    }
  },
});

register("flower-trick", {
  flags: { ignoresAccuracy: true },
  modifyPower: (ctx) => ctx.move.power, // always crit - handled via critRate
  onHit: (ctx) => { /* guaranteed crit already baked in */ },
});

register("chilly-reception", {
  customResolve: (ctx) => {
    ctx.room.weather = "hail";
    ctx.room.weatherTurns = 5;
    ctx.room.log.push("눈이 내리기 시작했다!");
    // 교체할 포켓몬 있을 때만 스위치 플래그
    const aliveOthers = ctx.attacker.party.some(
      (p, i) => i !== ctx.attacker.activeIndex && p.hp > 0,
    );
    if (aliveOthers) {
      ctx.room.pendingSwitchAfterMove = ctx.room.pendingSwitchAfterMove ?? {};
      const side = ctx.room.playerA === ctx.attacker ? "a" : "b";
      ctx.room.pendingSwitchAfterMove[side] = true;
    }
    return true;
  },
});

register("syrup-bomb", {
  onHit: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "syrup-bomb", 3);
    }
  },
});

register("last-respects", {
  modifyPower: (ctx) => {
    const fainted = ctx.attacker.party.filter(p => p.hp <= 0).length;
    return Math.min(50 + 50 * fainted, 350);
  },
});

register("rage-fist", {
  modifyPower: (ctx) => {
    const hitsTaken = ctx.attacker.rageFistHits ?? 0;
    return Math.min(50 + 50 * hitsTaken, 350);
  },
});

register("collision-course", {
  onAttack: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) mult *= (typeChart[ctx.move.type]?.[t] ?? 1);
    return mult > 1 ? 1.333 : 1;
  },
});
register("electro-drift", {
  onAttack: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) mult *= (typeChart[ctx.move.type]?.[t] ?? 1);
    return mult > 1 ? 1.333 : 1;
  },
});

register("tera-starstorm", {
  customResolve: (ctx) => {
    if (ctx.atkPoke.species === "terapagos-stellar") {
      ctx.move = { ...ctx.move, type: "stellar" as any };
    }
    return false;
  },
});

register("alluring-voice", {
  flags: { sound: true },
  onHit: (ctx) => {
    // Confuse target if they boosted stats this turn
    if (ctx.defender.boostedStatsThisTurn && ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "confusion", 3);
    }
  },
});

register("burning-bulwark", {
  flags: { isProtect: true },
  applyEffect: (ctx) => {
    // Similar to protect, plus burn on contact (handled in pvp-room.ts)
    addVolatile(ctx.attacker.volatiles, "burning-bulwark", 1);
  },
});

register("silk-trap", {
  flags: { isProtect: true },
  applyEffect: (ctx) => {
    addVolatile(ctx.attacker.volatiles, "silk-trap", 1);
  },
});

register("hyper-drill", {
  flags: { ignoresProtect: true },
});

register("spicy-extract", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [
        { stat: "attack", change: 2 },
        { stat: "defense", change: -2 },
      ]);
    }
  },
});

register("matcha-gotcha", {
  // drain 1/2, 30% burn
  onHit: (ctx) => {
    const heal = Math.floor(ctx.damage / 2);
    ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
    if (Math.random() < 0.3 && !ctx.defPoke.statusCondition && ctx.defPoke.hp > 0) {
      ctx.defPoke.statusCondition = "burn";
    }
  },
});

register("doodle", {
  customResolve: (ctx) => {
    // Copy target's ability to user
    if (ctx.defPoke.abilityId) {
      ctx.atkPoke.abilityId = ctx.defPoke.abilityId;
      ctx.room.log.push(`${ctx.attacker.nickname}: 낙서! ${ctx.defPoke.abilityId}를 복사!`);
    }
    return true;
  },
});

register("twin-beam", {
  // 2 hits handled via minHits/maxHits
});

register("population-bomb", {
  // 1-10 hits, accuracy drops per hit
});
```

- [ ] Step 1: 모든 기술 등록
- [ ] Step 2: 필요한 경우 pvp-room.ts에 지원 로직 추가 (burning-bulwark contact burn 등)
- [ ] Step 3: 테스트 15+개
- [ ] Commit `feat(pvp): register Gen 9 moves`

---

## Phase 5: 합체 시스템

### Task 5.1: 합체 데이터

- [ ] Step 1: `data/items/items.json` 추가 (아직 없는 것만)
  - dna-splicers, n-solarizer, n-lunarizer, reins-of-unity
  - booster-energy, ultra-necrozium-z
  - teal-mask, wellspring-mask, hearthflame-mask, cornerstone-mask
  - tera-shard-* (18 types)

### Task 5.2: 합체 로직

- [ ] Step 1: `packages/server/src/game/fusion.ts`

```typescript
const FUSION_RECIPES = [
  { base: "kyurem", partner: "reshiram", item: "dna-splicers", result: "kyurem-white" },
  { base: "kyurem", partner: "zekrom", item: "dna-splicers", result: "kyurem-black" },
  { base: "necrozma", partner: "solgaleo", item: "n-solarizer", result: "necrozma-dusk-mane" },
  { base: "necrozma", partner: "lunala", item: "n-lunarizer", result: "necrozma-dawn-wings" },
  { base: "calyrex", partner: "glastrier", item: "reins-of-unity", result: "calyrex-ice-rider" },
  { base: "calyrex", partner: "spectrier", item: "reins-of-unity", result: "calyrex-shadow-rider" },
];

export function fusePokemon(user, baseUid, partnerUid, itemId) {
  // 필드 상속 규칙 (base 우선):
  //   species    → recipe.result (합체 폼)
  //   level      → base
  //   nature     → base
  //   isShiny    → base
  //   gender     → base
  //   teraType   → base 유지
  //   stats      → result species baseStats 기반 재계산
  //   maxHp      → result species 기준으로 재계산
  //   hp         → 비율 유지 (hp/maxHp)
  //   moves      → base.moves + partner.moves 중 unique, 최대 4개 유지
  //                (base 우선, partner signature 추가, 사용자 선택 UI 필요)
  //   abilityId  → result species의 signature ability (e.g. Kyurem-Black → Teravolt)
  //                recipe에 abilityOverride 정의
  //   heldItem   → base 유지
  //   friendship → base
  //   ivs/evs    → base
  //   fusedPartnerData → partner의 전체 OwnedPokemon 스냅샷 저장

  // 1. Validate: base/partner 둘 다 user의 파티에 있어야 함, item 소지 확인
  // 2. Find recipe (FUSION_RECIPES)
  // 3. Partner 스냅샷을 base.fusedPartnerData에 저장
  // 4. base.species = recipe.result
  // 5. Stats 재계산 via buildStatsForPokemon (nature, level 그대로)
  // 6. HP 비율 유지해서 새 maxHp에 매핑
  // 7. moves 병합: base 우선, partner에 없는 것 추가, 4개 제한 (사용자가 나중에 정리)
  // 8. ability: recipe.abilityOverride 사용 (e.g. "teravolt")
  // 9. Partner를 user.pokemon에서 제거
  // 10. Item 소비 안함 (canon: DNA Splicer 등은 재사용 가능)
}

const FUSION_RECIPES = [
  { base: "kyurem", partner: "reshiram", item: "dna-splicers", result: "kyurem-white", abilityOverride: "turboblaze" },
  { base: "kyurem", partner: "zekrom", item: "dna-splicers", result: "kyurem-black", abilityOverride: "teravolt" },
  { base: "necrozma", partner: "solgaleo", item: "n-solarizer", result: "necrozma-dusk-mane", abilityOverride: "prism-armor" },
  { base: "necrozma", partner: "lunala", item: "n-lunarizer", result: "necrozma-dawn-wings", abilityOverride: "prism-armor" },
  { base: "calyrex", partner: "glastrier", item: "reins-of-unity", result: "calyrex-ice-rider", abilityOverride: "as-one-glastrier" },
  { base: "calyrex", partner: "spectrier", item: "reins-of-unity", result: "calyrex-shadow-rider", abilityOverride: "as-one-spectrier" },
];

export function unfusePokemon(user, fusedUid) {
  // 1. Validate fusedPartnerData exists
  // 2. Restore base species (kyurem, necrozma, calyrex)
  // 3. Restore partner pokemon from fusedPartnerData
  // 4. Return item
}
```

### Task 5.3: 합체 API

- [ ] Step 1: `packages/server/src/routes/fusion-routes.ts`

Endpoints:
```
POST /fusion/fuse   { baseUid, partnerUid, itemId }
POST /fusion/unfuse { fusedUid }
```

Validation 체크리스트:
- 인증 (JWT에서 userId 추출)
- 사용자가 base/partner 모두 소유하는지
- base/partner가 PvP 방에 있지 않은지 (room.hasActivePvpBattle(userId) 체크)
- 아이템 소지 확인 (canon: item은 소비되지 않지만 소지 필요)
- 레시피 일치 확인

반환: 업데이트된 OwnedPokemon 목록

- [ ] Step 2: app.ts에 라우터 등록
- [ ] Step 3: API 통합 테스트 (tests/api/fusion-flow.test.ts)

### Task 5.4: 테스트

- [ ] Step 1: 합체 시뮬레이션 (`fusion-sim.test.ts`)
- [ ] Commit `feat(game): add fusion system (Kyurem/Necrozma/Calyrex)`

---

## Phase 6: Ultra Burst (배틀 내 변신)

### Task 6.1: PvpTransformationType 확장

이미 Phase 2에서 추가됨 ("ultra-burst").

### Task 6.2: 변환 로직

- [ ] Step 1: 조건: species === "necrozma-dusk-mane" || "necrozma-dawn-wings", heldItem === "ultra-necrozium-z"
- [ ] Step 2: 스탯 1.2x, species → necrozma-ultra
- [ ] Step 3: transformationUsed 소모

### Task 6.3: 테스트

- [ ] 커밋 `feat(pvp): add Ultra Burst in-battle transformation`

---

## Phase 7: 최종 통합 & 회귀 검증

- [ ] Step 1: **Gen 1-8 회귀 테스트 (중요)**
  - 기존 924개 테스트 전부 통과 확인
  - 특히 Adaptability 관련 테스트: 기존 damage 계산 방식이 computeStab로 마이그레이션 되어도 동작해야 함
  - Mega/Gigantamax/Primal 전환 정상 동작
  - STAB 1.5x 정확 적용
- [ ] Step 2: `cd packages/server && npx vitest run`
- [ ] Step 3: `npx tsc --noEmit` (server + cli)
- [ ] Step 4: AI vs AI 시뮬레이션에 Gen 9 포켓몬 포함하여 재검증
- [ ] Step 5: 테라스탈 + 합체 조합 스트레스 테스트
  - Kyurem-Black이 Ice Tera
  - Ogerpon-Wellspring이 Water Tera + Embody Aspect 발동
  - Terapagos-Stellar의 Stellar Tera + Tera Starstorm
- [ ] Step 6: Evolution 시뮬레이션에 Gen 9 신규 종 추가 (스프리가티토 → 플로라곤 → 메이가스카라다 등)
- [ ] Step 7: Commit `feat: complete Gen 9 support`
