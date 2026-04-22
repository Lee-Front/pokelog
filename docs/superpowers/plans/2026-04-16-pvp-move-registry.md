# PvP Move Effects Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pvp-room.ts에 하드코딩된 109개 기술별 if/else 로직을 공통 레지스트리 시스템으로 리팩토링하고, 새 기술은 `register()` 호출로만 추가할 수 있게 만든다.

**Architecture:** `packages/server/src/pvp/pvp-moves.ts`에 훅 기반 레지스트리를 구축. pvp-room.ts는 `executeMove(ctx)` 한 번 호출하고 모든 분기는 레지스트리로 위임한다. 기존 특성/도구 레지스트리와 동일한 패턴.

**Tech Stack:** 기존 TypeScript/Vitest. 추가 의존성 없음.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/pvp/pvp-moves.ts` | 기술 효과 레지스트리 + 110+ 기술 등록 |
| `packages/server/tests/pvp/pvp-moves.test.ts` | 레지스트리 테스트 |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/src/pvp/pvp-room.ts` | 하드코딩된 if/else 블록 제거, 레지스트리 호출로 대체 |

---

## Hook Design

### Core Context

```typescript
export interface MoveContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;       // effective move data (may be mutated: type override from -ate, power mod)
  moveId: string;
  damage: number;       // post-calc damage (only valid in onHit/onMiss)
  missed: boolean;      // only valid in onHit/onMiss
}
```

### Hook Types

```typescript
export interface MoveEffects {
  /** Completely custom handler. Returns true to skip all default processing. */
  customResolve?: (ctx: MoveContext) => boolean;

  /** Runs before execution. Return { cancel, message } to abort the move. */
  beforeMove?: (ctx: MoveContext) => { cancel?: boolean; message?: string } | void;

  /** Override move power. Return new power value. */
  modifyPower?: (ctx: MoveContext) => number;

  /** Override damage entirely. Return damage amount, or null to use normal calc. */
  fixedDamage?: (ctx: MoveContext) => number | null;

  /** Runs after damage applied (hit case). */
  onHit?: (ctx: MoveContext) => void;

  /** Runs when move misses. */
  onMiss?: (ctx: MoveContext) => void;

  /** Apply field/status effects (runs for status moves or after hit for damaging). */
  applyEffect?: (ctx: MoveContext) => void;

  /** Healing moves (Recover, Rest, etc.). */
  heal?: (ctx: MoveContext) => void;

  /** Move category/attribute flags. */
  flags?: MoveFlags;
}

export interface MoveFlags {
  selfKO?: boolean;
  twoTurn?: boolean;
  semiInvulnerable?: boolean;
  forcesSwitch?: "user" | "target";
  setsHazard?: "stealth-rock" | "spikes" | "toxic-spikes" | "sticky-web";
  clearsHazards?: "own" | "opponent" | "both";
  ignoresSubstitute?: boolean;
  ignoresProtect?: boolean;
  ignoresAccuracy?: boolean;
  contact?: boolean;
  powder?: boolean;
  sound?: boolean;
  punch?: boolean;
  bite?: boolean;
  pulse?: boolean;
  isOHKO?: boolean;
  isEvasion?: boolean;
  setsTerrain?: "electric" | "grassy" | "psychic" | "misty";
  setsWeather?: "sun" | "rain" | "sandstorm" | "hail";
  setsScreen?: "reflect" | "light-screen" | "aurora-veil";
  setsRoom?: "trick-room" | "magic-room" | "wonder-room";
}
```

### Public API

```typescript
// Register effects for a move
register(moveId: string, effects: MoveEffects): void

// Retrieve effects
getMoveEffects(moveId: string): MoveEffects | undefined

// Query flags (for pvp-room.ts integration)
isContact(moveId: string): boolean
isSound(moveId: string): boolean
isPowder(moveId: string): boolean
// etc.

// Main entry point called by pvp-room.ts in place of executeFight body
executeRegisteredMove(ctx: MoveContext): MoveResult
```

---

## Task 1: Framework & Basic Hooks

- [ ] Step 1: Create `pvp-moves.ts` with MoveContext, MoveEffects, MoveFlags types + registry Map + register()/getMoveEffects()
- [ ] Step 2: Add flag query helpers (isContact, isSound, isPowder, etc.)
- [ ] Step 3: Commit `feat(pvp): add move effects registry framework`

## Task 2: Migrate Simple Categories

Migrate these hardcoded sets/records into `register()` calls with only flags:

- [ ] **OHKO moves** (fissure, sheer-cold, horn-drill, guillotine) → `flags: { isOHKO: true }`
- [ ] **Evasion moves** (double-team, minimize) → `flags: { isEvasion: true }`
- [ ] **Self-KO moves** (self-destruct, explosion, memento, final-gambit, healing-wish, lunar-dance, misty-explosion) → `flags: { selfKO: true }`
- [ ] **Semi-invulnerable** two-turn moves → `flags: { twoTurn: true, semiInvulnerable: true }`
- [ ] **Regular two-turn** (sky-attack, solar-beam, meteor-beam, skull-bash, razor-wind) → `flags: { twoTurn: true }`
- [ ] **Hazard moves** (stealth-rock, spikes, toxic-spikes, sticky-web) → `flags: { setsHazard: "..." }`
- [ ] **Hazard clear** (rapid-spin, defog) → `flags: { clearsHazards: "..." }`
- [ ] **Terrain** (electric-terrain, grassy-terrain, psychic-terrain, misty-terrain) → `flags: { setsTerrain: "..." }`
- [ ] **Weather** (sunny-day, rain-dance, sandstorm, hail) → `flags: { setsWeather: "..." }`
- [ ] **Screens** (reflect, light-screen, aurora-veil) → `flags: { setsScreen: "..." }`
- [ ] **Rooms** (trick-room, magic-room, wonder-room) → `flags: { setsRoom: "..." }`

Update pvp-room.ts to read these via `getMoveEffects(moveId)?.flags` instead of hardcoded sets.

- [ ] Commit `refactor(pvp): migrate simple move categories to registry`

## Task 3: Migrate Fixed Damage & Self-KO Logic

```typescript
register("dragon-rage", { fixedDamage: () => 40 });
register("sonic-boom", { fixedDamage: () => 20 });
register("seismic-toss", { fixedDamage: (ctx) => ctx.atkPoke.level });
register("night-shade", { fixedDamage: (ctx) => ctx.atkPoke.level });
register("psywave", { fixedDamage: (ctx) => ctx.atkPoke.level });
```

- [ ] Remove `FIXED_DAMAGE_MOVES` record from pvp-room.ts, use registry instead
- [ ] Commit

## Task 4: Migrate Status/Volatile Moves

Move these from pvp-room.ts if/else to `applyEffect` callbacks:

- [ ] taunt, disable, encore, torment (with lastMoveUsed tracking)
- [ ] leech-seed (with grass immunity check)
- [ ] yawn, curse (branches for ghost)
- [ ] ingrain, focus-energy, destiny-bond, magic-coat
- [ ] foresight, odor-sleuth
- [ ] attract (with gender check)
- [ ] heal-block, embargo, perish-song
- [ ] protect moves (with consecutive counter)
- [ ] substitute

- [ ] Commit `refactor(pvp): migrate status moves to registry applyEffect`

## Task 5: Migrate Healing & Wish

```typescript
register("recover", { heal: (ctx) => { ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + Math.floor(ctx.atkPoke.maxHp / 2)); } });
register("roost", { heal: (ctx) => { /* heal + roost flag */ } });
register("rest", { heal: (ctx) => { /* heal to full + sleep */ } });
register("moonlight", { heal: (ctx) => { /* weather-scaled */ } });
register("wish", { customResolve: (ctx) => { /* queue wish */ return true; } });
```

- [ ] Commit

## Task 6: Migrate onHit Effects

```typescript
register("knock-off", {
  modifyPower: (ctx) => ctx.defPoke.heldItem ? ctx.move.power * 1.5 : ctx.move.power,
  onHit: (ctx) => { if (ctx.defPoke.heldItem) ctx.defPoke.heldItem = null; },
});

register("trick", { onHit: (ctx) => { /* swap items */ } });
register("switcheroo", { onHit: (ctx) => { /* swap items */ } });
register("brick-break", { onHit: (ctx) => { ctx.defender.screens = undefined; } });
register("psychic-fangs", { onHit: (ctx) => { ctx.defender.screens = undefined; } });
register("u-turn", { flags: { forcesSwitch: "user" } });
register("volt-switch", { flags: { forcesSwitch: "user" } });
register("flip-turn", { flags: { forcesSwitch: "user" } });
register("parting-shot", { flags: { forcesSwitch: "user" }, onHit: (ctx) => { /* stat drops */ } });
register("whirlwind", { flags: { forcesSwitch: "target" } });
register("roar", { flags: { forcesSwitch: "target" } });
register("dragon-tail", { flags: { forcesSwitch: "target" } });
register("circle-throw", { flags: { forcesSwitch: "target" } });
```

