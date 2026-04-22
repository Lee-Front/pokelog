# PvP Ability System Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PvP 배틀에 특성(Ability) 효과 시스템을 구축하고, 경쟁 PvP 핵심 특성 ~50종을 구현한다.

**Architecture:** `packages/server/src/pvp/pvp-abilities.ts`에 특성 효과 레지스트리를 만들고, 배틀 엔진의 각 훅 포인트에서 호출한다. 각 특성은 훅 타입별 콜백으로 등록된다. pvp-room.ts는 특��� 시스템의 존재만 알면 되고, 개별 특성 로직은 pvp-abilities.ts에 캡슐화된다.

**Tech Stack:** 기존 TypeScript/Vitest. 추가 의존성 없음.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/pvp/pvp-abilities.ts` | 특성 효과 레지스트리 + 모든 특성 구현 |
| `packages/server/tests/pvp/pvp-abilities.test.ts` | 특성 단위 테스트 |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/src/pvp/pvp-room.ts` | 각 훅 포인트에서 특성 함수 호출 |
| `packages/server/tests/pvp/pvp-room.test.ts` | 특성 통합 테스트 |

---

## Task 1: 특성 효과 프레임워크

**Files:**
- Create: `packages/server/src/pvp/pvp-abilities.ts`

- [ ] **Step 1: 훅 타입 정의 및 레지스트리 구현**

```typescript
import type { PvpPlayerState, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";
import type { MoveData } from "../../../../shared/types.js";
import { applyStatChanges } from "../game/battle.js";

// ── Hook types ──

export interface OnSwitchInContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  opponent: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface DamageModContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface OnMoveUseContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  atkPoke: PvpPokemon;
  move: MoveData;
}

export interface StatusGuardContext {
  pokemon: PvpPokemon;
  status: string; // "poison" | "burn" | "paralysis" | "sleep" | "freeze" | "confusion" | etc.
}

export interface EndOfTurnContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  opponent: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface OnSwitchOutContext {
  player: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface AbilityEffects {
  onSwitchIn?: (ctx: OnSwitchInContext) => void;
  onAttack?: (ctx: DamageModContext) => number;         // returns modified damage multiplier
  onDefend?: (ctx: DamageModContext) => number;          // returns modified damage multiplier
  onMoveUse?: (ctx: OnMoveUseContext) => { powerMod?: number; stabMod?: number; priorityMod?: number };
  canReceiveStatus?: (ctx: StatusGuardContext) => boolean; // false = immune
  onEndOfTurn?: (ctx: EndOfTurnContext) => void;
  onSwitchOut?: (ctx: OnSwitchOutContext) => void;
  ignoresOpponentAbility?: boolean;                       // Mold Breaker 계열
  modifySpeed?: (speed: number, pokemon: PvpPokemon, weather?: string) => number;
}

// ── Registry ──
const abilityRegistry = new Map<string, AbilityEffects>();

function register(id: string, effects: AbilityEffects): void {
  abilityRegistry.set(id, effects);
}

export function getAbilityEffects(abilityId: string | null | undefined): AbilityEffects | undefined {
  if (!abilityId) return undefined;
  return abilityRegistry.get(abilityId);
}

// ── Public API for pvp-room.ts ──

export function triggerOnSwitchIn(ctx: OnSwitchInContext): void {
  const effects = getAbilityEffects(ctx.pokemon.abilityId);
  if (effects?.onSwitchIn) effects.onSwitchIn(ctx);
}

export function getAttackMultiplier(ctx: DamageModContext): number {
  const effects = getAbilityEffects(ctx.atkPoke.abilityId);
  return effects?.onAttack ? effects.onAttack(ctx) : 1;
}

export function getDefenseMultiplier(ctx: DamageModContext): number {
  // Check if attacker has mold breaker
  const atkEffects = getAbilityEffects(ctx.atkPoke.abilityId);
  if (atkEffects?.ignoresOpponentAbility) return 1;
  const effects = getAbilityEffects(ctx.defPoke.abilityId);
  return effects?.onDefend ? effects.onDefend(ctx) : 1;
}

export function getMoveModifiers(ctx: OnMoveUseContext): { powerMod: number; stabMod: number; priorityMod: number } {
  const effects = getAbilityEffects(ctx.atkPoke.abilityId);
  if (effects?.onMoveUse) {
    const mods = effects.onMoveUse(ctx);
    return { powerMod: mods.powerMod ?? 1, stabMod: mods.stabMod ?? 1, priorityMod: mods.priorityMod ?? 0 };
  }
  return { powerMod: 1, stabMod: 1, priorityMod: 0 };
}

export function canReceiveStatus(pokemon: PvpPokemon, status: string): boolean {
  const effects = getAbilityEffects(pokemon.abilityId);
  if (effects?.canReceiveStatus) return effects.canReceiveStatus({ pokemon, status });
  return true;
}

export function triggerEndOfTurn(ctx: EndOfTurnContext): void {
  const effects = getAbilityEffects(ctx.pokemon.abilityId);
  if (effects?.onEndOfTurn) effects.onEndOfTurn(ctx);
}

export function triggerOnSwitchOut(ctx: OnSwitchOutContext): void {
  const effects = getAbilityEffects(ctx.pokemon.abilityId);
  if (effects?.onSwitchOut) effects.onSwitchOut(ctx);
}

export function getEffectiveSpeed(speed: number, pokemon: PvpPokemon, weather?: string): number {
  const effects = getAbilityEffects(pokemon.abilityId);
  if (effects?.modifySpeed) return effects.modifySpeed(speed, pokemon, weather);
  return speed;
}

export function hasAbilityFlag(abilityId: string | null | undefined, flag: keyof AbilityEffects): boolean {
  const effects = getAbilityEffects(abilityId);
  return effects ? Boolean(effects[flag]) : false;
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(pvp): add ability effects framework and registry"
```

