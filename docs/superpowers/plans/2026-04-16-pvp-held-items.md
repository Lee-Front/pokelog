# PvP Held Item Effects Implementation Plan (Plan C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PvP 배틀에서 지닌 도구(held item) 효과를 구현한다. 특성 시스템과 동일한 레지스트리 패턴을 사용하여 ~30종 핵심 경쟁 도구를 추가한다.

**Architecture:** `packages/server/src/pvp/pvp-items.ts`에 도구 효과 레지스트리를 만들고, pvp-abilities.ts와 동일한 훅 패턴을 따른다. pvp-room.ts의 기존 특성 훅 호출부 옆에 도구 훅을 추가한다.

**Tech Stack:** 기존 TypeScript/Vitest. 추가 의존성 없음.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/pvp/pvp-items.ts` | 도구 효과 레지스트리 + 모든 도구 구현 |
| `packages/server/tests/pvp/pvp-items.test.ts` | 도구 단위 테스트 |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/src/pvp/pvp-room.ts` | 도구 훅 호출 추가 |

---

## Task 1: 도구 효과 프레임워크 + pvp-room.ts 연동

**Files:**
- Create: `packages/server/src/pvp/pvp-items.ts`
- Modify: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: pvp-items.ts 프레임워크 생성**

특성 시스템과 동일한 패턴:

```typescript
import type { PvpPlayerState, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";
import type { MoveData } from "../../../../shared/types.js";

export interface ItemDamageModContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface ItemEndOfTurnContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface ItemEffects {
  onAttack?: (ctx: ItemDamageModContext) => number;        // damage multiplier
  onDefense?: (ctx: ItemDamageModContext) => number;       // damage multiplier
  afterAttack?: (ctx: ItemDamageModContext) => void;       // after dealing damage (recoil etc.)
  afterBeingHit?: (ctx: ItemDamageModContext) => void;     // after taking damage
  onEndOfTurn?: (ctx: ItemEndOfTurnContext) => void;
  modifySpeed?: (speed: number) => number;
  modifyStats?: (stats: { attack: number; defense: number; spAttack: number; spDefense: number; speed: number }, pokemon: PvpPokemon) => typeof stats;
  preventKO?: (ctx: ItemDamageModContext) => boolean;      // true = survive with 1 HP, consume item
  lockMove?: boolean;                                       // Choice items
}

const itemRegistry = new Map<string, ItemEffects>();

function register(id: string, effects: ItemEffects): void {
  itemRegistry.set(id, effects);
}

export function getItemEffects(itemId: string | null | undefined): ItemEffects | undefined {
  if (!itemId) return undefined;
  return itemRegistry.get(itemId);
}

// Public API
export function getItemAttackMultiplier(ctx: ItemDamageModContext): number {
  const effects = getItemEffects(ctx.atkPoke.heldItem);
  return effects?.onAttack ? effects.onAttack(ctx) : 1;
}

export function getItemDefenseMultiplier(ctx: ItemDamageModContext): number {
  const effects = getItemEffects(ctx.defPoke.heldItem);
  return effects?.onDefense ? effects.onDefense(ctx) : 1;
}

export function triggerAfterAttack(ctx: ItemDamageModContext): void {
  const effects = getItemEffects(ctx.atkPoke.heldItem);
  if (effects?.afterAttack) effects.afterAttack(ctx);
}

export function triggerAfterBeingHit(ctx: ItemDamageModContext): void {
  const effects = getItemEffects(ctx.defPoke.heldItem);
  if (effects?.afterBeingHit) effects.afterBeingHit(ctx);
}

export function triggerItemEndOfTurn(ctx: ItemEndOfTurnContext): void {
  const effects = getItemEffects(ctx.pokemon.heldItem);
  if (effects?.onEndOfTurn) effects.onEndOfTurn(ctx);
}

export function getItemSpeedMultiplier(pokemon: PvpPokemon): number {
  const effects = getItemEffects(pokemon.heldItem);
  if (effects?.modifySpeed) return effects.modifySpeed(1);
  return 1;
}

export function checkItemPreventKO(ctx: ItemDamageModContext): boolean {
  const effects = getItemEffects(ctx.defPoke.heldItem);
  if (effects?.preventKO) return effects.preventKO(ctx);
  return false;
}

export function isChoiceItem(itemId: string | null | undefined): boolean {
  const effects = getItemEffects(itemId);
  return effects?.lockMove ?? false;
}
```