- [ ] Commit

## Task 7: Migrate customResolve Moves

```typescript
register("transform", { customResolve: (ctx) => { /* copy stats/moves */ return true; } });
register("copycat", { customResolve: (ctx) => { /* use lastMoveUsedInBattle */ return true; } });
register("mimic", { customResolve: (ctx) => { /* replace mimic slot */ return true; } });
register("metronome", { customResolve: (ctx) => { /* random move */ return true; } });
register("snore", { customResolve: (ctx) => { /* bypass sleep */ return true; } });
register("sleep-talk", { customResolve: (ctx) => { /* random other move */ return true; } });
register("pain-split", { customResolve: (ctx) => { /* avg HP */ return true; } });
register("endeavor", { customResolve: (ctx) => { /* match HP */ return true; } });
register("counter", { customResolve: (ctx) => { /* return 2x physical */ return true; } });
register("mirror-coat", { customResolve: (ctx) => { /* return 2x special */ return true; } });
register("belly-drum", { customResolve: (ctx) => { /* half HP, +6 atk */ return true; } });
register("fake-out", { beforeMove: (ctx) => ctx.attacker.justSwitchedIn ? undefined : { cancel: true, message: "..." } });
```

- [ ] Commit

## Task 8: Refactor pvp-room.ts executeFight

Replace the monolithic if/else chain in executeFight with ordered registry calls:

```typescript
function executeFight(...) {
  const ctx = buildContext(room, attacker, defender, moveId);
  const effects = getMoveEffects(ctx.moveId);

  // 1. customResolve — if present, delegates everything
  if (effects?.customResolve?.(ctx)) return;

  // 2. beforeMove — can cancel
  const gate = effects?.beforeMove?.(ctx);
  if (gate?.cancel) { room.log.push(gate.message ?? "실패!"); return; }

  // 3. Flag checks
  if (effects?.flags?.isOHKO) { room.log.push("일격기 조항!"); return; }
  if (effects?.flags?.isEvasion) { room.log.push("회피 조항!"); return; }

  // 4. Two-turn move handling
  if (effects?.flags?.twoTurn && !attacker.chargingMove) {
    attacker.chargingMove = { moveId, turn: 1 };
    if (effects.flags.semiInvulnerable) addVolatile(...);
    return;
  }

  // 5. Mega/Gigantamax/Dynamax (already in code)
  // 6. Status checks (sleep, freeze, paralysis, confusion, flinch, infatuation)
  // 7. Accuracy check
  // 8. Power modification
  const effectivePower = effects?.modifyPower?.(ctx) ?? ctx.move.power;
  const modifiedMove = effectivePower !== ctx.move.power ? { ...ctx.move, power: effectivePower } : ctx.move;

  // 9. Damage calculation
  let damage: number;
  const fixedDmg = effects?.fixedDamage?.(ctx);
  if (fixedDmg != null) {
    damage = fixedDmg;
  } else {
    damage = calculateDamage(modifiedMove, ...);
  }

  // 10. Apply damage
  // 11. onHit / onMiss
  // 12. applyEffect (always runs for status moves)
  // 13. Flag-based post-processing (forcesSwitch, setsHazard, setsTerrain, etc.)
  // 14. selfKO
  // 15. heal
  // 16. contact abilities, form changes, etc.
}
```

- [ ] Step 1: Extract buildContext helper
- [ ] Step 2: Restructure executeFight to use the pipeline above
- [ ] Step 3: Run full test suite - must pass 836+
- [ ] Commit `refactor(pvp): restructure executeFight to use move registry`

## Task 9: Add P1 Missing Moves Using New Registry

Now adding moves is easy. Implement the 16 power-formula moves:

```typescript
register("gyro-ball", {
  modifyPower: (ctx) => Math.min(150, Math.floor(25 * ctx.defPoke.stats.speed / Math.max(1, ctx.atkPoke.stats.speed))),
});
register("electro-ball", {
  modifyPower: (ctx) => {
    const ratio = ctx.atkPoke.stats.speed / Math.max(1, ctx.defPoke.stats.speed);
    if (ratio >= 4) return 150;
    if (ratio >= 3) return 120;
    if (ratio >= 2) return 80;
    if (ratio >= 1) return 60;
    return 40;
  },
});
register("hex", {
  modifyPower: (ctx) => ctx.defPoke.statusCondition ? ctx.move.power * 2 : ctx.move.power,
});
register("venoshock", {
  modifyPower: (ctx) => ctx.defPoke.statusCondition === "poison" ? ctx.move.power * 2 : ctx.move.power,
});
register("facade", {
  modifyPower: (ctx) => ctx.atkPoke.statusCondition ? ctx.move.power * 2 : ctx.move.power,
});
register("acrobatics", {
  modifyPower: (ctx) => !ctx.atkPoke.heldItem ? ctx.move.power * 2 : ctx.move.power,
});
register("flail", {
  modifyPower: (ctx) => {
    const p = ctx.atkPoke.hp / ctx.atkPoke.maxHp;
    if (p <= 0.0417) return 200;
    if (p <= 0.1042) return 150;
    if (p <= 0.2083) return 100;
    if (p <= 0.3542) return 80;
    if (p <= 0.6875) return 40;
    return 20;
  },
});
register("reversal", { modifyPower: /* same as flail */ });
register("water-spout", {
  modifyPower: (ctx) => Math.max(1, Math.floor(150 * ctx.atkPoke.hp / ctx.atkPoke.maxHp)),
});
register("eruption", { modifyPower: /* same */ });
register("stored-power", {
  modifyPower: (ctx) => {
    const boosts = Object.values(ctx.attacker.statStages).filter(v => v > 0).reduce((a, b) => a + b, 0);
    return ctx.move.power + boosts * 20;
  },
});
register("punishment", {
  modifyPower: (ctx) => {
    const boosts = Object.values(ctx.defender.statStages).filter(v => v > 0).reduce((a, b) => a + b, 0);
    return Math.min(200, 60 + boosts * 20);
  },
});
register("payback", {
  modifyPower: (ctx) => ctx.defender.actionSubmitted ? ctx.move.power * 2 : ctx.move.power,
});
register("avalanche", { /* 2x if user hit this turn */ });
register("revenge", { /* 2x if user hit this turn, -4 priority */ });
register("last-resort", { beforeMove: /* check all moves used */ });
register("wake-up-slap", {
  modifyPower: (ctx) => ctx.defPoke.statusCondition === "sleep" ? ctx.move.power * 2 : ctx.move.power,
  onHit: (ctx) => { if (ctx.defPoke.statusCondition === "sleep") { ctx.defPoke.statusCondition = null; ctx.defPoke.sleepTurns = undefined; } },
});
register("smelling-salts", {
  modifyPower: (ctx) => ctx.defPoke.statusCondition === "paralysis" ? ctx.move.power * 2 : ctx.move.power,
  onHit: (ctx) => { if (ctx.defPoke.statusCondition === "paralysis") ctx.defPoke.statusCondition = null; },
});
register("low-kick", {
  modifyPower: (ctx) => {
    // Weight-based power - need weight data on pokemon. Simplified: use static value based on species or skip
    return ctx.move.power;
  },
});
register("grass-knot", { modifyPower: /* same weight-based */ });
register("heavy-slam", { modifyPower: /* user/target weight ratio */ });
register("heat-crash", { modifyPower: /* same */ });
```

Note: Weight-based moves need species weight data. If not available, keep default power.

- [ ] Commit `feat(pvp): add power-formula moves via move registry`

## Task 10: Add Missing Moves (Safeguard, Mist, Endure, etc.)

```typescript
register("safeguard", {
  applyEffect: (ctx) => {
    addVolatile(ctx.attacker.volatiles, "safeguard", 5);
    ctx.room.log.push("몸지킴! 상태이상이 막혔다!");
  },
});
register("mist", {
  applyEffect: (ctx) => {
    addVolatile(ctx.attacker.volatiles, "mist", 5);
    ctx.room.log.push("흰안개! 능력 하락이 막혔다!");
  },
});
register("lucky-chant", {
  applyEffect: (ctx) => {
    addVolatile(ctx.attacker.volatiles, "lucky-chant", 5);
    ctx.room.log.push("행운노래! 급소가 막혔다!");
  },
});
register("endure", {
  applyEffect: (ctx) => {
    addVolatile(ctx.attacker.volatiles, "endure", 1);
    ctx.room.log.push(`${ctx.atkPoke.species}: 버티기!`);
  },
});
```

Update pvp-room.ts to respect these volatiles:
- When applying status: check for `safeguard` on defender's side
- When applying stat drops from opponent: check for `mist`
- When computing crit: check for `lucky-chant`
- When HP would reach 0 from one hit at full HP: check for `endure`

- [ ] Commit

## Task 11: Final Testing

- [ ] Run full test suite: `cd packages/server && npx vitest run`
- [ ] Run type check: `npx tsc --noEmit`
- [ ] All 836+ tests must pass
- [ ] Commit `refactor(pvp): complete move registry migration`