---

## Task 2: pvp-room.ts에 특성 훅 연동

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: import 추가**

```typescript
import {
  triggerOnSwitchIn, getAttackMultiplier, getDefenseMultiplier,
  getMoveModifiers, canReceiveStatus, triggerEndOfTurn,
  triggerOnSwitchOut, getEffectiveSpeed,
} from "./pvp-abilities.js";
```

- [ ] **Step 2: 훅 포인트 연결**

**selectLead (switch-in):** 양쪽 리드 선택 완료 후:
```typescript
for (const [player, opp] of [[room.playerA, room.playerB], [room.playerB, room.playerA]]) {
  triggerOnSwitchIn({ room, player, opponent: opp, pokemon: player.party[player.activeIndex] });
}
```

**applySwitch (switch-out + switch-in):**
```typescript
// Before changing activeIndex:
const oldPoke = player.party[player.activeIndex];
triggerOnSwitchOut({ player, pokemon: oldPoke });
// After changing activeIndex:
const newPoke = player.party[index];
const opp = room.playerA === player ? room.playerB : room.playerA;
triggerOnSwitchIn({ room, player, opponent: opp, pokemon: newPoke });
```

**executeFight (damage modifiers):** After calculateDamage, apply ability multipliers:
```typescript
const atkMult = getAttackMultiplier({ room, attacker, defender, atkPoke, defPoke, move: effectiveMoveData, damage: result.damage });
const defMult = getDefenseMultiplier({ room, attacker, defender, atkPoke, defPoke, move: effectiveMoveData, damage: result.damage });
const finalDamage = Math.max(1, Math.floor(result.damage * atkMult * defMult));
```

**executeFight (status guard):** Before applying ailment:
```typescript
if (!canReceiveStatus(defPoke, ailment)) {
  room.log.push(`${defender.nickname}의 ${defPoke.species}: 특성으로 상태이상을 막았다!`);
  // skip status application
}
```