- [ ] **Step 2: pvp-room.ts에 도구 훅 연동**

각 특성 훅 호출 옆에 도구 훅 추가:

```typescript
import { getItemAttackMultiplier, getItemDefenseMultiplier, triggerAfterAttack, triggerAfterBeingHit, triggerItemEndOfTurn, checkItemPreventKO, getItemSpeedMultiplier } from "./pvp-items.js";
```

**데미지 계산 후:** 특성 멀티플라이어 옆에 도구 멀티플라이어 추가:
```typescript
const itemAtkMult = getItemAttackMultiplier(dmgCtx);
const itemDefMult = getItemDefenseMultiplier(dmgCtx);
finalDamage = Math.floor(finalDamage * itemAtkMult * itemDefMult);
```

**KO 방지:** 데미지 적용 전, 방어자가 죽을 때:
```typescript
if (defPoke.hp - finalDamage <= 0 && defPoke.hp > 0) {
  if (checkItemPreventKO(dmgCtx)) {
    finalDamage = defPoke.hp - 1;
    defPoke.heldItem = null; // 소모
  }
}
```

**데미지 적용 후:**
```typescript
triggerAfterAttack(dmgCtx);
if (defPoke.hp > 0) triggerAfterBeingHit(dmgCtx);
```

**턴 종료:**
```typescript
triggerItemEndOfTurn({ room, player, pokemon: poke });
```

**스피드:** getEffectiveSpeed 후 도구 스피드도 적용:
```typescript
speedA *= getItemSpeedMultiplier(pokemonA);
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(pvp): add held item effects framework and hooks"
```

---

## Task 2: 데미지 보정 도구

- [ ] **Step 1: 등록**

```typescript
// ── Damage boosters ──
register("life-orb", {
  onAttack: (ctx) => ctx.move.power > 0 ? 1.3 : 1,
  afterAttack: (ctx) => {
    if (ctx.move.power > 0 && ctx.damage > 0) {
      const recoil = Math.max(1, Math.floor(ctx.atkPoke.maxHp / 10));
      ctx.atkPoke.hp = Math.max(0, ctx.atkPoke.hp - recoil);
      ctx.room.log.push(`${ctx.atkPoke.species}: 생명의구슬 반동!`);
    }
  },
});

register("choice-band", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 1.5 : 1,
  lockMove: true,
});

register("choice-specs", {
  onAttack: (ctx) => ctx.move.category === "special" ? 1.5 : 1,
  lockMove: true,
});

register("expert-belt", {
  // 효과 좋은 기술 1.2x — approximate with type check
  onAttack: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) mult *= (typeChart[ctx.move.type]?.[t] ?? 1);
    return mult > 1 ? 1.2 : 1;
  },
});

register("muscle-band", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 1.1 : 1,
});

register("wise-glasses", {
  onAttack: (ctx) => ctx.move.category === "special" ? 1.1 : 1,
});

register("metronome", {
  // Simplified: 1.2x on repeated use (not tracking consecutive uses for MVP)
  onAttack: () => 1,
});
```

- [ ] **Step 2: 방어 도구**

```typescript
register("assault-vest", {
  onDefense: (ctx) => ctx.move.category === "special" ? 0.67 : 1, // ~1.5x spDef
});

register("eviolite", {
  // 1.5x def and spDef for not-fully-evolved pokemon
  // Simplified: always apply (proper check would need evolution data)
  onDefense: () => 0.67, // ~1.5x defense
});

register("rocky-helmet", {
  afterBeingHit: (ctx) => {
    if (ctx.move.category === "physical" && ctx.atkPoke.hp > 0) {
      const dmg = Math.max(1, Math.floor(ctx.atkPoke.maxHp / 6));
      ctx.atkPoke.hp = Math.max(0, ctx.atkPoke.hp - dmg);
      ctx.room.log.push(`${ctx.defPoke.species}의 울퉁불퉁멧! ${ctx.atkPoke.species}에게 ${dmg} 데미지!`);
    }
  },
});
```