**resolveTurn (speed):** When determining turn order:
```typescript
let speedA = getEffectiveSpeed(pokemonA.stats.speed, pokemonA, room.weather);
let speedB = getEffectiveSpeed(pokemonB.stats.speed, pokemonB, room.weather);
// Then apply paralysis reduction on top
```

**resolveTurn (end of turn):** In end-of-turn loop:
```typescript
triggerEndOfTurn({ room, player, opponent: opp, pokemon: poke });
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): wire ability hooks into PvP battle engine"
```

---

## Task 3: 진입 특성 (Switch-In)

**Files:**
- Modify: `packages/server/src/pvp/pvp-abilities.ts`
- Test: `packages/server/tests/pvp/pvp-abilities.test.ts`

구현할 특성:
- **intimidate** (위협): 상대 attack -1
- **drizzle** (잔비): 비 설정
- **drought** (가뭄): 맑음 설정
- **sand-stream** (모래날림): 모래바람 설정
- **snow-warning** (눈퍼뜨리기): 우박 설정

```typescript
register("intimidate", {
  onSwitchIn: (ctx) => {
    ctx.opponent.statStages = applyStatChanges(ctx.opponent.statStages, [{ stat: "attack", change: -1 }]);
    ctx.room.log.push(`${ctx.pokemon.species}의 위협! ${ctx.opponent.nickname}의 공격이 내려갔다!`);
  },
});

register("drizzle", {
  onSwitchIn: (ctx) => { ctx.room.weather = "rain"; ctx.room.weatherTurns = 5; ctx.room.log.push("비가 내리기 시작했다!"); },
});
register("drought", {
  onSwitchIn: (ctx) => { ctx.room.weather = "sun"; ctx.room.weatherTurns = 5; ctx.room.log.push("햇살이 강해졌다!"); },
});
register("sand-stream", {
  onSwitchIn: (ctx) => { ctx.room.weather = "sandstorm"; ctx.room.weatherTurns = 5; ctx.room.log.push("모래바람이 불기 시작했다!"); },
});
register("snow-warning", {
  onSwitchIn: (ctx) => { ctx.room.weather = "hail"; ctx.room.weatherTurns = 5; ctx.room.log.push("우박이 내리기 시작했다!"); },
});
```

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add switch-in abilities (intimidate, weather setters)"
```

---

## Task 4: 공격 보정 특성

구현할 특성:
- **adaptability** (적응력): STAB 2x → `stabMod: 2/1.5`
- **technician** (테크니션): power≤60 → 1.5x
- **huge-power / pure-power**: attack 2x
- **guts** (근성): 상태이상 시 attack 1.5x, 화상 페널티 무시
- **overgrow / blaze / torrent**: HP≤1/3 시 해당 타입 1.5x
- **iron-fist**: 펀치기술 1.2x
- **strong-jaw**: 물기기술 1.5x
- **sheer-force**: 부가효과 있는 기술 1.3x
- **reckless**: 반동기 1.2x

```typescript
register("adaptability", {
  onMoveUse: (ctx) => ({ stabMod: 2 }),
});

register("technician", {
  onMoveUse: (ctx) => ({ powerMod: ctx.move.power > 0 && ctx.move.power <= 60 ? 1.5 : 1 }),
});

register("huge-power", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 2 : 1,
});
register("pure-power", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 2 : 1,
});

register("guts", {
  onAttack: (ctx) => ctx.atkPoke.statusCondition ? 1.5 : 1,
  // Note: pvp-room.ts burn penalty should check for guts and skip
});
```

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add offensive ability modifiers"
```

---

## Task 5: 방어/면역 특성

구현할 특성:
- **levitate** (부유): ground 면역
- **flash-fire** (타오르는불꽃): fire 면역, 자신 fire 1.5x
- **volt-absorb** (축전): electric 면역, HP 1/4 회복
- **water-absorb** (저수): water 면역, HP 1/4 회복
- **lightning-rod** (피뢰침): electric 면역, spAttack +1
- **storm-drain** (폭풍배수구): water 면역, spAttack +1
- **sap-sipper** (초식): grass 면역, attack +1
- **motor-drive** (전기엔진): electric 면역, speed +1
- **thick-fat** (두꺼운지방): fire/ice 데미지 0.5x
- **multiscale** (멀티스케일): 풀HP시 데미지 0.5x
- **sturdy** (옹골참): 풀HP��� 1턴 버팀
- **filter / solid-rock**: 효과 좋은 기술 0.75x
- **fur-coat**: 물리 데미지 0.5x
- **ice-scales**: 특수 데미지 0.5x
- **dry-skin** (건조피부): water 면역+회복, fire 1.25x

```typescript
register("levitate", {
  onDefend: (ctx) => ctx.move.type === "ground" ? 0 : 1,
});

register("flash-fire", {
  onDefend: (ctx) => {
    if (ctx.move.type === "fire") {
      // Set a flag for boosted fire (use volatile or a temp marker)
      ctx.room.log.push(`${ctx.defPoke.species}의 타오르는불꽃!`);
      return 0;
    }
    return 1;
  },
});

register("sturdy", {
  onDefend: (ctx) => {
    if (ctx.defPoke.hp === ctx.defPoke.maxHp && ctx.damage >= ctx.defPoke.hp) {
      ctx.room.log.push(`${ctx.defPoke.species}의 옹골참! 버텼다!`);
      // Return a multiplier that leaves 1 HP — handled specially
      return -1; // sentinel: pvp-room.ts sets HP to 1
    }
    return 1;
  },
});

register("multiscale", {
  onDefend: (ctx) => ctx.defPoke.hp === ctx.defPoke.maxHp ? 0.5 : 1,
});

register("thick-fat", {
  onDefend: (ctx) => (ctx.move.type === "fire" || ctx.move.type === "ice") ? 0.5 : 1,
});
```

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add defensive and immunity abilities"
```

---

## Task 6: 상태이상 면역 특성

구현할 특성:
- **immunity** (면역): poison 면역
- **limber** (유연): paralysis 면역
- **water-veil** (수의베일): burn 면역
- **insomnia / vital-spirit**: sleep 면역
- **magma-armor** (마그마의무장): freeze 면역
- **own-tempo** (마이페이스): confusion 면역
- **inner-focus** (정신력): flinch 면역
- **oblivious** (둔감): infatuation 면역
- **clear-body / white-smoke**: 상대에 의한 스탯 감소 면역

```typescript
register("immunity", { canReceiveStatus: (ctx) => ctx.status !== "poison" });
register("limber", { canReceiveStatus: (ctx) => ctx.status !== "paralysis" });
register("water-veil", { canReceiveStatus: (ctx) => ctx.status !== "burn" });
register("insomnia", { canReceiveStatus: (ctx) => ctx.status !== "sleep" });
register("vital-spirit", { canReceiveStatus: (ctx) => ctx.status !== "sleep" });
register("magma-armor", { canReceiveStatus: (ctx) => ctx.status !== "freeze" });
register("own-tempo", { canReceiveStatus: (ctx) => ctx.status !== "confusion" });
register("inner-focus", { canReceiveStatus: (ctx) => ctx.status !== "flinch" });
register("oblivious", { canReceiveStatus: (ctx) => ctx.status !== "infatuation" });
```

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add status immunity abilities"
```

---

## Task 7: 스피드 보정 & 턴 종료 특성

구현할 특성:
- **swift-swim** (쓱쓱): rain 시 speed 2x
- **chlorophyll** (엽록소): sun 시 speed 2x
- **sand-rush** (모래헤치기): sandstorm 시 speed 2x
- **slush-rush** (눈치우기): hail 시 speed 2x
- **speed-boost** (가속): 턴 종료 speed +1
- **prankster** (짓궂은마음): status 기술 priority +1
- **poison-heal** (포이즌힐): 독 시 데미지 대신 1/8 회복
- **natural-cure** (자연회복): 교체 시 상태이상 치유
- **regenerator** (재생력): 교체 시 1/3 HP 회복
- **rain-dish** (레인디쉬): rain 시 1/16 HP 회복
- **ice-body** (아이스바디): hail 시 1/16 HP 회복
- **magic-guard** (매직가드): 직접 공격만 데미지 (독/화상/날씨 무효)