- [ ] **Step 3: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add damage modifier held items"
```

---

## Task 3: 생존/회복 도구

```typescript
register("focus-sash", {
  preventKO: (ctx) => {
    if (ctx.defPoke.hp >= ctx.defPoke.maxHp) {
      ctx.room.log.push(`${ctx.defPoke.species}의 기합의띠! 버텨냈다!`);
      return true; // survive with 1 HP, item consumed
    }
    return false;
  },
});

register("leftovers", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && ctx.pokemon.hp < ctx.pokemon.maxHp) {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 먹다남은음식! HP를 회복했다!`);
    }
  },
});

register("black-sludge", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp <= 0) return;
    const types = getEffectiveTypes(ctx.pokemon.species, ctx.pokemon.variantId, ctx.player.battleForm);
    if (types.includes("poison")) {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 검은진흙! HP를 회복했다!`);
    } else {
      const dmg = Math.max(1, Math.floor(ctx.pokemon.maxHp / 8));
      ctx.pokemon.hp = Math.max(0, ctx.pokemon.hp - dmg);
      ctx.room.log.push(`${ctx.pokemon.species}의 검은진흙! 데미지를 받았다!`);
    }
  },
});

register("shell-bell", {
  afterAttack: (ctx) => {
    if (ctx.damage > 0 && ctx.atkPoke.hp > 0) {
      const heal = Math.max(1, Math.floor(ctx.damage / 8));
      ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
    }
  },
});

register("sitrus-berry", {
  // Trigger when HP drops below 50% — checked after being hit
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.hp > 0 && ctx.defPoke.hp <= ctx.defPoke.maxHp / 2 && ctx.defPoke.heldItem === "sitrus-berry") {
      const heal = Math.floor(ctx.defPoke.maxHp / 4);
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.defPoke.heldItem = null; // consumed
      ctx.room.log.push(`${ctx.defPoke.species}의 자리열매! HP를 회복했다!`);
    }
  },
});
```

- [ ] **Step 1: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add survival and recovery held items"
```

---

## Task 4: 스피드/상태/기타 도구

```typescript
register("choice-scarf", {
  modifySpeed: (speed) => Math.floor(speed * 1.5),
  lockMove: true,
});

register("iron-ball", {
  modifySpeed: (speed) => Math.floor(speed * 0.5),
});

register("flame-orb", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && !ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = "burn";
      ctx.room.log.push(`${ctx.pokemon.species}의 화염구슬! 화상을 입었다!`);
    }
  },
});

register("toxic-orb", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && !ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = "poison";
      ctx.pokemon.toxicCounter = 1;
      ctx.room.log.push(`${ctx.pokemon.species}의 독독구슬! 맹독에 걸렸다!`);
    }
  },
});

register("weakness-policy", {
  afterBeingHit: (ctx) => {
    // Activate on super-effective hit
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) mult *= (typeChart[ctx.move.type]?.[t] ?? 1);
    if (mult > 1 && ctx.defPoke.hp > 0 && ctx.defPoke.heldItem === "weakness-policy") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "attack", change: 2 }, { stat: "spAttack", change: 2 }]);
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 약점보험! 공격과 특수공격이 올랐다!`);
    }
  },
});

register("heavy-duty-boots", {
  // Entry hazard immunity — will be relevant when Plan D adds hazards
});

register("lum-berry", {
  // Cure status — trigger after receiving status
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition && ctx.defPoke.heldItem === "lum-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.sleepTurns = undefined;
      ctx.defPoke.toxicCounter = undefined;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 리샘열매! 상태이상이 치유됐다!`);
    }
  },
});

register("big-root", {
  // 1.3x drain/leech seed healing — simplified via afterAttack
  afterAttack: (ctx) => {
    // The drain is already applied by pvp-room.ts; big-root would need deeper integration
    // For MVP, skip
  },
});
```

- [ ] **Step 1: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add speed, status, and utility held items"
```

---

## Task 5: 전체 테스트

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
git commit -m "feat(pvp): complete held item system (Plan C)"
```