```typescript
register("swift-swim", {
  modifySpeed: (speed, poke, weather) => weather === "rain" ? speed * 2 : speed,
});
register("chlorophyll", {
  modifySpeed: (speed, poke, weather) => weather === "sun" ? speed * 2 : speed,
});
register("sand-rush", {
  modifySpeed: (speed, poke, weather) => weather === "sandstorm" ? speed * 2 : speed,
});
register("slush-rush", {
  modifySpeed: (speed, poke, weather) => weather === "hail" ? speed * 2 : speed,
});

register("speed-boost", {
  onEndOfTurn: (ctx) => {
    ctx.player.statStages = applyStatChanges(ctx.player.statStages, [{ stat: "speed", change: 1 }]);
    ctx.room.log.push(`${ctx.pokemon.species}의 가속! 스피드가 올랐다!`);
  },
});

register("prankster", {
  onMoveUse: (ctx) => ({ priorityMod: ctx.move.category === "status" ? 1 : 0 }),
});

register("poison-heal", {
  // Handled in pvp-room.ts end-of-turn: check ability before applying poison damage
  // If poison-heal, heal 1/8 instead of taking damage
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.statusCondition === "poison") {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 8));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 포이즌힐! HP를 회복했다!`);
    }
  },
});

register("natural-cure", {
  onSwitchOut: (ctx) => {
    if (ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = null;
      ctx.pokemon.sleepTurns = undefined;
      ctx.pokemon.toxicCounter = undefined;
    }
  },
});

register("regenerator", {
  onSwitchOut: (ctx) => {
    const heal = Math.floor(ctx.pokemon.maxHp / 3);
    ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
  },
});

register("magic-guard", {
  // pvp-room.ts에서 독/화상/날씨/hazard 데미지 적용 전에 체크
  // onEndOfTurn에서 처리하지 않고 pvp-room.ts에서 직접 체크
});
```

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: magic-guard, poison-heal은 pvp-room.ts end-of-turn에서 특수 처리**

pvp-room.ts end-of-turn에서:
```typescript
// Skip poison/burn/weather damage if magic-guard
const hasMagicGuard = poke.abilityId === "magic-guard";

// Poison heal: heal instead of damage
const hasPoisonHeal = poke.abilityId === "poison-heal";
if (poke.statusCondition === "poison" && hasPoisonHeal) {
  // Skip normal poison damage, triggerEndOfTurn handles healing
}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(pvp): add speed, end-of-turn, and switch-out abilities"
```

---

## Task 8: Mold Breaker 계열 & 기타

구현할 특성:
- **mold-breaker / turboblaze / teravolt**: 상대 방어 특성 무시
- **unaware** (천진): 상대 스탯 랭크 무시
- **contrary** (심술꾸러기): 스탯 변화 반전
- **pressure** (프레셔): 상대 PP 2 소모

```typescript
register("mold-breaker", { ignoresOpponentAbility: true });
register("turboblaze", { ignoresOpponentAbility: true });
register("teravolt", { ignoresOpponentAbility: true });

// unaware, contrary는 pvp-room.ts에서 직접 처리
```

pvp-room.ts에서:
- **unaware**: calculateDamage 호출 시 상대 스탯 스테이지를 0으로 전달
- **contrary**: applyStatChanges 호출 시 change 값을 반전
- **pressure**: PP 소모 시 2 차감

- [ ] **Step 1: 테스트 작성**
- [ ] **Step 2: 구현**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add mold-breaker, unaware, contrary, pressure"
```

---

## Task 9: 전체 테스트 & 타입 체크

- [ ] **Step 1: 전체 서버 테스트**

```bash
cd packages/server && npx vitest run
```

- [ ] **Step 2: 타입 체크**

```bash
cd packages/server && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): complete ability system (Plan B)"
```
